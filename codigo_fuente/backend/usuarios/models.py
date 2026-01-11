# usuarios/models.py
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager
from django.core.exceptions import ObjectDoesNotExist
from django.core.validators import RegexValidator, MinValueValidator, MaxValueValidator
from django.db import models
from datetime import date
from usuarios.utils import normalizar_celular_ecuador
from django.utils import timezone

# ---------------- Constantes de Rol ----------------
ADMIN_ROLE_ID = 1              # Superadmin del sistema
PACIENTE_ROLE_ID = 2
ODONTOLOGO_ROLE_ID = 3
ADMIN_CLINICO_ROLE_ID = 4

# ---------------- Constantes de Seguridad (Anti Fuerza Bruta) ----------------
# Sistema de bloqueo escalonado:
# - Intentos 1-5:   Bloqueo 15 min
# - Intentos 6-10:  Bloqueo 30 min
# - Intentos 11-15: Bloqueo 1 hora (60 min)
# - Intentos 16-20: Desactivación automática de cuenta (is_active=False)

MAX_INTENTOS_ANTES_BLOQUEO_1 = 5    # Primer umbral (bloqueo 15 min)
MAX_INTENTOS_ANTES_BLOQUEO_2 = 10   # Segundo umbral (bloqueo 30 min)
MAX_INTENTOS_ANTES_BLOQUEO_3 = 15   # Tercer umbral (bloqueo 1 hora)
MAX_INTENTOS_ANTES_DESACTIVAR = 20  # Cuarto umbral (desactivación automática)

TIEMPO_BLOQUEO_1 = 15   # Minutos del primer bloqueo
TIEMPO_BLOQUEO_2 = 30   # Minutos del segundo bloqueo
TIEMPO_BLOQUEO_3 = 60   # Minutos del tercer bloqueo

LIMITE_CONTADOR = 25    # Límite máximo del contador (por seguridad, mayor a 20)
# ---------------- Manager ----------------
class UsuarioManager(BaseUserManager):
    def create_user(self, cedula, password=None, **extra_fields):
        if not cedula:
            raise ValueError('La cédula es obligatoria')
        if not password:
            raise ValueError('La contraseña es obligatoria')

        # Validar campos requeridos
        requeridos = [
            'primer_nombre', 'primer_apellido', 'segundo_apellido',
            'fecha_nacimiento', 'sexo', 'tipo_sangre', 'id_rol'
        ]
        faltan = [k for k in requeridos if not extra_fields.get(k)]
        if faltan:
            raise ValueError(f"Faltan campos obligatorios: {', '.join(faltan)}")

        # Normalizar email si existe
        if 'email' in extra_fields and extra_fields['email']:
            extra_fields['email'] = self.normalize_email(extra_fields['email'])

        user = self.model(cedula=cedula, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, cedula, password=None, **extra_fields):
        # Crea un superusuario EXIGIENDO datos completos y garantizando rol administrador SISTEMA (id_rol=1).
        extra_fields.setdefault('is_active', True)

        requeridos = [
            'primer_nombre', 'primer_apellido', 'segundo_apellido',
            'fecha_nacimiento', 'sexo', 'tipo_sangre', 'email', 'celular'
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

        user = self.create_user(cedula, password, **extra_fields)

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

# ---------------- IntentosLogin ----------------
class IntentosLogin(models.Model):
    id_intento = models.AutoField(primary_key=True, db_column='id_intento')
    
    # FK al usuario
    id_usuario = models.ForeignKey(
        'Usuario',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column='id_usuario',
        related_name='intentos_login'
    )
    
    # Datos del intento
    cedula_intentada = models.CharField(max_length=10, db_column='cedula_intentada')
    ip_address = models.GenericIPAddressField(db_column='ip_address')
    exitoso = models.BooleanField(default=False, db_column='exitoso')
    
    # Auditoría
    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    
    class Meta:
        db_table = 'intentos_login'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['cedula_intentada', '-created_at']),
            models.Index(fields=['ip_address', '-created_at']),
        ]
    
    def __str__(self):
        estado = "exitoso" if self.exitoso else "fallido"
        return f"Intento {estado} - {self.cedula_intentada} ({self.created_at})"

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
    regex=r'^\+?\d{9,15}$', message='El celular debe tener entre 9 y 15 dígitos (formato E.164: +593XXXXXXXXX).'
)

class Usuario(AbstractBaseUser, PermissionsMixin):
    # PK primero
    id_usuario = models.AutoField(primary_key=True, db_column='id_usuario')

    # Identidad / autenticación (cédula es USERNAME_FIELD)
    cedula = models.CharField(max_length=10, unique=True, validators=[cedula_validator], db_column='cedula')
    
    # Email y celular propios
    # unique=True permite NULL duplicados en PostgreSQL
    # Menores sin estos datos: email ficticio autogenerado, celular=NULL
    email = models.EmailField(unique=True, blank=True, null=True, db_column='email', help_text='Email del usuario. Para menores sin email, se genera automáticamente.')
    celular = models.CharField(max_length=15, unique=True, validators=[celular_validator], blank=True, null=True, db_column='celular', help_text='Celular del usuario (opcional para menores sin celular propio)')

    # Datos personales
    primer_nombre = models.CharField(max_length=100, db_column='primer_nombre')
    segundo_nombre = models.CharField(max_length=100, blank=True, null=True, db_column='segundo_nombre')
    primer_apellido = models.CharField(max_length=100, db_column='primer_apellido')
    segundo_apellido = models.CharField(max_length=100, db_column='segundo_apellido')  # obligatorio
    fecha_nacimiento = models.DateField(db_column='fecha_nacimiento')
    sexo = models.CharField(max_length=1, choices=SEXO_CHOICES, db_column='sexo')
    tipo_sangre = models.CharField(max_length=12, choices=TIPO_SANGRE_CHOICES, default='Desconocido', db_column='tipo_sangre')
    foto = models.TextField(
        blank=True,
        null=True,
        db_column='foto',
        help_text='URL encriptada de la foto del usuario'
    )

    # FK después de la PK
    id_rol = models.ForeignKey(Rol, on_delete=models.PROTECT, db_column='id_rol', related_name='usuarios')

    # Flags Django
    is_active = models.BooleanField(default=True, db_column='is_active')   # habilita/deshabilita login
    is_staff = models.BooleanField(default=False, db_column='is_staff')    # acceso a /admin

    # Control de intentos fallidos y bloqueo temporal
    intentos_fallidos = models.IntegerField(
        default=0,
        db_column='intentos_fallidos',
        validators=[MinValueValidator(0), MaxValueValidator(25)],
        help_text='Contador de intentos de login fallidos consecutivos. Al llegar a 20 se desactiva la cuenta automáticamente.'
    )
    ultimo_intento_fallido = models.DateTimeField(
        null=True,
        blank=True,
        db_column='ultimo_intento_fallido',
        help_text='Timestamp del último intento fallido'
    )
    bloqueado_hasta = models.DateTimeField(
        null=True,
        blank=True,
        db_column='bloqueado_hasta',
        help_text='Fecha y hora hasta la cual la cuenta está bloqueada temporalmente'
    )

    # Auditoría
    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    USERNAME_FIELD = 'cedula'
    REQUIRED_FIELDS = [
        'primer_nombre', 'primer_apellido', 'segundo_apellido',
        'fecha_nacimiento', 'sexo', 'tipo_sangre', 'email', 'celular'
    ]

    objects = UsuarioManager()

    class Meta:
        db_table = 'usuario'
        ordering = ['id_usuario']

    def __str__(self):
        return f"{self.primer_nombre} {self.primer_apellido} {self.segundo_apellido}"
    
    def es_menor_edad(self):
        # Calcula si el usuario es menor de 18 años
        hoy = date.today()
        edad = hoy.year - self.fecha_nacimiento.year
        if (hoy.month, hoy.day) < (self.fecha_nacimiento.month, self.fecha_nacimiento.day):
            edad -= 1
        return edad < 18
    
    def resetear_intentos_login(self):
        self.intentos_fallidos = 0
        self.ultimo_intento_fallido = None
        self.bloqueado_hasta = None
        self.save(update_fields=['intentos_fallidos', 'ultimo_intento_fallido', 'bloqueado_hasta'])
    
    def set_foto_encriptada(self, url_plana: str):
        # Encripta y guarda la URL de la foto
        from usuarios.utils import encriptar_url
        if url_plana:
            self.foto = encriptar_url(url_plana)
        else:
            self.foto = None
    
    def get_foto_desencriptada(self) -> str:
        # Retorna la URL de la foto desencriptada
        from usuarios.utils import desencriptar_url
        if self.foto:
            try:
                return desencriptar_url(self.foto)
            except Exception:
                return None
        return None
    
    def esta_bloqueado_temporalmente(self):
        # Verifica si la cuenta está actualmente bloqueada por intentos fallidos.

        
        if not self.bloqueado_hasta:
            return False, 0
        
        if self.bloqueado_hasta <= timezone.now():
            # El bloqueo ya expiró
            return False, 0
        
        # Calcular minutos restantes
        segundos_restantes = (self.bloqueado_hasta - timezone.now()).total_seconds()
        minutos_restantes = int(segundos_restantes / 60) + 1  # Redondear hacia arriba
        
        return True, minutos_restantes

    def save(self, *args, **kwargs):
        """
        Reglas centralizadas:
        - Rol 1 (superadmin): is_staff=True, is_superuser=True (siempre)
        - Resto de roles: is_superuser=False, is_staff editable desde frontend
        - Email vacío: generar email ficticio basado en cédula
        - Celular: normalizar a formato E.164 (+593...) automáticamente
        - Si is_active=False: desactiva también el registro de Odontólogo si existe
        - Si is_active cambia a True: resetea intentos fallidos y desbloquea
        - Limita intentos_fallidos a máximo 10 (seguridad anti-fuerza bruta)
        """
        # Detectar si la cuenta está siendo reactivada (is_active: False → True)
        if self.pk:  # Solo si el usuario ya existe en BD
            try:
                usuario_anterior = Usuario.objects.get(pk=self.pk)
                # Si cambió de inactivo a activo, resetear intentos
                if not usuario_anterior.is_active and self.is_active:
                    self.intentos_fallidos = 0
                    self.ultimo_intento_fallido = None
                    self.bloqueado_hasta = None
            except Usuario.DoesNotExist:
                pass  # Usuario nuevo, no hacer nada
        
        # Normalizar celular a formato E.164
        if self.celular:
            celular_normalizado = normalizar_celular_ecuador(self.celular)
            if celular_normalizado:
                self.celular = celular_normalizado
        
        # Gestión de flags según rol
        if self.id_rol_id == ADMIN_ROLE_ID:
            self.is_staff = True
            self.is_superuser = True
        else:
            self.is_superuser = False
        
        # Generar email ficticio si no tiene email
        if not self.email:
            self.email = f"cedula{self.cedula}@oralflow.system"
        
        # Limitar intentos_fallidos al máximo permitido (seguridad)
        if self.intentos_fallidos > LIMITE_CONTADOR:
            self.intentos_fallidos = LIMITE_CONTADOR
        
        super().save(*args, **kwargs)
        
        # Si el usuario se desactiva, desactivar también su registro de odontólogo
        if not self.is_active:
            try:
                from odontologos.models import Odontologo
                odontologo = Odontologo.objects.filter(id_usuario=self).first()
                if odontologo and odontologo.activo:
                    odontologo.activo = False
                    odontologo.save()
            except Exception:
                pass  # Si no existe o hay error, continuar