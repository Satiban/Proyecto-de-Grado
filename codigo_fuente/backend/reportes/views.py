# reportes/views.py
from django.utils.dateparse import parse_date
from django.db.models import Count, Sum, Q
from django.db.models.functions import TruncWeek, ExtractHour
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from decimal import Decimal

from citas.models import Cita, PagoCita


class ReportesViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"], url_path="overview")
    def overview(self, request):
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

        # ---------- KPIs de Pagos ----------
        # Filtrar pagos según las mismas citas del reporte
        citas_ids = qs.values_list('id_cita', flat=True)
        pagos_qs = PagoCita.objects.filter(id_cita_id__in=citas_ids)
        
        # Total recaudado (solo pagos en estado 'pagado')
        total_recaudado = pagos_qs.filter(estado_pago='pagado').aggregate(
            total=Sum('monto')
        )['total'] or Decimal('0.00')
        
        # Reembolsos
        reembolsos_data = pagos_qs.filter(estado_pago='reembolsado').aggregate(
            total=Sum('monto'),
            cantidad=Count('id_pago_cita')
        )
        total_reembolsado = reembolsos_data['total'] or Decimal('0.00')
        cantidad_reembolsos = reembolsos_data['cantidad'] or 0
        
        # Pagos completados vs pendientes
        pagos_completados = pagos_qs.filter(estado_pago='pagado').count()
        citas_realizadas = qs.filter(estado='realizada').count()
        pagos_pendientes = max(0, citas_realizadas - pagos_completados)
        
        # Tasa de pago (% de citas realizadas que tienen pago)
        tasa_pago = float(pagos_completados * 100.0 / citas_realizadas) if citas_realizadas > 0 else 0.0
        
        # Ingreso neto (recaudado - reembolsado)
        ingreso_neto = total_recaudado - total_reembolsado
        
        kpis_pagos = {
            "total_recaudado": float(total_recaudado),
            "total_reembolsado": float(total_reembolsado),
            "ingreso_neto": float(ingreso_neto),
            "pagos_completados": pagos_completados,
            "pagos_pendientes": pagos_pendientes,
            "cantidad_reembolsos": cantidad_reembolsos,
            "tasa_pago": tasa_pago,
        }
        
        # ---------- Series de Pagos ----------
        # Ingresos por día
        ingresos_por_dia = [
            {
                "fecha": r["id_cita__fecha"].isoformat(),
                "monto": float(r["total"]) if r["total"] else 0.0
            }
            for r in pagos_qs.filter(estado_pago='pagado').values("id_cita__fecha")
                .annotate(total=Sum('monto'))
                .order_by("id_cita__fecha")
        ]
        
        # Distribución por método de pago
        por_metodo_pago = [
            {
                "metodo": r["metodo_pago"].capitalize(),
                "total": r["count"],
                "monto": float(r["monto_total"]) if r["monto_total"] else 0.0
            }
            for r in pagos_qs.filter(estado_pago='pagado').values("metodo_pago")
                .annotate(
                    count=Count('id_pago_cita'),
                    monto_total=Sum('monto')
                )
                .order_by("-monto_total")
        ]
        
        # Comparación citas realizadas vs pagadas (por día)
        citas_vs_pagos = []
        for dia in qs.filter(estado='realizada').values('fecha').annotate(
            citas_realizadas=Count('id_cita')
        ).order_by('fecha'):
            fecha_iso = dia['fecha'].isoformat()
            pagadas = pagos_qs.filter(
                id_cita__fecha=dia['fecha'],
                estado_pago='pagado'
            ).count()
            citas_vs_pagos.append({
                "fecha": fecha_iso,
                "citas_realizadas": dia['citas_realizadas'],
                "pagadas": pagadas,
                "pendientes": dia['citas_realizadas'] - pagadas
            })
        
        # Ingresos por semana
        ingresos_por_semana = [
            {
                "semana": r["semana"].isoformat() if r["semana"] else "N/A",
                "monto": float(r["total"]) if r["total"] else 0.0
            }
            for r in pagos_qs.filter(estado_pago='pagado')
                .annotate(semana=TruncWeek('id_cita__fecha'))
                .values("semana")
                .annotate(total=Sum('monto'))
                .order_by("semana")
        ]

        return Response({
            "kpis": kpis,
            "kpis_pagos": kpis_pagos,
            "series": {
                "por_dia": por_dia,
                "por_semana_estado": por_semana_estado,
                "por_especialidad": por_especialidad,
                "por_hora": por_hora,
                "ingresos_por_dia": ingresos_por_dia,
                "por_metodo_pago": por_metodo_pago,
                "citas_vs_pagos": citas_vs_pagos,
                "ingresos_por_semana": ingresos_por_semana,
            },
            "tablas": {
                "top_pacientes": top_pacientes,
            }
        })
