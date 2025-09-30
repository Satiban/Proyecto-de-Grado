# reportes/views.py
from django.utils.dateparse import parse_date
from django.db.models import Count
from django.db.models.functions import TruncWeek, ExtractHour
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from citas.models import Cita


class ReportesViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"], url_path="overview")
    def overview(self, request):
        """
        GET /api/v1/reportes/overview/?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
                                     [&odontologo=&consultorio=&estado=&especialidad=]
        Respuesta compatible con tu Reportes.tsx (KPIs + series + top_pacientes).
        """
        p = request.query_params
        desde = parse_date(p.get("desde"))
        hasta = parse_date(p.get("hasta"))
        odontologo = p.get("odontologo")
        consultorio = p.get("consultorio")
        estado = p.get("estado")
        especialidad = p.get("especialidad")

        qs = Cita.objects.select_related(
            "id_paciente__id_usuario",
            "id_odontologo__id_usuario",
            "id_consultorio",
        )
        if desde:
            qs = qs.filter(fecha__gte=desde)
        if hasta:
            qs = qs.filter(fecha__lte=hasta)
        if odontologo:
            qs = qs.filter(id_odontologo_id=odontologo)
        if consultorio:
            qs = qs.filter(id_consultorio_id=consultorio)
        if estado:
            qs = qs.filter(estado=estado)
        if especialidad:
            # OJO: related_name correcto en Odontologo es 'especialidades'
            qs = qs.filter(id_odontologo__especialidades__id_especialidad_id=especialidad)

        # ---------- KPIs ----------
        total = qs.count()
        realizadas = qs.filter(estado="realizada").count()
        confirmadas = qs.filter(estado="confirmada").count()
        canceladas = qs.filter(estado="cancelada").count()
        denom = realizadas + canceladas
        asistencia_pct = float(realizadas * 100.0 / denom) if denom else 0.0

        kpis = {
            "citas_totales": total,
            "realizadas": realizadas,
            "confirmadas": confirmadas,
            "canceladas": canceladas,
            "asistencia_pct": asistencia_pct,
        }

        # ---------- Series ----------
        por_dia = [
            {"fecha": r["fecha"].isoformat(), "total": r["total"]}
            for r in qs.values("fecha").annotate(total=Count("id_cita")).order_by("fecha")
        ]

        por_semana_raw = (
            qs.annotate(sem=TruncWeek("fecha"))
              .values("sem", "estado")
              .annotate(total=Count("id_cita"))
              .order_by("sem")
        )
        sem_map = {}
        for r in por_semana_raw:
            key = r["sem"].isoformat() if r["sem"] else "N/A"
            sem_map.setdefault(key, {"semana": key, "pendiente": 0, "confirmada": 0, "cancelada": 0, "realizada": 0})
            sem_map[key][r["estado"]] = r["total"]
        por_semana_estado = list(sem_map.values())

        por_especialidad = [
            {
                "especialidad": r["id_odontologo__especialidades__id_especialidad__nombre"] or "Sin especialidad",
                "total": r["total"],
            }
            for r in (
                qs.values("id_odontologo__especialidades__id_especialidad__nombre")
                  .annotate(total=Count("id_cita"))
                  .order_by("-total")
            )
        ]

        por_hora = [
            {"hora": f"{int(r['hh']):02d}:00", "total": r["total"]}
            for r in (
                qs.annotate(hh=ExtractHour("hora"))
                  .values("hh")
                  .annotate(total=Count("id_cita"))
                  .order_by("hh")
            )
            if r["hh"] is not None
        ]

        # ---------- Tabla: Top pacientes ----------
        top_pac_q = (
            qs.values(
                "id_paciente__id_usuario__cedula",
                "id_paciente__id_usuario__primer_nombre",
                "id_paciente__id_usuario__segundo_nombre",
                "id_paciente__id_usuario__primer_apellido",
                "id_paciente__id_usuario__segundo_apellido",
            )
            .annotate(citas=Count("id_cita"))
            .order_by("-citas")[:10]
        )

        def full_name(r):
            parts = [
                r.get("id_paciente__id_usuario__primer_nombre"),
                r.get("id_paciente__id_usuario__segundo_nombre"),
                r.get("id_paciente__id_usuario__primer_apellido"),
                r.get("id_paciente__id_usuario__segundo_apellido"),
            ]
            return " ".join([p for p in parts if p]) or "—"

        top_pacientes = [
            {
                "paciente": full_name(r),
                "cedula": r.get("id_paciente__id_usuario__cedula") or "",
                "citas": r["citas"],
            }
            for r in top_pac_q
        ]

        return Response({
            "kpis": kpis,
            "series": {
                "por_dia": por_dia,
                "por_semana_estado": por_semana_estado,
                "por_especialidad": por_especialidad,
                "por_hora": por_hora,
            },
            "tablas": {
                "top_pacientes": top_pacientes,
            }
        })
