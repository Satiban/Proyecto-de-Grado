# citas/management/commands/autocancelar.py
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from django.db.models import Q


from citas.models import (
    Cita,
    ESTADO_PENDIENTE,
    ESTADO_CANCELADA,
    Configuracion,
)

ROL_PACIENTE = 2 

class Command(BaseCommand):
    help = (
        "Cancela automáticamente citas 'pendiente' cuando faltan ≤12h para su inicio "
        "(o ya pasaron) y no fueron confirmadas. Penaliza al paciente (cooldown)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="No guarda cambios, solo reporta.")

    def handle(self, *args, **opts):
        dry = opts["dry_run"]

        # Obtener el valor de horas desde la configuración (horas_confirmar_hasta)
        config = Configuracion.get_config()
        horas_confirmar_hasta = getattr(config, 'horas_confirmar_hasta', 12) or 12

        now_local = timezone.localtime(timezone.now())
        threshold = now_local + timedelta(hours=horas_confirmar_hasta)

        # Citas PENDIENTE cuyo inicio es <= (ahora + horas_confirmar_hasta)
        qs = (
            Cita.objects
            .filter(estado=ESTADO_PENDIENTE)
            .filter(
                Q(fecha__lt=threshold.date())
                | Q(fecha=threshold.date(), hora__lte=threshold.time())
            )
        )

        total_elegibles = qs.count()
        if dry:
            self.stdout.write(self.style.WARNING(
                f"[autocancelar] DRY-RUN | pendientes_elegibles={total_elegibles} | no se guardan cambios"
            ))
            return

        # Penaliza al paciente para que cuente cooldown
        canceladas = qs.update(
            estado=ESTADO_CANCELADA,
            cancelada_en=timezone.now(),
            cancelada_por_rol=ROL_PACIENTE,
        )

        self.stdout.write(self.style.SUCCESS(
            f"[autocancelar] pendientes_elegibles={total_elegibles} | canceladas={canceladas}"
        ))
