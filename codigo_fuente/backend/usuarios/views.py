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
from rest_framework_simplejwt.views import TokenObtainPairView

from cloudinary.uploader import destroy
from usuarios.utils import subir_foto_perfil_cloudinary
from urllib.parse import urlparse

from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from datetime import datetime
from email.mime.image import MIMEImage
import os

from .models import Rol, Usuario
from .serializers import (
    RolSerializer,
    UsuarioSerializer,
    PasswordResetRequestSer,
    PasswordResetValidateSer,
    PasswordResetConfirmSer,
    CustomTokenObtainPairSerializer,
)

# Importar modelos de pacientes y odontólogos para verificar roles adicionales
from pacientes.models import Paciente
from odontologos.models import Odontologo
from usuarios.utils import subir_foto_perfil_cloudinary

# -----------------------------
# Vista personalizada para Token con actualización de last_login
# -----------------------------

class CustomTokenObtainPairView(TokenObtainPairView):
    """
    Vista personalizada que usa el CustomTokenObtainPairSerializer
    para actualizar el campo last_login cuando el usuario inicia sesión.
    """
    serializer_class = CustomTokenObtainPairSerializer

# -----------------------------
# ViewSets existentes
# -----------------------------

class RolViewSet(viewsets.ModelViewSet):
    queryset = Rol.objects.all()
    serializer_class = RolSerializer
    permission_classes = [IsAuthenticated]  # o AllowAny si quieres que cualquiera liste roles

# =====================
# Utilidad: extraer public_id
# =====================
def obtener_public_id(url):
    """
    Extrae el public_id REAL desde la URL completa de Cloudinary,
    sin asumir la carpeta ni el formato.

    Funciona incluso si existen:
    - múltiples carpetas
    - transformaciones en la URL
    - versiones cambiantes "vXXXX"
    - formatos dinámicos (webp, jpg, png)
    """
    if not url:
        return None

    try:
        path = urlparse(url).path.strip('/')  
        partes = path.split('/')  
        if 'upload' not in partes:
            return None
        
        idx_upload = partes.index('upload')

        # Ignorar todo hasta después del "upload"
        partes_utiles = partes[idx_upload + 1:]  

        # Si lo siguiente es versión v12345, saltarlo
        if partes_utiles and partes_utiles[0].startswith('v') and partes_utiles[0][1:].isdigit():
            partes_utiles = partes_utiles[1:]

        # Último elemento es archivo.ext
        archivo = partes_utiles[-1]  
        nombre = archivo.rsplit('.', 1)[0]  

        carpetas = partes_utiles[:-1]  
        if carpetas:
            carpeta = "/".join(carpetas)
            return f"{carpeta}/{nombre}"
        else:
            return nombre

    except Exception:
        return None

class UsuarioViewSet(viewsets.ModelViewSet):
    queryset = Usuario.objects.all()
    serializer_class = UsuarioSerializer

    # Permitir crear SIN autenticación; el resto requiere token
    def get_permissions(self):
        if self.action in ["create", "verificar"]:
            return [AllowAny()]
        return [IsAuthenticated()]

    @action(detail=False, methods=['get'], url_path='me', permission_classes=[IsAuthenticated])
    def me(self, request):
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

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

    @action(detail=True, methods=['get'], url_path='roles-activos', permission_classes=[IsAuthenticated])
    def roles_activos(self, request, pk=None):
        """
        Retorna información sobre los roles activos del usuario:
        - rol_principal: el id_rol en la tabla Usuario
        - es_paciente: true si existe registro en Paciente
        - es_odontologo: true si existe registro en Odontologo
        - id_paciente: ID del paciente si existe
        - id_odontologo: ID del odontólogo si existe
        - es_admin: true si is_staff=true (admin o admin clínico)
        """
        usuario = self.get_object()
        
        # Verificar si tiene registro de paciente
        tiene_paciente = False
        id_paciente = None
        try:
            paciente = Paciente.objects.get(id_usuario=usuario)
            tiene_paciente = True
            id_paciente = paciente.id_paciente
        except Paciente.DoesNotExist:
            pass
        
        # Verificar si tiene registro de odontólogo
        tiene_odontologo = False
        id_odontologo = None
        odontologo_activo = None
        try:
            odontologo = Odontologo.objects.get(id_usuario=usuario)
            tiene_odontologo = True
            id_odontologo = odontologo.id_odontologo
            odontologo_activo = odontologo.activo
        except Odontologo.DoesNotExist:
            pass
        
        return Response({
            "id_usuario": usuario.id_usuario,
            "email": usuario.email,
            "rol_principal": usuario.id_rol_id,
            "rol_principal_nombre": usuario.id_rol.rol,
            "es_paciente": tiene_paciente,
            "es_odontologo": tiene_odontologo,
            "id_paciente": id_paciente,
            "id_odontologo": id_odontologo,
            "odontologo_activo": odontologo_activo,
            "es_admin": usuario.is_staff,
            "admin_activo": usuario.is_staff,
        })
    
    @action(detail=True, methods=['post'], url_path='resetear-intentos', permission_classes=[IsAuthenticated])
    def resetear_intentos(self, request, pk=None):
        """
        Resetea los intentos fallidos de login y desbloquea la cuenta.
        Solo accesible para admin/staff.
        """
        # Verificar que el usuario actual sea admin/staff
        if not request.user.is_staff:
            return Response(
                {"detail": "No tienes permisos para realizar esta acción."},
                status=status.HTTP_403_FORBIDDEN
            )
        
        usuario = self.get_object()
        
        # Guardar estado anterior para el log
        intentos_anteriores = usuario.intentos_fallidos
        estaba_bloqueado = usuario.bloqueado_hasta is not None
        
        # Resetear intentos
        usuario.resetear_intentos_login()
        
        return Response({
            "detail": "Intentos de login reseteados exitosamente.",
            "id_usuario": usuario.id_usuario,
            "cedula": usuario.cedula,
            "nombre_completo": f"{usuario.primer_nombre} {usuario.primer_apellido}",
            "intentos_anteriores": intentos_anteriores,
            "estaba_bloqueado": estaba_bloqueado,
            "estado_actual": {
                "intentos_fallidos": usuario.intentos_fallidos,
                "bloqueado_hasta": usuario.bloqueado_hasta,
            }
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='verificar-rol-paciente', permission_classes=[IsAuthenticated])
    def verificar_rol_paciente(self, request, pk=None):
        """
        Verifica si el usuario tiene registro de paciente.
        Siempre retorna 200 con campo 'existe' (true/false).
        """
        usuario = self.get_object()
        
        try:
            paciente = Paciente.objects.get(id_usuario=usuario)
            return Response({
                "existe": True,
                "id_paciente": paciente.id_paciente,
                "contacto_emergencia_nom": paciente.contacto_emergencia_nom,
                "contacto_emergencia_cel": paciente.contacto_emergencia_cel,
                "contacto_emergencia_par": paciente.contacto_emergencia_par,
            })
        except Paciente.DoesNotExist:
            return Response({
                "existe": False,
                "mensaje": "Este usuario no tiene registro de paciente"
            })

    @action(detail=True, methods=['get'], url_path='verificar-rol-odontologo', permission_classes=[IsAuthenticated])
    def verificar_rol_odontologo(self, request, pk=None):
        """
        Verifica si el usuario tiene registro de odontólogo.
        Siempre retorna 200 con campo 'existe' (true/false).
        """
        usuario = self.get_object()
        
        try:
            odontologo = Odontologo.objects.get(id_usuario=usuario)
            return Response({
                "existe": True,
                "id_odontologo": odontologo.id_odontologo,
                "id_consultorio_defecto": odontologo.id_consultorio_defecto_id,
            })
        except Odontologo.DoesNotExist:
            return Response({
                "existe": False,
                "mensaje": "Este usuario no tiene registro de odontólogo"
            })

    @action(detail=True, methods=['post'], url_path='previsualizar-cambio-staff', permission_classes=[IsAuthenticated])
    def previsualizar_cambio_staff(self, request, pk=None):
        """
        Previsualiza el impacto de cambiar is_staff de un usuario.
        
        Si is_staff pasa de true a false:
        - Verifica si tiene registro de paciente
        - Si tiene, permite el cambio y muestra mensaje
        - Si NO tiene, rechaza el cambio
        
        Si is_staff pasa de false a true:
        - Permite el cambio (se convierte en admin clínico)
        """
        usuario = self.get_object()
        nuevo_is_staff = request.data.get("nuevo_is_staff")
        
        if nuevo_is_staff is None:
            return Response(
                {"detail": "Falta el campo 'nuevo_is_staff'"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Verificar si tiene registro de paciente
        tiene_paciente = Paciente.objects.filter(id_usuario=usuario).exists()
        
        # Cambiar de admin (is_staff=true) a no-admin (is_staff=false)
        if usuario.is_staff and not nuevo_is_staff:
            if not tiene_paciente:
                return Response({
                    "permitido": False,
                    "motivo": "No puede desactivar is_staff sin tener registro de paciente. "
                                "Primero debe crear el registro de paciente para este usuario.",
                    "tiene_paciente": False,
                }, status=status.HTTP_400_BAD_REQUEST)
            
            return Response({
                "permitido": True,
                "mensaje": "El usuario dejará de tener permisos de administrador pero "
                            "mantendrá su acceso como paciente. Mantendrá su rol de Admin Clínico pero "
                            "solo podrá ingresar como paciente.",
                "tiene_paciente": True,
                "cambio_rol": "Permisos de Admin → Solo Paciente",
            })
        
        # Cambiar de no-admin a admin (activar is_staff)
        elif not usuario.is_staff and nuevo_is_staff:
            mensaje = "El usuario recuperará sus permisos de administrador clínico."
            if tiene_paciente:
                mensaje += " Podrá elegir entre ingresar como administrador o paciente."
            
            return Response({
                "permitido": True,
                "mensaje": mensaje,
                "tiene_paciente": tiene_paciente,
                "cambio_rol": "Solo Paciente → Admin + Paciente" if tiene_paciente else "→ Admin",
            })
        
        # Sin cambios
        return Response({
            "permitido": True,
            "mensaje": "No hay cambios en is_staff",
            "tiene_paciente": tiene_paciente,
        })
    
    @action(detail=True, methods=['patch'], url_path='foto', permission_classes=[IsAuthenticated])
    def actualizar_foto(self, request, pk=None):
        """
        Actualiza o elimina la foto de perfil del usuario.
        - Para eliminar: enviar foto_remove=true
        - Para actualizar: enviar archivo en 'foto'
        """
        
        usuario = self.get_object()
        
        # Verificar permisos: solo el mismo usuario o admin
        if request.user.id_usuario != usuario.id_usuario and request.user.id_rol_id != 1:
            return Response(
                {'detail': 'No tienes permiso para modificar esta foto'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Opción 1: Eliminar foto
        if request.data.get('foto_remove') == 'true':
            foto_anterior = usuario.get_foto_desencriptada()
            if foto_anterior:
                public_id_anterior = obtener_public_id(foto_anterior)
                if public_id_anterior:
                    try:
                        destroy(public_id_anterior, resource_type='image')
                    except Exception:
                        pass
            
            usuario.foto = None
            usuario.save(update_fields=['foto'])
            
            serializer = self.get_serializer(usuario)
            return Response(serializer.data)
        
        # Opción 2: Actualizar foto
        archivo = request.FILES.get('foto')
        if not archivo:
            return Response(
                {'detail': 'Debe proporcionar un archivo o usar foto_remove=true para eliminar'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            # 1. Eliminar foto anterior de Cloudinary si existe
            foto_anterior = usuario.get_foto_desencriptada()
            if foto_anterior:
                public_id_anterior = obtener_public_id(foto_anterior)
                if public_id_anterior:
                    try:
                        destroy(public_id_anterior, resource_type='image')
                    except Exception:
                        pass
            
            # 2. Subir nueva foto a Cloudinary
            url_nueva = subir_foto_perfil_cloudinary(archivo, usuario.cedula)
            
            # 3. Encriptar y guardar la URL
            usuario.set_foto_encriptada(url_nueva)
            usuario.save(update_fields=['foto'])
            
            # 4. Retornar datos actualizados con URL desencriptada
            serializer = self.get_serializer(usuario)
            return Response(serializer.data)
            
        except Exception as e:
            return Response(
                {'detail': f'Error al actualizar foto: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )

# -----------------------------
# Endpoints: Password Reset
# -----------------------------

token_generator = PasswordResetTokenGenerator()

class PasswordResetRequestThrottle(throttling.AnonRateThrottle):
    # Limitar solicitudes anónimas para evitar abuso.
    scope = "password_reset_request"


class PasswordResetRequestView(APIView):
    """
    Busca al usuario por cédula y envía el correo al email asociado.
    Si el email es @oralflow (dummy) y el usuario es paciente, envía al contacto de emergencia.
    """
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRequestThrottle]

    def post(self, request):
        from pacientes.models import Paciente
        
        ser = PasswordResetRequestSer(data=request.data)
        ser.is_valid(raise_exception=True)
        cedula = ser.validated_data["cedula"].strip()

        try:
            user = Usuario.objects.get(cedula=cedula)
        except Usuario.DoesNotExist:
            # No revelar existencia de la cédula
            return Response({"detail": "Si la cédula está registrada, se enviará un correo al email asociado."})

        # Determinar email destino
        email_destino = user.email
        es_dummy = email_destino and "@oralflow" in email_destino.lower()
        
        # Si es email dummy, buscar el contacto de emergencia (solo para pacientes)
        if es_dummy:
            try:
                paciente = Paciente.objects.get(id_usuario=user)
                if paciente.contacto_emergencia_email:
                    email_destino = paciente.contacto_emergencia_email
                else:
                    # Sin email válido, no se puede enviar
                    return Response({"detail": "Si la cédula está registrada, se enviará un correo al email asociado."})
            except Paciente.DoesNotExist:
                # No es paciente y tiene email dummy, no se puede enviar
                return Response({"detail": "Si la cédula está registrada, se enviará un correo al email asociado."})
        
        if not email_destino:
            # Sin email válido
            return Response({"detail": "Si la cédula está registrada, se enviará un correo al email asociado."})

        # Generar token y enviar correo
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = token_generator.make_token(user)

        front_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
        reset_url = f"{front_url}/reset-password?uid={uid}&token={token}"

        # Preparar contexto para las plantillas
        context = {
            'usuario_nombre': f"{user.primer_nombre} {user.primer_apellido}",
            'reset_url': reset_url,
            'year': datetime.now().year,
        }

        # Ocultar parcialmente el email para mostrarlo al usuario
        def ocultar_email(email):
            if not email or "@" not in email:
                return "***@***.com"
            local, dominio = email.split("@", 1)
            if len(local) <= 3:
                local_oculto = "***"
            else:
                local_oculto = local[:2] + "***"
            return f"{local_oculto}@{dominio}"
        
        email_mostrado = ocultar_email(email_destino)
        
        # Intentar enviar el correo (con manejo de errores para evitar exponer problemas de SMTP)
        try:
            # Renderizar plantillas HTML y texto
            html_content = render_to_string('password_reset_email.html', context)
            text_content = render_to_string('password_reset_email.txt', context)
            
            # Crear email con HTML
            email = EmailMultiAlternatives(
                subject="Restablecer contraseña - Bella Dent",
                body=text_content,  # Versión texto plano (fallback)
                from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
                to=[email_destino],
            )
            email.attach_alternative(html_content, "text/html")

            # Adjuntar logo embebido (CID)
            logo_path = os.path.join(settings.BASE_DIR, 'usuarios', 'static', 'belladent-logo5.png')
            if os.path.exists(logo_path):
                with open(logo_path, 'rb') as f:
                    logo_data = f.read()
                
                logo = MIMEImage(logo_data)
                logo.add_header('Content-ID', '<logo_belladent>')
                logo.add_header('Content-Disposition', 'inline', filename='belladent-logo5.png')
                email.attach(logo)

            email.send(fail_silently=False)
        except Exception as e:
            # Log del error para debugging (sin exponerlo al usuario)
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error al enviar correo de reset password: {str(e)}")
            # Retornar respuesta exitosa al usuario de todos modos (por seguridad)
        
        return Response({
            "detail": f"Si la cédula está registrada, se enviará un correo a {email_mostrado}",
            "email": email_mostrado
        })


class PasswordResetValidateView(APIView):
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

        # Validar que no sea la misma contraseña actual (medida de seguridad)
        if user.check_password(new_password):
            return Response(
                {"new_password": ["Por seguridad, no puedes usar tu contraseña anterior. Elige una contraseña diferente."]}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validación de políticas de contraseña de Django
        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as e:
            return Response({"new_password": e.messages}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save(update_fields=["password"])
        return Response({"detail": "Contraseña actualizada."})