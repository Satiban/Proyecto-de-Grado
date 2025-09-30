from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import Usuario, Rol

class UsuarioAdmin(UserAdmin):
    model = Usuario
    list_display = ('email', 'primer_nombre', 'primer_apellido', 'is_staff', 'is_active')
    list_filter = ('is_staff', 'is_active')
    search_fields = ('email',)
    ordering = ('email',)

    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Información personal', {'fields': ('primer_nombre', 'primer_apellido')}),
        ('Permisos', {'fields': ('is_staff', 'is_active', 'is_superuser', 'groups', 'user_permissions')}),
    )

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('email', 'primer_nombre', 'primer_apellido', 'password1', 'password2', 'is_staff', 'is_active')}
        ),
    )

admin.site.register(Usuario, UsuarioAdmin)
admin.site.register(Rol)