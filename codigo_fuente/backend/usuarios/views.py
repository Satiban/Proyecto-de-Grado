# usuarios/views.py
from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from rest_framework import viewsets, status, throttling
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.decorators import action
from rest_framework.views import APIView

from django.core.mail import send_mail

from .models import Rol, Usuario
from .serializers import (
    RolSerializer,
    UsuarioSerializer,
    # ↓ serializers para reset
    PasswordResetRequestSer,
    PasswordResetValidateSer,
    PasswordResetConfirmSer,
)

# -----------------------------
# ViewSets existentes
# -----------------------------

class RolViewSet(viewsets.ModelViewSet):
    queryset = Rol.objects.all()
    serializer_class = RolSerializer
    permission_classes = [IsAuthenticated]  # o AllowAny si quieres que cualquiera liste roles


class UsuarioViewSet(viewsets.ModelViewSet):
    queryset = Usuario.objects.all()
    serializer_class = UsuarioSerializer

    # Permitir crear SIN autenticación; el resto requiere token
    def get_permissions(self):
        if self.action in ["create", "verificar"]:
            return [AllowAny()]
        return [IsAuthenticated()]

    # GET /api/v1/usuarios/me/
    @action(detail=False, methods=['get'], url_path='me', permission_classes=[IsAuthenticated])
    def me(self, request):
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

    # GET /api/v1/usuarios/verificar/?cedula=...&email=...&celular=...
    @action(detail=False, methods=['get'], url_path='verificar', permission_classes=[AllowAny])
    def verificar(self, request):
        cedula = request.query_params.get("cedula")
        email = request.query_params.get("email")
        celular = request.query_params.get("celular")

        if not cedula and not email and not celular:
            return Response(
                {"detail": "Debes enviar 'cedula' y/o 'email' y/o 'celular' como query params."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = {"ok": True}
        if cedula:
            data["cedula"] = {
                "value": cedula,
                "exists": Usuario.objects.filter(cedula=cedula).exists(),
            }
        if email:
            data["email"] = {
                "value": email,
                "exists": Usuario.objects.filter(email=email).exists(),
            }
        if celular:
            data["celular"] = {
                "value": celular,
                "exists": Usuario.objects.filter(celular=celular).exists(),
            }

        return Response(data, status=status.HTTP_200_OK)

# -----------------------------
# Endpoints: Password Reset
# -----------------------------

token_generator = PasswordResetTokenGenerator()

class PasswordResetRequestThrottle(throttling.AnonRateThrottle):
    """
    Limitar solicitudes anónimas para evitar abuso.
    En settings.py puedes definir:
    REST_FRAMEWORK = {
        "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
        "DEFAULT_THROTTLE_RATES": {"anon": "20/min", "password_reset_request": "5/h"},
    }
    """
    scope = "password_reset_request"


class PasswordResetRequestView(APIView):
    """
    POST /api/auth/password-reset/request/
    body: {"email": "..."}
    Responde 200 siempre (para no revelar si el correo existe).
    """
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRequestThrottle]

    def post(self, request):
        ser = PasswordResetRequestSer(data=request.data)
        ser.is_valid(raise_exception=True)
        email = ser.validated_data["email"].strip()

        try:
            user = Usuario.objects.get(email__iexact=email)
        except Usuario.DoesNotExist:
            # No revelar existencia del email
            return Response({"detail": "Si el email existe, enviaremos un enlace."})

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = token_generator.make_token(user)

        front_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
        reset_url = f"{front_url}/reset-password?uid={uid}&token={token}"

        body = (
            "Hola,\n\n"
            "Recibimos una solicitud para restablecer tu contraseña de OralFlow.\n\n"
            f"Abre este enlace para continuar: {reset_url}\n\n"
            "Si no fuiste tú, ignora este mensaje."
        )

        send_mail(
            subject="Restablecer contraseña - OralFlow",
            message=body,
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
            recipient_list=[email],
            fail_silently=False,
        )
        return Response({"detail": "Si el email existe, enviaremos un enlace."})


class PasswordResetValidateView(APIView):
    """
    POST /api/auth/password-reset/validate/
    body: {"uid": "...", "token": "..."}
    """
    permission_classes = [AllowAny]

    def post(self, request):
        ser = PasswordResetValidateSer(data=request.data)
        ser.is_valid(raise_exception=True)
        uid = ser.validated_data["uid"]
        token = ser.validated_data["token"]

        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = Usuario.objects.get(pk=user_id)
        except Exception:
            return Response({"detail": "Enlace inválido."}, status=status.HTTP_400_BAD_REQUEST)

        if token_generator.check_token(user, token):
            return Response({"detail": "Válido"})
        return Response({"detail": "Inválido o expirado."}, status=status.HTTP_400_BAD_REQUEST)


class PasswordResetConfirmView(APIView):
    """
    POST /api/auth/password-reset/confirm/
    body: {"uid":"...","token":"...","new_password":"..."}
    """
    permission_classes = [AllowAny]

    def post(self, request):
        ser = PasswordResetConfirmSer(data=request.data)
        ser.is_valid(raise_exception=True)
        uid = ser.validated_data["uid"]
        token = ser.validated_data["token"]
        new_password = ser.validated_data["new_password"]

        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = Usuario.objects.get(pk=user_id)
        except Exception:
            return Response({"detail": "Enlace inválido."}, status=status.HTTP_400_BAD_REQUEST)

        if not token_generator.check_token(user, token):
            return Response({"detail": "Inválido o expirado."}, status=status.HTTP_400_BAD_REQUEST)

        # Validación de políticas de contraseña de Django
        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as e:
            # e.messages -> lista de mensajes legibles
            return Response({"new_password": e.messages}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save(update_fields=["password"])
        return Response({"detail": "Contraseña actualizada."})
