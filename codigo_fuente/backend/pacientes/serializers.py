from django.db import IntegrityError
from django.db.models.functions import Lower
from rest_framework import serializers

from .models import Paciente, Antecedente, PacienteAntecedente
from usuarios.models import PACIENTE_ROLE_ID


class PacienteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Paciente
        fields = [
            'id_paciente',
            'id_usuario',
            'contacto_emergencia_nom',
            'contacto_emergencia_cel',
            'contacto_emergencia_par',
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            'created_at': {'read_only': True},
            'updated_at': {'read_only': True},
        }

    def validate(self, attrs):
        # Validar que el usuario tenga rol=PACIENTE (2)
        usuario = attrs.get('id_usuario') or getattr(self.instance, 'id_usuario', None)
        if usuario and getattr(usuario, 'id_rol_id', None) != PACIENTE_ROLE_ID:
            raise serializers.ValidationError({"id_usuario": "El usuario debe tener rol 'paciente' (id_rol=2)."})

        # Validar OneToOne con mensaje claro (antes de que explote por DB)
        if usuario:
            qs = Paciente.objects.filter(id_usuario=usuario)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"id_usuario": "Este usuario ya tiene un perfil de paciente."})
        return attrs


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
        # Unicidad case-insensitive con mensaje claro
        qs = Antecedente.objects.annotate(nl=Lower('nombre')).filter(nl=value.lower())
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ya existe un antecedente con ese nombre.")
        return value

    def get_en_uso(self, obj):
        return PacienteAntecedente.objects.filter(id_antecedente=obj).exists()


class PacienteAntecedenteSerializer(serializers.ModelSerializer):
    # Conveniente para el front:
    antecedente_nombre = serializers.CharField(source='id_antecedente.nombre', read_only=True)

    class Meta:
        model = PacienteAntecedente
        fields = [
            'id_paciente_antecedente',
            'id_paciente',
            'id_antecedente',
            'antecedente_nombre',   # ← agregado
            'relacion_familiar',    # choices: abuelos, padres, hermanos, propio
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
        # Por si se cuela IntegrityError desde la DB, lo convertimos en error legible
        try:
            return super().create(validated_data)
        except IntegrityError:
            raise serializers.ValidationError(
                {"non_field_errors": ["Ya existe esa combinación (paciente, antecedente, relación)."]}
            )