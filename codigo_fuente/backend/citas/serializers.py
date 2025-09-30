# citas/serializers.py
from datetime import datetime, date, timedelta
from django.db import IntegrityError
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models.functions import Lower
from rest_framework import serializers

from .models import Consultorio, Cita


class ConsultorioSerializer(serializers.ModelSerializer):
    en_uso = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = Consultorio
        fields = "__all__"
        extra_kwargs = {
            "created_at": {"read_only": True},
            "updated_at": {"read_only": True},
            "id_consultorio": {"read_only": True},
        }
    
    def get_en_uso(self, obj):
        # True si existe al menos una cita (activa o histórica) asociada
        return Cita.objects.filter(id_consultorio=obj).exists()

    def validate_numero(self, value):
        trimmed = (value or "").strip()
        if not trimmed:
            raise serializers.ValidationError("El número no puede estar vacío.")

        baseQs = Consultorio.objects.all()
        if self.instance:
            baseQs = baseQs.exclude(pk=self.instance.pk)

        if baseQs.annotate(n=Lower("numero")).filter(n=trimmed.lower()).exists():
            raise serializers.ValidationError("Ya existe un consultorio con ese número.")

        return trimmed

    def validate_descripcion(self, value):
        return (value or "").strip()


class CitaSerializer(serializers.ModelSerializer):
    # Campos calculados para UI
    paciente_nombre = serializers.SerializerMethodField(read_only=True)
    paciente_cedula = serializers.CharField(
        source="id_paciente.id_usuario.cedula", read_only=True
    )
    odontologo_nombre = serializers.SerializerMethodField(read_only=True)
    consultorio = serializers.SerializerMethodField(read_only=True)
    hora_inicio = serializers.SerializerMethodField(read_only=True)
    hora_fin = serializers.SerializerMethodField(read_only=True)

    # Reglas de negocio expuestas a UI (solo lectura)
    reprogramaciones = serializers.IntegerField(read_only=True)
    cancelada_en = serializers.DateTimeField(read_only=True)
    cancelada_por_rol = serializers.IntegerField(read_only=True)

    # ❗ Motivo obligatorio en API
    motivo = serializers.CharField(required=True, allow_blank=False, allow_null=False)

    class Meta:
        model = Cita
        fields = [
            "id_cita",
            "id_paciente",
            "id_odontologo",
            "id_consultorio",
            "fecha",
            "hora",            # almacenada en BD (minuto=0)
            "hora_inicio",     # HH:MM para UI
            "hora_fin",        # HH:MM para UI (+1h)
            "motivo",
            "estado",
            "reprogramaciones",
            "cancelada_en",
            "cancelada_por_rol",
            "created_at",
            "updated_at",
            "paciente_nombre",
            "paciente_cedula",
            "odontologo_nombre",
            "consultorio",
        ]
        extra_kwargs = {
            "created_at": {"read_only": True},
            "updated_at": {"read_only": True},
        }

    # ---- helper interno (camelCase según tu estándar) ----
    def fmtTime(self, t):
        return t.strftime("%H:%M") if t else None

    # DRF exige el prefijo get_ en snake_case para SerializerMethodField
    def get_hora_inicio(self, obj):
        return self.fmtTime(obj.hora)

    def get_hora_fin(self, obj):
        if not obj.hora:
            return None
        base = datetime.combine(date(2000, 1, 1), obj.hora)
        return (base + timedelta(hours=1)).strftime("%H:%M")

    def get_consultorio(self, obj):
        if obj.id_consultorio:
            return {
                "id_consultorio": obj.id_consultorio_id,
                "numero": obj.id_consultorio.numero,
            }
        return None

    def get_paciente_nombre(self, obj):
        userObj = getattr(obj.id_paciente, "id_usuario", None)
        if not userObj:
            return ""
        parts = [
            (userObj.primer_nombre or "").strip(),
            (userObj.segundo_nombre or "").strip(),
            (userObj.primer_apellido or "").strip(),
            (userObj.segundo_apellido or "").strip(),
        ]
        return " ".join([p for p in parts if p])

    def get_odontologo_nombre(self, obj):
        userObj = getattr(getattr(obj, "id_odontologo", None), "id_usuario", None)
        if not userObj:
            return ""
        parts = [
            (userObj.primer_nombre or "").strip(),
            (userObj.segundo_nombre or "").strip(),
            (userObj.primer_apellido or "").strip(),
            (userObj.segundo_apellido or "").strip(),
        ]
        return " ".join([p for p in parts if p])

    # ---- validaciones amigables (además de las del modelo) ----
    def validate_hora(self, value):
        if value and value.minute != 0:
            raise serializers.ValidationError(
                "Las citas duran 1 hora y deben iniciar en la hora exacta (minuto 0)."
            )
        return value

    def create(self, validated_data):
        citaObj = Cita(**validated_data)

        # ✅ Captura errores de validación del modelo y reenvía como 400 JSON
        try:
            citaObj.full_clean()
        except DjangoValidationError as e:
            data = getattr(e, "message_dict", None) or {"detail": e.messages}
            # Asegura formato field -> [msgs]
            for key, val in list(data.items()):
                if isinstance(val, str):
                    data[key] = [val]
            raise serializers.ValidationError(data)

        try:
            citaObj.save()
        except IntegrityError as e:
            msg = str(e)
            if "uq_cita_odo_fecha_hora_activa" in msg:
                raise serializers.ValidationError(
                    {"hora": ["Ese horario ya está tomado para el odontólogo."]}
                )
            if "uq_cita_consul_fecha_hora_activa" in msg:
                raise serializers.ValidationError(
                    {"id_consultorio": ["El consultorio ya está ocupado en ese horario."]}
                )
            if "uq_cita_paciente_fecha_hora_activa" in msg:
                raise serializers.ValidationError(
                    {"id_paciente": ["El paciente ya tiene una cita en ese horario."]}
                )
            raise
        return citaObj

    def update(self, instance, validated_data):
        for key, val in validated_data.items():
            setattr(instance, key, val)

        try:
            instance.full_clean()
        except DjangoValidationError as e:
            data = getattr(e, "message_dict", None) or {"detail": e.messages}
            for key, val in list(data.items()):
                if isinstance(val, str):
                    data[key] = [val]
            raise serializers.ValidationError(data)

        try:
            instance.save()
        except IntegrityError as e:
            msg = str(e)
            if "uq_cita_odo_fecha_hora_activa" in msg:
                raise serializers.ValidationError(
                    {"hora": ["Ese horario ya está tomado para el odontólogo."]}
                )
            if "uq_cita_consul_fecha_hora_activa" in msg:
                raise serializers.ValidationError(
                    {"id_consultorio": ["El consultorio ya está ocupado en ese horario."]}
                )
            if "uq_cita_paciente_fecha_hora_activa" in msg:
                raise serializers.ValidationError(
                    {"id_paciente": ["El paciente ya tiene una cita en ese horario."]}
                )
            raise
        return instance