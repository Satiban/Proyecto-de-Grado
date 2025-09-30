# fichas_medicas/views.py
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated, BasePermission, SAFE_METHODS
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django_filters.rest_framework import DjangoFilterBackend  # <-- filtros

from .models import FichaMedica, ArchivoAdjunto
from .serializers import FichaMedicaSerializer, ArchivoAdjuntoSerializer
from usuarios.models import ADMIN_ROLE_ID, ODONTOLOGO_ROLE_ID, PACIENTE_ROLE_ID


# --- Permisos por objeto ---
class CanWriteFicha(BasePermission):
    """
    Lectura: cualquiera autenticado con permisos de rol (se controla en get_queryset)
    Escritura: admin o el odontólogo dueño de la cita.
    """
    def has_object_permission(self, request, view, obj: FichaMedica):
        if request.method in SAFE_METHODS:
            return True

        userObj = request.user
        if not userObj.is_authenticated:
            return False

        if getattr(userObj, 'id_rol_id', None) == ADMIN_ROLE_ID:
            return True

        # odontólogo dueño de la cita
        odontologoUserId = getattr(
            getattr(obj.id_cita.id_odontologo, 'id_usuario', None),
            'id_usuario',
            None
        )
        return odontologoUserId == getattr(userObj, 'id_usuario', None)


class CanWriteAdjunto(BasePermission):
    """
    Lectura: cualquiera autenticado con permisos de rol (se controla en get_queryset)
    Escritura: admin o el odontólogo dueño de la cita (vía ficha).
    """
    def has_object_permission(self, request, view, obj: ArchivoAdjunto):
        if request.method in SAFE_METHODS:
            return True

        userObj = request.user
        if not userObj.is_authenticated:
            return False

        if getattr(userObj, 'id_rol_id', None) == ADMIN_ROLE_ID:
            return True

        odontologoUserId = getattr(
            getattr(obj.id_ficha_medica.id_cita.id_odontologo, 'id_usuario', None),
            'id_usuario',
            None
        )
        return odontologoUserId == getattr(userObj, 'id_usuario', None)


class FichaMedicaViewSet(viewsets.ModelViewSet):
    """
    Endpoints:
      - GET /fichas_medicas/               (lista, con filtros)
      - GET /fichas_medicas/{id}/          (detalle)
      - POST /fichas_medicas/              (crear)
      - PUT/PATCH /fichas_medicas/{id}/    (editar)
      - DELETE /fichas_medicas/{id}/       (eliminar)
    Filtros soportados:
      - ?id_cita=<int>
    """
    serializer_class = FichaMedicaSerializer
    permission_classes = [IsAuthenticated, CanWriteFicha]

    queryset = FichaMedica.objects.select_related(
        'id_cita__id_paciente__id_usuario',
        'id_cita__id_odontologo__id_usuario',
        'id_cita__id_consultorio',
    ).all()

    # Habilita filtros por querystring
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["id_cita"]

    def get_queryset(self):
        """
        Restringe por rol:
          - Admin: ve todo
          - Odontólogo: solo fichas de sus citas
          - Paciente: solo fichas de sus citas
        Los filtros por querystring (id_cita) se aplican
        luego automáticamente por DjangoFilterBackend.
        """
        userObj = self.request.user
        baseQs = self.queryset

        roleId = getattr(userObj, 'id_rol_id', None)
        if roleId == ADMIN_ROLE_ID:
            return baseQs
        if roleId == ODONTOLOGO_ROLE_ID:
            return baseQs.filter(id_cita__id_odontologo__id_usuario=userObj)
        if roleId == PACIENTE_ROLE_ID:
            return baseQs.filter(id_cita__id_paciente__id_usuario=userObj)
        return baseQs.none()


class ArchivoAdjuntoViewSet(viewsets.ModelViewSet):
    """
    Endpoints:
      - GET /archivos_adjuntos/                 (lista, con filtros)
      - GET /archivos_adjuntos/{id}/            (detalle)
      - POST /archivos_adjuntos/                (crear)
      - PUT/PATCH /archivos_adjuntos/{id}/      (editar)
      - DELETE /archivos_adjuntos/{id}/         (eliminar)
    Filtros soportados:
      - ?id_ficha_medica=<int>
    """
    serializer_class = ArchivoAdjuntoSerializer
    permission_classes = [IsAuthenticated, CanWriteAdjunto]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    queryset = ArchivoAdjunto.objects.select_related(
        'id_ficha_medica__id_cita__id_paciente__id_usuario',
        'id_ficha_medica__id_cita__id_odontologo__id_usuario',
    ).all()

    # Habilita filtros por querystring
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["id_ficha_medica"]

    def get_queryset(self):
        """
        Restringe por rol:
          - Admin: ve todo
          - Odontólogo: adjuntos de fichas de sus citas
          - Paciente: adjuntos de sus fichas
        Los filtros por querystring (id_ficha_medica) se aplican
        luego automáticamente por DjangoFilterBackend.
        """
        userObj = self.request.user
        baseQs = self.queryset

        roleId = getattr(userObj, 'id_rol_id', None)
        if roleId == ADMIN_ROLE_ID:
            return baseQs
        if roleId == ODONTOLOGO_ROLE_ID:
            return baseQs.filter(id_ficha_medica__id_cita__id_odontologo__id_usuario=userObj)
        if roleId == PACIENTE_ROLE_ID:
            return baseQs.filter(id_ficha_medica__id_cita__id_paciente__id_usuario=userObj)
        return baseQs.none()