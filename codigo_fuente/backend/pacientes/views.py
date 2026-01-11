# backend/pacientes/views.py
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated, AllowAny, BasePermission, SAFE_METHODS
from rest_framework.exceptions import NotFound
from rest_framework.decorators import action
from rest_framework.response import Response
from citas.models import Cita

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
        # Lecturas permitidas para todos
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

        qp = self.request.query_params
        uid = qp.get("id_usuario")
        if uid:
            try:
                qs = qs.filter(id_usuario_id=int(uid))
            except (TypeError, ValueError):
                return Paciente.objects.none()

        return qs
    
    @action(detail=False, methods=["get"], url_path="de-odontologo")
    def de_odontologo(self, request):
        id_odo = request.query_params.get("id_odontologo")
        if not id_odo:
            return Response({"detail": "Falta id_odontologo"}, status=400)

        pac_ids = (
            Cita.objects.filter(id_odontologo=id_odo)
            .values_list("id_paciente", flat=True)
            .distinct()
        )
        qs = Paciente.objects.filter(id_paciente__in=pac_ids).select_related("id_usuario")

        page = self.paginate_queryset(qs)
        if page is not None:
            ser = self.get_serializer(page, many=True)
            return self.get_paginated_response(ser.data)

        ser = self.get_serializer(qs, many=True)
        return Response(ser.data)


class AntecedenteViewSet(viewsets.ModelViewSet):
    queryset = Antecedente.objects.all()
    serializer_class = AntecedenteSerializer

    def get_permissions(self):
        if self.action in ["list", "retrieve"]:
            return [AllowAny()]
        # crear/editar/eliminar: solo admin u odontólogo
        return [IsAuthenticated(), IsAdminOrDentist()]


class PacienteAntecedenteViewSet(viewsets.ModelViewSet):
    serializer_class = PacienteAntecedenteSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = PacienteAntecedente.objects.select_related('id_paciente', 'id_antecedente')

        qp = self.request.query_params

        if getattr(user, "id_rol_id", None) == PACIENTE_ROLE_ID:
            qs = qs.filter(id_paciente__id_usuario_id=getattr(user, "id_usuario", None))
        else:
            pid = qp.get("id_paciente")
            if pid:
                try:
                    qs = qs.filter(id_paciente_id=int(pid))
                except (TypeError, ValueError):
                    return PacienteAntecedente.objects.none()

        aid = qp.get("id_antecedente")
        if aid:
            try:
                qs = qs.filter(id_antecedente_id=int(aid))
            except (TypeError, ValueError):
                return PacienteAntecedente.objects.none()

        rel = qp.get("relacion_familiar")
        if rel:
            qs = qs.filter(relacion_familiar=rel)

        return qs

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
                raise NotFound("Registro no encontrado para el paciente indicado.")
        return obj
