# backend/pacientes/serializers.py
from django.db import IntegrityError
from django.db.models.functions import Lower
from rest_framework import serializers

from .models import Paciente, Antecedente, PacienteAntecedente
from usuarios.models import PACIENTE_ROLE_ID


class PacienteSerializer(serializers.ModelSerializer):

    usuario_email = serializers.EmailField(source="id_usuario.email", read_only=True)
    cedula = serializers.CharField(source="id_usuario.cedula", read_only=True)
    sexo = serializers.CharField(source="id_usuario.sexo", read_only=True)
    celular = serializers.CharField(source="id_usuario.celular", read_only=True)
    is_active = serializers.BooleanField(source="id_usuario.is_active", read_only=True)
    primer_nombre = serializers.CharField(source="id_usuario.primer_nombre", read_only=True)
    segundo_nombre = serializers.CharField(source="id_usuario.segundo_nombre", read_only=True)
    primer_apellido = serializers.CharField(source="id_usuario.primer_apellido", read_only=True)
    segundo_apellido = serializers.CharField(source="id_usuario.segundo_apellido", read_only=True)
    fecha_nacimiento = serializers.DateField(source="id_usuario.fecha_nacimiento", read_only=True)
    tipo_sangre = serializers.CharField(source="id_usuario.tipo_sangre", read_only=True)
    nombreCompleto = serializers.SerializerMethodField()
    foto = serializers.SerializerMethodField()

    class Meta:
        model = Paciente
        fields = [
            "id_usuario",
            "id_paciente",
            "usuario_email",
            "cedula",
            "sexo",
            "celular",
            "is_active",
            "primer_nombre",
            "segundo_nombre",
            "primer_apellido",
            "segundo_apellido",
            "fecha_nacimiento",
            "tipo_sangre",
            "nombreCompleto",
            "contacto_emergencia_nom",
            "contacto_emergencia_cel",
            "contacto_emergencia_par",
            "contacto_emergencia_email",
            "foto",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {
            "created_at": {"read_only": True},
            "updated_at": {"read_only": True},
        }

    def get_nombreCompleto(self, obj):
        u = obj.id_usuario
        if not u:
            return ""
        return " ".join(
            filter(
                None,
                [u.primer_nombre, u.segundo_nombre, u.primer_apellido, u.segundo_apellido],
            )
        )

    def get_foto(self, obj):
        user = obj.id_usuario
        if not user:
            return None
        
        try:
            return user.get_foto_desencriptada()
        except Exception:
                return str(foto) if foto else None

    def validate_contacto_emergencia_par(self, value):
        """Capitalizar la primera letra del parentesco"""
        if value:
            return value.capitalize()
        return value

    def validate(self, attrs):
        usuario = attrs.get('id_usuario') or getattr(self.instance, 'id_usuario', None)
        if usuario:
            qs = Paciente.objects.filter(id_usuario=usuario)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"id_usuario": "Este usuario ya tiene un perfil de paciente."})
        return attrs
    
    def update(self, instance, validated_data):
        usuario_data = validated_data.pop("id_usuario", None)
        if usuario_data:
            usuario = instance.id_usuario

            # Manejo de eliminación o actualización de foto
            request = self.context.get("request")
            if request and hasattr(request, "data"):
                if request.data.get("foto_remove") == "true":
                    if usuario.foto:
                        usuario.foto.delete(save=False)
                    usuario.foto = None

            for attr, value in usuario_data.items():
                setattr(usuario, attr, value)

            usuario.save()

        return super().update(instance, validated_data)



class AntecedenteSerializer(serializers.ModelSerializer):
    en_uso = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Antecedente
        fields = ['id_antecedente', 'nombre', 'created_at', 'updated_at', 'en_uso']
        extra_kwargs = {
            'created_at': {'read_only': True},
            'updated_at': {'read_only': True},
        }

    def validate_nombre(self, value):
        qs = Antecedente.objects.annotate(nl=Lower('nombre')).filter(nl=value.lower())
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ya existe un antecedente con ese nombre.")
        return value

    def get_en_uso(self, obj):
        return PacienteAntecedente.objects.filter(id_antecedente=obj).exists()


class PacienteAntecedenteSerializer(serializers.ModelSerializer):
    antecedente_nombre = serializers.CharField(source='id_antecedente.nombre', read_only=True)

    class Meta:
        model = PacienteAntecedente
        fields = [
            'id_paciente_antecedente',
            'id_paciente',
            'id_antecedente',
            'antecedente_nombre',   
            'relacion_familiar',
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            'created_at': {'read_only': True},
            'updated_at': {'read_only': True},
        }

    def validate(self, attrs):
        paciente = attrs.get('id_paciente') or getattr(self.instance, 'id_paciente', None)
        antecedente = attrs.get('id_antecedente') or getattr(self.instance, 'id_antecedente', None)
        relacion = attrs.get('relacion_familiar') or getattr(self.instance, 'relacion_familiar', None)

        if paciente and antecedente and relacion:
            qs = PacienteAntecedente.objects.filter(
                id_paciente=paciente,
                id_antecedente=antecedente,
                relacion_familiar=relacion,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {"non_field_errors": ["Ya registraste ese antecedente con esa relación familiar para este paciente."]}
                )
        return attrs

    def create(self, validated_data):
        try:
            return super().create(validated_data)
        except IntegrityError:
            raise serializers.ValidationError(
                {"non_field_errors": ["Ya existe esa combinación (paciente, antecedente, relación)."]}
            )