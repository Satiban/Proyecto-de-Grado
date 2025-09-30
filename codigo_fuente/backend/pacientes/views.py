from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated, AllowAny, BasePermission, SAFE_METHODS
from rest_framework.exceptions import NotFound

from .models import Paciente, Antecedente, PacienteAntecedente
from .serializers import (
    PacienteSerializer,
    AntecedenteSerializer,
    PacienteAntecedenteSerializer,
)
from usuarios.models import PACIENTE_ROLE_ID


# --- Permiso: solo admin (id_rol=1) u odontólogo (id_rol=3) pueden modificar Antecedentes ---
class IsAdminOrDentist(BasePermission):
    def has_permission(self, request, view):
        # Lecturas permitidas para todos (útil en página de registro)
        if request.method in SAFE_METHODS:
            return True
        # Para escribir, debe estar autenticado y tener rol 1 o 3
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        return getattr(user, "id_rol_id", None) in (1, 3)


class PacienteViewSet(viewsets.ModelViewSet):
    serializer_class = PacienteSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = Paciente.objects.select_related('id_usuario').all()

        # Si el usuario autenticado es PACIENTE, solo puede ver su propio registro
        if getattr(user, "id_rol_id", None) == PACIENTE_ROLE_ID:
            return qs.filter(id_usuario_id=getattr(user, "id_usuario", None))

        # Para admin/odontólogo permitimos filtrar por ?id_usuario=<int>
        qp = self.request.query_params
        uid = qp.get("id_usuario")
        if uid:
            try:
                qs = qs.filter(id_usuario_id=int(uid))
            except (TypeError, ValueError):
                return Paciente.objects.none()

        return qs


class AntecedenteViewSet(viewsets.ModelViewSet):
    queryset = Antecedente.objects.all()
    serializer_class = AntecedenteSerializer

    def get_permissions(self):
        # listar/detallar: cualquiera (para poblar selectores en formularios públicos)
        if self.action in ["list", "retrieve"]:
            return [AllowAny()]
        # crear/editar/eliminar: solo admin u odontólogo
        return [IsAuthenticated(), IsAdminOrDentist()]


class PacienteAntecedenteViewSet(viewsets.ModelViewSet):
    """
    Importante: filtramos por query params y reforzamos seguridad:
      - ?id_paciente=<int>
      - ?id_antecedente=<int>
      - ?relacion_familiar=<choice>
    Si el autenticado es PACIENTE (id_rol=2), se limitan los resultados
    a su propio Paciente (id_usuario = request.user.id_usuario) ignorando
    cualquier otro id_paciente que intenten pasar.
    """
    serializer_class = PacienteAntecedenteSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = PacienteAntecedente.objects.select_related('id_paciente', 'id_antecedente')

        qp = self.request.query_params

        # Si es PACIENTE: forzar a su propio Paciente
        if getattr(user, "id_rol_id", None) == PACIENTE_ROLE_ID:
            qs = qs.filter(id_paciente__id_usuario_id=getattr(user, "id_usuario", None))
        else:
            # Solo para roles no-paciente aplicamos filtros libres
            pid = qp.get("id_paciente")
            if pid:
                try:
                    qs = qs.filter(id_paciente_id=int(pid))
                except (TypeError, ValueError):
                    return PacienteAntecedente.objects.none()

        # id_antecedente
        aid = qp.get("id_antecedente")
        if aid:
            try:
                qs = qs.filter(id_antecedente_id=int(aid))
            except (TypeError, ValueError):
                return PacienteAntecedente.objects.none()

        # relacion_familiar (choices: abuelos, padres, hermanos, propio)
        rel = qp.get("relacion_familiar")
        if rel:
            qs = qs.filter(relacion_familiar=rel)

        return qs

    # (Extra defensa) Si se hace retrieve/destroy y viene ?id_paciente=X,
    # validamos que el registro pertenezca a ese paciente.
    def get_object(self):
        obj = super().get_object()
        pid = self.request.query_params.get("id_paciente")

        # Si es paciente, adicionalmente bloquea acceso a registros ajenos
        user = self.request.user
        if getattr(user, "id_rol_id", None) == PACIENTE_ROLE_ID:
            if obj.id_paciente.id_usuario_id != getattr(user, "id_usuario", None):
                raise NotFound("Registro no encontrado para el paciente autenticado.")

        if pid:
            try:
                pid_int = int(pid)
            except (TypeError, ValueError):
                raise NotFound("id_paciente inválido.")
            if obj.id_paciente_id != pid_int:
                # No expongas registros que no pertenecen al paciente indicado
                raise NotFound("Registro no encontrado para el paciente indicado.")
        return obj
