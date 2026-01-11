# usuarios/serializers.py
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth.models import update_last_login
from .models import (
    Rol, Usuario, LIMITE_CONTADOR,
    MAX_INTENTOS_ANTES_BLOQUEO_1, MAX_INTENTOS_ANTES_BLOQUEO_2,
    MAX_INTENTOS_ANTES_BLOQUEO_3, MAX_INTENTOS_ANTES_DESACTIVAR,
    TIEMPO_BLOQUEO_1, TIEMPO_BLOQUEO_2, TIEMPO_BLOQUEO_3
)
from pacientes.models import Paciente

ADMIN_ROLE_ID = 1
ADMIN_CLINICO_ROLE_ID = 4

class RolSerializer(serializers.ModelSerializer):
    class Meta:
        model = Rol
        fields = ['id_rol', 'rol', 'created_at', 'updated_at']


class UsuarioSerializer(serializers.ModelSerializer):
    rol_nombre = serializers.CharField(source='id_rol.rol', read_only=True)

    # Alias de email por compatibilidad
    usuario_email = serializers.EmailField(source='email', required=False)

    # Exponer is_active (solo lectura, para clientes que ya consumen is_active)
    is_active = serializers.BooleanField(read_only=True)

    # Campo "activo" editable que mapea a is_active en el modelo
    activo = serializers.BooleanField(source='is_active', required=False)

    id_paciente = serializers.SerializerMethodField()
    
    # Foto desencriptada para lectura
    foto = serializers.SerializerMethodField()

    # ---- Flags de acceso ----
    is_superuser = serializers.BooleanField(read_only=True)
    is_staff = serializers.BooleanField(required=False, default=serializers.empty)
    staff = serializers.BooleanField(source='is_staff', required=False, default=serializers.empty)

    class Meta:
        model = Usuario
        fields = [
            'id_usuario',
            'email',
            'usuario_email',
            'password',      
            'primer_nombre',
            'segundo_nombre',
            'primer_apellido',
            'segundo_apellido',
            'cedula',
            'fecha_nacimiento',
            'sexo',
            'tipo_sangre',
            'celular',
            'foto',
            'id_rol',
            'rol_nombre',
            "id_paciente",

            # Flags
            'is_active',         
            'activo',              
            'is_staff',          
            'staff',             
            'is_superuser',     

            # Auditoría
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            'password': {'write_only': True},
            'created_at': {'read_only': True},
            'updated_at': {'read_only': True},
        }

    def get_id_paciente(self, obj):
            try:
                paciente = Paciente.objects.get(id_usuario=obj)
                return paciente.id_paciente
            except Paciente.DoesNotExist:
                return None
    
    def get_foto(self, obj):
        # Retorna la URL de la foto desencriptada
        try:
            return obj.get_foto_desencriptada()
        except Exception:
            return None

    def to_internal_value(self, data):
        # Si es creación (no hay instance), eliminar is_staff del data
        if not self.instance:
            data = data.copy() if hasattr(data, 'copy') else dict(data)
            data.pop('is_staff', None)
            data.pop('staff', None)
        return super().to_internal_value(data)

    # --------- Validaciones ---------
    def validate(self, attrs):
        cedula = attrs.get("cedula")
        email = attrs.get("email")
        celular = attrs.get("celular")
        qs = Usuario.objects.all()

        # Unicidad
        if self.instance is None:
            if cedula and qs.filter(cedula=cedula).exists():
                raise serializers.ValidationError({"cedula": "La cédula ya está registrada."})
            if email and qs.filter(email=email).exists():
                raise serializers.ValidationError({"email": "El correo ya está registrado."})
            if celular and qs.filter(celular=celular).exists():
                raise serializers.ValidationError({"celular": "El celular ya está registrado."})
        else:
            if cedula and qs.exclude(pk=self.instance.pk).filter(cedula=cedula).exists():
                raise serializers.ValidationError({"cedula": "La cédula ya está registrada."})
            if email and qs.exclude(pk=self.instance.pk).filter(email=email).exists():
                raise serializers.ValidationError({"email": "El correo ya está registrado."})
            if celular and qs.exclude(pk=self.instance.pk).filter(celular=celular).exists():
                raise serializers.ValidationError({"celular": "El celular ya está registrado."})

        return attrs

    # --------- Create / Update ---------
    def create(self, validated_data):
        password = validated_data.pop('password', None)
        validated_data.setdefault('is_active', True)  # activo por defecto
        role = validated_data.get('id_rol')
        role_id = None
        if isinstance(role, Rol):
            role_id = role.id_rol
        elif role is not None:
            try:
                role_id = int(role)
            except Exception:
                role_id = None

        if role_id == ADMIN_ROLE_ID or role_id == ADMIN_CLINICO_ROLE_ID:
            validated_data['is_staff'] = True
        else:
            validated_data['is_staff'] = False
        
        # Si viene foto (URL plana), encriptarla antes de crear
        foto_plana = validated_data.pop('foto', None)
        
        user = Usuario.objects.create_user(password=password, **validated_data)
        
        # Encriptar foto si existe
        if foto_plana:
            user.set_foto_encriptada(foto_plana)
            user.save(update_fields=['foto'])
        
        return user

    def update(self, instance, validated_data):
        """
        Update seguro:
        - Si viene password, hashearla con set_password.
        - 'activo' ya llega como is_active por el source.
        - 'is_staff' se respeta en edición.
        - Si viene 'foto' o 'foto_remove', actualiza/elimina correctamente.
        - NUEVO: Si cambia is_staff, ajustar rol automáticamente:
            * is_staff=False → Si tiene paciente, cambiar a rol PACIENTE (2)
            * is_staff=True → Cambiar a rol ADMIN_CLINICO (4)
        """
        password = validated_data.pop('password', None)
        
        # Verificar si cambia is_staff
        nuevo_is_staff = validated_data.get('is_staff')
        cambio_is_staff = nuevo_is_staff is not None and instance.is_staff != nuevo_is_staff

        # Manejar foto si llega en multipart
        request = self.context.get("request")
        if request and hasattr(request, "data"):
            # Si el frontend manda 'foto_remove', eliminamos la actual
            if request.data.get("foto_remove") == "true":
                instance.foto = None
                instance.foto = None

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        # Validar que tenga registro de paciente si desactiva is_staff
        if cambio_is_staff and not nuevo_is_staff:
            tiene_paciente = Paciente.objects.filter(id_usuario=instance).exists()
            if not tiene_paciente:
                raise serializers.ValidationError({
                    "is_staff": "No puede desactivar is_staff sin tener registro de paciente. "
                               "Primero debe crear el registro de paciente para este usuario."
                })

        instance.save()
        return instance



# -----------------------------
# Serializers para Password Reset
# -----------------------------

class PasswordResetRequestSer(serializers.Serializer):
    cedula = serializers.CharField(max_length=10)


class PasswordResetValidateSer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()


class PasswordResetConfirmSer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(min_length=8, write_only=True)


# -----------------------------
# Custom TokenObtainPairSerializer para actualizar last_login y manejar bloqueos
# -----------------------------

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    cedula = serializers.CharField(write_only=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if 'username' in self.fields:
            del self.fields['username']
    
    def validate(self, attrs):
        """
        Sobrescribir para mapear 'cedula' a 'username' internamente
        y manejar errores de bloqueo personalizados CON registro en BD
        """
        from django.utils import timezone
        from datetime import timedelta
        from usuarios.models import IntentosLogin
        
        # Mapear cedula a username para que el padre funcione correctamente
        cedula = attrs.get('cedula')
        if cedula:
            attrs['username'] = cedula
        
        # Obtener IP del request
        request = self.context.get('request')
        ip_address = '0.0.0.0'
        if request:
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip_address = x_forwarded_for.split(',')[0].strip()
            else:
                ip_address = request.META.get('REMOTE_ADDR', '0.0.0.0')
        
        # Verificar si el usuario está bloqueado ANTES de intentar autenticar
        try:
            usuario = Usuario.objects.get(cedula=cedula)
            
            # Si la cuenta está desactivada, rechazar inmediatamente (no incrementar más)
            if not usuario.is_active:
                # Registrar intento pero NO incrementar contador
                IntentosLogin.objects.create(
                    id_usuario=usuario,
                    cedula_intentada=cedula,
                    ip_address=ip_address,
                    exitoso=False
                )
                
                raise serializers.ValidationError({
                    "detail": "Cuenta desactivada por múltiples intentos fallidos. Contacta al administrador.",
                    "desactivada": True,
                    "requiere_admin": True
                })
            
            # Si el bloqueo ya expiró, resetear
            if usuario.bloqueado_hasta and usuario.bloqueado_hasta <= timezone.now():
                usuario.bloqueado_hasta = None
                usuario.intentos_fallidos = 0
                usuario.save(update_fields=['bloqueado_hasta', 'intentos_fallidos'])
            
            # Verificar bloqueo temporal
            if usuario.bloqueado_hasta and usuario.bloqueado_hasta > timezone.now():
                tiempo_restante = int((usuario.bloqueado_hasta - timezone.now()).total_seconds() / 60)
                
                # Registrar intento durante bloqueo
                IntentosLogin.objects.create(
                    id_usuario=usuario,
                    cedula_intentada=cedula,
                    ip_address=ip_address,
                    exitoso=False
                )
                
                raise serializers.ValidationError({
                    "detail": f"Cuenta bloqueada temporalmente. Intenta nuevamente en {tiempo_restante} minutos.",
                    "bloqueado": True,
                    "minutos_restantes": tiempo_restante
                })
            
        except Usuario.DoesNotExist:
            IntentosLogin.objects.create(
                id_usuario=None,
                cedula_intentada=cedula,
                ip_address=ip_address,
                exitoso=False
            )
        
        try:
            data = super().validate(attrs)
            
            # Login exitoso: resetear intentos y registrar éxito
            try:
                usuario = Usuario.objects.get(cedula=cedula)
                if usuario.intentos_fallidos > 0 or usuario.ultimo_intento_fallido:
                    usuario.intentos_fallidos = 0
                    usuario.ultimo_intento_fallido = None
                    usuario.bloqueado_hasta = None
                    usuario.save(update_fields=['intentos_fallidos', 'ultimo_intento_fallido', 'bloqueado_hasta'])
                
                # Registrar intento exitoso
                IntentosLogin.objects.create(
                    id_usuario=usuario,
                    cedula_intentada=cedula,
                    ip_address=ip_address,
                    exitoso=True
                )
            except Usuario.DoesNotExist:
                pass
            
            return data
            
        except Exception as e:
            # Si falla la autenticación, incrementar contador e intentos
            try:
                usuario = Usuario.objects.get(cedula=cedula)
                
                # Registrar intento fallido
                IntentosLogin.objects.create(
                    id_usuario=usuario,
                    cedula_intentada=cedula,
                    ip_address=ip_address,
                    exitoso=False
                )
                
                # Incrementar contador
                usuario.intentos_fallidos = min(usuario.intentos_fallidos + 1, LIMITE_CONTADOR)
                usuario.ultimo_intento_fallido = timezone.now()
                
                # Sistema de bloqueo escalonado
                if usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_DESACTIVAR:
                    # 20+ intentos: DESACTIVAR CUENTA
                    usuario.is_active = False
                    usuario.bloqueado_hasta = None  # Ya no necesita bloqueo temporal
                    mensaje_error = "Cuenta desactivada por múltiples intentos fallidos. Contacta al administrador."
                    intentos_restantes = 0
                elif usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_BLOQUEO_3:
                    # 15-19 intentos: Bloqueo de 1 hora
                    usuario.bloqueado_hasta = timezone.now() + timedelta(minutes=TIEMPO_BLOQUEO_3)
                    intentos_restantes = MAX_INTENTOS_ANTES_DESACTIVAR - usuario.intentos_fallidos
                    mensaje_error = f"Cuenta bloqueada por 1 hora. Intentos restantes antes de desactivación: {intentos_restantes}"
                elif usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_BLOQUEO_2:
                    # 10-14 intentos: Bloqueo de 30 minutos
                    usuario.bloqueado_hasta = timezone.now() + timedelta(minutes=TIEMPO_BLOQUEO_2)
                    intentos_restantes = MAX_INTENTOS_ANTES_BLOQUEO_3 - usuario.intentos_fallidos
                    mensaje_error = f"Cuenta bloqueada por 30 minutos. Intentos restantes antes del próximo nivel: {intentos_restantes}"
                elif usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_BLOQUEO_1:
                    # 5-9 intentos: Bloqueo de 15 minutos
                    usuario.bloqueado_hasta = timezone.now() + timedelta(minutes=TIEMPO_BLOQUEO_1)
                    intentos_restantes = MAX_INTENTOS_ANTES_BLOQUEO_2 - usuario.intentos_fallidos
                    mensaje_error = f"Cuenta bloqueada por 15 minutos. Intentos restantes antes del próximo nivel: {intentos_restantes}"
                else:
                    # 1-4 intentos: Solo advertencia
                    intentos_restantes = MAX_INTENTOS_ANTES_BLOQUEO_1 - usuario.intentos_fallidos
                    mensaje_error = f"Credenciales incorrectas. Te quedan {intentos_restantes} intentos antes del bloqueo."
                
                usuario.save(update_fields=['intentos_fallidos', 'ultimo_intento_fallido', 'bloqueado_hasta', 'is_active'])
                
                # Construir respuesta de error según el nivel
                error_response = {"detail": mensaje_error}
                
                if usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_DESACTIVAR:
                    error_response["desactivada"] = True
                    error_response["requiere_admin"] = True
                elif usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_BLOQUEO_1:
                    error_response["bloqueado"] = True
                    if usuario.bloqueado_hasta:
                        minutos = int((usuario.bloqueado_hasta - timezone.now()).total_seconds() / 60)
                        error_response["minutos_restantes"] = minutos
                else:
                    error_response["intentos_restantes"] = intentos_restantes
                
                raise serializers.ValidationError(error_response)
            except Usuario.DoesNotExist:
                pass  # Usuario no existe, dejar error genérico
            
            raise e
        
        return data
    
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        update_last_login(None, user)
        return token