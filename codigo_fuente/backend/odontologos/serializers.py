# backend/odontologos/serializers.py
import json
from datetime import datetime, time
from typing import Any, Dict, Optional

from django.db import transaction, IntegrityError
from django.db.models.functions import Lower, ExtractMonth, ExtractDay
from django.db.models import Q
from rest_framework import serializers
from datetime import time as _time

from .models import (
    Odontologo,
    Especialidad,
    OdontologoEspecialidad,
    BloqueoDia,
    OdontologoHorario,
    normalizar_dia_semana, 
)
from usuarios.models import Usuario, ODONTOLOGO_ROLE_ID  # rol=3
from citas.models import Consultorio  # FK de Odontologo.id_consultorio_defecto

# ==== Citas para cancelar automáticamente ====
try:
    from citas.models import Cita, ESTADO_PENDIENTE, ESTADO_CONFIRMADA, ESTADO_CANCELADA
except Exception:
    Cita = None
    ESTADO_PENDIENTE = "pendiente"
    ESTADO_CONFIRMADA = "confirmada"
    ESTADO_CANCELADA = "cancelada"


class OdontologoSerializer(serializers.ModelSerializer):
    # Alias write-only que recibe el front y mapea al FK real
    consultorio_defecto_id = serializers.PrimaryKeyRelatedField(
        source="id_consultorio_defecto",
        queryset=Consultorio.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    # Foto por multipart
    foto = serializers.ImageField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Odontologo
        fields = "__all__"
        extra_kwargs = {
            "created_at": {"read_only": True},
            "updated_at": {"read_only": True},
            # Lo mostramos/representamos, pero lo escribimos con el alias consultorio_defecto_id
            "id_consultorio_defecto": {"read_only": True},
        }

    # ----------------- Helpers usados en la representación -----------------
    def _user(self, obj):
        return getattr(obj, "id_usuario", None)

    def _activo(self, user):
        if not user:
            return True
        return bool(getattr(user, "is_active", True))  # ojo: ya no usamos "estado"

    def _nombre_usuario(self, user):
        if not user:
            return ""
        pnom = (getattr(user, "primer_nombre", "") or "").strip()
        snom = (getattr(user, "segundo_nombre", "") or "").strip()
        pape = (getattr(user, "primer_apellido", "") or "").strip()
        sape = (getattr(user, "segundo_apellido", "") or "").strip()
        return " ".join(" ".join([pnom, snom, pape, sape]).split())

    def _consultorio_defecto(self, obj):
        cons = getattr(obj, "id_consultorio_defecto", None)
        if not cons:
            return None
        return {"id_consultorio": getattr(cons, "pk", None), "numero": getattr(cons, "numero", None)}

    def _especialidades(self, obj):
        rels = (
            OdontologoEspecialidad.objects.select_related("id_especialidad")
            .filter(id_odontologo=obj)
        )
        nombres_activos = set()
        detalle = []
        for r in rels:
            esp = getattr(r, "id_especialidad", None)
            nombre = getattr(esp, "nombre", None) if esp else None
            estado_rel = bool(getattr(r, "estado", True))
            if estado_rel and nombre:
                nombres_activos.add(nombre)
            detalle.append(
                {
                    "nombre": nombre,
                    "universidad": getattr(r, "universidad", None),
                    "estado": estado_rel,
                }
            )
        return sorted(nombres_activos), detalle

    def _horarios(self, obj):
        qs = OdontologoHorario.objects.filter(id_odontologo=obj).order_by(
            "dia_semana", "hora_inicio"
        )
        out = []
        for h in qs:
            out.append(
                {
                    "dia_semana": getattr(h, "dia_semana", None),  # Lunes=0..Domingo=6
                    "hora_inicio": h.hora_inicio.strftime("%H:%M") if h.hora_inicio else None,
                    "hora_fin": h.hora_fin.strftime("%H:%M") if h.hora_fin else None,
                    "vigente": bool(getattr(h, "vigente", True)),
                }
            )
        return out

    def to_representation(self, instance):
        def s(v):
            if v is None:
                return None
            try:
                return str(v)
            except Exception:
                return None

        data = super().to_representation(instance)
        user = self._user(instance)

        data["nombreCompleto"] = self._nombre_usuario(user)
        data["cedula"] = s(getattr(user, "cedula", None))
        data["sexo"] = s(getattr(user, "sexo", None))
        data["usuario_email"] = s(getattr(user, "email", None))
        data["celular"] = s(getattr(user, "celular", None))
        data["fecha_nacimiento"] = s(getattr(user, "fecha_nacimiento", None))
        data["tipo_sangre"] = s(getattr(user, "tipo_sangre", None))

        # Foto -> solo URL/string
        foto_url = None
        if user:
            f = getattr(user, "foto", None)
            if f:
                if hasattr(f, "url"):
                    try:
                        foto_url = f.url
                    except Exception:
                        foto_url = s(f)
                else:
                    foto_url = s(f)
        data["foto"] = foto_url

        data["is_active"] = self._activo(user)
        cons = self._consultorio_defecto(instance)
        if cons:
            cons = {"id_consultorio": cons.get("id_consultorio"), "numero": s(cons.get("numero"))}
        data["consultorio_defecto"] = cons

        nombres, detalle = self._especialidades(instance)
        data["especialidades"] = [s(n) for n in nombres]
        data["especialidades_detalle"] = [
            {
                "nombre": s(d.get("nombre")),
                "universidad": s(d.get("universidad")),
                "estado": bool(d.get("estado", True)),
            }
            for d in detalle
        ]
        data["horarios"] = self._horarios(instance)
        return data

    # ----------------- Entrada: aceptar JSON string en multipart -----------------
    def to_internal_value(self, data):
        m = data.copy()
        for key in ("especialidades_detalle", "horarios"):
            val = data.get(key)
            if isinstance(val, str) and val.strip():
                try:
                    m[key] = json.loads(val)
                except Exception:
                    pass
        return super().to_internal_value(m)

    # ----------------- Parse/validación de horas -----------------
    @staticmethod
    def _parse_time(val: Optional[str]) -> Optional[time]:
        if not val:
            return None
        s = str(val).strip().upper()
        if "-" in s or s in {"--:--", "--:-- --", "—:—", "— —"}:
            return None
        for fmt in ("%I:%M %p", "%I:%M%p"):  # AM/PM
            try:
                return datetime.strptime(s, fmt).time()
            except ValueError:
                pass
        for fmt in ("%H:%M", "%H:%M:%S"):    # 24h
            try:
                return datetime.strptime(s, fmt).time()
            except ValueError:
                pass
        return None

    # ---- Helper: parsear booleanos desde multipart (true/false/1/0/yes/si) ----
    @staticmethod
    def _parse_bool(val) -> bool:
        if isinstance(val, bool):
            return val
        s = str(val).strip().lower()
        return s in {"1", "true", "t", "yes", "y", "on", "si", "sí"}

    # ----------------- Validación de alto nivel -----------------
    def validate(self, attrs):
        """
        Validar que el usuario tenga rol=3 y que no exista otro odontólogo con ese usuario.
        En update, impedimos cambiar 'id_usuario' (OneToOne ya creado).
        """
        user = attrs.get("id_usuario")
        if self.instance:
            if user and user != self.instance.id_usuario:
                raise serializers.ValidationError({"id_usuario": "No se puede cambiar el usuario asociado."})
            return attrs

        if not user:
            raise serializers.ValidationError({"id_usuario": "Debes especificar el usuario."})
        if getattr(user, "id_rol_id", None) != ODONTOLOGO_ROLE_ID:
            raise serializers.ValidationError({"id_usuario": "El usuario debe tener rol 'odontólogo' (id_rol=3)."})
        if Odontologo.objects.filter(id_usuario=user).exists():
            raise serializers.ValidationError({"id_usuario": "Ese usuario ya está asociado a un odontólogo."})
        return attrs

    # ----------------- Helpers de escritura -----------------
    def _ci_get_especialidad(self, nombre: str) -> Especialidad:
        nom = (nombre or "").strip()
        if not nom:
            raise ValueError("Nombre de especialidad vacío.")
        try:
            return Especialidad.objects.annotate(nl=Lower('nombre')).get(nl=nom.lower())
        except Especialidad.DoesNotExist:
            try:
                return Especialidad.objects.create(nombre=nom)
            except IntegrityError:
                return Especialidad.objects.annotate(nl=Lower('nombre')).get(nl=nom.lower())

    def _apply_especialidades(self, instance: Odontologo, esps_payload):
        OdontologoEspecialidad.objects.filter(id_odontologo=instance).delete()
        bulk = []
        for e in (esps_payload or []):
            nombre = (e.get("nombre") or "").strip()
            if not nombre:
                continue
            esp_obj = self._ci_get_especialidad(nombre)
            bulk.append(
                OdontologoEspecialidad(
                    id_odontologo=instance,
                    id_especialidad=esp_obj,
                    universidad=(e.get("universidad") or "").strip(),
                    estado=bool(e.get("estado", True)),
                )
            )
        if bulk:
            OdontologoEspecialidad.objects.bulk_create(bulk)

    def _apply_horarios(self, instance: Odontologo, hrs_payload):
        # Reemplazamos todo por lo recibido (semántica de "definición vigente")
        OdontologoHorario.objects.filter(id_odontologo=instance).delete()
        if not hrs_payload:
            return

        open_t = _time(9, 0)
        close_t = _time(22, 0)   # tope 22:00

        to_create = []
        for h in hrs_payload:
            vigente = bool(h.get("vigente"))
            if not vigente:
                continue

            # --- Normalizar día (Lunes=0..Domingo=6) ---
            raw_day = h.get("dia_semana")
            try:
                dia_norm = normalizar_dia_semana(raw_day)
            except Exception:
                raise serializers.ValidationError({"horarios": f"dia_semana inválido: {raw_day}"})

            # --- Parse de horas ---
            t_ini = self._parse_time(h.get("hora_inicio"))
            t_fin = self._parse_time(h.get("hora_fin"))
            if not t_ini or not t_fin:
                raise serializers.ValidationError({"horarios": "Hay días habilitados con horas vacías o inválidas."})
            if not (open_t <= t_ini < t_fin <= close_t):
                raise serializers.ValidationError({"horarios": "Las horas deben estar entre 09:00 y 22:00, y fin > inicio."})

            to_create.append(OdontologoHorario(
                id_odontologo=instance,
                dia_semana=dia_norm,
                hora_inicio=t_ini,
                hora_fin=t_fin,
                vigente=True,
            ))

        if to_create:
            OdontologoHorario.objects.bulk_create(to_create)

    # ----------------- create / update atómicos -----------------
    @transaction.atomic
    def create(self, validated_data: Dict[str, Any]) -> Odontologo:
        # 'id_consultorio_defecto' ya viene listo gracias a consultorio_defecto_id (source=...)
        foto = validated_data.pop("foto", None)

        instance = Odontologo.objects.create(**validated_data)

        # ------ Actualizar datos de Usuario ------
        user: Optional[Usuario] = getattr(instance, "id_usuario", None)
        if not user:
            raise serializers.ValidationError("Odontólogo sin usuario asociado.")

        in_data = self.initial_data
        mapping = {
            "primer_nombre": "primer_nombre",
            "segundo_nombre": "segundo_nombre",
            "primer_apellido": "primer_apellido",
            "segundo_apellido": "segundo_apellido",
            "cedula": "cedula",
            "sexo": "sexo",
            "fecha_nacimiento": "fecha_nacimiento",
            "tipo_sangre": "tipo_sangre",
            "celular": "celular",
            "usuario_email": "email",
        }
        for front, model_field in mapping.items():
            if front in in_data:
                setattr(user, model_field, in_data.get(front))

        if "is_active" in in_data:
            user.is_active = self._parse_bool(in_data.get("is_active"))


        if foto is not None:
            user.foto = foto
        try:
            user.save()
        except IntegrityError:
            raise serializers.ValidationError({"usuario_email": "Ese correo ya está registrado."})

        # ------ Especialidades ------
        esps = None
        if "especialidades_detalle" in self.initial_data:
            esps = self.initial_data.get("especialidades_detalle")
            if isinstance(esps, str):
                try:
                    esps = json.loads(esps)
                except Exception:
                    raise serializers.ValidationError({"especialidades_detalle": "JSON inválido."})
        elif "especialidades_detalle" in validated_data:
            esps = validated_data.get("especialidades_detalle")
        self._apply_especialidades(instance, esps)

        # ------ Horarios ------
        hrs = None
        if "horarios" in self.initial_data:
            hrs = self.initial_data.get("horarios")
            if isinstance(hrs, str):
                try:
                    hrs = json.loads(hrs)
                except Exception:
                    raise serializers.ValidationError({"horarios": "JSON inválido."})
        elif "horarios" in validated_data:
            hrs = validated_data.get("horarios")
        self._apply_horarios(instance, hrs)

        instance.refresh_from_db()
        return instance

    @transaction.atomic
    def update(self, instance: Odontologo, validated_data: Dict[str, Any]) -> Odontologo:
        # 'id_consultorio_defecto' puede venir seteado por el alias consultorio_defecto_id
        foto = validated_data.pop("foto", None)

        for k, v in list(validated_data.items()):
            try:
                setattr(instance, k, v)
            except Exception:
                pass

        user: Optional[Usuario] = getattr(instance, "id_usuario", None)
        if user is None:
            raise serializers.ValidationError("Odontólogo sin usuario asociado.")

        in_data = self.initial_data
        mapping = {
            "primer_nombre": "primer_nombre",
            "segundo_nombre": "segundo_nombre",
            "primer_apellido": "primer_apellido",
            "segundo_apellido": "segundo_apellido",
            "cedula": "cedula",
            "sexo": "sexo",
            "fecha_nacimiento": "fecha_nacimiento",
            "tipo_sangre": "tipo_sangre",
            "celular": "celular",
            "usuario_email": "email",
        }
        for front, model_field in mapping.items():
            if front in in_data:
                setattr(user, model_field, in_data.get(front))

        if "is_active" in in_data:
            user.is_active = self._parse_bool(in_data.get("is_active"))

        if foto is not None:
            user.foto = foto
        try:
            user.save()
        except IntegrityError:
            raise serializers.ValidationError({"usuario_email": "Ese correo ya está registrado."})

        # Especialidades
        esps = None
        if "especialidades_detalle" in self.initial_data:
            esps = self.initial_data.get("especialidades_detalle")
            if isinstance(esps, str):
                try:
                    esps = json.loads(esps)
                except Exception:
                    raise serializers.ValidationError({"especialidades_detalle": "JSON inválido."})
        elif "especialidades_detalle" in validated_data:
            esps = validated_data.get("especialidades_detalle")
        self._apply_especialidades(instance, esps)

        # Horarios
        hrs = None
        if "horarios" in self.initial_data:
            hrs = self.initial_data.get("horarios")
            if isinstance(hrs, str):
                try:
                    hrs = json.loads(hrs)
                except Exception:
                    raise serializers.ValidationError({"horarios": "JSON inválido."})
        elif "horarios" in validated_data:
            hrs = validated_data.get("horarios")
        self._apply_horarios(instance, hrs)

        instance.save()
        instance.refresh_from_db()
        return instance


class EspecialidadSerializer(serializers.ModelSerializer):
    en_uso = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = Especialidad
        fields = "__all__"
        extra_kwargs = {
            "created_at": {"read_only": True},
            "updated_at": {"read_only": True},
        }
    
    def get_en_uso(self, obj):
        return OdontologoEspecialidad.objects.filter(id_especialidad=obj).exists()


class OdontologoEspecialidadSerializer(serializers.ModelSerializer):
    class Meta:
        model = OdontologoEspecialidad
        fields = "__all__"
        extra_kwargs = {
            "created_at": {"read_only": True},
            "updated_at": {"read_only": True},
        }


class BloqueoDiaSerializer(serializers.ModelSerializer):
    class Meta:
        model = BloqueoDia
        fields = "__all__"
        extra_kwargs = {
            "created_at": {"read_only": True},
            "updated_at": {"read_only": True},
        }


class OdontologoHorarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = OdontologoHorario
        fields = "__all__"
        extra_kwargs = {
            "created_at": {"read_only": True},
            "updated_at": {"read_only": True},
        }

    def validate(self, attrs):
        # Normaliza cualquier input de día (0..6, 1..7, nombre, etc.)
        raw_day = attrs.get("dia_semana")
        try:
            attrs["dia_semana"] = normalizar_dia_semana(raw_day)
        except Exception:
            raise serializers.ValidationError({"dia_semana": f"Valor inválido: {raw_day}. Usa Lunes=0..Domingo=6"})
        return attrs


# ===================== Bloqueo por RANGO (agrupado por 'grupo') =====================
from uuid import uuid4
import datetime as _dt

class BloqueoGrupoSerializer(serializers.Serializer):
    """
    Representa un 'grupo' (UUID) de BloqueoDia, que puede abarcar varias fechas.
    IMPORTANTE: Este serializer SOLO crea/actualiza bloqueos. NO toca estados de citas.
    Los cambios de estado (-> mantenimiento / -> pendiente) se hacen vía endpoints:
      - preview/apply-mantenimiento   (services/bloqueo_service.py)
      - apply-reactivar               (services/bloqueo_service.py)
    """
    id = serializers.UUIDField(read_only=True)  # = grupo
    fecha_inicio = serializers.DateField()
    fecha_fin = serializers.DateField()
    motivo = serializers.CharField(required=False, allow_blank=True, default="")
    recurrente_anual = serializers.BooleanField(required=False, default=False)
    id_odontologo = serializers.IntegerField(required=False, allow_null=True)
    odontologo_nombre = serializers.CharField(read_only=True, allow_null=True)

    def validate(self, attrs):
        fi = attrs.get("fecha_inicio")
        ff = attrs.get("fecha_fin")
        if fi and ff and fi > ff:
            raise serializers.ValidationError({"fecha_fin": "Debe ser ≥ fecha_inicio."})
        return attrs

    # ---- helpers permisos ----
    def _is_admin(self, request): return getattr(request.user, "id_rol_id", None) == 1
    def _is_dent(self, request):  return getattr(request.user, "id_rol_id", None) == 3

    def _check_permissions(self, *, request, id_odontologo: int | None):
        # Globales: solo admin crea/edita
        if not id_odontologo and not self._is_admin(request):
            raise serializers.ValidationError({"id_odontologo": "Solo un administrador puede gestionar bloqueos globales."})
        # Dentista: solo sobre su propio odontólogo
        if self._is_dent(request) and id_odontologo:
            my_od = Odontologo.objects.filter(id_usuario_id=request.user.id_usuario)\
                                      .values_list("id_odontologo", flat=True).first()
            if my_od != id_odontologo:
                raise serializers.ValidationError({"id_odontologo": "No puedes gestionar bloqueos de otro odontólogo."})

    # ---- solape por (mes, día) para recurrentes ----
    def _mmdd_generator(self, fi, ff):
        """Devuelve una lista de (mes, dia) para cada día del rango [fi, ff]."""
        out = []
        cur = fi
        while cur <= ff:
            out.append((cur.month, cur.day))
            cur += _dt.timedelta(days=1)
        return out

    def _q_mmdd_any(self, mmdd_list):
        q = Q()
        for m, d in mmdd_list:
            q |= (Q(fecha__month=m) & Q(fecha__day=d))
        return q

    def _overlap_q(self, fi, ff, id_od):
        """
        Construye un filtro de solape:
        - no recurrentes: fecha en [fi, ff]
        - recurrentes: mes-día coincide con alguno del rango
        y mismo alcance (global u odontólogo).
        """
        mmdd_list = self._mmdd_generator(fi, ff)
        alcance_q = Q(id_odontologo_id=id_od)
        rango_no_rec = Q(recurrente_anual=False, fecha__range=(fi, ff))
        rango_rec    = Q(recurrente_anual=True) & self._q_mmdd_any(mmdd_list)
        return alcance_q & (rango_no_rec | rango_rec)

    # ---- create / update ----
    def create(self, vd):
        request = self.context.get("request")
        fi, ff = vd["fecha_inicio"], vd["fecha_fin"]
        id_od = vd.get("id_odontologo")
        motivo = vd.get("motivo", "")
        rec = bool(vd.get("recurrente_anual", False))

        # Permisos
        self._check_permissions(request=request, id_odontologo=id_od)

        # Valida odontólogo si viene
        if id_od and not Odontologo.objects.filter(pk=id_od).exists():
            raise serializers.ValidationError({"id_odontologo": "Odontólogo inválido."})

        # Anti-solape contra otros bloqueos (mismo alcance, usando lógica de mm-dd)
        exists = BloqueoDia.objects.filter(self._overlap_q(fi, ff, id_od)).exists()
        if exists:
            raise serializers.ValidationError("Ya existe un bloqueo que intersecta ese rango (incluye recurrentes).")

        # Crear filas por día con el mismo grupo (NO tocar citas aquí)
        g = uuid4()
        cur = fi
        bulk = []
        while cur <= ff:
            bulk.append(BloqueoDia(
                grupo=g,
                id_odontologo_id=id_od,
                fecha=cur,
                motivo=motivo,
                recurrente_anual=rec,
            ))
            cur += _dt.timedelta(days=1)
        BloqueoDia.objects.bulk_create(bulk)

        # Nombre odontólogo (opcional)
        od_name = None
        if id_od:
            od = Odontologo.objects.select_related("id_usuario").filter(pk=id_od).first()
            if od and od.id_usuario:
                od_name = f"{od.id_usuario.primer_nombre or ''} {od.id_usuario.primer_apellido or ''}".strip()

        return {
            "id": g,
            "fecha_inicio": fi,
            "fecha_fin": ff,
            "motivo": motivo,
            "recurrente_anual": rec,
            "id_odontologo": id_od,
            "odontologo_nombre": od_name,
        }

    def update(self, instance, vd):
        """
        instance es un dict con el estado actual del grupo (lo arma la vista).
        Re-genera las filas según el payload. NO toca estados de citas.
        """
        request = self.context.get("request")
        g = instance["id"]
        fi = vd.get("fecha_inicio", instance["fecha_inicio"])
        ff = vd.get("fecha_fin", instance["fecha_fin"])
        motivo = vd.get("motivo", instance.get("motivo", ""))
        rec = bool(vd.get("recurrente_anual", instance.get("recurrente_anual", False)))
        id_od = vd.get("id_odontologo", instance.get("id_odontologo"))

        # Permisos
        self._check_permissions(request=request, id_odontologo=id_od)

        # Anti-solape (excluyendo el propio grupo) con lógica de mm-dd
        exists = BloqueoDia.objects.filter(self._overlap_q(fi, ff, id_od)).exclude(grupo=g).exists()
        if exists:
            raise serializers.ValidationError("Ya existe un bloqueo que intersecta ese rango (incluye recurrentes).")

        # Re-generar filas del grupo (NO tocar citas aquí)
        BloqueoDia.objects.filter(grupo=g).delete()
        cur = fi
        bulk = []
        while cur <= ff:
            bulk.append(BloqueoDia(
                grupo=g,
                id_odontologo_id=id_od,
                fecha=cur,
                motivo=motivo,
                recurrente_anual=rec,
            ))
            cur += _dt.timedelta(days=1)
        BloqueoDia.objects.bulk_create(bulk)

        return {
            "id": g,
            "fecha_inicio": fi,
            "fecha_fin": ff,
            "motivo": motivo,
            "recurrente_anual": rec,
            "id_odontologo": id_od,
            "odontologo_nombre": None,
        }