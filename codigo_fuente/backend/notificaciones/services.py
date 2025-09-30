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

def send_whatsapp_template(to_e164: str, content_sid: str, variables: dict, status_callback_url: str | None = None):
    params = {
        "from_": settings.TWILIO_WHATSAPP_FROM,
        "to": f"whatsapp:{to_e164}",
        "content_sid": content_sid,
        "content_variables": json.dumps(variables),  # {"1":"12/1","2":"3pm"} por ejemplo
    }
    if status_callback_url:
        params["status_callback"] = status_callback_url
    if settings.TWILIO_MESSAGING_SERVICE_SID:
        params["messaging_service_sid"] = settings.TWILIO_MESSAGING_SERVICE_SID
    msg = _client.messages.create(**params)
    return msg.sid
