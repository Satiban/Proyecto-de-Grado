# fichas_medicas/models.py
from django.db import models
from django.db.models import Index
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator, MinValueValidator
from mimetypes import guess_type
import hashlib

from citas.models import Cita


# ---------------- Ficha Médica ----------------
class FichaMedica(models.Model):
    id_ficha_medica = models.AutoField(primary_key=True, db_column='id_ficha_medica')

    # 1 ficha por cita (no borrar la cita si existe ficha)
    id_cita = models.OneToOneField(
        Cita,
        on_delete=models.PROTECT,
        db_column='id_cita',
        related_name='ficha_medica',
    )

    observacion = models.TextField(blank=True, null=True, db_column='observacion')
    diagnostico = models.TextField(blank=True, null=True, db_column='diagnostico')
    tratamiento = models.TextField(blank=True, null=True, db_column='tratamiento')
    comentarios = models.TextField(blank=True, null=True, db_column='comentarios')
    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'ficha_medica'
        ordering = ['id_ficha_medica']
        indexes = [
            Index(fields=['id_cita'], name='idx_ficha_cita'),
        ]

    def __str__(self):
        return f'Ficha Médica {self.id_ficha_medica} - Cita {self.id_cita_id}'

    # Nota: NO bloqueamos crear/editar por estado de la cita.
    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)


# ---------------- Archivo Adjunto ----------------
def adjuntoUploadTo(instance, filename):
    # Guardar por carpeta de ficha: archivos_adjuntos/ficha_<id>/
    fichaId = instance.id_ficha_medica_id or 'tmp'
    return f'archivos_adjuntos/ficha_{fichaId}/{filename}'

# Alias para compatibilidad con migraciones antiguas que referencien el nombre snake_case
adjunto_upload_to = adjuntoUploadTo


class ArchivoAdjunto(models.Model):
    id_archivo_adjunto = models.AutoField(primary_key=True, db_column='id_archivo_adjunto')

    id_ficha_medica = models.ForeignKey(
        FichaMedica,
        on_delete=models.CASCADE,   # si se elimina la ficha, se eliminan sus adjuntos
        db_column='id_ficha_medica',
        related_name='archivos',
    )

    archivo = models.FileField(
        upload_to=adjuntoUploadTo,
        null=True, blank=True,
        db_column='archivo',
        validators=[FileExtensionValidator(allowed_extensions=['pdf', 'jpg', 'jpeg', 'png', 'webp'])],
    )
    mime_type = models.CharField(max_length=100, blank=True, db_column='mime_type')
    nombre_original = models.TextField(blank=True, db_column='nombre_original')

    # Entero normal (int4) como id_ficha_medica, con mínimo 0
    tamano_bytes = models.IntegerField(
        blank=True,
        null=True,
        db_column='tamano_bytes',
        validators=[MinValueValidator(0)]
    )

    checksum_sha256 = models.CharField(max_length=64, blank=True, db_column='checksum_sha256')
    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'archivo_adjunto'
        ordering = ['id_archivo_adjunto']
        indexes = [
            Index(fields=['id_ficha_medica'], name='idx_adj_ficha'),
            Index(fields=['created_at'], name='idx_adj_created'),
        ]

    def __str__(self):
        return self.nombre_original or f'Adjunto {self.id_archivo_adjunto}'

    def clean(self):
        # Límite de 10 MB
        if self.archivo and getattr(self.archivo, 'size', 0) > 10 * 1024 * 1024:
            raise ValidationError({'archivo': 'El archivo supera el tamaño máximo de 10MB.'})

    def save(self, *args, **kwargs):
        self.clean()

        fileObj = self.archivo
        if fileObj:
            # Nombre original
            if not self.nombre_original:
                self.nombre_original = getattr(fileObj, 'name', '')

            # Tamaño
            self.tamano_bytes = getattr(fileObj, 'size', None)

            # Mime type
            if not self.mime_type:
                mimeTypeGuess, _ = guess_type(getattr(fileObj, 'name', ''))
                self.mime_type = mimeTypeGuess or ''

            # SHA-256
            try:
                hasher = hashlib.sha256()
                for chunk in fileObj.chunks():
                    hasher.update(chunk)
                self.checksum_sha256 = hasher.hexdigest()
            except Exception:
                # Por compatibilidad con storages que no implementan chunks()
                pass

        super().save(*args, **kwargs)
