# backend/citas/utils.py
import cloudinary
from django.core.exceptions import ValidationError
from django.utils import timezone
from urllib.parse import urlparse

def subir_comprobante_cloudinary(archivo, cedula, pago_id=None):
    """
    Sube el comprobante a Cloudinary, valida tamaño/formato y genera un nombre único.
    Si aún no existe pago_id (creación), usa solo cédula + timestamp
    """
    try:
        max_size = 5 * 1024 * 1024
        if hasattr(archivo, "size") and archivo.size > max_size:
            raise ValidationError(
                f"El comprobante es demasiado grande ({archivo.size / (1024*1024):.2f}MB). "
                "El tamaño máximo permitido es 5MB."
            )

        ext = archivo.name.split(".")[-1].lower() if hasattr(archivo, "name") else "jpg"
        formatos_permitidos = ["jpg", "jpeg", "png"]
        if ext not in formatos_permitidos:
            raise ValidationError(
                f"Formato no válido. Solo se permiten: {', '.join(formatos_permitidos).upper()}."
            )

        timestamp = timezone.now().strftime("%Y%m%d%H%M%S")
        if pago_id:
            public_id = f"comprobante_{cedula}_{pago_id}_{timestamp}"
        else:
            public_id = f"comprobante_{cedula}_{timestamp}"

        resultado = cloudinary.uploader.upload(
            archivo,
            folder="comprobantes",
            public_id=public_id,
            overwrite=True,
            invalidate=True,
            allowed_formats=formatos_permitidos,
            resource_type="image",
            quality="auto",
            fetch_format="auto",
        )

        return resultado.get("secure_url")

    except ValidationError:
        raise
    except Exception as e:
        raise Exception(f"Error al subir comprobante a Cloudinary: {str(e)}")

def obtener_public_id(url: str | None) -> str | None:
    # Extrae el public_id real desde una URL completa de Cloudinary.

    if not url:
        return None

    try:
        path = urlparse(url).path.strip('/')
        partes = path.split('/')

        if 'upload' not in partes:
            return None

        idx = partes.index('upload')
        partes_utiles = partes[idx + 1:]

        # Saltar versión tipo v12345
        if partes_utiles and partes_utiles[0].startswith('v') and partes_utiles[0][1:].isdigit():
            partes_utiles = partes_utiles[1:]

        # Último elemento = archivo.ext
        archivo = partes_utiles[-1]
        nombre = archivo.rsplit('.', 1)[0]

        carpetas = partes_utiles[:-1]
        if carpetas:
            return "/".join(carpetas) + "/" + nombre
        return nombre

    except Exception:
        return None