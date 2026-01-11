# usuarios/utils.py
import re
import cloudinary
from cloudinary.uploader import upload
from cloudinary.utils import cloudinary_url
from datetime import date, datetime
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.conf import settings
from cryptography.fernet import Fernet


# ==========================
# ENCRIPTACIÓN DE URLs
# ==========================

def get_fernet_cipher():
    # Obtiene la instancia de Fernet para encriptar/desencriptar
    key = settings.FERNET_KEY
    # Asegurarse de que la clave esté en formato bytes
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def encriptar_url(url: str) -> str:
    # Encripta una URL usando Fernet
    if not url:
        return url
    
    try:
        cipher = get_fernet_cipher()
        url_bytes = url.encode('utf-8')
        encrypted_bytes = cipher.encrypt(url_bytes)
        # Convertir a string para almacenar en BD
        return encrypted_bytes.decode('utf-8')
    except Exception as e:
        raise Exception(f"Error al encriptar URL: {str(e)}")


def desencriptar_url(encrypted_url: str) -> str:
    # Desencripta una URL encriptada con Fernet
    if not encrypted_url:
        return encrypted_url
    
    try:
        cipher = get_fernet_cipher()
        encrypted_bytes = encrypted_url.encode('utf-8')
        decrypted_bytes = cipher.decrypt(encrypted_bytes)
        return decrypted_bytes.decode('utf-8')
    except Exception as e:
        raise Exception(f"Error al desencriptar URL: {str(e)}")


def normalizar_celular_ecuador(celular: str | None) -> str | None:
    """
    Normaliza un número de celular ecuatoriano al formato E.164 (+593...).
    
    Acepta:
    - 0999090660      → +593999090660
    - 999090660       → +593999090660
    - +593999090660   → +593999090660
    - 593999090660    → +593999090660
    
    Args:
        celular: Número en cualquier formato común ecuatoriano
        
    Returns:
        str: Número en formato E.164 (+593XXXXXXXXX) o None si es inválido
    """
    if not celular:
        return None
    
    # Limpiar espacios, guiones, paréntesis
    celular = re.sub(r'[\s\-\(\)]', '', str(celular))
    
    # Si ya está en formato E.164 correcto, retornar
    if celular.startswith('+593') and len(celular) == 13:
        return celular
    
    # Remover + o 00 al inicio si existen
    celular = celular.lstrip('+').lstrip('0')
    
    # Si empieza con 593, agregar +
    if celular.startswith('593'):
        return f'+{celular}'
    
    # Si tiene 9 dígitos (formato local sin 0 inicial)
    if len(celular) == 9 and celular[0] == '9':
        return f'+593{celular}'
    
    # Si tiene 10 dígitos y empieza con 0 (formato local)
    if len(celular) == 10 and celular[0] == '0':
        return f'+593{celular[1:]}'
    
    # No se pudo normalizar
    return None


def obtener_contacto_notificacion(usuario):
    """
    Obtiene los datos de contacto correctos para enviar notificaciones.
    
    Para menores sin email/celular propio, usa los del contacto de emergencia (Paciente).
    Para mayores o menores con datos propios, usa los suyos.
    
    Args:
        usuario: Instancia de Usuario
        
    Returns:
        dict con 'email', 'celular' (ya normalizado a E.164), 'celular_tipo' y 'nombre_completo'
    """
    email_destino = usuario.email
    celular_destino = usuario.celular
    celular_tipo = "propio"
    
    # Si el usuario es paciente y tiene email ficticio o no tiene celular,
    # usar datos del contacto de emergencia
    if hasattr(usuario, 'paciente'):
        paciente = usuario.paciente
        
        # Si tiene email ficticio, usar email del contacto
        if usuario.email and usuario.email.endswith('@oralflow.system'):
            email_destino = paciente.contacto_emergencia_email or usuario.email
        
        # Si no tiene celular, usar celular del contacto
        if not usuario.celular:
            celular_destino = paciente.contacto_emergencia_cel
            celular_tipo = "contacto_emergencia"
    
    # Normalizar el celular a E.164
    if celular_destino:
        celular_destino = normalizar_celular_ecuador(celular_destino)
    
    return {
        'email': email_destino,
        'celular': celular_destino,
        'celular_tipo': celular_tipo,
        'nombre_completo': f"{usuario.primer_nombre} {usuario.primer_apellido}"
    }


def validar_registro_publico(data):
    """
    Valida que el registro público solo permita mayores de 18 años.
    Para mayores, email y celular son obligatorios.
    """
    fecha_nac = data.get('fecha_nacimiento')
    if not fecha_nac:
        raise ValidationError('La fecha de nacimiento es obligatoria')
    
    # Calcular edad
    hoy = date.today()
    edad = hoy.year - fecha_nac.year
    if (hoy.month, hoy.day) < (fecha_nac.month, fecha_nac.day):
        edad -= 1
    
    if edad < 18:
        raise ValidationError(
            'Los menores de 18 años deben ser registrados presencialmente '
            'en el consultorio junto con su representante legal.'
        )
    
    # Para mayores, email y celular son obligatorios
    if not data.get('email'):
        raise ValidationError('El email es obligatorio para mayores de edad')
    if not data.get('celular'):
        raise ValidationError('El celular es obligatorio para mayores de edad')


def validar_datos_paciente_menor(usuario_data, paciente_data):
    # Valida que un menor tenga los datos requeridos en Usuario y Paciente.
    # Si el menor no tiene email propio, debe tener email en contacto de emergencia
    tiene_email_propio = usuario_data.get('email') and not usuario_data.get('email', '').endswith('@oralflow.system')
    tiene_email_contacto = paciente_data.get('contacto_emergencia_email')
    
    if not tiene_email_propio and not tiene_email_contacto:
        raise ValidationError(
            'Para menores sin email propio, el email del contacto de emergencia es obligatorio'
        )
    
    # Celular de contacto siempre es obligatorio en Paciente
    if not paciente_data.get('contacto_emergencia_cel'):
        raise ValidationError('El celular del contacto de emergencia es obligatorio')

def subir_foto_perfil_cloudinary(archivo, cedula):
    try:
        # Validar tamaño del archivo (máximo 5MB)
        max_size = 5 * 1024 * 1024  # 5MB en bytes
        if hasattr(archivo, 'size') and archivo.size > max_size:
            raise ValidationError(
                f'La imagen es demasiado grande ({archivo.size / (1024*1024):.2f}MB). '
                f'El tamaño máximo permitido es 5MB.'
            )
        
        # Determinar extensión del archivo
        if hasattr(archivo, 'name'):
            ext = archivo.name.split('.')[-1].lower()
        else:
            ext = 'jpg'  # Default
        
        # Validar formatos permitidos
        formatos_permitidos = ['jpg', 'jpeg', 'png']
        if ext not in formatos_permitidos:
            raise ValidationError(
                f'Formato de imagen no válido. Solo se permiten: {", ".join(formatos_permitidos).upper()}'
            )
        
        # Generar el nombre del archivo
        nombre_archivo = f"perfil_{cedula}"
        
        # Subir a Cloudinary con optimización automática
        resultado = cloudinary.uploader.upload(
            archivo,
            folder="perfiles",
            resource_type="image",
            public_id=nombre_archivo,
            overwrite=True,
            invalidate=True,
            allowed_formats=['jpg', 'jpeg', 'png'],
            # Transformaciones automáticas de Cloudinary
            quality="auto",  # Calidad automática
            fetch_format="auto"  # Formato automático
        )
        
        # Retornar la URL segura
        return resultado.get('secure_url')

    except ValidationError:
        raise
    except Exception as e:
        raise Exception(f"Error al subir imagen a Cloudinary: {str(e)}")