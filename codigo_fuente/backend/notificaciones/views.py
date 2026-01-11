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
from usuarios.utils import normalizar_celular_ecuador
from .services import send_whatsapp_text

# -------------------------
# Helpers
# -------------------------

def _norm(s: str | None) -> str:
    # Normaliza: minúsculas, sin tildes, sin puntuación, sin dobles espacios.
    if not s:
        return ""
    s = s.strip().lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    table = str.maketrans({c: " " for c in string.punctuation})
    s = s.translate(table)
    return " ".join(s.split())

def _fmt_fecha_hora(fecha, hora) -> str:
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

_DIAS = {0:"Lunes",1:"Martes",2:"Miércoles",3:"Jueves",4:"Viernes",5:"Sábado",6:"Domingo"}
_MESES = {1:"enero",2:"febrero",3:"marzo",4:"abril",5:"mayo",6:"junio",7:"julio",8:"agosto",
            9:"septiembre",10:"octubre",11:"noviembre",12:"diciembre"}

def fmt_fecha_larga(fecha, hora) -> str:
    fh = timezone.make_aware(
        timezone.datetime.combine(fecha, hora),
        timezone.get_current_timezone()
    )
    dia = _DIAS[fh.weekday()]
    mes = _MESES[fh.month]
    return f"{dia} {fh.day} de {mes} de {fh.year} ({fh.strftime('%d/%m/%Y')}) a las {fh.strftime('%H:%M')}"

def doctor_line(cita: Cita) -> str:
    return _doctor_line(cita)

def _mensaje_confirmada(cita: Cita) -> str:
    # Obtener nombre del paciente (sin el "Paciente X -")
    paciente_obj = getattr(cita, "id_paciente", None)
    if paciente_obj and hasattr(paciente_obj, "id_usuario"):
        usuario = paciente_obj.id_usuario
        nombre_paciente = f"{usuario.primer_nombre} {usuario.primer_apellido}"
    else:
        nombre_paciente = "Paciente"
    
    doctor = _doctor_line(cita)
    fh = _fmt_fecha_hora(cita.fecha, cita.hora)
    return (
        "✅ *Cita confirmada*\n"
        f"Gracias {nombre_paciente}. Te esperamos el {fh} {doctor}.\n"
        "Si deseas reprogramar o cancelar, llama al consultorio\n"
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

    from_wa     = (data.get("From") or "")
    body        = _norm(data.get("Body"))
    btn_text    = _norm(data.get("ButtonText"))
    btn_payload = _norm(data.get("ButtonPayload") or data.get("Postback") or data.get("Payload"))
    
    original_msg_sid = data.get("OriginalRepliedMessageSid") or data.get("ReferralMessageSid")

    text = btn_payload or btn_text or body

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
        return Response({"ok": True}, status=200)

    if not decision:
        return Response({"ok": True}, status=200)

    # Normalizar número
    e164 = from_wa.replace("whatsapp:", "")
    e164_normalizado = normalizar_celular_ecuador(e164)
    if not e164_normalizado:
        return Response({"ok": True}, status=200)

    # Obtener citas asociadas
    from pacientes.models import Paciente
    now = timezone.now()
    candidatos_citas = []

    # Por celular propio
    for u in Usuario.objects.exclude(celular__isnull=True).exclude(celular=''):
        if normalizar_celular_ecuador(u.celular) == e164_normalizado:
            citas_usuario = Cita.objects.filter(
                id_paciente__id_usuario=u.id_usuario,
                estado__in=[ESTADO_PENDIENTE, ESTADO_CONFIRMADA, ESTADO_CANCELADA],
                fecha__gte=now.date(),
            ).order_by("fecha", "hora")
            for cita in citas_usuario:
                candidatos_citas.append({'cita': cita, 'usuario': u})

    # Por contacto de emergencia
    for p in Paciente.objects.exclude(contacto_emergencia_cel__isnull=True).exclude(contacto_emergencia_cel=''):
        if normalizar_celular_ecuador(p.contacto_emergencia_cel) == e164_normalizado:
            citas_paciente = Cita.objects.filter(
                id_paciente=p,
                estado__in=[ESTADO_PENDIENTE, ESTADO_CONFIRMADA, ESTADO_CANCELADA],
                fecha__gte=now.date(),
            ).order_by("fecha", "hora")
            for cita in citas_paciente:
                candidatos_citas.append({'cita': cita, 'usuario': p.id_usuario})

    if not candidatos_citas:
        return Response({"ok": True}, status=200)

    cita_seleccionada = None

    # 1: Match exacto por SID
    if original_msg_sid:
        for c in candidatos_citas:
            if c['cita'].whatsapp_message_sid == original_msg_sid:
                cita_seleccionada = c
                break

    # 2: Último recordatorio en 48h
    if not cita_seleccionada:
        from datetime import timedelta
        hace_48h = now - timedelta(hours=48)
        recientes = [
            c for c in candidatos_citas 
            if c['cita'].recordatorio_enviado_at 
            and c['cita'].recordatorio_enviado_at >= hace_48h
        ]
        if recientes:
            recientes.sort(key=lambda x: x['cita'].recordatorio_enviado_at, reverse=True)
            cita_seleccionada = recientes[0]

    # 3: La más próxima
    if not cita_seleccionada:
        candidatos_citas.sort(key=lambda x: (x['cita'].fecha, x['cita'].hora))
        cita_seleccionada = candidatos_citas[0]

    cita = cita_seleccionada["cita"]
    usuario = cita_seleccionada["usuario"]

    if decision == ESTADO_CONFIRMADA and cita.estado == ESTADO_CONFIRMADA:
        send_whatsapp_text(e164_normalizado, _mensaje_ya_confirmada(cita))
        return Response({"ok": True}, status=200)

    if decision == ESTADO_CANCELADA and cita.estado == ESTADO_CANCELADA:
        send_whatsapp_text(e164_normalizado, _mensaje_ya_cancelada(cita))
        return Response({"ok": True}, status=200)

    if decision == ESTADO_CONFIRMADA:
        cita.estado = ESTADO_CONFIRMADA
        cita.cancelada_en = None
        cita.cancelada_por_rol = None
        cita.confirmacion_fuente = "whatsapp"
        cita.save(update_fields=["estado", "confirmacion_fuente", "cancelada_en", "cancelada_por_rol"])
        send_whatsapp_text(e164_normalizado, _mensaje_confirmada(cita))
    else:
        cita.estado = ESTADO_CANCELADA
        cita.cancelada_en = now
        cita.cancelada_por_rol = 2
        cita.confirmacion_fuente = "whatsapp"
        cita.save(update_fields=["estado", "cancelada_en", "cancelada_por_rol", "confirmacion_fuente"])
        send_whatsapp_text(e164_normalizado, _mensaje_cancelada(cita))

    return Response({"ok": True}, status=200)
