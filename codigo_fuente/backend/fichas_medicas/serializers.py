# fichas_medicas/serializers.py
import hashlib
import mimetypes
from django.db import IntegrityError
from rest_framework import serializers

from .models import ArchivoAdjunto, FichaMedica


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
        obj = FichaMedica(**validated_data)
        try:
            obj.save()
        except IntegrityError:
            raise serializers.ValidationError({'id_cita': 'Ya existe una ficha para esta cita.'})
        return obj


class ArchivoAdjuntoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ArchivoAdjunto
        fields = [
            'id_archivo_adjunto', 'id_ficha_medica', 'archivo',
            'mime_type', 'nombre_original', 'tamano_bytes', 'checksum_sha256',
            'created_at', 'updated_at',
        ]
        extra_kwargs = {
            'created_at': {'read_only': True},
            'updated_at': {'read_only': True},
        }

    def validate_archivo(self, fileObj):
        if not fileObj:
            return fileObj

        if fileObj.size > 10 * 1024 * 1024:
            raise serializers.ValidationError('El archivo supera 10MB.')

        allowedExtensions = {'pdf', 'jpg', 'jpeg', 'png', 'webp'}
        extLower = (fileObj.name.split('.')[-1] or '').lower()
        if extLower not in allowedExtensions:
            raise serializers.ValidationError('Extensión no permitida (pdf, jpg, jpeg, png, webp).')

        return fileObj

    def create(self, validated_data):
        fileObj = validated_data.get('archivo')

        if fileObj:
            mimeTypeGuess = mimetypes.guess_type(fileObj.name)[0] or 'application/octet-stream'
            validated_data['mime_type'] = mimeTypeGuess
            validated_data['nombre_original'] = fileObj.name
            validated_data['tamano_bytes'] = fileObj.size
            sha256Hasher = hashlib.sha256()
            for chunk in fileObj.chunks():
                sha256Hasher.update(chunk)
            validated_data['checksum_sha256'] = sha256Hasher.hexdigest()
        return super().create(validated_data)
