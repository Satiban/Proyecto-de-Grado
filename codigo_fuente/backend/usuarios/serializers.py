# usuarios/serializers.py
from rest_framework import serializers
from .models import Rol, Usuario

# IDs de rol (ajusta si cambian en tu BD)
ADMIN_ROLE_ID = 1
ADMIN_CLINICO_ROLE_ID = 4


class RolSerializer(serializers.ModelSerializer):
    class Meta:
        model = Rol
        fields = ['id_rol', 'rol', 'created_at', 'updated_at']


class UsuarioSerializer(serializers.ModelSerializer):
    rol_nombre = serializers.CharField(source='id_rol.rol', read_only=True)

    # Alias de email por compatibilidad (frontend a veces usa "usuario_email")
    usuario_email = serializers.EmailField(source='email', required=False)

    # Exponer is_active (solo lectura, para clientes que ya consumen is_active)
    is_active = serializers.BooleanField(read_only=True)

    # Campo "activo" editable que mapea a is_active en el modelo
    activo = serializers.BooleanField(source='is_active', required=False)

    # ---- Flags de acceso ----
    # is_superuser no se edita desde el frontend
    is_superuser = serializers.BooleanField(read_only=True)

    # is_staff editable: puedes enviarlo como "is_staff" o usando el alias "staff"
    is_staff = serializers.BooleanField(required=False)
    staff = serializers.BooleanField(source='is_staff', required=False)

    class Meta:
        model = Usuario
        fields = [
            'id_usuario',
            'email',
            'usuario_email',
            'password',          # write_only
            'primer_nombre',
            'segundo_nombre',
            'primer_apellido',
            'segundo_apellido',
            'cedula',
            'fecha_nacimiento',
            'sexo',
            'tipo_sangre',
            'celular',
            'foto',
            'id_rol',
            'rol_nombre',

            # Flags
            'is_active',         # read_only
            'activo',            # writable alias -> is_active
            'is_staff',          # ✅ writable
            'staff',             # alias writable -> is_staff
            'is_superuser',      # read_only

            # Auditoría
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            'password': {'write_only': True},
            'created_at': {'read_only': True},
            'updated_at': {'read_only': True},
        }

    # --------- Validaciones ---------
    def validate(self, attrs):
        """
        - Unicidad de cédula, email y celular (create/update).
        Nota: cuando venga "usuario_email", DRF ya lo mapea a attrs['email'] por el source='email'.
        """
        cedula = attrs.get("cedula")
        email = attrs.get("email")
        celular = attrs.get("celular")
        qs = Usuario.objects.all()

        # Unicidad
        if self.instance is None:
            if cedula and qs.filter(cedula=cedula).exists():
                raise serializers.ValidationError({"cedula": "La cédula ya está registrada."})
            if email and qs.filter(email=email).exists():
                raise serializers.ValidationError({"email": "El correo ya está registrado."})
            if celular and qs.filter(celular=celular).exists():
                raise serializers.ValidationError({"celular": "El celular ya está registrado."})
        else:
            if cedula and qs.exclude(pk=self.instance.pk).filter(cedula=cedula).exists():
                raise serializers.ValidationError({"cedula": "La cédula ya está registrada."})
            if email and qs.exclude(pk=self.instance.pk).filter(email=email).exists():
                raise serializers.ValidationError({"email": "El correo ya está registrado."})
            if celular and qs.exclude(pk=self.instance.pk).filter(celular=celular).exists():
                raise serializers.ValidationError({"celular": "El celular ya está registrado."})

        return attrs

    # --------- Create / Update ---------
    def create(self, validated_data):
        """
        Crear usuario usando el manager para asegurar hash y reglas.
        - 'is_staff' por defecto:
            * Rol 1 (admin): True
            * Rol 4 (admin clínico): False
            * Otros: False
        - Si VIENE 'is_staff' y el rol es 4, lo forzamos a False al crear (regla de negocio).
        """
        password = validated_data.pop('password', None)
        validated_data.setdefault('is_active', True)  # activo por defecto

        # Rol (puede venir como instancia, int o None)
        role = validated_data.get('id_rol')
        role_id = None
        if isinstance(role, Rol):
            role_id = role.id_rol
        elif role is not None:
            try:
                role_id = int(role)
            except Exception:
                role_id = None

        # Normalizar is_staff en creación
        if 'is_staff' not in validated_data:
            if role_id == ADMIN_ROLE_ID:
                validated_data['is_staff'] = True
            elif role_id == ADMIN_CLINICO_ROLE_ID:
                validated_data['is_staff'] = False
            else:
                validated_data['is_staff'] = False
        else:
            if role_id == ADMIN_CLINICO_ROLE_ID:
                validated_data['is_staff'] = False

        user = Usuario.objects.create_user(password=password, **validated_data)
        return user

    def update(self, instance, validated_data):
        """
        Update seguro:
        - Si viene password, hashearla con set_password.
        - 'activo' ya llega como is_active por el source.
        - 'is_staff' se respeta en edición.
        """
        password = validated_data.pop('password', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        instance.save()
        return instance


# -----------------------------
# Serializers para Password Reset
# -----------------------------

class PasswordResetRequestSer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetValidateSer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()


class PasswordResetConfirmSer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(min_length=6, write_only=True)
