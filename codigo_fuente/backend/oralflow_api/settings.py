from pathlib import Path
from datetime import timedelta
from decouple import config
import os
import cloudinary

# ==========================
# Rutas base y configuración
# ==========================
BASE_DIR = Path(__file__).resolve().parent.parent

# ==========================
# Configuración general
# ==========================
SECRET_KEY = config("SECRET_KEY")
DEBUG = config("DEBUG", cast=bool, default=True)

# ==========================
# Encriptación Fernet
# ==========================
FERNET_KEY = config("FERNET_KEY")

# ==========================
ALLOWED_HOSTS = [
    "localhost", 
    "127.0.0.1",
    "incontestably-reparative-morgan.ngrok-free.dev",
    "belladent-backend.onrender.com",
]

CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",            # LOCALHOST – necesario para pruebas
    "http://127.0.0.1:5173",
    "https://belladent.vercel.app",     # FRONTEND en producción
    "https://belladent-backend.onrender.com",  # BACKEND en producción
]

# ==========================
# Aplicaciones instaladas
# ==========================
INSTALLED_APPS = [
    # Django apps
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Terceros
    "rest_framework",
    "corsheaders",
    "rest_framework_simplejwt",
    "django_filters",
    "cloudinary",

    # Apps locales
    "pacientes",
    "odontologos",
    "citas.apps.CitasConfig",
    "fichas_medicas.apps.FichasMedicasConfig",
    "notificaciones",
    "reportes",
    "usuarios.apps.UsuariosConfig",
]

# ==========================
# Middleware
# ==========================
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # importante para Render
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "usuarios.middleware.SuperuserAdminMiddleware",  # Requiere is_superuser + is_staff para /admin/
]

ROOT_URLCONF = "oralflow_api.urls"

# ==========================
# Templates
# ==========================
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "oralflow_api.wsgi.application"

# ==========================
# Base de datos
# ==========================
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": config("DB_NAME"),
        "USER": config("DB_USER"),
        "PASSWORD": config("DB_PASSWORD"),
        "HOST": config("DB_HOST"),
        "PORT": config("DB_PORT"),
    }
}

# ==========================
# Validación de contraseñas
# ==========================
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
        "OPTIONS": {"max_similarity": 0.7},
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# Tiempo de expiración del token de restablecimiento de contraseña (en segundos)
PASSWORD_RESET_TIMEOUT = 1800

# ==========================
# Internacionalización
# ==========================
LANGUAGE_CODE = "es"
TIME_ZONE = "America/Guayaquil"
USE_I18N = True
USE_TZ = True

# ==========================
# Archivos estáticos y media
# ==========================
STATIC_URL = "/static/"
STATIC_ROOT = os.path.join(BASE_DIR, "staticfiles")

# Directorios adicionales para archivos estáticos (logos)
STATICFILES_DIRS = [
    os.path.join(BASE_DIR, "usuarios", "static"),
]

STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# ==========================
# Cloudinary 
# ==========================

cloudinary.config( 
    cloud_name = config("CLOUDINARY_CLOUD_NAME"), 
    api_key = config("CLOUDINARY_API_KEY"), 
    api_secret = config("CLOUDINARY_API_SECRET")
)

# URLs para emails y enlaces externos
FRONTEND_URL = config("FRONTEND_URL", default="http://localhost:5173")
BACKEND_URL = config("BACKEND_URL", default="http://localhost:8000")

# ==========================
# Configuración REST Framework
# ==========================
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PARSER_CLASSES": (
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ),
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "20/min",
        "user": "1000/day",
        "password_reset_request": "5/hour",
    },
}

# ==========================
# CORS (para frontend)
# ==========================
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",               # desarrollo local
    "http://127.0.0.1:5173",
    "https://belladent.vercel.app",
]

# ==========================
# Configuración de usuario personalizado
# ==========================
AUTH_USER_MODEL = "usuarios.Usuario"

# Backend de autenticación personalizado (login con cédula)
AUTHENTICATION_BACKENDS = [
    "usuarios.authentication.CedulaAuthenticationBackend",  # Login con cédula
    "django.contrib.auth.backends.ModelBackend",            # Fallback por si acaso
]

# ==========================
# Configuración JWT
# ==========================
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "USER_ID_FIELD": "id_usuario",
    "USER_ID_CLAIM": "user_id",
    "UPDATE_LAST_LOGIN": True,
}

# ==========================
# Configuración Email
# ==========================
EMAIL_BACKEND = config(
    "EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST = config("EMAIL_HOST", default="")
EMAIL_PORT = config("EMAIL_PORT", cast=int, default=587)
EMAIL_USE_TLS = config("EMAIL_USE_TLS", cast=bool, default=True)
EMAIL_USE_SSL = config("EMAIL_USE_SSL", cast=bool, default=False)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="no-reply@oralflow.local")

# ==========================
# Configuración Twilio
# ==========================
TWILIO_ACCOUNT_SID = config("TWILIO_ACCOUNT_SID", default="")
TWILIO_AUTH_TOKEN = config("TWILIO_AUTH_TOKEN", default="")
TWILIO_WHATSAPP_FROM = config(
    "TWILIO_WHATSAPP_FROM", default="whatsapp:+14155238886"
)
TWILIO_MESSAGING_SERVICE_SID = config("TWILIO_MESSAGING_SERVICE_SID", default=None)
PUBLIC_BASE_URL = config("PUBLIC_BASE_URL", default="")
TWILIO_TEMPLATE_SID_RECORDATORIO = config("TWILIO_TEMPLATE_SID_RECORDATORIO", default="")

# ==========================
# Seguridad para Render
# ==========================
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"