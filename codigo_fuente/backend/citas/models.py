# citas/models.py
from datetime import time
from uuid import uuid4
from django.db import models
from django.db.models import Q, UniqueConstraint, Index
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator

from pacientes.models import Paciente
from odontologos.models import Odontologo, BloqueoDia, OdontologoHorario

# ---- estados como constantes de módulo (para usarlos en Meta) ----
ESTADO_PENDIENTE = 'pendiente'
ESTADO_CONFIRMADA = 'confirmada'
ESTADO_CANCELADA  = 'cancelada'
ESTADO_REALIZADA  = 'realizada'
ESTADO_MANTENIMIENTO = 'mantenimiento'


def tToMinutes(t: time) -> int:
    return t.hour * 60 + t.minute

# Alias para compatibilidad
_t_to_minutes = tToMinutes


class Consultorio(models.Model):
    id_consultorio = models.AutoField(primary_key=True, db_column='id_consultorio')
    numero = models.CharField(max_length=10, unique=True, db_column='numero')
    descripcion = models.TextField(blank=True, null=True, db_column='descripcion')
    estado = models.BooleanField(default=True, db_column='estado')

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'consultorio'
        ordering = ['id_consultorio']
        indexes = [
            Index(fields=['estado'], name='idx_consultorio_estado'),
            Index(fields=['numero'], name='idx_consultorio_numero'),
        ]

    def __str__(self):
        return f'Consultorio {self.numero}'


class Cita(models.Model):
    ESTADO_CHOICES = [
        (ESTADO_PENDIENTE, 'Pendiente'),
        (ESTADO_CONFIRMADA, 'Confirmada'),
        (ESTADO_CANCELADA,  'Cancelada'),
        (ESTADO_REALIZADA,  'Realizada'),
        (ESTADO_MANTENIMIENTO, 'Mantenimiento'),
    ]

    id_cita = models.AutoField(primary_key=True, db_column='id_cita')

    # PROTECT para no perder historial
    id_paciente = models.ForeignKey(
        Paciente, on_delete=models.PROTECT, db_column='id_paciente', related_name='citas'
    )
    id_odontologo = models.ForeignKey(
        Odontologo, on_delete=models.PROTECT, db_column='id_odontologo', related_name='citas'
    )
    id_consultorio = models.ForeignKey(
        Consultorio, on_delete=models.PROTECT, db_column='id_consultorio', related_name='citas'
    )

    fecha = models.DateField(db_column='fecha')
    hora = models.TimeField(db_column='hora')  # minuto=0
    motivo = models.TextField(blank=False, null=False, db_column='motivo')
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default=ESTADO_PENDIENTE, db_column='estado')

    # Reprogramaciones hechas por el PACIENTE (tu contador actual)
    reprogramaciones = models.IntegerField(
        default=0,
        db_column='reprogramaciones',
        validators=[MinValueValidator(0)],
        help_text="Número de veces que el paciente reprogramó esta cita."
    )

    # Cancelación por paciente/staff
    cancelada_en = models.DateTimeField(
        null=True, blank=True, db_column='cancelada_en',
        help_text="Fecha/hora exacta en que el PACIENTE canceló. Nulo si canceló staff/odontólogo."
    )
    cancelada_por_rol = models.IntegerField(
        null=True, blank=True, db_column='cancelada_por_rol',
        help_text="Rol que canceló: 1,2,3,4. Si fue staff/odo, no se aplica cooldown."
    )

    # ---- NUEVO: huellas para 'reprogramación' por desactivación de consultorio ----
    reprogramada_en = models.DateTimeField(
        null=True, blank=True, db_column='reprogramada_en',
        help_text="Fecha/hora en que esta cita fue marcada para reprogramación (por operación masiva)."
    )
    reprogramada_por_rol = models.IntegerField(
        null=True, blank=True, db_column='reprogramada_por_rol',
        help_text="Rol que marcó la reprogramación masiva (1=Admin, etc.)."
    )
    batch_id = models.UUIDField(
        null=True, blank=True, db_column='batch_id', db_index=True,
        help_text="Identificador del lote de operación masiva (para filtrar y reportar)."
    )
    # -------------------------------------------------------------------------------

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    # --- Tracking WhatsApp ---
    whatsapp_message_sid = models.CharField(
        max_length=64, null=True, blank=True, db_column='whatsapp_message_sid',
        help_text="SID del mensaje de recordatorio enviado por WhatsApp."
    )
    recordatorio_enviado_at = models.DateTimeField(
        null=True, blank=True, db_column='recordatorio_enviado_at',
        help_text="Marca de tiempo cuando se envió el recordatorio por WhatsApp."
    )
    confirmacion_fuente = models.CharField(
        max_length=16, null=True, blank=True, db_column='confirmacion_fuente',
        help_text="whatsapp | web | recepcion"
    )

    class Meta:
        db_table = 'cita'
        ordering = ['fecha', 'hora', 'id_cita']
        constraints = [
            # Evitar doble reserva del ODONTOLOGO a esa fecha/hora (si no está cancelada)
            UniqueConstraint(
                fields=['id_odontologo', 'fecha', 'hora'],
                condition=~Q(estado=ESTADO_CANCELADA),
                name='uq_cita_odo_fecha_hora_activa',
            ),
            # Evitar doble reserva del CONSULTORIO a esa fecha/hora (si no está cancelada)
            UniqueConstraint(
                fields=['id_consultorio', 'fecha', 'hora'],
                condition=~Q(estado=ESTADO_CANCELADA),
                name='uq_cita_consul_fecha_hora_activa',
            ),
            # Evitar que el PACIENTE tenga dos citas a la misma hora (si no están canceladas)
            UniqueConstraint(
                fields=['id_paciente', 'fecha', 'hora'],
                condition=~Q(estado=ESTADO_CANCELADA),
                name='uq_cita_paciente_fecha_hora_activa',
            ),
            # Refuerzo: minuto debe ser 0
            models.CheckConstraint(
                check=Q(hora__minute=0),
                name='ck_cita_minuto_cero',
            ),
        ]
        indexes = [
            Index(fields=['id_odontologo', 'fecha'], name='idx_cita_odo_fecha'),
            Index(fields=['id_consultorio', 'fecha'], name='idx_cita_consul_fecha'),
            Index(fields=['id_paciente', 'fecha'], name='idx_cita_paciente_fecha'),
            Index(fields=['estado', 'fecha'], name='idx_cita_estado_fecha'),
            Index(fields=['id_paciente', 'id_odontologo', 'cancelada_en'], name='idx_cita_po_canceladaen'),
            Index(fields=['cancelada_por_rol', 'cancelada_en'], name='idx_cita_cancel_porrol_en'),

            # Útil para listar rápido las reprogramadas de un consultorio por fecha
            Index(fields=['estado', 'id_consultorio', 'fecha'], name='idx_cita_est_cons_fecha'),
        ]

    def __str__(self):
        return f'Cita {self.id_cita} - {self.fecha} {self.hora}'

    # --------- Validaciones de negocio ---------
    def clean(self):
        # 0) minuto = 0
        if self.hora and getattr(self.hora, 'minute', None) not in (0,):
            raise ValidationError({"hora": "Las citas duran 1h y deben iniciar en la hora exacta (minuto 0)."})

        # 1) Consultorio activo (solo para crear/mover a un consultorio activo)
        if self.id_consultorio_id and self.id_consultorio and not self.id_consultorio.estado:
            raise ValidationError({"id_consultorio": "El consultorio está inactivo."})

        # 2) Debe caber COMPLETA (1h) dentro de un horario vigente del odontólogo ese día
        if self.id_odontologo_id and self.fecha and self.hora:
            weekday0 = self.fecha.weekday()  # 0=Lun..6=Dom
            horarios = OdontologoHorario.objects.filter(
                id_odontologo_id=self.id_odontologo_id,
                vigente=True,
                dia_semana=weekday0,
            ).only("hora_inicio", "hora_fin")

            startMin = tToMinutes(self.hora)
            endMin = startMin + 60  # cita de 1h

            fitsAny = any(tToMinutes(h.hora_inicio) <= startMin and endMin <= tToMinutes(h.hora_fin) for h in horarios)
            if not fitsAny:
                raise ValidationError({"hora": "La hora no está dentro del horario vigente del odontólogo para ese día."})

        # 3) No debe caer en bloqueos (globales o por odontólogo)
        if self.fecha:
            qGlobal = Q(id_odontologo__isnull=True) & (
                Q(fecha=self.fecha) |
                (Q(recurrente_anual=True) & Q(fecha__month=self.fecha.month, fecha__day=self.fecha.day))
            )
            qOdo = Q()
            if self.id_odontologo_id:
                qOdo = Q(id_odontologo_id=self.id_odontologo_id) & (
                    Q(fecha=self.fecha) |
                    (Q(recurrente_anual=True) & Q(fecha__month=self.fecha.month, fecha__day=self.fecha.day))
                )

            if BloqueoDia.objects.filter(qGlobal | qOdo).exists():
                raise ValidationError({"fecha": "El día está bloqueado."})

        # 4) Mensajes claros por conflictos (además del constraint condicional)
        if self.id_odontologo_id and self.fecha and self.hora:
            baseQs = Cita.objects.filter(
                id_odontologo_id=self.id_odontologo_id,
                fecha=self.fecha,
                hora=self.hora,
            ).exclude(estado=ESTADO_CANCELADA)
            if self.pk:
                baseQs = baseQs.exclude(pk=self.pk)
            if baseQs.exists():
                raise ValidationError({"hora": "Ese horario ya está tomado para el odontólogo."})

        if self.id_consultorio_id and self.fecha and self.hora:
            baseQs = Cita.objects.filter(
                id_consultorio_id=self.id_consultorio_id,
                fecha=self.fecha,
                hora=self.hora,
            ).exclude(estado=ESTADO_CANCELADA)
            if self.pk:
                baseQs = baseQs.exclude(pk=self.pk)
            if baseQs.exists():
                raise ValidationError({"id_consultorio": "El consultorio ya está ocupado en ese horario."})

        if self.id_paciente_id and self.fecha and self.hora:
            baseQs = Cita.objects.filter(
                id_paciente_id=self.id_paciente_id,
                fecha=self.fecha,
                hora=self.hora,
            ).exclude(estado=ESTADO_CANCELADA)
            if self.pk:
                baseQs = baseQs.exclude(pk=self.pk)
            if baseQs.exists():
                raise ValidationError({"id_paciente": "El paciente ya tiene una cita en ese horario."})

        # 5) No se atiende en almuerzo
        if self.hora and self.hora.hour in (13, 14):
            raise ValidationError({"hora": "No se atiende en horario de almuerzo."})

    def save(self, *args, **kwargs):
        # Ejecuta validaciones Python (además del serializer.full_clean())
        self.clean()
        super().save(*args, **kwargs)

    @property
    def inicio_dt(self):
        from datetime import datetime
        from django.utils.timezone import make_aware
        naive = datetime.combine(self.fecha, self.hora)
        try:
            return make_aware(naive)
        except Exception:
            return naive