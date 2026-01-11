# notificaciones/services.py
import json
from django.conf import settings
from twilio.rest import Client

_client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)

def send_whatsapp_text(to_e164: str, text: str, status_callback_url: str | None = None):
    params = {
        "from_": settings.TWILIO_WHATSAPP_FROM,
        "to": f"whatsapp:{to_e164}",
        "body": text,
    }
    if status_callback_url:
        params["status_callback"] = status_callback_url
    if settings.TWILIO_MESSAGING_SERVICE_SID:
        params["messaging_service_sid"] = settings.TWILIO_MESSAGING_SERVICE_SID
    msg = _client.messages.create(**params)
    return msg.sid

def send_whatsapp_template(to_e164: str, content_sid: str, variables: dict, status_callback_url: str | None = None, cita_id: int | None = None):
    """
    Envía una plantilla de WhatsApp con variables dinámicas.
    
    Args:
        to_e164: Número en formato E.164 (+593...)
        content_sid: ID de la plantilla de Twilio
        variables: Dict con las variables de la plantilla {"1": "...", "2": "..."}
        status_callback_url: URL opcional para callbacks de estado
        cita_id: ID de la cita (se incluirá en el MessagingServiceSid para tracking)
    
    Returns:
        str: Message SID del mensaje enviado
    """
    params = {
        "from_": settings.TWILIO_WHATSAPP_FROM,
        "to": f"whatsapp:{to_e164}",
        "content_sid": content_sid,
        "content_variables": json.dumps(variables),
    }
    if status_callback_url:
        params["status_callback"] = status_callback_url
    if settings.TWILIO_MESSAGING_SERVICE_SID:
        params["messaging_service_sid"] = settings.TWILIO_MESSAGING_SERVICE_SID
    
    msg = _client.messages.create(**params)
    return msg.sid
