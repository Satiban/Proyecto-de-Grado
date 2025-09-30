# notificaciones/urls.py
from django.urls import path
from .views import whatsapp_incoming

urlpatterns = [
    path("webhook/", whatsapp_incoming, name="twilio_whatsapp_incoming"),
]
