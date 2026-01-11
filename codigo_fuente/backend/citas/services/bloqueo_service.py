# citas/services/bloqueo_service.py
from __future__ import annotations

from uuid import uuid4
from datetime import date as _date, timedelta
from typing import Iterable, Optional

from django.db import transaction
from django.db.models import Q, Count
from django.utils import timezone

from citas.models import (
    Cita,
    ESTADO_CANCELADA,
    ESTADO_CONFIRMADA,
    ESTADO_MANTENIMIENTO,
    ESTADO_PENDIENTE,
)


def _q_futuras(dt_from):
    """
    Q para seleccionar citas FUTURAS respecto a dt_from (aware):
        - fecha > dt_from.date()
        - o misma fecha y hora >= dt_from.time()
    """
    return Q(fecha__gt=dt_from.date()) | Q(fecha=dt_from.date(), hora__gte=dt_from.time())

def _days_in_mmdd_range(start: _date, end: _date) -> Iterable[tuple[int, int]]:
    """
    Devuelve (month, day) para cada día del rango start..end (ambos inclusive),
    interpretado SOLO por MM-DD. Soporta rangos que cruzan año (p.ej. 12-28..01-03).
    """
    base_year = 2000  # normalizamos a un año base
    s = _date(base_year, start.month, start.day)
    e = _date(base_year, end.month, end.day)

    days: list[tuple[int, int]] = []
    if s <= e:
        cur = s
        while cur <= e:
            days.append((cur.month, cur.day))
            cur += timedelta(days=1)
    else:
        # cruza año: s..Dec31 + Jan01..e
        cur = s
        while cur <= _date(base_year, 12, 31):
            days.append((cur.month, cur.day))
            cur += timedelta(days=1)
        cur = _date(base_year, 1, 1)
        while cur <= e:
            days.append((cur.month, cur.day))
            cur += timedelta(days=1)
    return days


def _q_rango_fechas(fi: _date, ff: _date, recurrente_anual: bool) -> Q:
    """
    Selección por fecha:
      - No recurrente: fecha in [fi..ff]
      - Recurrente anual: (fecha__month, fecha__day) en rango MM-DD
    """
    if not recurrente_anual:
        return Q(fecha__range=[fi, ff])

    # Recurrente anual por MM-DD
    pairs = _days_in_mmdd_range(fi, ff)
    q = Q(pk__in=[])
    for m, d in pairs:
        q |= Q(fecha__month=m, fecha__day=d)
    return q


def _qs_base_bloqueo(
    fi: _date,
    ff: _date,
    id_odontologo: Optional[int],
    recurrente_anual: bool,
    dt_from,
):
    """
    QuerySet base de citas afectadas por un bloqueo:
      - Solo FUTURAS (>= dt_from)
      - En rango (normal o recurrente por MM-DD)
      - Si id_odontologo se especifica, filtra por ese odontólogo; si no, aplica global
      - Excluye explícitamente CANCELADAS
    """
    q = _q_rango_fechas(fi, ff, recurrente_anual) & _q_futuras(dt_from)
    qs = Cita.objects.filter(q).exclude(estado=ESTADO_CANCELADA)
    if id_odontologo is not None:
        qs = qs.filter(id_odontologo_id=id_odontologo)
    return qs


def previewMantenimientoBloqueo(
    fecha_inicio: _date,
    fecha_fin: _date,
    id_odontologo: Optional[int] = None,
    recurrente_anual: bool = False,
    dtFrom=None,
):
    """
    PREVIEW: cuenta y lista las citas FUTURAS (>= dtFrom) que se verían afectadas
    por un bloqueo (global o por odontólogo) en [fecha_inicio..fecha_fin].
    SOLO considera estados PENDIENTE o CONFIRMADA (se excluyen canceladas, mantenimiento,
    realizadas, etc.).
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    base = _qs_base_bloqueo(fecha_inicio, fecha_fin, id_odontologo, recurrente_anual, dtFrom)
    qs = base.filter(estado__in=[ESTADO_PENDIENTE, ESTADO_CONFIRMADA])

    total = qs.count()
    porEstado = dict(
        qs.values("estado").annotate(cnt=Count("estado")).values_list("estado", "cnt")
    )

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
        ).order_by("fecha", "hora", "id_cita")
    )

    return {
        "total_afectadas": total,
        "por_estado": porEstado,
        "items": items,
    }


def previewReactivacionBloqueo(
    fecha_inicio: _date,
    fecha_fin: _date,
    id_odontologo: Optional[int] = None,
    recurrente_anual: bool = False,
    dtFrom=None,
):
    """
    PREVIEW: lista las citas FUTURAS en estado "MANTENIMIENTO" que volverían
    a "PENDIENTE" al reactivar un bloqueo en el rango indicado.
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    base = _qs_base_bloqueo(
        fecha_inicio, fecha_fin, id_odontologo, recurrente_anual, dtFrom
    )
    qs = base.filter(estado=ESTADO_MANTENIMIENTO)

    total = qs.count()
    porEstado = {ESTADO_MANTENIMIENTO: total} if total else {}

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
        ).order_by("fecha", "hora", "id_cita")
    )

    return {
        "total_afectadas": total,
        "por_estado": porEstado,
        "items": items,
    }


@transaction.atomic
def applyMantenimientoBloqueo(
    fecha_inicio: _date,
    fecha_fin: _date,
    byRoleId: int,
    id_odontologo: Optional[int] = None,
    recurrente_anual: bool = False,
    dtFrom=None,
):
    """
    Marca como 'MANTENIMIENTO' todas las citas FUTURAS afectadas por el bloqueo
    (global o por odontólogo) en [fecha_inicio..fecha_fin] que estén en
    PENDIENTE o CONFIRMADA. No toca canceladas ni otros estados
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    base = _qs_base_bloqueo(fecha_inicio, fecha_fin, id_odontologo, recurrente_anual, dtFrom)
    qs = base.filter(estado__in=[ESTADO_PENDIENTE, ESTADO_CONFIRMADA]).select_for_update()

    batch = uuid4()
    now = timezone.now()

    # Para CSV previo al update
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
        ).order_by("fecha", "hora", "id_cita")
    )

    model_fields = {f.name for f in Cita._meta.get_fields()}
    update_kwargs = {"estado": ESTADO_MANTENIMIENTO}
    if "reprogramada_en" in model_fields:
        update_kwargs["reprogramada_en"] = now
    if "reprogramada_por_rol" in model_fields:
        update_kwargs["reprogramada_por_rol"] = byRoleId
    if "batch_id" in model_fields:
        update_kwargs["batch_id"] = batch

    updated = qs.update(**update_kwargs)

    return {
        "batch_id": str(batch),
        "total_mantenimiento": updated,
        "items": items,
    }


@transaction.atomic
def applyReactivacionBloqueo(
    fecha_inicio: _date,
    fecha_fin: _date,
    id_odontologo: Optional[int] = None,
    recurrente_anual: bool = False,
    dtFrom=None,
):
    """
    REACTIVAR: todas las citas FUTURAS en estado 'MANTENIMIENTO' del rango vuelven a 'PENDIENTE'.
    Se usa cuando se elimina o se desactiva el bloqueo para reabrir huecos.
    """
    if dtFrom is None:
        dtFrom = timezone.now()

    base = _qs_base_bloqueo(fecha_inicio, fecha_fin, id_odontologo, recurrente_anual, dtFrom)
    qs = base.filter(estado=ESTADO_MANTENIMIENTO).select_for_update()
    
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
        ).order_by("fecha", "hora", "id_cita")
    )

    changed = qs.update(estado=ESTADO_PENDIENTE)

    return {
        "total_pendientes": changed,
        "items": items,
    }