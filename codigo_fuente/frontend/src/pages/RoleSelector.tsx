// src/pages/RoleSelector.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, Stethoscope, ArrowRight, Loader2, Shield } from "lucide-react";
import { getRolesActivos } from "../api/auth";
import logoUrl from "../assets/belladent-logo5.png";

type RolesActivos = {
  id_usuario: number;
  email: string;
  rol_principal: number;
  rol_principal_nombre: string;
  es_paciente: boolean;
  es_odontologo: boolean;
  id_paciente: number | null;
  id_odontologo: number | null;
  odontologo_activo?: boolean;
  es_admin?: boolean;
  admin_activo?: boolean;
};

export default function RoleSelector() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<RolesActivos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      navigate("/login");
      return;
    }

    (async () => {
      try {
        setLoading(true);
        const data = await getRolesActivos(Number(userId));
        setRoles(data);

        // Determinar roles ACTIVOS disponibles
        const esOdontologoActivo = data.es_odontologo && data.odontologo_activo !== false;
        const esAdminActivo = data.es_admin === true || data.admin_activo === true;
        
        // Contar cuántos roles activos tiene (considerando admin como rol adicional)
        const rolesActivos = [
          data.es_paciente,
          esOdontologoActivo,
          esAdminActivo
        ].filter(Boolean).length;
        
        if (rolesActivos <= 1) {
          // Solo tiene un rol activo, redirigir automáticamente
          if (esAdminActivo && !data.es_paciente && !esOdontologoActivo) {
            // SOLO es admin
            navigate("/admin");
          } else if (esOdontologoActivo && !data.es_paciente && !esAdminActivo) {
            // SOLO es odontólogo activo
            localStorage.setItem("contexto_activo", "odontologo");
            localStorage.setItem("id_odontologo", String(data.id_odontologo));
            localStorage.setItem("odontologo_activo", "true");
            navigate("/odontologo");
          } else if (data.es_paciente && !esOdontologoActivo && !esAdminActivo) {
            // SOLO es paciente
            localStorage.setItem("contexto_activo", "paciente");
            localStorage.setItem("id_paciente", String(data.id_paciente));
            navigate("/paciente");
          } else {
            // No tiene ningún rol adicional activo, usar el rol principal
            handleRoleRedirect(data.rol_principal);
          }
        }
        // Si rolesActivos > 1, no hace nada aquí y muestra el selector más abajo
      } catch (err) {
        console.error("Error al obtener roles activos:", err);
        setError("No se pudieron cargar los roles disponibles.");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  const handleRoleRedirect = (roleId: number) => {
    switch (roleId) {
      case 1: // Admin
        navigate("/admin");
        break;
      case 2: // Paciente
        navigate("/paciente");
        break;
      case 3: // Odontólogo
        navigate("/odontologo");
        break;
      case 4: // Admin clínico
        navigate("/admin");
        break;
      default:
        setError("Rol no reconocido.");
    }
  };

  const seleccionarRol = (tipo: "paciente" | "odontologo" | "admin") => {
    if (!roles) return;

    // Guardar el contexto seleccionado
    localStorage.setItem("contexto_activo", tipo);
    
    if (tipo === "paciente") {
      localStorage.setItem("id_paciente", String(roles.id_paciente));
      navigate("/paciente");
    } else if (tipo === "odontologo") {
      localStorage.setItem("id_odontologo", String(roles.id_odontologo));
      // Guardar el estado activo del odontólogo
      localStorage.setItem("odontologo_activo", String(roles.odontologo_activo !== false));
      navigate("/odontologo");
    } else if (tipo === "admin") {
      // Guardar info de admin
      localStorage.setItem("id_usuario", String(roles.id_usuario));
      navigate("/admin");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Cargando roles disponibles...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-red-600 mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate("/login")}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Volver al login
          </button>
        </div>
      </div>
    );
  }

  // Verificar roles ACTIVOS disponibles
  const esOdontologoActivo = roles?.es_odontologo && roles?.odontologo_activo !== false;
  const tienePaciente = roles?.es_paciente;
  const esAdminActivo = roles?.es_admin === true || roles?.admin_activo === true;
  
  // Contar roles activos disponibles para mostrar selector
  const rolesDisponibles = [tienePaciente, esOdontologoActivo, esAdminActivo].filter(Boolean).length;
  
  if (!roles || rolesDisponibles === 0) {
    return null; // Ya se redirigió automáticamente
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      {/* Logo en la esquina superior izquierda */}
      <div className="fixed left-4 top-4 lg:left-8 lg:top-6 z-20">
        <img src={logoUrl} alt="OralFlow" className="h-33 w-auto" />
      </div>

      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Selecciona tu rol
          </h1>
          <p className="text-gray-600">
            Tienes acceso a múltiples perfiles. ¿Cómo deseas ingresar hoy?
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Conectado como: <span className="font-medium">{roles.email}</span>
          </p>
        </div>

        {/* Tarjetas de roles */}
        <div className={`grid gap-6 ${rolesDisponibles === 3 ? 'grid-cols-1 md:grid-cols-3' : rolesDisponibles === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
          {/* Tarjeta Admin (solo si es admin activo) */}
          {esAdminActivo && (
            <button
              onClick={() => seleccionarRol("admin")}
              className="group relative overflow-hidden rounded-xl border-2 border-gray-200 bg-white p-8 text-left transition-all hover:border-purple-500 hover:shadow-xl hover:-translate-y-1"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-100 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150" />
              
              <div className="relative z-10">
                <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 text-purple-600">
                  <Shield className="h-8 w-8" />
                </div>
                
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Administrador
                </h3>
                
                <p className="text-gray-600 mb-6">
                  Gestiona usuarios, configura el sistema y supervisa todas las operaciones.
                </p>
                
                <div className="flex items-center text-purple-600 font-medium group-hover:gap-3 transition-all">
                  Continuar como administrador
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </button>
          )}

          {/* Tarjeta Paciente */}
          {tienePaciente && (
            <button
              onClick={() => seleccionarRol("paciente")}
              className="group relative overflow-hidden rounded-xl border-2 border-gray-200 bg-white p-8 text-left transition-all hover:border-blue-500 hover:shadow-xl hover:-translate-y-1"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150" />
              
              <div className="relative z-10">
                <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 text-blue-600">
                  <User className="h-8 w-8" />
                </div>
                
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Paciente
                </h3>
                
                <p className="text-gray-600 mb-6">
                  Agenda citas, consulta tu historial médico y gestiona tus datos personales.
                </p>
                
                <div className="flex items-center text-blue-600 font-medium group-hover:gap-3 transition-all">
                  Continuar como paciente
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </button>
          )}

          {/* Tarjeta Odontólogo (solo si está activo) */}
          {esOdontologoActivo && (
            <button
              onClick={() => seleccionarRol("odontologo")}
              className="group relative overflow-hidden rounded-xl border-2 border-gray-200 bg-white p-8 text-left transition-all hover:border-green-500 hover:shadow-xl hover:-translate-y-1"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-green-100 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150" />
              
              <div className="relative z-10">
                <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600">
                  <Stethoscope className="h-8 w-8" />
                </div>
                
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Odontólogo
                </h3>
                
                <p className="text-gray-600 mb-6">
                  Gestiona tu agenda, atiende pacientes y administra tu práctica profesional.
                </p>
                
                <div className="flex items-center text-green-600 font-medium group-hover:gap-3 transition-all">
                  Continuar como odontólogo
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <button
            onClick={() => {
              localStorage.clear();
              navigate("/login");
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
