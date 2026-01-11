# citas/models.py
from datetime import time
from decimal import Decimal
from django.db import models
from django.db.models import Q, UniqueConstraint, Index
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator, FileExtensionValidator, RegexValidator

from pacientes.models import Paciente
from odontologos.models import Odontologo, BloqueoDia, OdontologoHorario
from usuarios.utils import normalizar_celular_ecuador

# ---- estados como constantes de módulo (para usarlos en Meta) ----
ESTADO_PENDIENTE = 'pendiente'
ESTADO_CONFIRMADA = 'confirmada'
ESTADO_CANCELADA  = 'cancelada'
ESTADO_REALIZADA  = 'realizada'
ESTADO_MANTENIMIENTO = 'mantenimiento'

def validarImagenComprobante(value):
    valid_extensions = ['jpg', 'jpeg', 'png']
    ext = value.name.split('.')[-1].lower()
    if ext not in valid_extensions:
        raise ValidationError('Solo se permiten archivos JPG o PNG.')

def tToMinutes(t: time) -> int:
    return t.hour * 60 + t.minute

celular_contacto_validator = RegexValidator(
    regex=r'^\+?\d{9,15}$',
    message='El celular de contacto debe tener entre 9 y 15 dígitos (E.164: +593XXXXXXXXX).'
)

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
    ausentismo = models.BooleanField(
        default=False,
        db_column='ausentismo',
        help_text="Marca si la cita fue cancelada por inasistencia del paciente (ausentismo confirmado por el odontólogo)."
    )

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
            # Evitar doble reserva del ODONTOLOGO a esa fecha/hora
            UniqueConstraint(
                fields=['id_odontologo', 'fecha', 'hora'],
                condition=~Q(estado=ESTADO_CANCELADA),
                name='uq_cita_odo_fecha_hora_activa',
            ),
            # Evitar doble reserva del CONSULTORIO a esa fecha/hora
            UniqueConstraint(
                fields=['id_consultorio', 'fecha', 'hora'],
                condition=~Q(estado=ESTADO_CANCELADA),
                name='uq_cita_consul_fecha_hora_activa',
            ),
            # Evitar que el PACIENTE tenga dos citas a la misma hora
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
            Index(fields=['estado', 'id_consultorio', 'fecha'], name='idx_cita_est_cons_fecha'),
        ]

    def __str__(self):
        return f'Cita {self.id_cita} - {self.fecha} {self.hora}'

    # --------- Validaciones de negocio ---------
    def clean(self):
        # 0. minuto = 0
        if self.hora and getattr(self.hora, 'minute', None) not in (0,):
            raise ValidationError({"hora": "Las citas duran 1h y deben iniciar en la hora exacta (minuto 0)."})

        # 1. El paciente no puede agendar cita con un odontólogo que es él mismo
        if self.id_paciente_id and self.id_odontologo_id:
            # Obtener id_usuario del paciente
            paciente_usuario_id = getattr(self.id_paciente, 'id_usuario_id', None)
            # Obtener id_usuario del odontólogo
            odontologo_usuario_id = getattr(self.id_odontologo, 'id_usuario_id', None)
            
            if paciente_usuario_id and odontologo_usuario_id and paciente_usuario_id == odontologo_usuario_id:
                raise ValidationError({
                    "id_odontologo": "No puedes agendar una cita contigo mismo."
                })

        # 2. Consultorio activo (solo para crear/mover a un consultorio activo)
        if self.id_consultorio_id and self.id_consultorio and not self.id_consultorio.estado:
            raise ValidationError({"id_consultorio": "El consultorio está inactivo."})

        # 3. 1h dentro de un horario vigente del odontólogo ese día
        if self.id_odontologo_id and self.fecha and self.hora:
            weekday0 = self.fecha.weekday()
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

        # 4. No debe caer en bloqueos (globales o por odontólogo)
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

        # 5. Mensajes claros por conflictos
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

        # 6. No se atiende en almuerzo
        if self.hora and self.hora.hour in (13, 14):
            raise ValidationError({"hora": "No se atiende en horario de almuerzo."})

    def save(self, *args, **kwargs):
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

class PagoCita(models.Model):
    METODO_EFECTIVO = 'efectivo'
    METODO_TRANSFERENCIA = 'transferencia'
    METODO_CHOICES = [
        (METODO_EFECTIVO, 'Efectivo'),
        (METODO_TRANSFERENCIA, 'Transferencia'),
    ]

    ESTADO_PENDIENTE = 'pendiente'
    ESTADO_PAGADO = 'pagado'
    ESTADO_REEMBOLSADO = 'reembolsado'
    ESTADO_CHOICES = [
        (ESTADO_PENDIENTE, 'Pendiente'),
        (ESTADO_PAGADO, 'Pagado'),
        (ESTADO_REEMBOLSADO, 'Reembolsado'),
    ]

    id_pago_cita = models.AutoField(primary_key=True, db_column='id_pago_cita')
    id_cita = models.OneToOneField(
        'Cita', on_delete=models.PROTECT, db_column='id_cita', related_name='pago'
    )

    monto = models.DecimalField(
        max_digits=8, decimal_places=2, db_column='monto',
        validators=[MinValueValidator(Decimal('0.01'))],
        help_text="Monto total pagado por la cita."
    )
    metodo_pago = models.CharField(max_length=20, choices=METODO_CHOICES, db_column='metodo_pago')
    estado_pago = models.CharField(max_length=20, choices=ESTADO_CHOICES, default=ESTADO_PENDIENTE, db_column='estado_pago')

    comprobante = models.URLField(
        max_length=500,
        null=True,
        blank=True,
        db_column='comprobante',
        help_text="URL del comprobante de pago en Cloudinary."
    )

    observacion = models.TextField(null=True, blank=True, db_column='observacion')

    fecha_pago = models.DateTimeField(
        null=True, blank=True, db_column='fecha_pago',
        help_text="Fecha y hora en que se registró el pago."
    )
    reembolsado_en = models.DateTimeField(
        null=True, blank=True, db_column='reembolsado_en',
        help_text="Fecha y hora en que se efectuó el reembolso (si aplica)."
    )
    motivo_reembolso = models.TextField(
        null=True, blank=True, db_column='motivo_reembolso',
        help_text="Motivo por el cual se efectuó el reembolso."
    )

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'pago_cita'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['estado_pago'], name='idx_pago_estado'),
            models.Index(fields=['metodo_pago'], name='idx_pago_metodo'),
            models.Index(fields=['fecha_pago'], name='idx_pago_fecha'),
        ]

    def __str__(self):
        return f"Pago de Cita {self.id_cita_id} - {self.estado_pago} ({self.metodo_pago})"

    def clean(self):
        super().clean() 

        # Validar reembolso
        if self.estado_pago == self.ESTADO_REEMBOLSADO and not self.fecha_pago:
            raise ValidationError("No se puede reembolsar un pago que nunca fue registrado como pagado.")

        # Validar comprobante obligatorio solo si es transferencia
        if self.metodo_pago == self.METODO_TRANSFERENCIA:
            if not self.comprobante:
                raise ValidationError({"comprobante": "Debe adjuntar un comprobante para pagos por transferencia."})
        else:
            # Si es efectivo, se puede dejar vacío
            if self.comprobante:
                # Eliminar archivos subidos por error
                pass

class Configuracion(models.Model):
    # Configuración global del sistema de citas, Solo debe existir UNA fila en esta tabla
    id_configuracion = models.AutoField(
        primary_key=True,
        db_column='id_configuracion'
    )

    celular_contacto = models.CharField(
        default='0999999999',
        max_length=20,
        db_column='celular_contacto',
        validators=[celular_contacto_validator],
        help_text="Celular de contacto del consultorio (formato E.164 recomendado).",
    )

    max_citas_activas = models.IntegerField(
        default=1,
        validators=[MinValueValidator(1)],
        db_column='max_citas_activas',
        help_text="Número máximo de citas activas (pendiente/confirmada) que un paciente puede tener simultáneamente."
    )

    # Ventanas de confirmación
    horas_confirmar_desde = models.IntegerField(
        default=24,
        validators=[MinValueValidator(0)],
        db_column='horas_confirmar_desde'
    )
    horas_confirmar_hasta = models.IntegerField(
        default=12,
        validators=[MinValueValidator(0)],
        db_column='horas_confirmar_hasta'
    )
    horas_autoconfirmar = models.IntegerField(
        default=24,
        validators=[MinValueValidator(0)],
        db_column='horas_autoconfirmar'
    )

    # Límites
    max_citas_dia = models.IntegerField(
        default=1,
        validators=[MinValueValidator(1)],
        db_column='max_citas_dia'
    )

    # Penalización
    cooldown_dias = models.IntegerField(
        default=3,
        validators=[MinValueValidator(0)],
        db_column='cooldown_dias'
    )

    # Reprogramaciones
    max_reprogramaciones = models.IntegerField(
        default=1,
        validators=[MinValueValidator(0)],
        db_column='max_reprogramaciones'
    )
    min_horas_anticipacion = models.IntegerField(
        default=2,
        validators=[MinValueValidator(0)],
        db_column='min_horas_anticipacion'
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
        db_column='created_at'
    )
    updated_at = models.DateTimeField(
        auto_now=True,
        db_column='updated_at'
    )

    class Meta:
        db_table = 'configuracion'
        verbose_name = 'Configuración del Sistema'
        verbose_name_plural = 'Configuración del Sistema'

    def __str__(self):
        return "Configuración del Sistema"

    # ----- VALIDACIONES COMPLETAS -----
    def clean(self):
        """Validaciones de negocio"""
        super().clean()
        errors = {}

        # 1. Validar coherencia de ventana de confirmación
        if self.horas_confirmar_hasta >= self.horas_confirmar_desde:
            errors["horas_confirmar_hasta"] = (
                "Debe ser menor que horas_confirmar_desde."
            )

        # 2. Validar coherencia de anticipación frente a confirmación
        if self.min_horas_anticipacion >= self.horas_confirmar_desde:
            errors["min_horas_anticipacion"] = (
                "Debe ser menor que horas_confirmar_desde."
            )

        # 3. Validar que autoconfirmar no sea mayor que el inicio de la ventana
        if self.horas_autoconfirmar > self.horas_confirmar_desde:
            errors["horas_autoconfirmar"] = (
                "Debe ser menor o igual que horas_confirmar_desde."
            )
        
        # 4. Celular de contacto obligatorio
        if not self.celular_contacto or not self.celular_contacto.strip():
            errors["celular_contacto"] = "El número de contacto no puede estar vacío."

        # 5. max_citas_activas ≥ 1
        if self.max_citas_activas < 1:
            errors["max_citas_activas"] = "Debe ser al menos 1."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        # Normalizar número al formato E.164
        if self.celular_contacto:
            normalizado = normalizar_celular_ecuador(self.celular_contacto)
            if normalizado:
                self.celular_contacto = normalizado

        if not self.pk and Configuracion.objects.exists():
            raise ValidationError("Solo puede existir una configuración del sistema.")

        self.clean()
        super().save(*args, **kwargs)

    @classmethod
    def get_config(cls):
        config = cls.objects.get_or_create(pk=1)
        return config