# backend/citas/views.py
from datetime import time, date as _date, datetime as _dt, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.timezone import make_aware
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied

from pacientes.models import Paciente
from odontologos.models import OdontologoHorario, BloqueoDia
from .models import (
    Consultorio,
    Cita,
    ESTADO_CANCELADA,
    ESTADO_REALIZADA,
    ESTADO_CONFIRMADA,
    ESTADO_PENDIENTE,
    ESTADO_MANTENIMIENTO
)
from .serializers import ConsultorioSerializer, CitaSerializer
from .services.consultorio_service import (
    previewMantenimientoConsultorio,
    applyMantenimientoConsultorio,
    applyReactivacionConsultorio,
)


# -------- Config & Helpers --------
# Roles
ROL_SUPERADMIN = 1
ROL_PACIENTE   = 2
ROL_ODONTOLOGO = 3
ROL_ADMIN_CLIN = 4

# Ventana de confirmación para PACIENTE
CONFIRM_FROM_HOURS  = 24
CONFIRM_UNTIL_HOURS = 12

# Auto-confirmación al crear si faltan menos de este umbral (horas)
AUTO_CONFIRM_LT_HOURS = 24

# Límites de agendamiento PACIENTE
MAX_CITAS_SEMANA = 5
MAX_CITAS_DIA    = 1

# Cooldown (días) tras cancelación hecha por PACIENTE con ese odontólogo
COOLDOWN_DIAS = 7


# ==== Helpers (camelCase) con alias para compatibilidad ====
def userRole(user) -> int | None:
    return getattr(user, "id_rol_id", None)
_user_role = userRole  # alias

def isPatient(user) -> bool:
    return userRole(user) == ROL_PACIENTE
_is_patient = isPatient  # alias

def isStafflike(user) -> bool:
    return userRole(user) in {ROL_SUPERADMIN, ROL_ODONTOLOGO, ROL_ADMIN_CLIN}
_is_stafflike = isStafflike  # alias

def fmtHhmm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t else None
_fmt_hhmm = fmtHhmm  # alias

def nowAware():
    try:
        return make_aware(_dt.now())
    except Exception:
        return _dt.now()
_nowaware = nowAware  # alias

def hoursUntil(fecha, hora) -> float | None:
    if not (fecha and hora):
        return None
    target = _dt.combine(fecha, hora)
    now = nowAware()
    return (target - now.replace(tzinfo=None)).total_seconds() / 3600.0
_hours_until = hoursUntil  # alias

def buildSlotsFromInterval(start: time, end: time) -> list[str]:
    """Genera HH:MM cada 1h desde 'start' (incl) hasta 'end' (excl), saltando 13:00 y 14:00."""
    out = []
    cur = _dt.combine(_date(2000, 1, 1), start)
    stop = _dt.combine(_date(2000, 1, 1), end)
    while cur + timedelta(hours=1) <= stop:
        if cur.hour not in (13, 14):
            out.append(cur.strftime("%H:%M"))
        cur += timedelta(hours=1)
    return out
_build_slots_from_interval = buildSlotsFromInterval  # alias

def slotsHorariosParaFecha(fechaIso: str, idOdontologo: int) -> list[str]:
    """Slots a partir de horarios vigentes del odontólogo para el día de semana dado."""
    try:
        d = _date.fromisoformat(fechaIso)
    except Exception:
        return []
    dow = d.weekday()  # Lunes=0 .. Domingo=6

    qs = (
        OdontologoHorario.objects
        .filter(id_odontologo_id=idOdontologo, vigente=True, dia_semana=dow)
        .order_by("hora_inicio")
    )
    base = []
    for h in qs:
        if h.hora_inicio and h.hora_fin and h.hora_fin > h.hora_inicio:
            base.extend(buildSlotsFromInterval(h.hora_inicio, h.hora_fin))
    return sorted(set(base))
_slots_horarios_para_fecha = slotsHorariosParaFecha  # alias

def fechaBloqueada(fechaIso: str, idOdontologo: int) -> bool:
    """True si la fecha está bloqueada (global o del odontólogo), incluye recurrentes anuales."""
    try:
        d = _date.fromisoformat(fechaIso)
    except Exception:
        return False

    qBase = Q(fecha=d)  # no recurrentes
    qRec = Q(recurrente_anual=True, fecha__month=d.month, fecha__day=d.day)  # recurrentes
    qScope = Q(id_odontologo__isnull=True) | Q(id_odontologo_id=idOdontologo)

    return BloqueoDia.objects.filter((qBase | qRec) & qScope).exists()
_fecha_bloqueada = fechaBloqueada  # alias

def bloqueoDetalle(fechaIso: str, idOdontologo: int | None):
    """
    Devuelve (bloqueado: bool, motivo: str | None).
    Si hay bloqueo por odontólogo y global el mismo día, prioriza el motivo del odontólogo.
    Si idOdontologo es None, busca solo bloqueos globales.
    Incluye recurrentes anuales.
    """
    try:
        d = _date.fromisoformat(fechaIso)
    except Exception:
        return False, None

    qDia = Q(fecha=d)
    qRec = Q(recurrente_anual=True, fecha__month=d.month, fecha__day=d.day)

    if idOdontologo is not None:
        rowOdo = (
            BloqueoDia.objects
            .filter((qDia | qRec) & Q(id_odontologo_id=idOdontologo))
            .values_list("motivo", flat=True)
            .first()
        )
        if rowOdo is not None:
            return True, rowOdo

    rowGlobal = (
        BloqueoDia.objects
        .filter((qDia | qRec) & Q(id_odontologo__isnull=True))
        .values_list("motivo", flat=True)
        .first()
    )
    if rowGlobal is not None:
        return True, rowGlobal

    return False, None
_bloqueo_detalle = bloqueoDetalle  # alias

def pacienteIdFromUser(user) -> int | None:
    """
    Devuelve id_paciente del usuario autenticado (o None si no es paciente).
    Tolera distintos nombres de PK del usuario (id_usuario, id, pk).
    """
    userIds = [
        getattr(user, "id_usuario", None),
        getattr(user, "id", None),
        getattr(user, "pk", None),
    ]
    for uid in userIds:
        if uid is None:
            continue
        pid = (
            Paciente.objects
            .filter(id_usuario_id=uid)
            .values_list("id_paciente", flat=True)
            .first()
        )
        if pid:
            return pid
    return None
_paciente_id_from_user = pacienteIdFromUser  # alias

def semanaInicioFin(d):
    # Semana Lunes–Domingo para el conteo
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday
_semana_inicio_fin = semanaInicioFin  # alias

def monthStartEnd(year: int, month: int) -> tuple[_date, _date]:
    """Primer y último día (incl.) del mes dado."""
    start = _date(year, month, 1)
    if month == 12:
        end = _date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = _date(year, month + 1, 1) - timedelta(days=1)
    return start, end
_month_start_end = monthStartEnd  # alias


# -------- ViewSets --------
class ConsultorioViewSet(viewsets.ModelViewSet):
    queryset = Consultorio.objects.all()
    serializer_class = ConsultorioSerializer
    permission_classes = [IsAuthenticated]

    def _requireAdminRole(self, request):
        role = userRole(request.user)
        if role not in {ROL_SUPERADMIN, ROL_ADMIN_CLIN}:
            raise PermissionDenied("No tienes permisos para esta acción.")

    @action(detail=True, methods=["post"], url_path="preview-mantenimiento")
    def preview_mantenimiento(self, request, pk=None):
        """
        PREVIEW: cuenta y lista las citas FUTURAS (>= effective_from) del consultorio
        que pasarían a estado 'mantenimiento'. Excluye canceladas.
        """
        self._requireAdminRole(request)
        effective_from = request.data.get("effective_from")
        try:
            dt_from = timezone.make_aware(_dt.fromisoformat(effective_from)) if effective_from else timezone.now()
        except Exception:
            dt_from = timezone.now()

        data = previewMantenimientoConsultorio(int(pk), dt_from)
        return Response(data, status=status.HTTP_200_OK)

    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="apply-mantenimiento")
    def apply_mantenimiento(self, request, pk=None):
        """
        APLICA: marca como 'mantenimiento' las citas FUTURAS (>= effective_from) del consultorio.
        Params:
          - confirm: true (requerido)
          - effective_from: ISO opcional (default now)
          - set_inactive: bool opcional (default true) -> desactiva el consultorio al final
        """
        self._requireAdminRole(request)
        if not request.data.get("confirm"):
            return Response({"detail": "Falta confirm"}, status=status.HTTP_400_BAD_REQUEST)

        consultorio = self.get_object()

        effective_from = request.data.get("effective_from")
        try:
            dt_from = timezone.make_aware(_dt.fromisoformat(effective_from)) if effective_from else timezone.now()
        except Exception:
            dt_from = timezone.now()

        by_role = userRole(request.user) or ROL_SUPERADMIN
        result = applyMantenimientoConsultorio(consultorio, byRoleId=by_role, dtFrom=dt_from)

        set_inactive = request.data.get("set_inactive", True)
        if bool(set_inactive):
            consultorio.estado = False
            consultorio.save(update_fields=["estado"])

        payload = {
            **result,
            "consultorio": {
                "id_consultorio": consultorio.id_consultorio,
                "numero": consultorio.numero,
                "estado": consultorio.estado,
            },
        }
        return Response(payload, status=status.HTTP_200_OK)

    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="apply-reactivate")
    def apply_reactivate(self, request, pk=None):
        """
        REACTIVAR: pasa a 'pendiente' todas las citas FUTURAS del consultorio que estén en 'mantenimiento'.
        Params:
          - effective_from: ISO opcional (default now)
          - set_active: bool opcional (default true) -> activa el consultorio al final
        """
        self._requireAdminRole(request)

        consultorio = self.get_object()

        effective_from = request.data.get("effective_from")
        try:
            dt_from = timezone.make_aware(_dt.fromisoformat(effective_from)) if effective_from else timezone.now()
        except Exception:
            dt_from = timezone.now()

        result = applyReactivacionConsultorio(consultorio, dtFrom=dt_from)

        set_active = request.data.get("set_active", True)
        if bool(set_active):
            consultorio.estado = True
            consultorio.save(update_fields=["estado"])

        payload = {
            **result,
            "consultorio": {
                "id_consultorio": consultorio.id_consultorio,
                "numero": consultorio.numero,
                "estado": consultorio.estado,
            },
        }
        return Response(payload, status=status.HTTP_200_OK)

class CitaViewSet(viewsets.ModelViewSet):
    queryset = (
        Cita.objects
        .select_related(
            "id_paciente__id_usuario",
            "id_odontologo__id_usuario",
            "id_consultorio",
        )
        .order_by("-fecha", "-hora")
    )
    serializer_class = CitaSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        baseQs = super().get_queryset()
        params = self.request.query_params
        odontologoId = params.get("id_odontologo")
        nombre = params.get("paciente_nombre") or params.get("nombre")
        cedula = params.get("cedula")
        fecha = params.get("fecha")
        estado = params.get("estado")
        consultorioId = params.get("id_consultorio")

        if odontologoId:
            baseQs = baseQs.filter(id_odontologo_id=odontologoId)
        if consultorioId:
            baseQs = baseQs.filter(id_consultorio_id=consultorioId)
        if nombre:
            baseQs = baseQs.filter(
                Q(id_paciente__id_usuario__primer_nombre__icontains=nombre)
                | Q(id_paciente__id_usuario__segundo_nombre__icontains=nombre)
                | Q(id_paciente__id_usuario__primer_apellido__icontains=nombre)
                | Q(id_paciente__id_usuario__segundo_apellido__icontains=nombre)
            )
        if cedula:
            baseQs = baseQs.filter(id_paciente__id_usuario__cedula__icontains=cedula)
        if fecha:
            baseQs = baseQs.filter(fecha=fecha)
        if estado:
            baseQs = baseQs.filter(estado=estado)

        # --- filtro por paciente explícito ---
        pacienteId = params.get("id_paciente")
        if pacienteId:
            try:
                baseQs = baseQs.filter(id_paciente_id=int(pacienteId))
            except (TypeError, ValueError):
                return Cita.objects.none()

        # --- rango de fechas (start/end o alias) ---
        start = params.get("start") or params.get("from") or params.get("fecha_desde")
        end   = params.get("end")   or params.get("to")   or params.get("fecha_hasta")
        if start and end:
            baseQs = baseQs.filter(fecha__range=[start, end])
        elif start:
            baseQs = baseQs.filter(fecha__gte=start)
        elif end:
            baseQs = baseQs.filter(fecha__lte=end)

        # --- Blindaje: si es PACIENTE (rol=2), solo ve sus citas ---
        userRoleId = getattr(self.request.user, "id_rol_id", None)
        if userRoleId == ROL_PACIENTE:
            myPid = pacienteIdFromUser(self.request.user)
            if myPid:
                baseQs = baseQs.filter(id_paciente_id=myPid)
            else:
                return Cita.objects.none()

        return baseQs

    # -------- Seguridad extra en creación/edición --------
    def perform_create(self, serializer):
        """Si el usuario es PACIENTE, aplicar límites; staff/odo/admin sin restricciones."""
        user = self.request.user
        if isPatient(user):
            myPid = pacienteIdFromUser(user)
            if not myPid:
                raise ValidationError({"detail": "Usuario no asociado a un paciente válido."})

            vData = dict(serializer.validated_data)
            fecha = vData.get("fecha")
            hora = vData.get("hora")
            idOdontologo = vData.get("id_odontologo")
            odontologoPk = getattr(idOdontologo, "pk", idOdontologo)

            # 1) Máx. 1 cita por día (excluye canceladas y mantenimiento)
            if fecha:
                existeMismoDia = Cita.objects.filter(
                    id_paciente_id=myPid,
                    fecha=fecha,
                ).exclude(estado__in=[ESTADO_CANCELADA, ESTADO_MANTENIMIENTO]).exists()
                if existeMismoDia:
                    raise ValidationError({"fecha": "Solo puedes agendar 1 cita por día."})

            # 2) Máx. 5 citas por semana (excluye canceladas y mantenimiento)
            if fecha:
                ini, fin = semanaInicioFin(fecha)
                countSemana = Cita.objects.filter(
                    id_paciente_id=myPid,
                    fecha__range=[ini, fin],
                ).exclude(estado__in=[ESTADO_CANCELADA, ESTADO_MANTENIMIENTO]).count()
                if countSemana >= MAX_CITAS_SEMANA:
                    raise ValidationError({"fecha": f"Solo puedes agendar {MAX_CITAS_SEMANA} citas por semana."})

            # 3) Una cita activa (pendiente/confirmada) por odontólogo
            if odontologoPk:
                conflict = Cita.objects.filter(
                    id_paciente_id=myPid,
                    id_odontologo_id=odontologoPk,
                    estado__in=[ESTADO_PENDIENTE, ESTADO_CONFIRMADA],
                ).exists()
                if conflict:
                    raise ValidationError({"id_odontologo": "Ya tienes una cita activa con este odontólogo."})

                # 4) Cooldown tras cancelación hecha por PACIENTE (últimos COOLDOWN_DIAS)
                hace = timezone.now() - timedelta(days=COOLDOWN_DIAS)
                tieneCancelRecienteMismoOdo = Cita.objects.filter(
                    id_paciente_id=myPid,
                    id_odontologo_id=odontologoPk,
                    estado=ESTADO_CANCELADA,
                    cancelada_por_rol=ROL_PACIENTE,
                    cancelada_en__gte=hace,
                ).exists()
                if tieneCancelRecienteMismoOdo:
                    raise ValidationError({
                        "id_odontologo": f"No puedes autogendar con este odontólogo durante {COOLDOWN_DIAS} días después de cancelar. Comunícate con el consultorio."
                    })

            # === Estado inicial según la anticipación (< 24h => confirmada) ===
            horas = hoursUntil(fecha, hora)
            estadoInicial = ESTADO_PENDIENTE
            if horas is not None and horas < AUTO_CONFIRM_LT_HOURS:
                estadoInicial = ESTADO_CONFIRMADA

            serializer.save(
                id_paciente_id=myPid,
                reprogramaciones=0,
                estado=estadoInicial,
            )
        else:
            # Staff/Odontólogo/Admin sin límites
            vData = dict(serializer.validated_data)
            horas = hoursUntil(vData.get("fecha"), vData.get("hora"))
            estadoInicial = ESTADO_PENDIENTE
            if horas is not None and horas < AUTO_CONFIRM_LT_HOURS:
                estadoInicial = ESTADO_CONFIRMADA

            serializer.save(estado=estadoInicial)

    def perform_update(self, serializer):
        """PACIENTE no puede cambiar citas ajenas ni saltarse restricciones."""
        user = self.request.user
        instance: Cita = self.get_object()

        if isPatient(user):
            myPid = pacienteIdFromUser(user)
            if not myPid:
                raise PermissionDenied("No es un paciente válido.")
            if instance.id_paciente_id != myPid:
                raise PermissionDenied("No puedes modificar citas de otro paciente.")

            # Bloqueos según estado actual
            if instance.estado == ESTADO_CONFIRMADA:
                blockedFields = {"fecha", "hora", "id_odontologo", "id_consultorio", "estado"}
                if any(f in serializer.validated_data for f in blockedFields):
                    raise ValidationError({"detail": "No puedes modificar una cita confirmada desde la app. Llama al consultorio."})

            if instance.estado in (ESTADO_CANCELADA, ESTADO_MANTENIMIENTO):
                if any(f in serializer.validated_data for f in {"fecha", "hora", "estado"}):
                    raise ValidationError({"detail": "No puedes modificar una cita cancelada o en mantenimiento."})

            # Reprogramación vía PATCH (cambio de fecha/hora)
            changingDate = ("fecha" in serializer.validated_data) or ("hora" in serializer.validated_data)
            if changingDate:
                if instance.reprogramaciones >= 1:
                    raise ValidationError({"detail": "Solo puedes reprogramar una vez."})

                nuevaFecha = serializer.validated_data.get("fecha", instance.fecha)

                # 1 por día
                existeMismoDia = Cita.objects.filter(
                    id_paciente_id=myPid,
                    fecha=nuevaFecha,
                ).exclude(pk=instance.pk).exclude(estado__in=[ESTADO_CANCELADA, ESTADO_MANTENIMIENTO]).exists()
                if existeMismoDia:
                    raise ValidationError({"fecha": "Solo puedes agendar 1 cita por día."})

                # 5 por semana
                ini, fin = semanaInicioFin(nuevaFecha)
                countSemana = Cita.objects.filter(
                    id_paciente_id=myPid,
                    fecha__range=[ini, fin],
                ).exclude(estado__in=[ESTADO_CANCELADA, ESTADO_MANTENIMIENTO]).exclude(pk=instance.pk).count()
                if countSemana >= MAX_CITAS_SEMANA:
                    raise ValidationError({"fecha": f"Solo puedes agendar {MAX_CITAS_SEMANA} citas por semana."})

                serializer.validated_data["reprogramaciones"] = (instance.reprogramaciones or 0) + 1

            serializer.save(id_paciente_id=myPid)
        else:
            serializer.save()

    @action(detail=False, methods=["get"], url_path="disponibilidad")
    def disponibilidad(self, request):
        """Horas disponibles respetando horarios, bloqueos y ocupadas."""
        fecha = request.query_params.get("fecha")
        idOdontologoParam = request.query_params.get("id_odontologo")
        idConsultorioParam = request.query_params.get("id_consultorio")

        if not fecha or not idOdontologoParam:
            return Response({"detail": "Parámetros requeridos: fecha, id_odontologo"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            odontologoId = int(idOdontologoParam)
        except Exception:
            return Response({"detail": "id_odontologo inválido."}, status=status.HTTP_400_BAD_REQUEST)

        # 1) Si la fecha está bloqueada
        if fechaBloqueada(fecha, odontologoId):
            return Response({
                "fecha": fecha,
                "id_odontologo": odontologoId,
                "id_consultorio": int(idConsultorioParam) if idConsultorioParam else None,
                "ocupadas_odontologo": [],
                "ocupadas_consultorio": [],
                "ocupadas": [],
                "disponibles": [],
            }, status=status.HTTP_200_OK)

        # 2) Base de slots
        baseSlots = slotsHorariosParaFecha(fecha, odontologoId)

        # 3) Restar ocupadas (pendientes, confirmadas, realizadas, mantenimiento)
        qsOdo = (
            Cita.objects.filter(fecha=fecha, id_odontologo_id=odontologoId)
            .exclude(estado=ESTADO_CANCELADA)
        )
        ocupadasOdo = {fmtHhmm(c.hora) for c in qsOdo if c.hora}

        ocupadasCons = set()
        if idConsultorioParam:
            try:
                consultorioId = int(idConsultorioParam)
                qsCons = (
                    Cita.objects.filter(fecha=fecha, id_consultorio_id=consultorioId)
                    .exclude(estado=ESTADO_CANCELADA)
                )
                ocupadasCons = {fmtHhmm(c.hora) for c in qsCons if c.hora}
            except Exception:
                pass

        ocupadas = {h for h in (ocupadasOdo | ocupadasCons) if h is not None}
        disponibles = [h for h in baseSlots if h not in ocupadas]

        return Response({
            "fecha": fecha,
            "id_odontologo": odontologoId,
            "id_consultorio": int(idConsultorioParam) if idConsultorioParam else None,
            "ocupadas_odontologo": sorted([h for h in ocupadasOdo if h]),
            "ocupadas_consultorio": sorted([h for h in ocupadasCons if h]),
            "ocupadas": sorted(list(ocupadas)),
            "disponibles": disponibles,
        }, status=status.HTTP_200_OK)


    # ===================== NUEVOS ENDPOINTS =====================

    @action(detail=False, methods=["get"], url_path="dia-metadata")
    def dia_metadata(self, request):
        """
        Metadatos del día:
          - slots_totales / slots_ocupados / lleno (solo si se pasa id_odontologo)
          - bloqueado: True si día está bloqueado (global u odontólogo)
          - motivo_bloqueo: texto del bloqueo (prioriza del odontólogo; si no, global)
        Modo odontólogo: ?fecha=YYYY-MM-DD&id_odontologo=ID[&id_consultorio=ID]
        Modo global (admin): ?fecha=YYYY-MM-DD  (slots_* = 0, lleno=False, bloqueo global)
        """
        fecha = request.query_params.get("fecha")
        idOdontologoParam = request.query_params.get("id_odontologo")
        idConsultorioParam = request.query_params.get("id_consultorio")

        if not fecha:
            return Response({"detail": "Parámetro requerido: fecha"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            _date.fromisoformat(fecha)
        except Exception:
            return Response({"detail": "fecha inválida (YYYY-MM-DD)"}, status=status.HTTP_400_BAD_REQUEST)

        if idOdontologoParam is not None:
            try:
                odontologoId = int(idOdontologoParam)
            except Exception:
                return Response({"detail": "id_odontologo inválido."}, status=status.HTTP_400_BAD_REQUEST)

            baseSlots = slotsHorariosParaFecha(fecha, odontologoId)
            slotsTotales = len(baseSlots)

            qs = (
                Cita.objects.filter(fecha=fecha, id_odontologo_id=odontologoId)
                .exclude(estado__in=[ESTADO_CANCELADA, ESTADO_MANTENIMIENTO])
            )
            if idConsultorioParam:
                try:
                    qs = qs.filter(id_consultorio_id=int(idConsultorioParam))
                except Exception:
                    pass

            ocupadas = {fmtHhmm(c.hora) for c in qs if c.hora}
            slotsOcupados = len([h for h in ocupadas if h is not None])

            bloqueado, motivo = bloqueoDetalle(fecha, odontologoId)
            lleno = slotsTotales > 0 and slotsOcupados >= slotsTotales

            return Response(
                {
                    "fecha": fecha,
                    "id_odontologo": odontologoId,
                    "id_consultorio": int(idConsultorioParam) if idConsultorioParam else None,
                    "slots_totales": slotsTotales,
                    "slots_ocupados": slotsOcupados,
                    "lleno": bool(lleno),
                    "bloqueado": bool(bloqueado),
                    "motivo_bloqueo": motivo,
                },
                status=status.HTTP_200_OK,
            )
        else:
            bloqueado, motivo = bloqueoDetalle(fecha, None)
            return Response(
                {
                    "fecha": fecha,
                    "id_odontologo": None,
                    "id_consultorio": int(idConsultorioParam) if idConsultorioParam else None,
                    "slots_totales": 0,
                    "slots_ocupados": 0,
                    "lleno": False,
                    "bloqueado": bool(bloqueado),
                    "motivo_bloqueo": motivo,
                },
                status=status.HTTP_200_OK,
            )

    @action(detail=False, methods=["get"], url_path="resumen-mensual")
    def resumen_mensual(self, request):
        """
        Resumen por día del mes (modo odontólogo o global):
          Retorna { "YYYY-MM-DD": { "total_citas": int, "slots_totales": int, "slots_ocupados": int, "lleno": bool, "bloqueado": bool } }
        Params requeridos: ?year=YYYY&month=M
        Opcional:
          - &id_odontologo=ID  -> filtra por odontólogo y calcula slots/lleno y bloqueos (global u odo)
          - &id_consultorio=ID -> filtro adicional
        Reglas:
          - total_citas: cuenta TODAS las citas del día (según filtros), todos los estados
          - slots_ocupados: excluye canceladas y mantenimiento (solo si hay id_odontologo)
          - slots_totales: horarios del odontólogo (solo si hay id_odontologo)
          - bloqueado: global si no hay odontólogo; global u odontólogo si lo hay
        """
        try:
            year = int(request.query_params.get("year", ""))
            month = int(request.query_params.get("month", ""))
        except Exception:
            return Response({"detail": "Parámetros requeridos: year, month"}, status=status.HTTP_400_BAD_REQUEST)

        idOdontologoParam = request.query_params.get("id_odontologo")
        idConsultorioParam = request.query_params.get("id_consultorio")
        odontologoId = None
        if idOdontologoParam not in (None, "",):
            try:
                odontologoId = int(idOdontologoParam)
            except Exception:
                return Response({"detail": "id_odontologo inválido."}, status=status.HTTP_400_BAD_REQUEST)

        start, end = monthStartEnd(year, month)
        daysCount = (end - start).days + 1

        qsBase = Cita.objects.filter(fecha__range=[start, end])
        if odontologoId is not None:
            qsBase = qsBase.filter(id_odontologo_id=odontologoId)
        if idConsultorioParam:
            try:
                qsBase = qsBase.filter(id_consultorio_id=int(idConsultorioParam))
            except Exception:
                pass

        resumen = {}
        for i in range(daysCount):
            d = start + timedelta(days=i)
            iso = d.isoformat()

            totalCitas = qsBase.filter(fecha=d).count()

            if odontologoId is not None:
                ocupadas = qsBase.filter(fecha=d).exclude(estado__in=[ESTADO_CANCELADA, ESTADO_MANTENIMIENTO])
                hh = {fmtHhmm(c.hora) for c in ocupadas if c.hora}
                slotsOcupados = len([h for h in hh if h is not None])

                slotsTotales = len(slotsHorariosParaFecha(iso, odontologoId))
                bloqueado = fechaBloqueada(iso, odontologoId)
                lleno = slotsTotales > 0 and slotsOcupados >= slotsTotales
            else:
                slotsTotales = 0
                slotsOcupados = 0
                lleno = False
                bloqueado = BloqueoDia.objects.filter(
                    (Q(fecha=d) | (Q(recurrente_anual=True, fecha__month=d.month, fecha__day=d.day)))
                    & Q(id_odontologo__isnull=True)
                ).exists()

            resumen[iso] = {
                "total_citas": totalCitas,
                "slots_totales": slotsTotales,
                "slots_ocupados": slotsOcupados,
                "lleno": bool(lleno),
                "bloqueado": bool(bloqueado),
            }

        return Response(resumen, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="bloqueos-mes")
    def bloqueos_mes(self, request):
        """
        Lista de días bloqueados en un rango [from, to].
        Params:
          - from=YYYY-MM-DD (requerido)
          - to=YYYY-MM-DD   (requerido)
          - id_odontologo (opcional): si se pasa, mezcla bloqueos del odontólogo + globales.
                                      si no se pasa, devuelve SOLO bloqueos globales.
        Respuesta: [{"fecha": "YYYY-MM-DD", "motivo": str | null}, ...]  (único por fecha)
        """
        paramFrom = request.query_params.get("from")
        paramTo = request.query_params.get("to")
        idOdontologoParam = request.query_params.get("id_odontologo")

        if not (paramFrom and paramTo):
            return Response({"detail": "Parámetros requeridos: from, to"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            start = _date.fromisoformat(paramFrom)
            end = _date.fromisoformat(paramTo)
        except Exception:
            return Response({"detail": "Formato inválido de from/to (YYYY-MM-DD)."}, status=status.HTTP_400_BAD_REQUEST)
        if end < start:
            return Response({"detail": "El rango debe ser válido (to >= from)."}, status=status.HTTP_400_BAD_REQUEST)

        odontologoId = None
        if idOdontologoParam not in (None, "",):
            try:
                odontologoId = int(idOdontologoParam)
            except Exception:
                return Response({"detail": "id_odontologo inválido."}, status=status.HTTP_400_BAD_REQUEST)

        qScope = Q(id_odontologo__isnull=True)
        if odontologoId is not None:
            qScope = qScope | Q(id_odontologo_id=odontologoId)

        rows = list(
            BloqueoDia.objects
            .filter(qScope & (Q(fecha__range=[start, end]) | Q(recurrente_anual=True)))
            .values("fecha", "recurrente_anual", "motivo", "id_odontologo_id")
        )

        out = {}
        days = (end - start).days + 1
        for i in range(days):
            d = start + timedelta(days=i)
            motivoOdo = None
            motivoGlobal = None
            for r in rows:
                if r["fecha"] == d:
                    if r["id_odontologo_id"] is None:
                        motivoGlobal = motivoGlobal or r.get("motivo")
                    elif odontologoId is not None and r["id_odontologo_id"] == odontologoId:
                        motivoOdo = motivoOdo or r.get("motivo")
                elif r["recurrente_anual"] and r["fecha"] is not None:
                    if r["fecha"].month == d.month and r["fecha"].day == d.day:
                        if r["id_odontologo_id"] is None:
                            motivoGlobal = motivoGlobal or r.get("motivo")
                        elif odontologoId is not None and r["id_odontologo_id"] == odontologoId:
                            motivoOdo = motivoOdo or r.get("motivo")

            motivo = motivoOdo if motivoOdo is not None else motivoGlobal
            if motivo is not None:
                out[d.isoformat()] = motivo

        return Response(
            [{"fecha": k, "motivo": v} for k, v in sorted(out.items(), key=lambda kv: kv[0])],
            status=status.HTTP_200_OK
        )

    # -------- Acciones para el PACIENTE autenticado --------

    @action(
        detail=False,
        methods=["get"],
        url_path="paciente/mis-citas/proxima",
        permission_classes=[IsAuthenticated],
    )
    def proxima_para_paciente(self, request):
        """Próxima cita del paciente autenticado (la más cercana futura), excluye canceladas y mantenimiento."""
        pid = pacienteIdFromUser(request.user)
        if not pid:
            return Response({"detail": "No es un paciente válido."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            now = make_aware(_dt.now())
        except Exception:
            now = _dt.now()

        hoy = now.date()
        baseQs = (
            self.get_queryset()
            .filter(id_paciente_id=pid)
            .exclude(estado__in=[ESTADO_CANCELADA, ESTADO_MANTENIMIENTO])
            .filter(Q(fecha__gt=hoy) | Q(fecha=hoy, hora__gte=now.time()))
            .order_by("fecha", "hora")
        )
        citaObj = baseQs.first()
        if not citaObj:
            return Response(None, status=status.HTTP_200_OK)

        data = {
            "id_cita": citaObj.id_cita,
            "fecha": citaObj.fecha.isoformat() if citaObj.fecha else None,
            "hora_inicio": fmtHhmm(citaObj.hora),
            "estado": citaObj.estado,
            "motivo": getattr(citaObj, "motivo", None),
            "odontologo": (
                {
                    "id_odontologo": citaObj.id_odontologo_id,
                    "nombre": " ".join(
                        filter(
                            None,
                            [
                                getattr(citaObj.id_odontologo.id_usuario, "primer_nombre", None),
                                getattr(citaObj.id_odontologo.id_usuario, "primer_apellido", None),
                            ],
                        )
                    ).strip(),
                }
                if citaObj.id_odontologo_id and getattr(citaObj, "id_odontologo", None)
                else None
            ),
            "consultorio": (
                {
                    "id_consultorio": citaObj.id_consultorio_id,
                    "nombre": getattr(citaObj.id_consultorio, "descripcion", None),
                    "numero": getattr(citaObj.id_consultorio, "numero", None),
                }
                if citaObj.id_consultorio_id and getattr(citaObj, "id_consultorio", None)
                else None
            ),
            "reprogramaciones": citaObj.reprogramaciones or 0,
            "ya_reprogramada": (citaObj.reprogramaciones or 0) >= 1,
        }
        return Response(data, status=status.HTTP_200_OK)

    @action(
        detail=False,
        methods=["get"],
        url_path="paciente/mis-citas/resumen",
        permission_classes=[IsAuthenticated],
    )
    def resumen_para_paciente(self, request):
        """
        Resumen del historial del paciente autenticado:
          - citas_completadas: total en estado 'realizada'
          - ultima_visita: fecha de la última 'realizada'
          - ultima_observacion: texto de esa última (si existe)
        """
        pid = pacienteIdFromUser(request.user)
        if not pid:
            return Response(
                {"citas_completadas": 0, "ultima_visita": None, "ultima_observacion": None},
                status=status.HTTP_200_OK,
            )

        baseQs = (
            self.get_queryset()
            .filter(id_paciente_id=pid, estado=ESTADO_REALIZADA)
            .order_by("-fecha", "-hora")
        )
        total = baseQs.count()
        ultima = baseQs.first()
        ultimaObs = getattr(ultima, "observacion", None) if ultima else None

        data = {
            "citas_completadas": total,
            "ultima_visita": ultima.fecha.isoformat() if ultima and ultima.fecha else None,
            "ultima_observacion": ultimaObs,
        }
        return Response(data, status=status.HTTP_200_OK)

    # -------- Acciones de estado --------

    @action(detail=True, methods=["patch"], url_path="confirmar")
    def confirmar(self, request, pk=None):
        """
        Marca la cita como 'confirmada'.
        - Paciente: solo entre 24h y 12h antes.
        - Staff/Odo/Admin: sin ventana.
        - Nunca si está cancelada, realizada o en mantenimiento.
        """
        citaObj: Cita = self.get_object()
        user = request.user

        if citaObj.estado in (ESTADO_CANCELADA, ESTADO_REALIZADA, ESTADO_MANTENIMIENTO):
            return Response({"detail": "La cita no se puede confirmar en su estado actual."}, status=status.HTTP_400_BAD_REQUEST)

        if isPatient(user):
            hrs = hoursUntil(citaObj.fecha, citaObj.hora)
            if hrs is None:
                return Response({"detail": "Cita sin fecha/hora válidas."}, status=status.HTTP_400_BAD_REQUEST)
            if not (CONFIRM_UNTIL_HOURS <= hrs <= CONFIRM_FROM_HOURS):
                return Response({"detail": f"Solo puedes confirmar entre {CONFIRM_FROM_HOURS}h y {CONFIRM_UNTIL_HOURS}h antes."}, status=status.HTTP_400_BAD_REQUEST)

        citaObj.estado = ESTADO_CONFIRMADA
        citaObj.save(update_fields=["estado"])
        return Response({"id_cita": citaObj.id_cita, "estado": citaObj.estado}, status=status.HTTP_200_OK)

    @transaction.atomic
    @action(detail=True, methods=["patch"], url_path="cancelar")
    def cancelar(self, request, pk=None):
        """
        Marca la cita como 'cancelada'.
        - Paciente: no puede cancelar si ya estaba confirmada (app); se registra cancelada_en y cancelada_por_rol=2.
        - Staff/Odo/Admin: pueden cancelar siempre; no se setea cancelada_en (no aplica cooldown), pero sí cancelada_por_rol.
        - No se permite cancelar si está realizada o en mantenimiento.
        """
        citaObj: Cita = self.get_object()
        user = self.request.user

        if citaObj.estado in (ESTADO_REALIZADA, ESTADO_MANTENIMIENTO):
            return Response({"detail": "La cita no se puede cancelar en su estado actual."}, status=status.HTTP_400_BAD_REQUEST)
        if citaObj.estado == ESTADO_CANCELADA:
            return Response({"id_cita": citaObj.id_cita, "estado": citaObj.estado}, status=status.HTTP_200_OK)

        if isPatient(user):
            if citaObj.estado == ESTADO_CONFIRMADA:
                return Response({"detail": "No puedes cancelar una cita confirmada desde la app. Llama al consultorio."}, status=status.HTTP_400_BAD_REQUEST)
            citaObj.estado = ESTADO_CANCELADA
            citaObj.cancelada_en = timezone.now()
            citaObj.cancelada_por_rol = ROL_PACIENTE
            citaObj.save(update_fields=["estado", "cancelada_en", "cancelada_por_rol"])
        else:
            citaObj.estado = ESTADO_CANCELADA
            citaObj.cancelada_por_rol = userRole(user)
            citaObj.save(update_fields=["estado", "cancelada_por_rol"])

        return Response({"id_cita": citaObj.id_cita, "estado": citaObj.estado}, status=status.HTTP_200_OK)

    @transaction.atomic
    @action(detail=True, methods=["patch"], url_path="reprogramar")
    def reprogramar(self, request, pk=None):
        """
        Reprograma fecha/hora (y opcional consultorio).
        - Paciente: solo si no está confirmada/cancelada/mantenimiento; máx. 1 vez; respeta 1/día y 5/semana.
        - Staff/Odo/Admin: sin límites.
        """
        citaObj: Cita = self.get_object()
        user = self.request.user

        nuevaFechaParam = request.data.get("fecha")
        nuevaHoraParam = request.data.get("hora")
        nuevoConsultorioParam = request.data.get("id_consultorio")

        if not (nuevaFechaParam and nuevaHoraParam):
            return Response({"detail": "Se requiere fecha y hora."}, status=status.HTTP_400_BAD_REQUEST)

        if citaObj.estado in (ESTADO_REALIZADA, ESTADO_CANCELADA, ESTADO_MANTENIMIENTO):
            return Response({"detail": "No se puede reprogramar una cita cancelada, realizada o en mantenimiento."}, status=status.HTTP_400_BAD_REQUEST)

        if isPatient(user):
            myPid = pacienteIdFromUser(user)
            if not myPid or myPid != citaObj.id_paciente_id:
                return Response({"detail": "No puedes reprogramar citas de otro paciente."}, status=status.HTTP_403_FORBIDDEN)

            if citaObj.estado == ESTADO_CONFIRMADA:
                return Response({"detail": "No puedes reprogramar una cita confirmada desde la app. Llama al consultorio."}, status=status.HTTP_400_BAD_REQUEST)

            if (citaObj.reprogramaciones or 0) >= 1:
                return Response({"detail": "Solo puedes reprogramar una vez."}, status=status.HTTP_400_BAD_REQUEST)

            try:
                nuevaFechaObj = _date.fromisoformat(str(nuevaFechaParam))
            except Exception:
                return Response({"fecha": "Fecha inválida (YYYY-MM-DD)."}, status=status.HTTP_400_BAD_REQUEST)

            existeMismoDia = Cita.objects.filter(
                id_paciente_id=myPid,
                fecha=nuevaFechaObj,
            ).exclude(pk=citaObj.pk).exclude(estado__in=[ESTADO_CANCELADA, ESTADO_MANTENIMIENTO]).exists()
            if existeMismoDia:
                return Response({"fecha": "Solo puedes agendar 1 cita por día."}, status=status.HTTP_400_BAD_REQUEST)

            ini, fin = semanaInicioFin(nuevaFechaObj)
            countSemana = Cita.objects.filter(
                id_paciente_id=myPid,
                fecha__range=[ini, fin],
            ).exclude(estado__in=[ESTADO_CANCELADA, ESTADO_MANTENIMIENTO]).exclude(pk=citaObj.pk).count()
            if countSemana >= MAX_CITAS_SEMANA:
                return Response({"fecha": f"Solo puedes agendar {MAX_CITAS_SEMANA} citas por semana."}, status=status.HTTP_400_BAD_REQUEST)

            citaObj.reprogramaciones = (citaObj.reprogramaciones or 0) + 1

        try:
            citaObj.fecha = _date.fromisoformat(str(nuevaFechaParam))
        except Exception:
            return Response({"fecha": "Fecha inválida (YYYY-MM-DD)."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            hParts = str(nuevaHoraParam).split(":")
            citaObj.hora = time(hour=int(hParts[0]), minute=int(hParts[1]) if len(hParts) > 1 else 0)
        except Exception:
            return Response({"hora": "Hora inválida (HH:MM)."}, status=status.HTTP_400_BAD_REQUEST)

        if nuevoConsultorioParam:
            try:
                citaObj.id_consultorio_id = int(nuevoConsultorioParam)
            except Exception:
                return Response({"id_consultorio": "id_consultorio inválido."}, status=status.HTTP_400_BAD_REQUEST)

        citaObj.full_clean()
        citaObj.save()
        return Response(
            {"id_cita": citaObj.id_cita, "estado": citaObj.estado, "reprogramaciones": citaObj.reprogramaciones},
            status=status.HTTP_200_OK
        )