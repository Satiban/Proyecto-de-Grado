# citas/management/commands/enviar_recordatorios.py
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta

from citas.models import Cita, ESTADO_PENDIENTE
from notificaciones.services import send_whatsapp_template
from notificaciones.views import fmt_fecha_larga, doctor_line
from usuarios.utils import obtener_contacto_notificacion
from django.conf import settings


class Command(BaseCommand):
    help = "Analiza las citas pendientes y envía recordatorios de WhatsApp a las que están a 24 horas."

    def handle(self, *args, **opts):
        now = timezone.localtime(timezone.now())
        inicio = now + timedelta(hours=23)
        fin = now + timedelta(hours=25)

        # Citas pendientes dentro del rango de 24 h
        citas = (
            Cita.objects.filter(
                estado=ESTADO_PENDIENTE,
                fecha=inicio.date(),
            )
        )

        total = citas.count()
        self.stdout.write(self.style.WARNING(f"[recordatorios] citas_pendientes_en_24h={total}"))

        for c in citas:
            try:
                # Debug: info de la cita
                self.stdout.write(f"  → Procesando cita {c.id_cita}: {c.fecha} {c.hora}")
                
                usuario = getattr(c.id_paciente, "id_usuario", None)
                if not usuario:
                    self.stdout.write(self.style.WARNING(f"    ⚠️ Cita {c.id_cita} sin usuario asociado"))
                    continue
                
                # Obtener contacto correcto
                contacto = obtener_contacto_notificacion(usuario)
                celular = contacto.get('celular')
                celular_tipo = contacto.get('celular_tipo', 'propio')
                
                if not celular:
                    self.stdout.write(self.style.WARNING(
                        f"    ⚠️ Usuario {usuario.id_usuario} sin número de celular "
                        f"(ni propio ni de contacto de emergencia)"
                    ))
                    continue

                # Determinar nombre para el mensaje
                nombre_notif = usuario.primer_nombre or "Paciente"
                if celular_tipo == "contacto_emergencia":
                    self.stdout.write(f"    👤 Menor sin celular → enviando a contacto de emergencia")
                    nombre_notif = f"representante de {nombre_notif}"

                self.stdout.write(f"    📱 Enviando a: {celular} ({celular_tipo})")

                variables = {
                    "1": nombre_notif,
                    "2": fmt_fecha_larga(c.fecha, c.hora),
                    "3": doctor_line(c),
                }

                self.stdout.write(f"    📝 Variables: {variables}")

                # Enviar usando plantilla Twilio
                sid = send_whatsapp_template(
                    celular,
                    content_sid=settings.TWILIO_TEMPLATE_SID_RECORDATORIO,
                    variables=variables,
                    cita_id=c.id_cita,
                )

                # Guardar el SID y timestamp del recordatorio
                c.whatsapp_message_sid = sid
                c.recordatorio_enviado_at = now
                c.save(update_fields=['whatsapp_message_sid', 'recordatorio_enviado_at'])

                self.stdout.write(self.style.SUCCESS(f"    ✅ Recordatorio enviado: cita {c.id_cita} | SID: {sid}"))
            except Exception as e:
                import traceback
                self.stdout.write(self.style.ERROR(f"    ❌ Error en cita {c.id_cita}: {e}"))
                self.stdout.write(self.style.ERROR(f"    {traceback.format_exc()}"))
                continue

        self.stdout.write(self.style.SUCCESS("[recordatorios] Proceso completado."))
