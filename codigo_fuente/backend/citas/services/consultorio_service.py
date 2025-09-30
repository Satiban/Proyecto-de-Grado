# citas/services/consultorio_service.py
from uuid import uuid4
from django.db import transaction
from django.db.models import Q, Count
from django.utils import timezone

from citas.models import (
    Cita,
    Consultorio,
    ESTADO_CANCELADA,
    ESTADO_MANTENIMIENTO,
    ESTADO_PENDIENTE,
)


def _qFuturas(dtFrom):
    """
    Devuelve un Q que filtra citas con (fecha/hora) >= dtFrom.
    """
    return Q(fecha__gt=dtFrom.date()) | Q(fecha=dtFrom.date(), hora__gte=dtFrom.time())


def previewMantenimientoConsultorio(idConsultorio: int, dtFrom=None):
    """
    Previsualiza cuántas citas FUTURAS (>= dtFrom) serán afectadas
    al desactivar un consultorio (estado 'mantenimiento').
    Excluye las ya canceladas.
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    qs = (
        Cita.objects.filter(id_consultorio_id=idConsultorio)
        .filter(_qFuturas(dtFrom))
        .exclude(estado=ESTADO_CANCELADA)
    )

    total = qs.count()
    porEstado = dict(
        qs.values("estado").annotate(cnt=Count("estado")).values_list("estado", "cnt")
    )

    # Lista mínima para PDF / UI
    items = list(
        qs.values(
            "id_cita",
            "fecha",
            "hora",
            "id_paciente__id_usuario__primer_nombre",
            "id_paciente__id_usuario__primer_apellido",
            "id_paciente__id_usuario__celular",
            "id_odontologo__id_usuario__primer_nombre",
            "id_odontologo__id_usuario__primer_apellido",
        )
    )

    return {
        "total_afectadas": total,
        "por_estado": porEstado,
        "items": items,
    }


@transaction.atomic
def applyMantenimientoConsultorio(consultorio: Consultorio, byRoleId: int, dtFrom=None):
    """
    Marca como 'mantenimiento' todas las citas FUTURAS del consultorio
    (excluyendo canceladas). Setea huellas y devuelve batch + listado.
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    qs = (
        Cita.objects.select_for_update()
        .filter(id_consultorio_id=consultorio.id_consultorio)
        .filter(_qFuturas(dtFrom))
        .exclude(estado=ESTADO_CANCELADA)
    )

    batch = uuid4()
    now = timezone.now()

    items = list(
        qs.values(
            "id_cita",
            "fecha",
            "hora",
            "id_paciente__id_usuario__primer_nombre",
            "id_paciente__id_usuario__primer_apellido",
            "id_paciente__id_usuario__celular",
            "id_odontologo__id_usuario__primer_nombre",
            "id_odontologo__id_usuario__primer_apellido",
        )
    )

    updated = 0
    for c in qs:
        c.estado = ESTADO_MANTENIMIENTO
        # Campos de huella si existen (los agregaste en el modelo)
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
def applyReactivacionConsultorio(consultorio: Consultorio, dtFrom=None):
    """
    Cuando se reactiva el consultorio: pasa a 'pendiente' todas las citas
    FUTURAS que estén en 'mantenimiento' para ese consultorio.
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    qs = (
        Cita.objects.select_for_update()
        .filter(
            id_consultorio_id=consultorio.id_consultorio,
            estado=ESTADO_MANTENIMIENTO,
        )
        .filter(_qFuturas(dtFrom))
    )

    changed = qs.update(estado=ESTADO_PENDIENTE)
    return {
        "total_pendientes": changed
    }
