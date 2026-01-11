# Comando para normalizar todos los números de celular existentes en la BD al formato E.164.

from django.core.management.base import BaseCommand

from usuarios.models import Usuario
from pacientes.models import Paciente
from usuarios.utils import normalizar_celular_ecuador


class Command(BaseCommand):
    help = "Normaliza todos los números de celular en la BD al formato E.164 (+593...)"

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Simula la normalización sin guardar cambios',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        
        if dry_run:
            self.stdout.write(self.style.WARNING("🔍 MODO SIMULACIÓN - No se guardarán cambios\n"))
        else:
            self.stdout.write(self.style.WARNING("⚠️  MODO REAL - Se actualizarán los registros\n"))
        
        self.stdout.write("=" * 70)
        self.stdout.write("📱 NORMALIZANDO CELULARES DE USUARIOS")
        self.stdout.write("=" * 70 + "\n")
        
        usuarios_actualizados = 0
        usuarios_sin_cambios = 0
        usuarios_sin_celular = 0
        
        for usuario in Usuario.objects.all():
            if not usuario.celular:
                usuarios_sin_celular += 1
                continue
            
            celular_original = usuario.celular
            celular_normalizado = normalizar_celular_ecuador(celular_original)
            
            if celular_normalizado and celular_normalizado != celular_original:
                self.stdout.write(
                    f"  Usuario {usuario.id_usuario} ({usuario.primer_nombre} {usuario.primer_apellido}): "
                    f"{celular_original} → {celular_normalizado}"
                )
                
                if not dry_run:
                    usuario.celular = celular_normalizado
                    usuario.save(update_fields=['celular', 'updated_at'])
                
                usuarios_actualizados += 1
            else:
                usuarios_sin_cambios += 1
        
        self.stdout.write("\n" + "=" * 70)
        self.stdout.write("📱 NORMALIZANDO CELULARES DE CONTACTOS DE EMERGENCIA")
        self.stdout.write("=" * 70 + "\n")
        
        pacientes_actualizados = 0
        pacientes_sin_cambios = 0
        
        for paciente in Paciente.objects.all():
            if not paciente.contacto_emergencia_cel:
                continue
            
            celular_original = paciente.contacto_emergencia_cel
            celular_normalizado = normalizar_celular_ecuador(celular_original)
            
            if celular_normalizado and celular_normalizado != celular_original:
                self.stdout.write(
                    f"  Paciente {paciente.id_paciente} (contacto: {paciente.contacto_emergencia_nom}): "
                    f"{celular_original} → {celular_normalizado}"
                )
                
                if not dry_run:
                    paciente.contacto_emergencia_cel = celular_normalizado
                    paciente.save(update_fields=['contacto_emergencia_cel', 'updated_at'])
                
                pacientes_actualizados += 1
            else:
                pacientes_sin_cambios += 1
        
        # Resumen
        self.stdout.write("\n" + "=" * 70)
        self.stdout.write("📊 RESUMEN")
        self.stdout.write("=" * 70)
        self.stdout.write(f"\n👤 USUARIOS:")
        self.stdout.write(f"   ✅ Actualizados: {usuarios_actualizados}")
        self.stdout.write(f"   ⏭️  Sin cambios: {usuarios_sin_cambios}")
        self.stdout.write(f"   ⚪ Sin celular: {usuarios_sin_celular}")
        
        self.stdout.write(f"\n🏥 PACIENTES (contactos de emergencia):")
        self.stdout.write(f"   ✅ Actualizados: {pacientes_actualizados}")
        self.stdout.write(f"   ⏭️  Sin cambios: {pacientes_sin_cambios}")
        
        if dry_run:
            self.stdout.write(self.style.WARNING(
                "\n⚠️  Esto fue una SIMULACIÓN. Ejecuta sin --dry-run para aplicar los cambios."
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"\n✅ Proceso completado. {usuarios_actualizados + pacientes_actualizados} números normalizados."
            ))
