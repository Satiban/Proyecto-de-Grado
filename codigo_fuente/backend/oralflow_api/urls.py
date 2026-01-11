# backend/oralflow_api/urls.py
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from oralflow_api import api_urls

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', include(api_urls)),
    path('webhooks/twilio/', include('notificaciones.urls')),
]

# Habilitar archivos estáticos en desarrollo
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)