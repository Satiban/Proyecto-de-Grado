from django.db import models
from django.db.models import Q, F
from django.core.exceptions import ValidationError
from django.db.models import UniqueConstraint, Index
from django.db.models.functions import Lower, ExtractMonth, ExtractDay
import uuid

from usuarios.models import Usuario, ODONTOLOGO_ROLE_ID  # = 3


# ===================== Convención canónica de días =====================
# Lunes = 0, Martes = 1, ..., Domingo = 6
LUNES, MARTES, MIERCOLES, JUEVES, VIERNES, SABADO, DOMINGO = range(7)

DIA_CHOICES = [
    (LUNES, 'Lunes'),
    (MARTES, 'Martes'),
    (MIERCOLES, 'Miércoles'),
    (JUEVES, 'Jueves'),
    (VIERNES, 'Viernes'),
    (SABADO, 'Sábado'),
    (DOMINGO, 'Domingo'),
]

# Mapeos de nombres a índice canónico (acepta español/inglés, con y sin tildes)
NOMBRE_A_DIA = {
    'lunes': LUNES, 'mon': LUNES, 'monday': LUNES,
    'martes': MARTES, 'tue': MARTES, 'tuesday': MARTES,
    'miércoles': MIERCOLES, 'miercoles': MIERCOLES, 'wed': MIERCOLES, 'wednesday': MIERCOLES,
    'jueves': JUEVES, 'thu': JUEVES, 'thursday': JUEVES,
    'viernes': VIERNES, 'fri': VIERNES, 'friday': VIERNES,
    'sábado': SABADO, 'sabado': SABADO, 'sat': SABADO, 'saturday': SABADO,
    'domingo': DOMINGO, 'sun': DOMINGO, 'sunday': DOMINGO,
}

def normalizar_dia_semana(val) -> int:
    """
    Devuelve siempre Lunes=0..Domingo=6.

    Acepta:
      - int 0..6 -> ya canónico (Lunes=0)
      - int 1..7 -> ISO weekday (1=Lunes .. 7=Domingo) => (n-1)%7
      - str dígito "0".."6" o "1".."7"
      - str nombre ('martes', 'Mon', 'sunday', etc.)

    Si no puede normalizar, lanza ValueError.
    """
    if val is None:
        raise ValueError("Día de semana vacío.")

    # num?
    if isinstance(val, int):
        if 0 <= val <= 6:
            return val
        if 1 <= val <= 7:
            return (val - 1) % 7
        raise ValueError(f"Día inválido: {val}")

    s = str(val).strip().lower()
    if s == '':
        raise ValueError("Día vacío.")

    if s.isdigit():
        n = int(s)
        if 0 <= n <= 6:
            return n
        if 1 <= n <= 7:
            return (n - 1) % 7
        raise ValueError(f"Día inválido: {val}")

    if s in NOMBRE_A_DIA:
        return NOMBRE_A_DIA[s]

    raise ValueError(f"No se reconoce el día: {val}")


# ---------------- Odontologo ----------------
class Odontologo(models.Model):
    id_odontologo = models.AutoField(primary_key=True, db_column='id_odontologo')

    # PROTECT: no borres el Usuario por cascada; desactívalo con is_active
    id_usuario = models.OneToOneField(
        Usuario,
        on_delete=models.PROTECT,
        db_column='id_usuario',
        related_name='odontologo',
    )

    # Si borran el consultorio por defecto, que quede en NULL (no borres al odontólogo)
    id_consultorio_defecto = models.ForeignKey(
        'citas.Consultorio',
        on_delete=models.SET_NULL,
        db_column='id_consultorio_defecto',
        null=True,
        blank=True,
        related_name='odontologos_por_defecto',
    )

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'odontologo'
        ordering = ['id_odontologo']

    def __str__(self):
        u = self.id_usuario
        return f'{u.primer_nombre} {u.primer_apellido}' if u else f'Odontólogo {self.id_odontologo}'

    def clean(self):
        # Solo usuarios con rol odontólogo (id_rol = 3)
        if self.id_usuario_id and getattr(self.id_usuario, 'id_rol_id', None) != ODONTOLOGO_ROLE_ID:
            raise ValidationError("El id_usuario asociado debe tener rol 'odontólogo' (id_rol=3).")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)


# ---------------- Especialidad ----------------
class Especialidad(models.Model):
    id_especialidad = models.AutoField(primary_key=True, db_column='id_especialidad')
    # Unicidad case-insensitive (quitamos unique=True y usamos constraint)
    nombre = models.CharField(max_length=100, db_column='nombre')

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'especialidad'
        ordering = ['id_especialidad']
        constraints = [
            UniqueConstraint(Lower('nombre'), name='uq_especialidad_nombre_ci'),
        ]

    def __str__(self):
        return self.nombre


# ---------------- OdontologoEspecialidad (through) ----------------
class OdontologoEspecialidad(models.Model):
    id_odo_esp = models.AutoField(primary_key=True, db_column='id_odo_esp')

    id_odontologo = models.ForeignKey(
        Odontologo, on_delete=models.CASCADE, db_column='id_odontologo', related_name='especialidades'
    )
    id_especialidad = models.ForeignKey(
        Especialidad, on_delete=models.CASCADE, db_column='id_especialidad', related_name='odontologos'
    )

    universidad = models.CharField(max_length=150, null=True, blank=True, db_column='universidad')
    estado = models.BooleanField(default=True, db_column='estado')

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'odontologo_especialidad'
        ordering = ['id_odo_esp']
        constraints = [
            UniqueConstraint(fields=['id_odontologo', 'id_especialidad'], name='uq_odo_especialidad'),
        ]
        indexes = [
            Index(fields=['id_odontologo', 'estado'], name='idx_odoesp_odo_estado'),
            Index(fields=['id_especialidad', 'estado'], name='idx_odoesp_esp_estado'),
        ]

    def __str__(self):
        return f'{self.id_odontologo_id} - {self.id_especialidad_id} ({self.universidad or "s/i"})'


# ---------------- BloqueoDia ----------------
class BloqueoDia(models.Model):
    id_bloqueo = models.AutoField(primary_key=True, db_column='id_bloqueo')

    # AHORA nullable para permitir bloqueos GLOBALes (sin odontólogo)
    id_odontologo = models.ForeignKey(
        Odontologo,
        on_delete=models.CASCADE,
        db_column='id_odontologo',
        related_name='bloqueos',
        null=True,
        blank=True,
    )

    fecha = models.DateField(db_column='fecha')
    recurrente_anual = models.BooleanField(default=False, db_column='recurrente_anual')
    motivo = models.TextField(null=True, blank=True, db_column='motivo')

    # Agrupa varias filas (días) que pertenecen al mismo bloqueo lógico (rango)
    grupo = models.UUIDField(default=uuid.uuid4, db_index=True, db_column='grupo')

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'bloqueo_dia'
        ordering = ['id_bloqueo']
        constraints = [
            UniqueConstraint(fields=['id_odontologo', 'fecha'], name='uq_bloqueo_por_dia_por_odo'),
            UniqueConstraint(fields=['fecha'], condition=Q(id_odontologo__isnull=True), name='uq_bloqueo_global_por_dia'),
        ]
        indexes = [
            Index(fields=['fecha'], name='idx_bloqueo_fecha'),
            Index(fields=['id_odontologo', 'fecha'], name='idx_bloqueo_odo_fecha'),
            Index(fields=['grupo'], name='idx_bloqueo_grupo'),
            Index(
                F('recurrente_anual'),
                ExtractMonth('fecha'),
                ExtractDay('fecha'),
                F('id_odontologo'),
                name='idx_bloqueo_recurrente_mmdd_od',
            ),
        ]


    def __str__(self):
        scope = f'ODO {self.id_odontologo_id}' if self.id_odontologo_id else 'GLOBAL'
        return f'Bloqueo {self.fecha} - {scope}'


# ---------------- OdontologoHorario ----------------
class OdontologoHorario(models.Model):
    id_horario = models.AutoField(primary_key=True, db_column='id_horario')

    id_odontologo = models.ForeignKey(
        Odontologo, on_delete=models.CASCADE, db_column='id_odontologo', related_name='horarios'
    )
    dia_semana = models.IntegerField(choices=DIA_CHOICES, db_column='dia_semana')
    hora_inicio = models.TimeField(db_column='hora_inicio')
    hora_fin = models.TimeField(db_column='hora_fin')
    vigente = models.BooleanField(default=True, db_column='vigente')

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'odontologo_horario'
        ordering = ['id_horario']
        constraints = [
            models.CheckConstraint(
                check=Q(hora_fin__gt=F('hora_inicio')),
                name='ck_horario_rango_valido'
            ),
            models.CheckConstraint(
                check=Q(dia_semana__gte=0) & Q(dia_semana__lte=6),
                name='ck_dia_semana_valido'
            ),
            models.UniqueConstraint(
                fields=['id_odontologo', 'dia_semana', 'hora_inicio', 'hora_fin'],
                name='uq_horario_exact_duplicate'
            ),
        ]
        indexes = [
            Index(fields=['id_odontologo', 'dia_semana', 'vigente'], name='idx_horario_odo_dia_vig'),
        ]

    def __str__(self):
        return f'{self.get_dia_semana_display()} {self.hora_inicio} - {self.hora_fin}'

    # Evitar solapes para el mismo odontólogo y día (a nivel modelo)
    def clean(self):
        if not self.id_odontologo_id:
            return
        qs = OdontologoHorario.objects.filter(
            id_odontologo=self.id_odontologo,
            dia_semana=self.dia_semana,
            vigente=True  # solo chocamos con horarios vigentes
        )
        if self.pk:
            qs = qs.exclude(pk=self.pk)

        # solape si: inicio < fin_existente y fin > inicio_existente
        overlap = qs.filter(
            hora_inicio__lt=self.hora_fin,
            hora_fin__gt=self.hora_inicio,
        ).exists()
        if overlap:
            raise ValidationError("Ya existe un horario vigente que se solapa para ese día.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)
