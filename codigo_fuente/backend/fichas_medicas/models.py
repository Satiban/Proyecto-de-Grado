# fichas_medicas/models.py
from django.db import models
from django.db.models import Index
from django.core.validators import MinValueValidator

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

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)


# ---------------- Archivo Adjunto ----------------
def adjuntoUploadTo(instance, filename):
    # Guardar por carpeta de ficha: archivos_adjuntos/ficha_<id>/
    fichaId = instance.id_ficha_medica_id or 'tmp'
    return f'archivos_adjuntos/ficha_{fichaId}/{filename}'

adjunto_upload_to = adjuntoUploadTo


class ArchivoAdjunto(models.Model):
    id_archivo_adjunto = models.AutoField(primary_key=True, db_column='id_archivo_adjunto')

    id_ficha_medica = models.ForeignKey(
        FichaMedica,
        on_delete=models.CASCADE,
        db_column='id_ficha_medica',
        related_name='archivos',
    )

    # Campo que almacena la URL encriptada
    archivo_url = models.TextField(
        null=True,
        blank=True,
        db_column='archivo_url',
        help_text='URL encriptada del archivo en Cloudinary'
    )

    nombre_original = models.TextField(blank=True, db_column='nombre_original')
    mime_type = models.CharField(max_length=100, blank=True, db_column='mime_type')
    tamano_bytes = models.IntegerField(
        blank=True,
        null=True,
        db_column='tamano_bytes',
        validators=[MinValueValidator(0)]
    )

    # Opcional: mantenlo si lo necesitas
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

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
    
    def set_url_encriptada(self, url_plana: str):
        # Encripta y guarda la URL
        from .utils import encriptar_url
        if url_plana:
            self.archivo_url = encriptar_url(url_plana)
    
    def get_url_desencriptada(self) -> str:
        # Retorna la URL desencriptada
        from .utils import desencriptar_url
        if self.archivo_url:
            return desencriptar_url(self.archivo_url)
        return None