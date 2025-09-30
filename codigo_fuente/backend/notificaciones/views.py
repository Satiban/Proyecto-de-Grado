# notificaciones/views.py
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

import unicodedata
import string

from citas.models import (
    Cita,
    ESTADO_PENDIENTE,
    ESTADO_CONFIRMADA,
    ESTADO_CANCELADA,
)
from usuarios.models import Usuario
from .services import send_whatsapp_text


# -------------------------
# Helpers
# -------------------------

def _norm(s: str | None) -> str:
    """
    Normaliza: minúsculas, sin tildes, sin puntuación, sin dobles espacios.
    Ej: 'Sí, confirmar' -> 'si confirmar'
    """
    if not s:
        return ""
    s = s.strip().lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    table = str.maketrans({c: " " for c in string.punctuation})
    s = s.translate(table)
    return " ".join(s.split())


def _fmt_fecha_hora(fecha, hora) -> str:
    """
    Devuelve 'Miércoles 24/09/2025 a las 17:00' en español sin depender de locale.
    """
    dias_semana = {
        0: "Lunes", 1: "Martes", 2: "Miércoles",
        3: "Jueves", 4: "Viernes", 5: "Sábado", 6: "Domingo",
    }
    fh = timezone.make_aware(
        timezone.datetime.combine(fecha, hora),
        timezone.get_current_timezone()
    )
    dia_semana = dias_semana[fh.weekday()]
    return f"{dia_semana} {fh.strftime('%d/%m/%Y a las %H:%M')}"


def _nombre_completo_usuario(u) -> str:
    if not u:
        return ""
    piezas = []
    for campo in ("primer_nombre", "segundo_nombre", "nombres"):
        v = getattr(u, campo, None)
        if v:
            piezas.append(str(v).strip())
            break
    for campo in ("primer_apellido", "segundo_apellido", "apellidos"):
        v = getattr(u, campo, None)
        if v:
            piezas.append(str(v).strip())
    return " ".join(piezas).strip()


def _prefijo_doctor_y_articulo(cita: Cita) -> tuple[str, str]:
    """
    Retorna (artículo, prefijo): ('el', 'Dr.') / ('la', 'Dra.') / ('', '')
    Detecta sexo en cita.id_odontologo o en cita.id_odontologo.id_usuario.
    """
    odo = getattr(cita, "id_odontologo", None)
    sexo = None
    if odo is not None:
        sexo = getattr(odo, "sexo", None)
        if sexo is None and hasattr(odo, "id_usuario"):
            sexo = getattr(odo.id_usuario, "sexo", None)
    if isinstance(sexo, str):
        s = sexo.strip().upper()
        if s.startswith("F"):
            return "la", "Dra."
        if s.startswith("M"):
            return "el", "Dr."
    return "", ""


def _doctor_line(cita: Cita) -> str:
    """
    'con el Dr. Luis Tibán' / 'con la Dra. Ana Pérez' / 'con Luis Tibán' / fallback al __str__.
    """
    odo = getattr(cita, "id_odontologo", None)
    nombre = ""
    if odo is not None:
        u = getattr(odo, "id_usuario", None)
        nombre = _nombre_completo_usuario(u)
        if not nombre:
            for campo in ("nombres", "apellidos"):
                v = getattr(odo, campo, None)
                if v:
                    nombre = (nombre + " " + str(v).strip()).strip()
        if not nombre:
            nombre = str(odo).strip()

    art, pref = _prefijo_doctor_y_articulo(cita)
    if pref:
        return f"con {art} {pref} {nombre}".strip()
    return f"con {nombre}".strip() if nombre else "con su odontólogo"


# --- WRAPPERS públicos para usar desde shell/otros módulos ---

_DIAS = {0:"Lunes",1:"Martes",2:"Miércoles",3:"Jueves",4:"Viernes",5:"Sábado",6:"Domingo"}
_MESES = {1:"enero",2:"febrero",3:"marzo",4:"abril",5:"mayo",6:"junio",7:"julio",8:"agosto",
          9:"septiembre",10:"octubre",11:"noviembre",12:"diciembre"}

def fmt_fecha_larga(fecha, hora) -> str:
    """Miércoles 24 de septiembre de 2025 (24/09/2025) a las 17:00"""
    fh = timezone.make_aware(
        timezone.datetime.combine(fecha, hora),
        timezone.get_current_timezone()
    )
    dia = _DIAS[fh.weekday()]
    mes = _MESES[fh.month]
    return f"{dia} {fh.day} de {mes} de {fh.year} ({fh.strftime('%d/%m/%Y')}) a las {fh.strftime('%H:%M')}"

def doctor_line(cita: Cita) -> str:
    """Wrapper público de _doctor_line para import externo."""
    return _doctor_line(cita)


def _mensaje_confirmada(cita: Cita) -> str:
    paciente = str(getattr(cita, "id_paciente", "") or "Paciente")
    doctor = _doctor_line(cita)
    lugar = str(getattr(cita, "id_consultorio", "") or "el consultorio")
    fh = _fmt_fecha_hora(cita.fecha, cita.hora)
    return (
        "✅ *Cita confirmada*\n"
        f"Gracias {paciente}. Te esperamos el {fh} {doctor} en {lugar}.\n"
        "Si deseas reprogramar o cancelar, puedes hacerlo desde la web o respondiendo a este número.\n"
        "— Bella Dent 🦷"
    )


def _mensaje_cancelada(cita: Cita) -> str:
    fh = _fmt_fecha_hora(cita.fecha, cita.hora)
    return (
        "❌ *Cita cancelada*\n"
        f"Se ha cancelado tu cita del {fh}.\n"
        "Si deseas *agendar una nueva cita*, ingresa a la web o comunícate con el consultorio.\n"
        "— Bella Dent 🦷"
    )


def _mensaje_ya_confirmada(cita: Cita) -> str:
    fh = _fmt_fecha_hora(cita.fecha, cita.hora)
    return (
        f"ℹ️ Tu cita del {fh} *ya estaba confirmada*. ¡Te esperamos!\n"
        "Si necesitas cambiarla, por favor comunícate con el consultorio o responde este mensaje.\n"
        "— Bella Dent 🦷"
    )


def _mensaje_ya_cancelada(cita: Cita) -> str:
    fh = _fmt_fecha_hora(cita.fecha, cita.hora)
    return (
        f"ℹ️ La cita del {fh} *ya estaba cancelada*.\n"
        "Cuando gustes puedes agendar una nueva desde la web o llamando al consultorio.\n"
        "— Bella Dent 🦷"
    )


# -------------------------
# Webhook
# -------------------------

@csrf_exempt
@api_view(["POST"])
@permission_classes([AllowAny])
def whatsapp_incoming(request):
    data = request.POST.dict()
    print("[WA INCOMING]", data)

    # Origen y texto (incluye Quick Reply)
    from_wa     = (data.get("From") or "")
    body        = _norm(data.get("Body"))
    btn_text    = _norm(data.get("ButtonText"))
    btn_payload = _norm(data.get("ButtonPayload") or data.get("Postback") or data.get("Payload"))

    # Priorizar payload > texto del botón > texto libre
    text = btn_payload or btn_text or body
    # print("NORMALIZADO:", text)

    # Decisión tolerante
    decision = None
    if text in {"confirm", "si", "si confirmo", "si confirmar", "confirmo", "confirmar"}:
        decision = ESTADO_CONFIRMADA
    elif text in {"cancel", "no", "no cancelar", "cancelar", "no asisto"}:
        decision = ESTADO_CANCELADA
    elif text in {"reschedule", "reprogramar"}:
        e164 = from_wa.replace("whatsapp:", "")
        send_whatsapp_text(
            e164,
            "🔄 Para reprogramar, por favor ingresa a la web 🌐 o comunícate con el consultorio 📞\n— Bella Dent 🦷"
        )
        return Response({"ok": True, "info": "reprogramar"}, status=200)
    else:
        if text.startswith("si") or text.startswith("confirm"):
            decision = ESTADO_CONFIRMADA
        elif text.startswith("no") or "cancel" in text:
            decision = ESTADO_CANCELADA

    if not decision:
        return Response({"ok": True, "message": "Responde SI para confirmar o NO para cancelar"}, status=200)

    # Ubicar usuario por número (E.164)
    e164 = from_wa.replace("whatsapp:", "")
    try:
        usuario = Usuario.objects.get(celular__endswith=e164[-9:])  # tolera prefijo país
    except Usuario.DoesNotExist:
        return Response({"ok": False, "detail": "Número no asociado a un usuario"}, status=200)

    # Cita más próxima desde hoy (en estados relevantes)
    now = timezone.now()
    cita = (
        Cita.objects
        .filter(
            id_paciente__id_usuario=usuario.id_usuario,
            estado__in=[ESTADO_PENDIENTE, ESTADO_CONFIRMADA, ESTADO_CANCELADA],
            fecha__gte=now.date(),
        )
        .order_by("fecha", "hora")
        .first()
    )
    if not cita:
        return Response({"ok": True, "detail": "No hay cita pendiente para actualizar"}, status=200)

    # Idempotencia
    if decision == ESTADO_CONFIRMADA and cita.estado == ESTADO_CONFIRMADA:
        send_whatsapp_text(e164, _mensaje_ya_confirmada(cita))
        return Response({"ok": True, "cita_id": cita.id_cita, "nuevo_estado": cita.estado}, status=200)
    if decision == ESTADO_CANCELADA and cita.estado == ESTADO_CANCELADA:
        send_whatsapp_text(e164, _mensaje_ya_cancelada(cita))
        return Response({"ok": True, "cita_id": cita.id_cita, "nuevo_estado": cita.estado}, status=200)

    # Transición + seguimiento
    if decision == ESTADO_CONFIRMADA:
        cita.estado = ESTADO_CONFIRMADA
        cita.cancelada_en = None
        cita.cancelada_por_rol = None
        cita.confirmacion_fuente = "whatsapp"
        cita.save(update_fields=["estado", "confirmacion_fuente", "cancelada_en", "cancelada_por_rol"])
        send_whatsapp_text(e164, _mensaje_confirmada(cita))
    else:
        cita.estado = ESTADO_CANCELADA
        cita.cancelada_en = now
        cita.cancelada_por_rol = 2  # 2 = paciente
        cita.confirmacion_fuente = "whatsapp"
        cita.save(update_fields=["estado", "cancelada_en", "cancelada_por_rol", "confirmacion_fuente"])
        send_whatsapp_text(e164, _mensaje_cancelada(cita))

    return Response({"ok": True, "cita_id": cita.id_cita, "nuevo_estado": cita.estado}, status=200)
