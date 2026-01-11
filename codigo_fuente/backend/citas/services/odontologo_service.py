# citas/services/odontologo_service.py
from uuid import uuid4
from django.db import transaction
from django.db.models import Q, Count
from django.utils import timezone
from datetime import time

from citas.models import (
    Cita,
    ESTADO_MANTENIMIENTO,
    ESTADO_PENDIENTE,
)


def _qFuturas(dtFrom):
    # Devuelve un Q que filtra citas con (fecha/hora) >= dtFrom.
    return Q(fecha__gt=dtFrom.date()) | Q(fecha=dtFrom.date(), hora__gte=dtFrom.time())

def previewCambioHorarioOdontologo(idOdontologo: int, nuevosHorarios: list[dict], dtFrom=None):
    """
    Detecta citas FUTURAS (>= dtFrom) que quedarían FUERA del nuevo horario
    del odontólogo o en días deshabilitados
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    # Citas futuras (pendientes o confirmadas)
    qs = (
        Cita.objects.filter(id_odontologo_id=idOdontologo)
        .filter(_qFuturas(dtFrom))
        .filter(estado__in=[ESTADO_PENDIENTE, "confirmada"])
    )

    afectadas = []

    for cita in qs:
        dia_semana = cita.fecha.weekday()  # lunes=0 ... domingo=6
        # Busca si ese día está habilitado
        horario = next(
            (
                h for h in nuevosHorarios
                if int(h.get("dia_semana", -1)) == dia_semana
                and h.get("habilitado", h.get("vigente", True))
            ),
            None
        )

        if not horario:
            # Día deshabilitado completamente
            afectadas.append(cita)
            continue

        # Convertir a objetos time para comparar
        try:
            hora_ini = time.fromisoformat(str(horario["hora_inicio"]))
            hora_fin = time.fromisoformat(str(horario["hora_fin"]))
        except Exception:
            continue  # horario inválido, saltar

        if not (hora_ini <= cita.hora <= hora_fin):
            # Cita fuera del rango permitido
            afectadas.append(cita)

    items = list(
        {
            "id_cita": c.id_cita,
            "fecha": c.fecha,
            "hora": str(c.hora),
            "estado": c.estado,
            "paciente_nombre": " ".join(
                filter(
                    None,
                    [
                        getattr(c.id_paciente.id_usuario, "primer_nombre", ""),
                        getattr(c.id_paciente.id_usuario, "segundo_nombre", ""),
                        getattr(c.id_paciente.id_usuario, "primer_apellido", ""),
                        getattr(c.id_paciente.id_usuario, "segundo_apellido", ""),
                    ],
                )
            ).strip(),
        }
        for c in afectadas
    )

    return {
        "total_afectadas": len(items),
        "items": items,
    }

def previewMantenimientoOdontologo(idOdontologo: int, dtFrom=None):
    """
    Previsualiza cuántas citas FUTURAS (>= dtFrom) serán afectadas
    al desactivar un odontólogo. Solo incluye citas pendientes y confirmadas
    las realizadas, canceladas o en mantenimiento NO se afectan
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    qs = (
        Cita.objects.filter(id_odontologo_id=idOdontologo)
        .filter(_qFuturas(dtFrom))
        .filter(estado__in=[ESTADO_PENDIENTE, "confirmada"])  # Solo pendientes y confirmadas
    )

    total = qs.count()
    porEstado = dict(
        qs.values("estado").annotate(cnt=Count("estado")).values_list("estado", "cnt")
    )

    items = list(
        qs.values(
            "id_cita",
            "fecha",
            "hora",
            "estado",
            "id_paciente__id_usuario__cedula",
            "id_paciente__id_usuario__primer_nombre",
            "id_paciente__id_usuario__segundo_nombre",
            "id_paciente__id_usuario__primer_apellido",
            "id_paciente__id_usuario__segundo_apellido",
            "id_paciente__id_usuario__celular",
            "id_consultorio__numero",
        )
    )

    # Normalizar nombre completo
    for it in items:
        nombres = " ".join(
            filter(
                None,
                [
                    it.pop("id_paciente__id_usuario__primer_nombre", None),
                    it.pop("id_paciente__id_usuario__segundo_nombre", None),
                    it.pop("id_paciente__id_usuario__primer_apellido", None),
                    it.pop("id_paciente__id_usuario__segundo_apellido", None),
                ],
            )
        ).strip()
        it["paciente_nombre"] = nombres or "—"

    return {
        "total_afectadas": total,
        "por_estado": porEstado,
        "items": items,
    }


@transaction.atomic
def applyMantenimientoOdontologo(idOdontologo: int, byRoleId: int, dtFrom=None):
    """
    Marca como 'mantenimiento' todas las citas FUTURAS de ese odontólogo
    que estén en estado pendiente o confirmada. 
    Las citas realizadas, canceladas o ya en mantenimiento NO se modifican.
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    qs = (
        Cita.objects.select_for_update()
        .filter(id_odontologo_id=idOdontologo)
        .filter(_qFuturas(dtFrom))
        .filter(estado__in=[ESTADO_PENDIENTE, "confirmada"])  # Solo pendientes y confirmadas
    )

    batch = uuid4()
    now = timezone.now()

    items = list(
        qs.values(
            "id_cita",
            "fecha",
            "hora",
            "estado",
            "id_paciente__id_usuario__cedula",
            "id_paciente__id_usuario__primer_nombre",
            "id_paciente__id_usuario__segundo_nombre",
            "id_paciente__id_usuario__primer_apellido",
            "id_paciente__id_usuario__segundo_apellido",
            "id_paciente__id_usuario__celular",
            "id_consultorio__numero",
        )
    )

    # Normalizar nombre completo
    for it in items:
        nombres = " ".join(
            filter(
                None,
                [
                    it.pop("id_paciente__id_usuario__primer_nombre", None),
                    it.pop("id_paciente__id_usuario__segundo_nombre", None),
                    it.pop("id_paciente__id_usuario__primer_apellido", None),
                    it.pop("id_paciente__id_usuario__segundo_apellido", None),
                ],
            )
        ).strip()
        it["paciente_nombre"] = nombres or "—"

    updated = 0
    for c in qs:
        c.estado = ESTADO_MANTENIMIENTO
        if hasattr(c, "reprogramada_en"):
            c.reprogramada_en = now
        if hasattr(c, "reprogramada_por_rol"):
            c.reprogramada_por_rol = byRoleId
        if hasattr(c, "batch_id"):
            c.batch_id = batch

        c.save(
            update_fields=[
                f
                for f in ["estado", "reprogramada_en", "reprogramada_por_rol", "batch_id"]
                if hasattr(c, f)
            ]
        )
        updated += 1

    return {
        "batch_id": str(batch),
        "total_mantenimiento": updated,
        "items": items,
    }


@transaction.atomic
def applyReactivacionOdontologo(idOdontologo: int, dtFrom=None):
    """
    Cuando se reactiva el odontólogo: pasa a 'pendiente' todas las citas
    FUTURAS que estén en 'reprogramacion' para ese odontólogo.
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    qs = (
        Cita.objects.select_for_update()
        .filter(id_odontologo_id=idOdontologo, estado=ESTADO_MANTENIMIENTO)
        .filter(_qFuturas(dtFrom))
    )

    changed = qs.update(estado=ESTADO_PENDIENTE)
    return {
        "total_pendientes": changed
    }