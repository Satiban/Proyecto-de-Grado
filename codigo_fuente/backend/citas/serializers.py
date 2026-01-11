# citas/serializers.py
from datetime import datetime, date, timedelta
from django.utils.timezone import now
from django.db import IntegrityError
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models.functions import Lower
from rest_framework import serializers
from decimal import Decimal
from usuarios.utils import normalizar_celular_ecuador
from .models import Consultorio, Cita, PagoCita, Configuracion
from django.core.validators import RegexValidator
from cloudinary.uploader import destroy
from citas.utils import obtener_public_id, subir_comprobante_cloudinary

celular_contacto_validator = RegexValidator(
    regex=r'^\+?\d{9,15}$',
    message='El celular debe tener entre 9 y 15 dígitos. Formato recomendado E.164: +593XXXXXXXXX.'
)

# Serializer para Configuracion 
class ConfiguracionSerializer(serializers.ModelSerializer):
    def validate_celular_contacto(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("El número de contacto no puede estar vacío.")
        celular_contacto_validator(value)
        normalizado = normalizar_celular_ecuador(value)
        if normalizado:
            return normalizado
        return value

    def validate_max_citas_activas(self, value):
        if value < 1:
            raise serializers.ValidationError(
                "El número máximo de citas activas debe ser al menos 1."
            )
        return value

    def validate(self, data):
        horas_desde = data.get("horas_confirmar_desde", getattr(self.instance, "horas_confirmar_desde", None))
        horas_hasta = data.get("horas_confirmar_hasta", getattr(self.instance, "horas_confirmar_hasta", None))
        horas_auto = data.get("horas_autoconfirmar", getattr(self.instance, "horas_autoconfirmar", None))
        min_anticipacion = data.get("min_horas_anticipacion", getattr(self.instance, "min_horas_anticipacion", None))
        errors = {}
        # 1. coherencia confirmación: hasta < desde
        if horas_hasta is not None and horas_desde is not None:
            if horas_hasta >= horas_desde:
                errors["horas_confirmar_hasta"] = (
                    "Debe ser menor que horas_confirmar_desde."
                )
        # 2. anticipación < desde
        if min_anticipacion is not None and horas_desde is not None:
            if min_anticipacion >= horas_desde:
                errors["min_horas_anticipacion"] = (
                    "Debe ser menor que horas_confirmar_desde."
                )
        # 3. autoconfirmación <= desde
        if horas_auto is not None and horas_desde is not None:
            if horas_auto > horas_desde:
                errors["horas_autoconfirmar"] = (
                    "Debe ser menor o igual que horas_confirmar_desde."
                )
        if errors:
            raise serializers.ValidationError(errors)
        return data

    class Meta:
        model = Configuracion
        fields = [
            "id_configuracion",
            "celular_contacto",
            "max_citas_activas",
            "horas_confirmar_desde",
            "horas_confirmar_hasta",
            "horas_autoconfirmar",
            "max_citas_dia",
            "cooldown_dias",
            "max_reprogramaciones",
            "min_horas_anticipacion",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

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
    odontologo_especialidades = serializers.SerializerMethodField(read_only=True)
    consultorio = serializers.SerializerMethodField(read_only=True)
    hora_inicio = serializers.SerializerMethodField(read_only=True)
    hora_fin = serializers.SerializerMethodField(read_only=True)

    # Información de pago
    pago = serializers.SerializerMethodField(read_only=True)

    # Reglas de negocio expuestas a UI
    reprogramaciones = serializers.IntegerField(read_only=True)
    reprogramada_en = serializers.DateTimeField(required=False, allow_null=True)
    reprogramada_por_rol = serializers.IntegerField(required=False, allow_null=True)
    cancelada_en = serializers.DateTimeField(required=False, allow_null=True) 
    cancelada_por_rol = serializers.IntegerField(required=False, allow_null=True) 

    motivo = serializers.CharField(required=True, allow_blank=False, allow_null=False)

    class Meta:
        model = Cita
        fields = [
            "id_cita",
            "id_paciente",
            "id_odontologo",
            "id_consultorio",
            "fecha",
            "hora",       
            "hora_inicio",   
            "hora_fin",       
            "motivo",
            "estado",
            "reprogramaciones",
            "reprogramada_en",
            "reprogramada_por_rol",
            "cancelada_en",
            "cancelada_por_rol",
            "ausentismo",
            "created_at",
            "updated_at",
            "paciente_nombre",
            "paciente_cedula",
            "odontologo_nombre",
            "odontologo_especialidades",
            "consultorio",
            "pago", 
        ]
        extra_kwargs = {
            "created_at": {"read_only": True},
            "updated_at": {"read_only": True},
            "ausentismo": {"required": False},
        }

    def fmtTime(self, t):
        return t.strftime("%H:%M") if t else None

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
    
    def get_odontologo_especialidades(self, obj):
        return list(
            obj.id_odontologo.especialidades
            .filter(estado=True)  # opcional: solo activas
            .values_list("id_especialidad__nombre", flat=True)
        )

    def get_pago(self, obj):
        """Devuelve información del pago asociado (OneToOne) si existe."""
        try:
            if hasattr(obj, 'pago') and obj.pago:
                return {
                    "id_pago_cita": obj.pago.id_pago_cita,
                    "monto": str(obj.pago.monto),
                    "metodo_pago": obj.pago.metodo_pago,
                    "estado_pago": obj.pago.estado_pago,
                    "comprobante": obj.pago.comprobante if obj.pago.comprobante else None,
                    "observacion": obj.pago.observacion,
                    "fecha_pago": obj.pago.fecha_pago.isoformat() if obj.pago.fecha_pago else None,
                    "reembolsado_en": obj.pago.reembolsado_en.isoformat() if obj.pago.reembolsado_en else None,
                    "motivo_reembolso": obj.pago.motivo_reembolso,
                }
        except PagoCita.DoesNotExist:
            pass
        return None


    def validate_hora(self, value):
        if value and value.minute != 0:
            raise serializers.ValidationError(
                "Las citas duran 1 hora y deben iniciar en la hora exacta (minuto 0)."
            )
        return value

    def create(self, validated_data):
        citaObj = Cita(**validated_data)

        try:
            citaObj.full_clean()
        except DjangoValidationError as e:
            data = getattr(e, "message_dict", None) or {"detail": e.messages}
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

class PagoCitaSerializer(serializers.ModelSerializer):
    paciente_nombre = serializers.SerializerMethodField(read_only=True)
    odontologo_nombre = serializers.SerializerMethodField(read_only=True)
    cita_info = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = PagoCita
        fields = [
            "id_pago_cita",
            "id_cita",
            "monto",
            "metodo_pago",
            "estado_pago",
            "comprobante",
            "observacion",
            "fecha_pago",
            "reembolsado_en",
            "motivo_reembolso",
            "created_at",
            "updated_at",
            "paciente_nombre",
            "odontologo_nombre",
            "cita_info",
        ]
        read_only_fields = ["created_at", "updated_at", "comprobante"]

    # ===== Campos calculados =====
    def get_paciente_nombre(self, obj):
        cita = getattr(obj, "id_cita", None)
        if not cita or not cita.id_paciente or not cita.id_paciente.id_usuario:
            return ""
        userObj = cita.id_paciente.id_usuario
        parts = [
            (userObj.primer_nombre or "").strip(),
            (userObj.segundo_nombre or "").strip(),
            (userObj.primer_apellido or "").strip(),
            (userObj.segundo_apellido or "").strip(),
        ]
        return " ".join([p for p in parts if p])

    def get_odontologo_nombre(self, obj):
        cita = getattr(obj, "id_cita", None)
        if not cita or not cita.id_odontologo or not cita.id_odontologo.id_usuario:
            return ""
        userObj = cita.id_odontologo.id_usuario
        parts = [
            (userObj.primer_nombre or "").strip(),
            (userObj.segundo_nombre or "").strip(),
            (userObj.primer_apellido or "").strip(),
            (userObj.segundo_apellido or "").strip(),
        ]
        return " ".join([p for p in parts if p])

    def get_cita_info(self, obj):
        cita = getattr(obj, "id_cita", None)
        if not cita:
            return None

        paciente = getattr(cita, "id_paciente", None)
        odontologo = getattr(cita, "id_odontologo", None)
        consultorio = getattr(cita, "id_consultorio", None)

        paciente_nombre = self.get_paciente_nombre(obj)
        odontologo_nombre = self.get_odontologo_nombre(obj)
        odontologo_especialidades = []
        if odontologo:
            odontologo_especialidades = list(
                odontologo.especialidades.filter(estado=True)
                .values_list("id_especialidad__nombre", flat=True)
            )

        return {
            "id_cita": cita.id_cita,
            "fecha": cita.fecha,
            "hora": cita.hora.strftime("%H:%M") if cita.hora else None,
            "estado_cita": cita.estado,
            "motivo": cita.motivo,
            "paciente_nombre": paciente_nombre,
            "paciente_cedula": getattr(paciente.id_usuario, "cedula", "") if paciente and paciente.id_usuario else "",
            "odontologo_nombre": odontologo_nombre,
            "odontologo_especialidades": odontologo_especialidades,
            "consultorio_numero": getattr(consultorio, "numero", ""),
        }

    # ===== Validaciones =====
    def validate_monto(self, value):
        if value <= 0:
            raise serializers.ValidationError("El monto debe ser mayor a 0.")
        return round(Decimal(value), 2)

    def validate(self, data):
        # No se puede registrar pago de una cita no realizada
        cita = data.get("id_cita") or getattr(self.instance, "id_cita", None)
        if cita and cita.estado != "realizada":
            raise serializers.ValidationError(
                {"id_cita": ["Solo se pueden registrar pagos de citas en estado 'realizada'."]}
            )
        return data

    def create(self, validated_data):
        request = self.context.get("request")
        archivo = request.FILES.get("comprobante") if request and hasattr(request, "FILES") else None

        # Si no envían estado, asumir que es un pago registrado
        estado_in = validated_data.pop("estado_pago", None) or PagoCita.ESTADO_PAGADO

        pago = PagoCita.objects.create(
            **validated_data,
            estado_pago=estado_in,
        )

        # Subir comprobante si vino archivo
        if archivo:
            from citas.utils import subir_comprobante_cloudinary
            cita = pago.id_cita
            cedula = cita.id_paciente.id_usuario.cedula
            url_segura = subir_comprobante_cloudinary(archivo, cedula, pago.id_pago_cita)
            pago.comprobante = url_segura

        # Si quedó pagado y no tiene fecha, asignar ahora
        if pago.estado_pago == PagoCita.ESTADO_PAGADO and not pago.fecha_pago:
            pago.fecha_pago = now()

        campos = ["estado_pago", "updated_at"]
        if pago.comprobante:
            campos.append("comprobante")
        if pago.fecha_pago:
            campos.append("fecha_pago")

        pago.save(update_fields=campos)
        return pago

    def update(self, instance, validated_data):
        request = self.context.get("request")
        archivo_nuevo = request.FILES.get("comprobante") if request and hasattr(request, "FILES") else None

        metodo_pago = validated_data.get('metodo_pago', instance.metodo_pago)
        comprobante_in_data = 'comprobante' in validated_data
        comprobante_value = validated_data.get('comprobante') if comprobante_in_data else None

        def borrar_actual():
            if instance.comprobante:
                public_id = obtener_public_id(instance.comprobante)
                if public_id:
                    destroy(public_id)
                instance.comprobante = None

        # Manejo del comprobante según el método de pago
        if metodo_pago == PagoCita.METODO_EFECTIVO:
            # Si es efectivo, siempre borrar el comprobante
            borrar_actual()
            validated_data['comprobante'] = None
        elif metodo_pago == PagoCita.METODO_TRANSFERENCIA:
            if archivo_nuevo:
                # Hay archivo nuevo, reemplazar
                borrar_actual()
                cedula = instance.id_cita.id_paciente.id_usuario.cedula
                url = subir_comprobante_cloudinary(archivo_nuevo, cedula, instance.id_pago_cita)
                validated_data['comprobante'] = url
            elif comprobante_in_data and comprobante_value in (None, '', False):
                # Usuario quiere explícitamente borrar el comprobante
                borrar_actual()
                validated_data['comprobante'] = None
            else:
                validated_data.pop('comprobante', None)

        for key, val in validated_data.items():
            setattr(instance, key, val)

        if instance.estado_pago == PagoCita.ESTADO_PAGADO and not instance.fecha_pago:
            instance.fecha_pago = now()

        instance.full_clean()
        instance.save()
        return instance