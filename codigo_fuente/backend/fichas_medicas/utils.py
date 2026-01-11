# backend/fichas_medicas/utils.py
import cloudinary
import re
from django.core.exceptions import ValidationError
from urllib.parse import urlparse
from django.utils import timezone
import os
from cryptography.fernet import Fernet
from django.conf import settings


# ==========================
# ENCRIPTACIÓN DE URLs
# ==========================

def get_fernet_cipher():
    """Obtiene la instancia de Fernet para encriptar/desencriptar."""
    key = settings.FERNET_KEY
    # Asegurarse de que la clave esté en formato bytes
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def encriptar_url(url: str) -> str:
    """Encripta una URL usando Fernet."""
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


def subir_archivo_ficha_cloudinary(archivo, paciente, id_cita, archivo_id=None):
    # Sube un archivo de ficha médica a Cloudinary
    try:
        # ---- 1. Validar tamaño (10MB) ----
        max_size = 10 * 1024 * 1024
        if hasattr(archivo, "size") and archivo.size > max_size:
            raise ValidationError(
                f"El archivo es demasiado grande ({archivo.size / (1024*1024):.2f}MB). "
                "Máximo permitido: 10MB."
            )

        # ---- 2. Procesar nombre ----
        nombre_archivo = getattr(archivo, "name", "archivo")
        nombre_sin_ext, ext = os.path.splitext(nombre_archivo)
        ext = ext.lower().lstrip(".")

        if not ext:
            raise ValidationError("El archivo no tiene extensión reconocida.")

        # Limpiar nombre base (evitar caracteres raros)
        nombre_sin_ext = re.sub(r"[^a-zA-Z0-9_-]", "_", nombre_sin_ext)

        # ---- 3. Validar formato ----
        formatos_permitidos = [
            "pdf", "jpg", "jpeg", "png", "webp",
            "doc", "docx", "xls", "xlsx",
            "zip", "rar",
        ]

        if ext not in formatos_permitidos:
            raise ValidationError(
                f"Formato no válido. Solo se permiten: {', '.join(formatos_permitidos).upper()}."
            )

        # ---- 4. Construir carpetas ----
        usuario = paciente.id_usuario
        cedula = usuario.cedula

        inicial = (usuario.primer_nombre[:1] or "X").upper()
        inicial_ape = (usuario.primer_apellido[:1] or "X").upper()
        iniciales = f"{inicial}{inicial_ape}"

        paciente_folder = f"{iniciales}_{cedula}"
        ficha_folder = f"ficha_{id_cita}"

        # ---- 5. Evitar colisiones ----
        timestamp = timezone.now().strftime("%Y%m%d%H%M%S")
        public_id = f"{nombre_sin_ext}_{timestamp}"

        folder_path = f"fichas_medicas/{paciente_folder}/{ficha_folder}"

        # ---- 6. Elegir resource_type ----
        resource_type = "image" if ext in ["jpg", "jpeg", "png", "webp"] else "raw"

        # ---- 7. Subir a Cloudinary ----
        resultado = cloudinary.uploader.upload(
            archivo,
            folder=folder_path,
            public_id=public_id,
            overwrite=True,
            invalidate=True,
            resource_type=resource_type,
            **({"quality": "auto", "fetch_format": "auto"} if resource_type == "image" else {}),
        )

        return resultado.get("secure_url")

    except ValidationError:
        raise
    except Exception as e:
        raise Exception(f"Error al subir archivo a Cloudinary: {str(e)}")


def obtener_public_id_ficha(url: str | None) -> str | None:
    # Extrae el public_id real desde la URL de Cloudinary
    if not url:
        return None

    try:
        path = urlparse(url).path.strip("/")
        partes = path.split("/")

        if "upload" not in partes:
            return None

        idx = partes.index("upload")
        partes_utiles = partes[idx + 1:]

        if partes_utiles and partes_utiles[0].startswith("v") and partes_utiles[0][1:].isdigit():
            partes_utiles = partes_utiles[1:]

        archivo = partes_utiles[-1]
        carpetas = partes_utiles[:-1]
        if carpetas:
            return "/".join(carpetas) + "/" + archivo

        return archivo

    except:
        return None