# fichas_medicas/serializers.py
import hashlib
import mimetypes
from django.db import IntegrityError
from rest_framework import serializers

from .models import ArchivoAdjunto, FichaMedica
from .utils import subir_archivo_ficha_cloudinary, obtener_public_id_ficha
from cloudinary.uploader import destroy


# --------------------------
# Ficha Médica
# --------------------------
class FichaMedicaSerializer(serializers.ModelSerializer):
    class Meta:
        model = FichaMedica
        fields = [
            'id_ficha_medica', 'id_cita',
            'observacion', 'diagnostico', 'tratamiento', 'comentarios',
            'created_at', 'updated_at',
        ]
        extra_kwargs = {
            'created_at': {'read_only': True},
            'updated_at': {'read_only': True},
        }

    def create(self, validated_data):
        try:
            return FichaMedica.objects.create(**validated_data)
        except IntegrityError:
            raise serializers.ValidationError({
                'id_cita': 'Ya existe una ficha asociada a esta cita.'
            })


# --------------------------
# Archivo Adjunto
# --------------------------
class ArchivoAdjuntoSerializer(serializers.ModelSerializer):
    # Archivo temporal recibido desde el frontend
    archivo_file = serializers.FileField(write_only=True, required=False)
    # Campo personalizado para retornar la URL desencriptada
    archivo_url = serializers.SerializerMethodField()

    class Meta:
        model = ArchivoAdjunto
        fields = [
            'id_archivo_adjunto', 'id_ficha_medica',
            'archivo_url',        # URL desencriptada (solo lectura)
            'archivo_file',       # Archivo recibido
            'mime_type', 'nombre_original', 'tamano_bytes', 'checksum_sha256',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id_archivo_adjunto', 'archivo_url',
            'mime_type', 'nombre_original', 'tamano_bytes',
            'checksum_sha256', 'created_at', 'updated_at'
        ]
    
    def get_archivo_url(self, obj):
        """Retorna la URL desencriptada para lectura."""
        try:
            return obj.get_url_desencriptada()
        except Exception:
            return None

    # -----------------------
    # VALIDACIONES
    # -----------------------
    def validate_archivo_file(self, fileObj):
        """Valida el archivo antes de subirlo."""
        if not fileObj:
            return None

        # Límite 10MB
        if fileObj.size > 10 * 1024 * 1024:
            raise serializers.ValidationError('El archivo supera el límite de 10MB.')

        # Extensiones permitidas
        allowed_ext = {'pdf', 'jpg', 'jpeg', 'png', 'webp', 'zip', 'rar'}
        ext = (fileObj.name.split('.')[-1] or '').lower()
        if ext not in allowed_ext:
            raise serializers.ValidationError(
                'Extensión no permitida. Use: pdf, jpg, jpeg, png, webp, zip, rar'
            )

        return fileObj

    # -----------------------
    # CREAR ADJUNTO
    # -----------------------
    def create(self, validated_data):
        fileObj = validated_data.pop('archivo_file', None)
        ficha = validated_data.get('id_ficha_medica')

        if not fileObj:
            raise serializers.ValidationError({'archivo_file': 'Debe subir un archivo.'})

        if not ficha:
            raise serializers.ValidationError({'id_ficha_medica': 'Debe especificar una ficha médica.'})

        # Obtener paciente → cita → id_cita
        cita = ficha.id_cita
        paciente = cita.id_paciente

        # ------- Metadatos -------
        nombre_original = fileObj.name
        tamano_bytes = fileObj.size
        mime_type = mimetypes.guess_type(fileObj.name)[0] or 'application/octet-stream'

        # SHA-256
        sha256 = hashlib.sha256()
        for c in fileObj.chunks():
            sha256.update(c)
        checksum = sha256.hexdigest()

        # Crear registro inicial sin URL
        adj = ArchivoAdjunto.objects.create(
            id_ficha_medica=ficha,
            nombre_original=nombre_original,
            mime_type=mime_type,
            tamano_bytes=tamano_bytes,
            checksum_sha256=checksum
        )

        # Subir a Cloudinary
        try:
            fileObj.seek(0)
            url_segura = subir_archivo_ficha_cloudinary(
                archivo=fileObj,
                paciente=paciente,
                id_cita=cita.id_cita,
                archivo_id=adj.id_archivo_adjunto
            )

            # Encriptar la URL antes de guardar
            adj.set_url_encriptada(url_segura)
            adj.save(update_fields=['archivo_url'])

        except Exception as e:
            adj.delete()
            raise serializers.ValidationError({
                'archivo': f'Error al subir archivo: {str(e)}'
            })

        return adj

    # -----------------------
    # ACTUALIZAR ADJUNTO
    # -----------------------
    def update(self, instance, validated_data):
        nuevo_archivo = validated_data.pop('archivo_file', None)

        if nuevo_archivo:
            # 1. Eliminar archivo previo de Cloudinary (usando URL desencriptada)
            url_anterior = instance.get_url_desencriptada()
            if url_anterior:
                public_id = obtener_public_id_ficha(url_anterior)
                if public_id:
                    try:
                        ext_prev = (instance.nombre_original.split('.')[-1] or '').lower()
                        # Imágenes usan resource_type="image", todo lo demás usa "raw"
                        resource_type = "image" if ext_prev in ["jpg", "jpeg", "png", "webp"] else "raw"
                        destroy(public_id, resource_type=resource_type)
                    except Exception:
                        pass

            # 2. Metadatos nuevos
            instance.nombre_original = nuevo_archivo.name
            instance.tamano_bytes = nuevo_archivo.size
            instance.mime_type = mimetypes.guess_type(nuevo_archivo.name)[0] or 'application/octet-stream'

            sha256 = hashlib.sha256()
            for c in nuevo_archivo.chunks():
                sha256.update(c)
            instance.checksum_sha256 = sha256.hexdigest()

            # 3. Subir nuevo archivo
            try:
                nuevo_archivo.seek(0)
                cita = instance.id_ficha_medica.id_cita
                url_segura = subir_archivo_ficha_cloudinary(
                    archivo=nuevo_archivo,
                    paciente=cita.id_paciente,
                    id_cita=cita.id_cita,
                    archivo_id=instance.id_archivo_adjunto
                )
                # Encriptar la URL antes de guardar
                instance.set_url_encriptada(url_segura)
            except Exception as e:
                raise serializers.ValidationError({'archivo': f'Error al subir archivo: {str(e)}'})

        # Aplicar otros cambios (si los hubiera)
        for key, val in validated_data.items():
            setattr(instance, key, val)

        instance.save()
        return instance