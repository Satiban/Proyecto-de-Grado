# pacientes/models.py
from django.db import models
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db.models import UniqueConstraint
from django.db.models.functions import Lower

from usuarios.models import Usuario, PACIENTE_ROLE_ID  # PACIENTE_ROLE_ID = 2

# ---------- Validadores ----------
telefono_validator = RegexValidator(
    regex=r'^\d{9,15}$',
    message='El número debe tener entre 9 y 15 dígitos.'
)

# Parentesco del contacto de emergencia (solo estos)
CONTACTO_PARENTESCO_CHOICES = [
    ('hijos', 'Hijos'),
    ('padres', 'Padres'),
    ('hermanos', 'Hermanos'),
    ('abuelos', 'Abuelos'),
    ('esposos', 'Esposos'),
    ('otros', 'Otros'),
]

# Relación familiar del antecedente (solo estos)
RELACION_FAM_CHOICES = [
    ('abuelos', 'Abuelos'),
    ('padres', 'Padres'),
    ('hermanos', 'Hermanos'),
    ('propio', 'Propio'),
]


# ---------- Paciente ----------
class Paciente(models.Model):
    id_paciente = models.AutoField(primary_key=True, db_column='id_paciente')

    # PROTECT: no borres usuario por cascada; se desactiva con is_active
    id_usuario = models.OneToOneField(
        Usuario,
        on_delete=models.PROTECT,
        db_column='id_usuario',
        related_name='paciente',
    )

    contacto_emergencia_nom = models.CharField(max_length=100, db_column='contacto_emergencia_nom')
    contacto_emergencia_cel = models.CharField(max_length=15, validators=[telefono_validator], db_column='contacto_emergencia_cel')
    contacto_emergencia_par = models.CharField(max_length=50, choices=CONTACTO_PARENTESCO_CHOICES, db_column='contacto_emergencia_par')

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'paciente'
        ordering = ['id_paciente']

    def __str__(self):
        u = self.id_usuario
        nombre = f"{u.primer_nombre} {u.primer_apellido}" if u else "—"
        return f'Paciente {self.id_paciente} - {nombre}'

    def clean(self):
        # Solo usuarios con rol PACIENTE (id_rol = 2)
        if self.id_usuario_id and getattr(self.id_usuario, 'id_rol_id', None) != PACIENTE_ROLE_ID:
            raise ValidationError("El id_usuario asociado debe tener rol 'paciente' (id_rol=2).")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)


# ---------- Antecedente ----------
class Antecedente(models.Model):
    id_antecedente = models.AutoField(primary_key=True, db_column='id_antecedente')
    nombre = models.CharField(max_length=100, db_column='nombre')

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'antecedente'
        ordering = ['id_antecedente']
        constraints = [
            # Unicidad case-insensitive (PostgreSQL)
            UniqueConstraint(Lower('nombre'), name='uq_antecedente_nombre_ci'),
        ]

    def __str__(self):
        return self.nombre


# ---------- PacienteAntecedente ----------
class PacienteAntecedente(models.Model):
    id_paciente_antecedente = models.AutoField(primary_key=True, db_column='id_paciente_antecedente')

    id_paciente = models.ForeignKey(Paciente, on_delete=models.CASCADE, db_column='id_paciente', related_name='antecedentes')
    id_antecedente = models.ForeignKey(Antecedente, on_delete=models.CASCADE, db_column='id_antecedente', related_name='pacientes')

    # Solo: abuelos/padres/hermanos/propio
    relacion_familiar = models.CharField(max_length=20, choices=RELACION_FAM_CHOICES, db_column='relacion_familiar')

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'paciente_antecedente'
        ordering = ['id_paciente_antecedente']
        constraints = [
            # Evitar duplicados reales (pero permitir mismo antecedente con distinta relación)
            UniqueConstraint(fields=['id_paciente', 'id_antecedente', 'relacion_familiar'], name='uq_paciente_antecedente_rel'),
        ]

    def __str__(self):
        return f"{self.id_paciente_id} - {self.id_antecedente_id} ({self.relacion_familiar})"
