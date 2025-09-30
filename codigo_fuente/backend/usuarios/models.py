# usuarios/models.py
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager
from django.core.exceptions import ObjectDoesNotExist
from django.core.validators import RegexValidator
from django.db import models

# ---------------- Constantes de Rol ----------------
ADMIN_ROLE_ID = 1              # Superadmin del sistema (dueño): staff + superuser
PACIENTE_ROLE_ID = 2
ODONTOLOGO_ROLE_ID = 3
ADMIN_CLINICO_ROLE_ID = 4      # NUEVO: Administrador clínico (sin staff, sin superuser)

# ---------------- Manager ----------------
class UsuarioManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('El email es obligatorio')
        if not password:
            raise ValueError('La contraseña es obligatoria')

        email = self.normalize_email(email)

        # Validar campos requeridos (además de blank=False en el modelo)
        requeridos = [
            'primer_nombre', 'primer_apellido', 'segundo_apellido',
            'cedula', 'fecha_nacimiento', 'sexo', 'tipo_sangre', 'celular', 'id_rol'
        ]
        faltan = [k for k in requeridos if not extra_fields.get(k)]
        if faltan:
            raise ValueError(f"Faltan campos obligatorios: {', '.join(faltan)}")

        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        """
        Crea un superusuario EXIGIENDO datos completos y garantizando rol administrador SISTEMA (id_rol=1).
        """
        extra_fields.setdefault('is_active', True)

        requeridos = [
            'primer_nombre', 'primer_apellido', 'segundo_apellido',
            'cedula', 'fecha_nacimiento', 'sexo', 'tipo_sangre', 'celular'
        ]
        faltan = [k for k in requeridos if not extra_fields.get(k)]
        if faltan:
            raise ValueError(f"Faltan campos obligatorios para superusuario: {', '.join(faltan)}")

        # Asegurar rol administrador del sistema (id_rol=1)
        if 'id_rol' not in extra_fields or extra_fields['id_rol'] is None:
            try:
                from usuarios.models import Rol
                extra_fields['id_rol'] = Rol.objects.get(id_rol=ADMIN_ROLE_ID)
            except ObjectDoesNotExist:
                raise ValueError("Debe existir un rol 'administrador' con id_rol=1 en la base de datos")
        else:
            # Si vino otro rol, forzar que sea admin del sistema (1)
            try:
                from usuarios.models import Rol
                rol_val = extra_fields['id_rol']
                if isinstance(rol_val, int):
                    if rol_val != ADMIN_ROLE_ID:
                        raise ValueError("El superusuario debe tener id_rol=1 (administrador del sistema).")
                elif isinstance(rol_val, Rol) and rol_val.id_rol != ADMIN_ROLE_ID:
                    raise ValueError("El superusuario debe tener id_rol=1 (administrador del sistema).")
            except Exception:
                pass

        user = self.create_user(email, password, **extra_fields)

        # Por seguridad, garantizar flags (aunque save() también los eleva con rol 1)
        user.is_staff = True
        user.is_superuser = True
        user.save(using=self._db)

        return user


# ---------------- Rol ----------------
class Rol(models.Model):
    id_rol = models.AutoField(primary_key=True, db_column='id_rol')
    rol = models.CharField(max_length=50, unique=True, db_column='rol')

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'rol'
        ordering = ['id_rol']

    def __str__(self):
        return self.rol


# ---------------- Usuario ----------------
SEXO_CHOICES = [('M', 'Masculino'), ('F', 'Femenino')]
TIPO_SANGRE_CHOICES = [
    ('O+', 'O+'), ('O-', 'O-'),
    ('A+', 'A+'), ('A-', 'A-'),
    ('B+', 'B+'), ('B-', 'B-'),
    ('AB+', 'AB+'), ('AB-', 'AB-'),
    ('Desconocido', 'Desconocido')
]

cedula_validator = RegexValidator(
    regex=r'^\d{10}$', message='La cédula debe tener exactamente 10 dígitos.'
)
celular_validator = RegexValidator(
    regex=r'^\d{9,15}$', message='El celular debe tener entre 9 y 15 dígitos.'
)

class Usuario(AbstractBaseUser, PermissionsMixin):
    # PK primero
    id_usuario = models.AutoField(primary_key=True, db_column='id_usuario')

    # Identidad / autenticación
    email = models.EmailField(unique=True, db_column='email')

    # Datos personales
    primer_nombre = models.CharField(max_length=100, db_column='primer_nombre')
    segundo_nombre = models.CharField(max_length=100, blank=True, null=True, db_column='segundo_nombre')
    primer_apellido = models.CharField(max_length=100, db_column='primer_apellido')
    segundo_apellido = models.CharField(max_length=100, db_column='segundo_apellido')  # obligatorio
    cedula = models.CharField(max_length=10, unique=True, validators=[cedula_validator], db_column='cedula')
    fecha_nacimiento = models.DateField(db_column='fecha_nacimiento')
    sexo = models.CharField(max_length=1, choices=SEXO_CHOICES, db_column='sexo')
    tipo_sangre = models.CharField(max_length=12, choices=TIPO_SANGRE_CHOICES, default='Desconocido', db_column='tipo_sangre')
    celular = models.CharField(max_length=15, validators=[celular_validator], db_column='celular')
    foto = models.ImageField(upload_to='usuarios/fotos/', blank=True, null=True, db_column='foto')

    # FK después de la PK
    id_rol = models.ForeignKey(Rol, on_delete=models.PROTECT, db_column='id_rol', related_name='usuarios')

    # Flags Django
    is_active = models.BooleanField(default=True, db_column='is_active')   # habilita/deshabilita login
    is_staff = models.BooleanField(default=False, db_column='is_staff')    # acceso a /admin

    # Auditoría
    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = [
        'primer_nombre', 'primer_apellido', 'segundo_apellido',
        'cedula', 'fecha_nacimiento', 'sexo', 'tipo_sangre', 'celular'
    ]

    objects = UsuarioManager()

    class Meta:
        db_table = 'usuario'
        ordering = ['id_usuario']

    def __str__(self):
        return f"{self.primer_nombre} {self.primer_apellido} {self.segundo_apellido}"

    def save(self, *args, **kwargs):
        """
        Reglas centralizadas de flags:
        - Rol 1 (superadmin del sistema): is_staff=True, is_superuser=True (siempre)
        - Resto de roles (incluye ADMIN_CLINICO_ROLE_ID=4):
            * is_superuser siempre False
            * is_staff se respeta tal como venga (editable desde el frontend)
        """
        if self.id_rol_id == ADMIN_ROLE_ID:
            self.is_staff = True
            self.is_superuser = True
        else:
            # No tocar is_staff para permitir edición desde el frontend
            self.is_superuser = False
        super().save(*args, **kwargs)

