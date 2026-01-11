# backend/oralflow_api/api_urls.py
from django.urls import path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

# ==== ViewSets de cada app ====
# usuarios
from usuarios.views import (
    UsuarioViewSet, 
    RolViewSet, 
    CustomTokenObtainPairView,
    PasswordResetRequestView, 
    PasswordResetValidateView, 
    PasswordResetConfirmView,
)

# pacientes
from pacientes.views import (
    PacienteViewSet,
    AntecedenteViewSet,
    PacienteAntecedenteViewSet,
)

# odontologos
from odontologos.views import (
    OdontologoViewSet,
    EspecialidadViewSet,
    OdontologoEspecialidadViewSet,
    BloqueoDiaViewSet,
    OdontologoHorarioViewSet,
)


# citas
from citas.views import ConsultorioViewSet, CitaViewSet, PagoCitaViewSet, ConfiguracionView

# fichas médicas / archivos
from fichas_medicas.views import FichaMedicaViewSet, ArchivoAdjuntoViewSet

# reportes
from reportes.views import ReportesViewSet


router = DefaultRouter()

# ==== Registro de ViewSets ====
# usuarios
router.register(r'usuarios', UsuarioViewSet, basename='usuario')
router.register(r'roles', RolViewSet, basename='rol')

# pacientes
router.register(r'pacientes', PacienteViewSet, basename='paciente')
router.register(r'antecedentes', AntecedenteViewSet, basename='antecedente')
router.register(r'paciente-antecedentes', PacienteAntecedenteViewSet, basename='paciente-antecedente')

# odontologos
router.register(r'odontologos', OdontologoViewSet, basename='odontologo')
router.register(r'especialidades', EspecialidadViewSet, basename='especialidad')
router.register(r'odontologo-especialidades', OdontologoEspecialidadViewSet, basename='odontologo-especialidad')

# Ruta que usa el frontend
router.register(r'bloqueos-dias', BloqueoDiaViewSet, basename='bloqueo-dia')
router.register(r'odontologo-horarios', OdontologoHorarioViewSet, basename='odontologo-horario')

# citas
router.register(r'consultorios', ConsultorioViewSet, basename='consultorio')
router.register(r'citas', CitaViewSet, basename='cita')
router.register(r'pagos', PagoCitaViewSet, basename='pago')

# fichas médicas
router.register(r'fichas-medicas', FichaMedicaViewSet, basename='ficha-medica')
router.register(r'archivos-adjuntos', ArchivoAdjuntoViewSet, basename='archivo-adjunto')

# reportes
router.register(r'reportes', ReportesViewSet, basename='reporte')


# ==== URL patterns expuestos por el router + JWT ====
urlpatterns = router.urls

urlpatterns += [
    # JWT - usando vista personalizada para actualizar last_login
    path('token/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # ===== Password reset =====
    path('auth/password-reset/request/',  PasswordResetRequestView.as_view(),  name='password_reset_request'),
    path('auth/password-reset/validate/', PasswordResetValidateView.as_view(), name='password_reset_validate'),
    path('auth/password-reset/confirm/',  PasswordResetConfirmView.as_view(),  name='password_reset_confirm'),

    # Configuración general del sistema
    path('configuracion/', ConfiguracionView.as_view(), name='configuracion'),
]
