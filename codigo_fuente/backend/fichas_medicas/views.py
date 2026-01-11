# fichas_medicas/views.py
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated, BasePermission, SAFE_METHODS
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django_filters.rest_framework import DjangoFilterBackend

from .models import FichaMedica, ArchivoAdjunto
from .serializers import FichaMedicaSerializer, ArchivoAdjuntoSerializer
from .utils import obtener_public_id_ficha
from cloudinary.uploader import destroy

from usuarios.models import ADMIN_ROLE_ID, ODONTOLOGO_ROLE_ID, PACIENTE_ROLE_ID


# ============================
# PERMISOS POR OBJETO
# ============================

class CanWriteFicha(BasePermission):
    """
    Lectura: todos los autenticados según rol
    Escritura: admin o el odontólogo dueño de la cita.
    """
    def has_object_permission(self, request, view, obj: FichaMedica):
        if request.method in SAFE_METHODS:
            return True

        user = request.user
        if not user.is_authenticated:
            return False

        # Admin: acceso total
        if user.id_rol_id == ADMIN_ROLE_ID:
            return True

        # Odontólogo dueño de la cita
        odontologo_user_id = getattr(
            obj.id_cita.id_odontologo.id_usuario, "id_usuario", None
        )
        return odontologo_user_id == user.id_usuario


class CanWriteAdjunto(BasePermission):
    """
    Lectura: todos los autenticados según rol
    Escritura: admin o el odontólogo dueño de la ficha/cita
    """
    def has_object_permission(self, request, view, obj: ArchivoAdjunto):
        if request.method in SAFE_METHODS:
            return True

        user = request.user
        if not user.is_authenticated:
            return False

        if user.id_rol_id == ADMIN_ROLE_ID:
            return True

        odontologo_user_id = getattr(
            obj.id_ficha_medica.id_cita.id_odontologo.id_usuario,
            "id_usuario",
            None
        )
        return odontologo_user_id == user.id_usuario


# ============================
# FICHA MÉDICA
# ============================

class FichaMedicaViewSet(viewsets.ModelViewSet):
    serializer_class = FichaMedicaSerializer
    permission_classes = [IsAuthenticated, CanWriteFicha]

    queryset = FichaMedica.objects.select_related(
        'id_cita__id_paciente__id_usuario',
        'id_cita__id_odontologo__id_usuario',
        'id_cita__id_consultorio',
    )

    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["id_cita"]

    def get_queryset(self):
        """Control de acceso por rol."""
        user = self.request.user
        base = self.queryset

        if user.id_rol_id == ADMIN_ROLE_ID:
            return base
        if user.id_rol_id == ODONTOLOGO_ROLE_ID:
            return base.filter(id_cita__id_odontologo__id_usuario=user)
        if user.id_rol_id == PACIENTE_ROLE_ID:
            return base.filter(id_cita__id_paciente__id_usuario=user)

        return base.none()



# ============================
# ARCHIVOS ADJUNTOS
# ============================

class ArchivoAdjuntoViewSet(viewsets.ModelViewSet):
    serializer_class = ArchivoAdjuntoSerializer
    permission_classes = [IsAuthenticated, CanWriteAdjunto]

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    queryset = ArchivoAdjunto.objects.select_related(
        'id_ficha_medica__id_cita__id_paciente__id_usuario',
        'id_ficha_medica__id_cita__id_odontologo__id_usuario',
    )

    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["id_ficha_medica"]

    def get_queryset(self):
        """Control de acceso por rol."""
        user = self.request.user
        base = self.queryset

        if user.id_rol_id == ADMIN_ROLE_ID:
            return base
        if user.id_rol_id == ODONTOLOGO_ROLE_ID:
            return base.filter(id_ficha_medica__id_cita__id_odontologo__id_usuario=user)
        if user.id_rol_id == PACIENTE_ROLE_ID:
            return base.filter(id_ficha_medica__id_cita__id_paciente__id_usuario=user)

        return base.none()

    # -----------------------------
    # ELIMINAR
    # -----------------------------
    def perform_destroy(self, instance: ArchivoAdjunto):
        """
        Elimina el archivo también en Cloudinary antes de borrar de la BD.
        """
        # Obtener URL desencriptada
        url_desencriptada = instance.get_url_desencriptada()
        
        if url_desencriptada:
            public_id = obtener_public_id_ficha(url_desencriptada)
            if public_id:
                try:
                    # Determinar resource_type desde la URL de Cloudinary
                    resource_type = "raw"  # Default
                    if "/image/upload/" in url_desencriptada:
                        resource_type = "image"
                    elif "/raw/upload/" in url_desencriptada:
                        resource_type = "raw"
                    elif "/video/upload/" in url_desencriptada:
                        resource_type = "video"

                    destroy(public_id, resource_type=resource_type)
                except Exception:
                    pass  # evitar bloquear el delete si falla Cloudinary

        super().perform_destroy(instance)