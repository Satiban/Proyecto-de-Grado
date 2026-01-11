# backend/odontologos/views.py
from uuid import UUID
import datetime as _dt
import calendar

from django.db import transaction
from django.db.models import Min, Max, F, Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import (
    IsAuthenticated, AllowAny, BasePermission, SAFE_METHODS
)
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from .models import (
    Odontologo, Especialidad, OdontologoEspecialidad, BloqueoDia, OdontologoHorario
)
from .serializers import (
    OdontologoSerializer, EspecialidadSerializer, OdontologoEspecialidadSerializer,
    OdontologoHorarioSerializer, BloqueoGrupoSerializer
)

# === importar servicios de citas ===
from citas.services.odontologo_service import (
    previewMantenimientoOdontologo,
    applyMantenimientoOdontologo,
    applyReactivacionOdontologo,
)

from citas.services.bloqueo_service import (
    previewMantenimientoBloqueo,
    applyMantenimientoBloqueo,
    previewReactivacionBloqueo,
    applyReactivacionBloqueo,
)


# ===== Constantes de Rol =====
ROL_SUPERADMIN = 1
ROL_ADMIN_CLIN = 4


def userRole(user) -> int | None:
    return getattr(user, "id_rol_id", None)


# ===== Permisos =====

# Admin u odontólogo pueden escribir; cualquiera puede leer
class IsAdminOrDentist(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        return getattr(user, "id_rol_id", None) in (1, 3)


# Admin o el propio odontólogo pueden modificar ese recurso
class IsOwnerDentistOrAdmin(BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        if getattr(user, "id_rol_id", None) == 1:
            return True  # admin
        # dueño: user == obj.id_usuario
        return getattr(obj, "id_usuario_id", None) == getattr(user, "id_usuario", None)


# ===== ViewSets =====

class OdontologoViewSet(viewsets.ModelViewSet):
    """
    CRUD de Odontólogo + acciones extra:
      - GET /odontologos/{id}/horarios_vigentes
      - GET /odontologos/{id}/bloqueos
      - GET /odontologos/me
      - POST /odontologos/{id}/preview-mantenimiento
      - POST /odontologos/{id}/apply-mantenimiento
      - POST /odontologos/{id}/apply-reactivate
    """
    queryset = Odontologo.objects.select_related(
        "id_usuario",
        "id_consultorio_defecto",
    ).all()
    serializer_class = OdontologoSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsAuthenticated, IsOwnerDentistOrAdmin]

    # --- Helpers internos ---
    def _requireAdminRole(self, request):
        role = userRole(request.user)
        if role not in {ROL_SUPERADMIN, ROL_ADMIN_CLIN}:
            raise PermissionDenied("No tienes permisos para esta acción.")

    # --- Endpoints propios ---
    @action(detail=False, methods=["get"], url_path="me", permission_classes=[IsAuthenticated])
    def me(self, request):
        """Devuelve el odontólogo vinculado al usuario autenticado (o null si no es odontólogo)."""
        uid = getattr(request.user, "id_usuario", None) or getattr(request.user, "pk", None)
        if not uid:
            return Response({"detail": "Usuario inválido."}, status=status.HTTP_400_BAD_REQUEST)

        odo = Odontologo.objects.select_related("id_usuario", "id_consultorio_defecto") \
                                .filter(id_usuario_id=uid).first()
        if not odo:
            return Response(None, status=status.HTTP_200_OK)

        ser = OdontologoSerializer(odo, context={"request": request})
        return Response(ser.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="horarios_vigentes", permission_classes=[IsAuthenticated])
    def horarios_vigentes(self, request, pk=None):
        qs = (
            OdontologoHorario.objects
            .filter(id_odontologo_id=pk, vigente=True)
            .order_by("dia_semana", "hora_inicio")
        )
        data = [
            {
                "dia_semana": h.dia_semana,
                "hora_inicio": h.hora_inicio.strftime("%H:%M") if h.hora_inicio else None,
                "hora_fin": h.hora_fin.strftime("%H:%M") if h.hora_fin else None,
                "vigente": bool(h.vigente),
            }
            for h in qs
        ]
        return Response(data)

    @action(detail=True, methods=["get"], url_path="bloqueos", permission_classes=[IsAuthenticated])
    def bloqueos(self, request, pk=None):
        """Devuelve lista de días bloqueados para el rango dado (own/global/all)."""
        from_date = request.query_params.get("from") or request.query_params.get("start")
        to_date = request.query_params.get("to") or request.query_params.get("end")
        include = (request.query_params.get("include") or "own").lower()

        if not from_date or not to_date:
            return Response([], status=status.HTTP_200_OK)

        try:
            start = _dt.date.fromisoformat(from_date)
        except Exception:
            return Response({"detail": "Parámetro 'from/start' inválido (YYYY-MM-DD)."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            end = _dt.date.fromisoformat(to_date)
        except ValueError:
            try:
                y, m, _ = map(int, to_date.split("-"))
                last_day = calendar.monthrange(y, m)[1]
                end = _dt.date(y, m, last_day)
            except Exception:
                return Response({"detail": "Parámetro 'to/end' inválido (YYYY-MM-DD)."}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({"detail": "Parámetro 'to/end' inválido (YYYY-MM-DD)."}, status=status.HTTP_400_BAD_REQUEST)

        if end < start:
            start, end = end, start

        qs = BloqueoDia.objects.all()
        if include == "global":
            qs = qs.filter(id_odontologo__isnull=True)
        elif include == "all":
            qs = qs.filter(Q(id_odontologo__isnull=True) | Q(id_odontologo_id=pk))
        else:
            qs = qs.filter(id_odontologo_id=pk)

        no_rec = qs.filter(recurrente_anual=False, fecha__range=(start, end)).values_list("fecha", flat=True)
        rec_all = list(qs.filter(recurrente_anual=True).values_list("fecha", flat=True))

        mmdd = {(cur.month, cur.day) for cur in (start + _dt.timedelta(days=i) for i in range((end - start).days + 1))}
        expanded = []
        for base_date in rec_all:
            m, d = base_date.month, base_date.day
            if (m, d) in mmdd:
                cur = start
                while cur <= end:
                    if (cur.month, cur.day) == (m, d):
                        expanded.append(cur)
                    cur += _dt.timedelta(days=1)

        out_dates = sorted(set(list(no_rec) + expanded))
        data = [d.isoformat() for d in out_dates]
        return Response(data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="preview-mantenimiento")
    def preview_mantenimiento(self, request, pk=None):
        """PREVIEW: citas futuras que pasarían a estado 'mantenimiento' al desactivar odontólogo."""
        self._requireAdminRole(request)
        effective_from = request.data.get("effective_from")
        try:
            dt_from = timezone.make_aware(_dt.datetime.fromisoformat(effective_from)) if effective_from else timezone.now()
        except Exception:
            dt_from = timezone.now()
        data = previewMantenimientoOdontologo(int(pk), dt_from)
        return Response(data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="preview-horario-change")
    def preview_horario_change(self, request, pk=None):
        """
        PREVIEW: Citas futuras afectadas por un CAMBIO en el horario del odontólogo.
        No desactiva nada, solo analiza el impacto.
        """
        self._requireAdminRole(request)

        from citas.services.odontologo_service import previewCambioHorarioOdontologo

        nuevos_horarios = request.data.get("horarios") or []
        data = previewCambioHorarioOdontologo(int(pk), nuevos_horarios, dtFrom=timezone.now())
        return Response(data, status=status.HTTP_200_OK)

    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="apply-mantenimiento")
    def apply_mantenimiento(self, request, pk=None):
        """APLICA: marca en 'mantenimiento' citas futuras y desactiva odontólogo."""
        self._requireAdminRole(request)
        if not request.data.get("confirm"):
            return Response({"detail": "Falta confirm"}, status=status.HTTP_400_BAD_REQUEST)

        effective_from = request.data.get("effective_from")
        try:
            dt_from = timezone.make_aware(_dt.datetime.fromisoformat(effective_from)) if effective_from else timezone.now()
        except Exception:
            dt_from = timezone.now()

        by_role = userRole(request.user) or ROL_SUPERADMIN
        result = applyMantenimientoOdontologo(int(pk), byRoleId=by_role, dtFrom=dt_from)

        odo = self.get_object()
        odo.id_usuario.is_active = False
        odo.id_usuario.save(update_fields=["is_active"])

        payload = {
            **result,
            "odontologo": {
                "id_odontologo": odo.id_odontologo,
                "is_active": odo.id_usuario.is_active,
            },
        }
        return Response(payload, status=status.HTTP_200_OK)

    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="apply-reactivate")
    def apply_reactivate(self, request, pk=None):
        """REACTIVA: devuelve a 'pendiente' citas en mantenimiento y activa odontólogo."""
        self._requireAdminRole(request)

        effective_from = request.data.get("effective_from")
        try:
            dt_from = timezone.make_aware(_dt.datetime.fromisoformat(effective_from)) if effective_from else timezone.now()
        except Exception:
            dt_from = timezone.now()

        result = applyReactivacionOdontologo(int(pk), dtFrom=dt_from)

        odo = self.get_object()
        odo.id_usuario.is_active = True
        odo.id_usuario.save(update_fields=["is_active"])

        payload = {
            **result,
            "odontologo": {
                "id_odontologo": odo.id_odontologo,
                "is_active": odo.id_usuario.is_active,
            },
        }

        return Response(payload, status=status.HTTP_200_OK)
    
    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="apply-horario-change")
    def apply_horario_change(self, request, pk=None):
        """
        APLICA: pone en 'mantenimiento' las citas FUTURAS afectadas por cambios en el horario del odontólogo.
        Similar a apply_mantenimiento, pero sin desactivar al odontólogo.
        """
        self._requireAdminRole(request)

        if not request.data.get("confirm"):
            return Response({"detail": "Falta confirm"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            from citas.services.odontologo_service import applyMantenimientoOdontologo
        except ImportError:
            return Response({"detail": "Servicio no disponible"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        try:
            by_role = userRole(request.user) or ROL_SUPERADMIN
            result = applyMantenimientoOdontologo(int(pk), byRoleId=by_role, dtFrom=timezone.now())

            payload = {
                **result,
                "odontologo": {"id_odontologo": int(pk)},
            }
            return Response(payload, status=status.HTTP_200_OK)

        except Exception as e:
            print("Error en apply_horario_change:", e)
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



class EspecialidadViewSet(viewsets.ModelViewSet):
    queryset = Especialidad.objects.all()
    serializer_class = EspecialidadSerializer

    def get_permissions(self):
        if self.action in ["list", "retrieve"]:
            return [AllowAny()]
        return [IsAuthenticated(), IsAdminOrDentist()]


class OdontologoEspecialidadViewSet(viewsets.ModelViewSet):
    queryset = OdontologoEspecialidad.objects.select_related(
        "id_odontologo", "id_especialidad"
    ).all()
    serializer_class = OdontologoEspecialidadSerializer
    permission_classes = [IsAuthenticated, IsOwnerDentistOrAdmin]


# ===================== Bloqueos agrupados por "grupo" (UUID) =====================
class BloqueoDiaViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def _is_admin(self, request): return getattr(request.user, "id_rol_id", None) == 1
    def _is_dent(self, request):  return getattr(request.user, "id_rol_id", None) == 3

    def _require_admin(self, request):
        if getattr(request.user, "id_rol_id", None) != 1:
            raise PermissionDenied("Solo un administrador puede realizar esta acción.")

    def _get_group_params(self, group_qs):
        """
        Extrae (fecha_inicio, fecha_fin, id_odontologo, recurrente_anual) del queryset del grupo.
        """
        first = group_qs.order_by("fecha").first()
        if not first:
            return None
        fi = group_qs.aggregate(Min("fecha"))["fecha__min"]
        ff = group_qs.aggregate(Max("fecha"))["fecha__max"]
        return {
            "fecha_inicio": fi,
            "fecha_fin": ff,
            "id_odontologo": first.id_odontologo_id,
            "recurrente_anual": bool(first.recurrente_anual),
        }

    def _restricted_qs(self, request, qs):
        if self._is_admin(request):
            return qs
        if self._is_dent(request):
            # Odontólogo ve globales más los suyos
            return qs.filter(Q(id_odontologo__isnull=True) | Q(id_odontologo__id_usuario_id=request.user.id_usuario))
        return qs.filter(id_odontologo__isnull=True)

    def _mmdd_q_for_range(self, start_date: _dt.date, end_date: _dt.date):
        q = Q()
        cur = start_date
        while cur <= end_date:
            q |= (Q(fecha__month=cur.month) & Q(fecha__day=cur.day))
            cur += _dt.timedelta(days=1)
        return q

    # -------- list ----------
    def list(self, request):
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        odont = request.query_params.get("odontologo")

        qs = BloqueoDia.objects.select_related("id_odontologo", "id_odontologo__id_usuario")
        qs = self._restricted_qs(request, qs)

        if odont:
            if odont == "global":
                qs = qs.filter(id_odontologo__isnull=True)
            else:
                qs = qs.filter(id_odontologo_id=odont)

        if start and end:
            try:
                s = _dt.date.fromisoformat(start)
                e = _dt.date.fromisoformat(end)
            except Exception:
                return Response({"detail": "Parámetros start/end inválidos."}, status=status.HTTP_400_BAD_REQUEST)

            q_no_rec = Q(recurrente_anual=False, fecha__range=(s, e))
            q_rec = Q(recurrente_anual=True) & self._mmdd_q_for_range(s, e)
            qs = qs.filter(q_no_rec | q_rec)

        first_by_group = {}
        for r in qs.order_by("grupo", "fecha").values("grupo", "motivo", "recurrente_anual"):
            g = r["grupo"]
            if g not in first_by_group:
                first_by_group[g] = (r["motivo"], bool(r["recurrente_anual"]))

        agg = (qs.values("grupo", "id_odontologo",
                            nombre=F("id_odontologo__id_usuario__primer_nombre"),
                            apellido=F("id_odontologo__id_usuario__primer_apellido"))
                    .annotate(fecha_inicio=Min("fecha"), fecha_fin=Max("fecha"))
                    .order_by("fecha_inicio", "fecha_fin"))

        out = []
        for row in agg:
            g = row["grupo"]
            motivo, rec = first_by_group.get(g, ("", False))
            od_id = row["id_odontologo"]
            od_name = None
            if od_id:
                od_name = " ".join([row.get("nombre") or "", row.get("apellido") or ""]).strip() or None
            out.append({
                "id": g,
                "fecha_inicio": row["fecha_inicio"],
                "fecha_fin": row["fecha_fin"],
                "motivo": motivo or "",
                "recurrente_anual": rec,
                "id_odontologo": od_id,
                "odontologo_nombre": od_name,
            })

        ser = BloqueoGrupoSerializer(out, many=True)
        return Response(ser.data)

    # -------- create ----------
    def create(self, request):
        ser = BloqueoGrupoSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        data = ser.save()
        return Response(data, status=status.HTTP_201_CREATED)

    # -------- patch ----------
    def partial_update(self, request, pk=None):
        try:
            group_id = UUID(str(pk))
        except Exception:
            return Response({"detail": "ID de grupo inválido."}, status=status.HTTP_400_BAD_REQUEST)

        qs = self._restricted_qs(request, BloqueoDia.objects.filter(grupo=group_id))
        if not qs.exists():
            return Response({"detail": "No encontrado."}, status=status.HTTP_404_NOT_FOUND)

        if not self._is_admin(request) and qs.filter(id_odontologo__isnull=True).exists():
            return Response({"detail": "Solo un administrador puede editar bloqueos globales."}, status=status.HTTP_403_FORBIDDEN)

        if self._is_dent(request):
            my_od = Odontologo.objects.filter(id_usuario_id=request.user.id_usuario) \
                                        .values_list("id_odontologo", flat=True).first()
            if qs.exclude(id_odontologo_id=my_od).exists():
                return Response({"detail": "No puedes editar bloqueos de otro odontólogo."}, status=status.HTTP_403_FORBIDDEN)

        first = qs.order_by("fecha").first()
        instance = {
            "id": first.grupo,
            "fecha_inicio": qs.aggregate(Min("fecha"))["fecha__min"],
            "fecha_fin": qs.aggregate(Max("fecha"))["fecha__max"],
            "motivo": first.motivo,
            "recurrente_anual": first.recurrente_anual,
            "id_odontologo": first.id_odontologo_id,
        }
        ser = BloqueoGrupoSerializer(instance=instance, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        data = ser.save()
        return Response(data)

    # -------- destroy (reactiva antes de borrar) ----------
    def destroy(self, request, pk=None):
        try:
            group_id = UUID(str(pk))
        except Exception:
            return Response(status=status.HTTP_400_BAD_REQUEST)

        qs = self._restricted_qs(request, BloqueoDia.objects.filter(grupo=group_id))
        if not qs.exists():
            return Response(status=status.HTTP_204_NO_CONTENT)

        if not self._is_admin(request) and qs.filter(id_odontologo__isnull=True).exists():
            return Response({"detail": "Solo un administrador puede borrar bloqueos globales."}, status=status.HTTP_403_FORBIDDEN)

        if self._is_dent(request):
            my_od = Odontologo.objects.filter(id_usuario_id=request.user.id_usuario) \
                                        .values_list("id_odontologo", flat=True).first()
            if qs.exclude(id_odontologo_id=my_od).exists():
                return Response({"detail": "No puedes borrar bloqueos de otro odontólogo."}, status=status.HTTP_403_FORBIDDEN)

        params = self._get_group_params(qs)
        if params:
            applyReactivacionBloqueo(
                fecha_inicio=params["fecha_inicio"],
                fecha_fin=params["fecha_fin"],
                id_odontologo=params["id_odontologo"],
                recurrente_anual=params["recurrente_anual"],
                dtFrom=timezone.now(),
            )

        qs.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ========= Collection-level: preview en seco =========
    @action(detail=False, methods=["post"], url_path="preview-mantenimiento")
    def preview_mantenimiento_collection(self, request):
        ser = BloqueoGrupoSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        payload = ser.validated_data  # no guarda

        data = previewMantenimientoBloqueo(
            fecha_inicio=payload["fecha_inicio"],
            fecha_fin=payload["fecha_fin"],
            id_odontologo=payload.get("id_odontologo"),
            recurrente_anual=payload.get("recurrente_anual", False),
            dtFrom=timezone.now(),
        )
        return Response(data, status=status.HTTP_200_OK)

    # ========= Collection-level: crear + aplicar (atómico) =========
    @transaction.atomic
    @action(detail=False, methods=["post"], url_path="create-and-apply")
    def create_and_apply(self, request):
        """
        Crea el grupo de bloqueo y, si confirm=true, pone en 'mantenimiento'
        las citas FUTURAS afectadas (pendiente/confirmada). Devuelve también el preview.
        """
        confirm = bool(request.data.get("confirm"))
        ser = BloqueoGrupoSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)

        # 1) Crear grupo
        created = ser.save()  # {"id": uuid, ...}

        # 2) Preview
        data_preview = previewMantenimientoBloqueo(
            fecha_inicio=ser.validated_data["fecha_inicio"],
            fecha_fin=ser.validated_data["fecha_fin"],
            id_odontologo=ser.validated_data.get("id_odontologo"),
            recurrente_anual=ser.validated_data.get("recurrente_anual", False),
            dtFrom=timezone.now(),
        )

        # 3) Si NO hay afectadas o confirm==False, solo preview + grupo
        if not confirm or (data_preview.get("total_afectadas", 0) <= 0):
            return Response({"group": created, "preview": data_preview}, status=status.HTTP_201_CREATED)

        # 4) Aplicar mantenimiento
        result = applyMantenimientoBloqueo(
            fecha_inicio=ser.validated_data["fecha_inicio"],
            fecha_fin=ser.validated_data["fecha_fin"],
            byRoleId=getattr(request.user, "id_rol_id", 1) or 1,
            id_odontologo=ser.validated_data.get("id_odontologo"),
            recurrente_anual=ser.validated_data.get("recurrente_anual", False),
            dtFrom=timezone.now(),
        )

        return Response({"group": created, "preview": data_preview, "apply": result}, status=status.HTTP_201_CREATED)

    # ========= Detail: preview por grupo (ya creado) =========
    @action(detail=True, methods=["post"], url_path="preview-mantenimiento")
    def preview_mantenimiento_detail(self, request, pk=None):
        """
        PREVIEW: cuenta/lista las citas FUTURAS afectadas por ESTE grupo de bloqueo.
        Admin puede ver cualquier grupo; odontólogo solo sus grupos; globales solo admin.
        """
        try:
            group_id = UUID(str(pk))
        except Exception:
            return Response({"detail": "ID de grupo inválido."}, status=status.HTTP_400_BAD_REQUEST)

        qs = self._restricted_qs(request, BloqueoDia.objects.filter(grupo=group_id))
        if not qs.exists():
            return Response({"detail": "No encontrado."}, status=status.HTTP_404_NOT_FOUND)

        if qs.filter(id_odontologo__isnull=True).exists() and not self._is_admin(request):
            return Response({"detail": "Solo un administrador puede ver el preview de bloqueos globales."}, status=status.HTTP_403_FORBIDDEN)
        if self._is_dent(request):
            my_od = Odontologo.objects.filter(id_usuario_id=request.user.id_usuario).values_list("id_odontologo", flat=True).first()
            if qs.exclude(id_odontologo_id=my_od).exists():
                return Response({"detail": "No puedes ver el preview de otro odontólogo."}, status=status.HTTP_403_FORBIDDEN)

        params = self._get_group_params(qs)
        if not params:
            return Response({"total_afectadas": 0, "por_estado": {}, "items": []})

        data = previewMantenimientoBloqueo(
            fecha_inicio=params["fecha_inicio"],
            fecha_fin=params["fecha_fin"],
            id_odontologo=params["id_odontologo"],
            recurrente_anual=params["recurrente_anual"],
            dtFrom=timezone.now(),
        )
        return Response(data, status=status.HTTP_200_OK)

    # ========= Detail: preview reactivar (ya creado) =========
    @action(detail=True, methods=["post"], url_path="preview-reactivar")
    def preview_reactivar_detail(self, request, pk=None):
        """
        PREVIEW: lista las citas FUTURAS en MANTENIMIENTO que volverian a PENDIENTE
        si se elimina o reactiva este bloqueo.
        """
        try:
            group_id = UUID(str(pk))
        except Exception:
            return Response({"detail": "ID de grupo invalido."}, status=status.HTTP_400_BAD_REQUEST)

        qs = self._restricted_qs(request, BloqueoDia.objects.filter(grupo=group_id))
        if not qs.exists():
            return Response({"detail": "No encontrado."}, status=status.HTTP_404_NOT_FOUND)

        if qs.filter(id_odontologo__isnull=True).exists() and not self._is_admin(request):
            return Response({"detail": "Solo un administrador puede ver previsualizaciones de bloqueos globales."}, status=status.HTTP_403_FORBIDDEN)
        if self._is_dent(request):
            my_od = Odontologo.objects.filter(id_usuario_id=request.user.id_usuario).values_list("id_odontologo", flat=True).first()
            if qs.exclude(id_odontologo_id=my_od).exists():
                return Response({"detail": "No puedes ver el preview de otro odontologo."}, status=status.HTTP_403_FORBIDDEN)

        params = self._get_group_params(qs)
        if not params:
            return Response({"total_afectadas": 0, "por_estado": {}, "items": []})

        data = previewReactivacionBloqueo(
            fecha_inicio=params["fecha_inicio"],
            fecha_fin=params["fecha_fin"],
            id_odontologo=params["id_odontologo"],
            recurrente_anual=params["recurrente_anual"],
            dtFrom=timezone.now(),
        )
        return Response(data, status=status.HTTP_200_OK)

    # ========= Apply por grupo=========
    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="apply-mantenimiento")
    def apply_mantenimiento_detail(self, request, pk=None):
        self._require_admin(request)
        if not request.data.get("confirm"):
            return Response({"detail": "Falta confirm"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            group_id = UUID(str(pk))
        except Exception:
            return Response({"detail": "ID de grupo inválido."}, status=status.HTTP_400_BAD_REQUEST)

        qs = BloqueoDia.objects.filter(grupo=group_id)
        if not qs.exists():
            return Response({"detail": "No encontrado."}, status=status.HTTP_404_NOT_FOUND)

        params = self._get_group_params(qs)
        result = applyMantenimientoBloqueo(
            fecha_inicio=params["fecha_inicio"],
            fecha_fin=params["fecha_fin"],
            byRoleId=getattr(request.user, "id_rol_id", 1) or 1,
            id_odontologo=params["id_odontologo"],
            recurrente_anual=params["recurrente_anual"],
            dtFrom=timezone.now(),
        )
        return Response(result, status=status.HTTP_200_OK)

    # ========= Detail: reactivar por grupo =========
    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="apply-reactivar")
    def apply_reactivar_detail(self, request, pk=None):
        """
        REACTIVAR: devuelve a 'pendiente' las FUTURAS en 'mantenimiento' afectadas por ESTE grupo.
        Solo ADMIN.
        """
        self._require_admin(request)
        try:
            group_id = UUID(str(pk))
        except Exception:
            return Response({"detail": "ID de grupo inválido."}, status=status.HTTP_400_BAD_REQUEST)

        qs = BloqueoDia.objects.filter(grupo=group_id)
        if not qs.exists():
            return Response({"detail": "No encontrado."}, status=status.HTTP_404_NOT_FOUND)

        params = self._get_group_params(qs)
        result = applyReactivacionBloqueo(
            fecha_inicio=params["fecha_inicio"],
            fecha_fin=params["fecha_fin"],
            id_odontologo=params["id_odontologo"],
            recurrente_anual=params["recurrente_anual"],
            dtFrom=timezone.now(),
        )
        return Response(result, status=status.HTTP_200_OK)


# ===================== CRUD de horarios =====================
class OdontologoHorarioViewSet(viewsets.ModelViewSet):
    queryset = OdontologoHorario.objects.select_related("id_odontologo").all()
    serializer_class = OdontologoHorarioSerializer
    permission_classes = [IsAuthenticated, IsOwnerDentistOrAdmin]
    parser_classes = [MultiPartParser, FormParser, JSONParser]