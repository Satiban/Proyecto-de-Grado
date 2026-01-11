# usuarios/authentication.py
"""
Backend de autenticación personalizado para permitir login SOLO con cédula.
Incluye protección contra ataques de fuerza bruta con bloqueo escalonado:
- 1-5 intentos: Bloqueo 15 min
- 6-10 intentos: Bloqueo 30 min
- 11-15 intentos: Bloqueo 1 hora
- 16-20 intentos: Desactivación automática de cuenta
"""
from django.contrib.auth.backends import ModelBackend
from django.utils import timezone
from datetime import timedelta
from usuarios.models import (
    Usuario, IntentosLogin,
    MAX_INTENTOS_ANTES_BLOQUEO_1, MAX_INTENTOS_ANTES_BLOQUEO_2,
    MAX_INTENTOS_ANTES_BLOQUEO_3, MAX_INTENTOS_ANTES_DESACTIVAR,
    TIEMPO_BLOQUEO_1, TIEMPO_BLOQUEO_2, TIEMPO_BLOQUEO_3
)


def obtenerIpCliente(request):
    # Obtiene la IP real del cliente considerando proxies/balanceadores
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0].strip()
    else:
        ip = request.META.get('REMOTE_ADDR', '0.0.0.0')
    return ip


class CedulaAuthenticationBackend(ModelBackend):
    """
    Backend que permite autenticación ÚNICAMENTE usando cédula.
    Implementa bloqueo escalonado con desactivación automática.
    
    Sistema de protección:
    - 5 intentos fallidos → Bloqueo de 15 minutos
    - 10 intentos fallidos → Bloqueo de 30 minutos
    - 15 intentos fallidos → Bloqueo de 1 hora
    - 20 intentos fallidos → Desactivación automática (is_active=False)
    """
    
    def authenticate(self, request, username=None, password=None, **kwargs):
        """
        Autentica usuario por cédula con protección escalonada contra fuerza bruta.
        
        Estrategia de bloqueo escalonado:
        - 1-5 intentos: Advertencia
        - 5 intentos: Bloqueo de 15 minutos
        - 10 intentos: Bloqueo de 30 minutos
        - 15 intentos: Bloqueo de 1 hora
        - 20 intentos: Desactivación automática
        - Login exitoso: Resetea contador
        
        Args:
            username: La cédula del usuario (Django lo llama 'username' por convención)
            password: Contraseña del usuario
            request: Request HTTP para obtener IP
            
        Returns:
            Usuario autenticado o None si falla
        """
        if username is None or password is None:
            return None
        
        ip_address = obtenerIpCliente(request) if request else '0.0.0.0'
        
        try:
            # Buscar SOLO por cédula
            usuario = Usuario.objects.get(cedula=username)
            
            # Si la cuenta está desactivada, rechazar inmediatamente (no incrementar más)
            if not usuario.is_active:
                # Registrar intento pero NO incrementar contador
                IntentosLogin.objects.create(
                    id_usuario=usuario,
                    cedula_intentada=username,
                    ip_address=ip_address,
                    exitoso=False
                )
                return None
            
            # Verificar si está bloqueado temporalmente
            if usuario.bloqueado_hasta and usuario.bloqueado_hasta > timezone.now():
                # Registrar intento durante bloqueo
                IntentosLogin.objects.create(
                    id_usuario=usuario,
                    cedula_intentada=username,
                    ip_address=ip_address,
                    exitoso=False
                )
                return None
            
            # Si el bloqueo ya expiró, resetear
            if usuario.bloqueado_hasta and usuario.bloqueado_hasta <= timezone.now():
                usuario.bloqueado_hasta = None
                usuario.intentos_fallidos = 0
                usuario.save(update_fields=['bloqueado_hasta', 'intentos_fallidos'])
            
            # Validar contraseña
            if usuario.check_password(password):
                # Login exitoso: resetear intentos fallidos
                if usuario.intentos_fallidos > 0 or usuario.ultimo_intento_fallido:
                    usuario.intentos_fallidos = 0
                    usuario.ultimo_intento_fallido = None
                    usuario.bloqueado_hasta = None
                    usuario.save(update_fields=['intentos_fallidos', 'ultimo_intento_fallido', 'bloqueado_hasta'])
                
                # Registrar intento exitoso
                IntentosLogin.objects.create(
                    id_usuario=usuario,
                    cedula_intentada=username,
                    ip_address=ip_address,
                    exitoso=True
                )
                
                return usuario
            else:
                # Contraseña incorrecta: incrementar contador
                self._registrarIntentoFallido(usuario, username, ip_address)
                return None
                
        except Usuario.DoesNotExist:
            # Usuario no existe: registrar intento sin FK
            IntentosLogin.objects.create(
                id_usuario=None,
                cedula_intentada=username,
                ip_address=ip_address,
                exitoso=False
            )
            # Ejecutar hash de contraseña para evitar timing attacks
            Usuario().set_password(password)
            return None
        
        return None
    
    def _registrarIntentoFallido(self, usuario, cedula, ip_address):
        """
        Registra intento fallido, incrementa contador y aplica bloqueo escalonado.
        
        Sistema de escalamiento:
        - Intentos 1-5: Bloqueo 15 min
        - Intentos 6-10: Bloqueo 30 min
        - Intentos 11-15: Bloqueo 1 hora
        - Intentos 16-20: Desactivación automática
        
        Args:
            usuario: Instancia del Usuario
            cedula: Cédula intentada
            ip_address: IP del cliente
        """
        # Registrar en historial
        IntentosLogin.objects.create(
            id_usuario=usuario,
            cedula_intentada=cedula,
            ip_address=ip_address,
            exitoso=False
        )
        
        # Incrementar contador
        usuario.intentos_fallidos += 1
        usuario.ultimo_intento_fallido = timezone.now()
        
        # Sistema de bloqueo escalonado
        if usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_DESACTIVAR:
            # 20+ intentos: DESACTIVAR CUENTA
            usuario.is_active = False
            usuario.bloqueado_hasta = None  # Ya no necesita bloqueo temporal
        elif usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_BLOQUEO_3:
            # 15-19 intentos: Bloqueo de 1 hora
            usuario.bloqueado_hasta = timezone.now() + timedelta(minutes=TIEMPO_BLOQUEO_3)
        elif usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_BLOQUEO_2:
            # 10-14 intentos: Bloqueo de 30 minutos
            usuario.bloqueado_hasta = timezone.now() + timedelta(minutes=TIEMPO_BLOQUEO_2)
        elif usuario.intentos_fallidos >= MAX_INTENTOS_ANTES_BLOQUEO_1:
            # 5-9 intentos: Bloqueo de 15 minutos
            usuario.bloqueado_hasta = timezone.now() + timedelta(minutes=TIEMPO_BLOQUEO_1)
        
        usuario.save(update_fields=['intentos_fallidos', 'ultimo_intento_fallido', 'bloqueado_hasta', 'is_active'])
    
    def get_user(self, user_id):
        """
        Obtiene usuario por ID (requerido por Django).
        """
        try:
            return Usuario.objects.get(pk=user_id)
        except Usuario.DoesNotExist:
            return None
