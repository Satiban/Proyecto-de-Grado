// src/pages/login.tsx
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { login as loginApi, getProfile, getRolesActivos } from "../api/auth";
import { rolId, homeByRole } from "../utils/roles";
import StarBorder from "../components/StarBorder";
import logoUrl from "../assets/belladent-logo5.png";
import toothImg from "../assets/diente-login.png";

export default function LoginPage() {
  const [cedula, setCedula] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [mostrarPass, setMostrarPass] = useState(false);
  const [recordarme, setRecordarme] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { setUsuario } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const resultado = await loginApi(cedula, contrasena);
      
      // Si no fue exitoso, mostrar mensaje de error personalizado
      if (!resultado.success) {
        // Cuenta DESACTIVADA (20+ intentos) - Requiere admin
        if (resultado.desactivada || resultado.requiereAdmin) {
          setError(
            `⛔ Tu cuenta ha sido desactivada por múltiples intentos fallidos. Por favor, comunícate con el consultorio para restablecerla.`
          );
        }
        // Cuenta BLOQUEADA temporalmente (5-19 intentos)
        else if (resultado.bloqueado && resultado.minutosRestantes) {
          const minutos = resultado.minutosRestantes;
          const horaEstimada = new Date(Date.now() + minutos * 60000);
          const horaFormato = horaEstimada.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
          
          if (minutos >= 60) {
            const horas = Math.floor(minutos / 60);
            setError(
              `🔒 Cuenta bloqueada por ${horas} hora${horas > 1 ? 's' : ''}. Podrás intentar nuevamente a las ${horaFormato} aproximadamente.`
            );
          } else {
            setError(
              `🔒 Cuenta bloqueada temporalmente. Podrás intentar nuevamente en ${minutos} minuto${minutos > 1 ? 's' : ''} (aprox. ${horaFormato}).`
            );
          }
        }
        // Advertencia con intentos restantes (1-4 intentos)
        else if (resultado.intentosRestantes !== undefined) {
          const intentos = resultado.intentosRestantes;
          if (intentos > 1) {
            setError(`❌ Credenciales incorrectas. Te quedan ${intentos} intentos antes del bloqueo temporal.`);
          } else if (intentos === 1) {
            setError(`⚠️ Credenciales incorrectas. Te queda 1 intento antes del bloqueo temporal de 15 minutos.`);
          } else {
            setError(`❌ ${resultado.mensaje || 'Credenciales incorrectas'}`);
          }
        }
        // Error genérico
        else {
          setError(resultado.mensaje || "Credenciales incorrectas o error de conexión.");
        }
        setLoading(false);
        return;
      }
      
      // Login exitoso
      const { access, refresh } = resultado.data;
      const store = recordarme ? localStorage : sessionStorage;
      store.setItem("accessToken", access);
      store.setItem("refreshToken", refresh);
      localStorage.setItem("tokenStore", recordarme ? "local" : "session");

      const usuario = await getProfile();
      setUsuario(usuario);
      
      // Guardar userId para consultas posteriores
      localStorage.setItem("userId", String(usuario.id_usuario));
      
      // LIMPIAR contexto activo previo (importante para evitar conflictos)
      localStorage.removeItem("contexto_activo");
      localStorage.removeItem("id_paciente");
      localStorage.removeItem("id_odontologo");
      
      // Verificar roles activos
      try {
        const rolesActivos = await getRolesActivos(usuario.id_usuario);
        
        // Detectar roles activos
        const esOdontologoActivo = rolesActivos.es_odontologo && rolesActivos.odontologo_activo !== false;
        const esAdminActivo = rolesActivos.es_admin === true || rolesActivos.admin_activo === true;
        
        // Contar roles activos
        const cantidadRoles = [
          rolesActivos.es_paciente,
          esOdontologoActivo,
          esAdminActivo
        ].filter(Boolean).length;
        
        // Si tiene 2 o más roles activos, ir a selector
        if (cantidadRoles >= 2) {
          navigate("/role-selector", { replace: true });
          return;
        }
        
        // Si solo tiene UN rol activo, redirigir directamente
        if (esAdminActivo && !rolesActivos.es_paciente && !esOdontologoActivo) {
          // SOLO admin
          navigate("/admin", { replace: true });
          return;
        }
        
        if (esOdontologoActivo && !rolesActivos.es_paciente && !esAdminActivo) {
          // SOLO odontólogo
          localStorage.setItem("contexto_activo", "odontologo");
          localStorage.setItem("id_odontologo", String(rolesActivos.id_odontologo));
          navigate("/odontologo", { replace: true });
          return;
        }
        
        if (rolesActivos.es_paciente && !esOdontologoActivo && !esAdminActivo) {
          // SOLO paciente
          localStorage.setItem("contexto_activo", "paciente");
          localStorage.setItem("id_paciente", String(rolesActivos.id_paciente));
          navigate("/paciente", { replace: true });
          return;
        }
      } catch (rolesError) {
        console.error("Error al obtener roles activos:", rolesError);
        // Si falla, usar lógica tradicional por rol principal
      }
      
      // Fallback: usar rol principal (para admins, etc.)
      const idRol = rolId(usuario?.id_rol);
      navigate(homeByRole(idRol, usuario?.is_superuser), { replace: true });
    } catch (err) {
      console.error("Error inesperado en login:", err);
      setError("Error inesperado. Por favor intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      {/* === Panel izquierdo === */}
      <div className="relative flex items-center justify-center px-8 py-10 overflow-hidden bg-gradient-to-tl from-[#DEF2FF] via-[#FAFDFF] to-[#ffffff]">
        {/* Logo */}
        <div className="fixed lg:absolute left-4 top-4 lg:left-8 lg:top-6 z-20">
          <img src={logoUrl} alt="OralFlow" className="h-33 w-auto" />
        </div>

        {/* === Card con StarBorder === */}
        <div className="w-full max-w-md mt-28 lg:mt-24 relative">
          <StarBorder
            color="#0070B7"
            speed="6s"
            thickness={1}
            className="w-full shadow-xl"
          >
            <div className="p-8">
              <div className="mb-6 text-center">
                <p className="text-gray-700">Bienvenido</p>
                <h1 className="text-3xl font-semibold text-gray-900">
                  Iniciar Sesión
                </h1>
              </div>

              {error && (
                <div 
                  className={`mb-4 rounded-lg border px-3 py-3 text-sm ${
                    error.includes('⛔') 
                      ? 'border-red-300 bg-red-100 text-red-800'
                      : error.includes('🔒')
                      ? 'border-amber-300 bg-amber-100 text-amber-800'
                      : error.includes('⚠️')
                      ? 'border-orange-300 bg-orange-100 text-orange-800'
                      : 'border-red-200 bg-red-50 text-red-700'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 mt-0.5">
                      {error.includes('⛔') ? '⛔' : error.includes('🔒') ? '🔒' : error.includes('⚠️') ? '⚠️' : '❌'}
                    </span>
                    <span className="flex-1">{error.replace(/^[⛔🔒⚠️❌]\s*/, '')}</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                {/* Campo cédula */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Cédula
                  </label>
                  <input
                    type="text"
                    value={cedula}
                    onChange={(e) => {
                      const valor = e.target.value.replace(/\D/g, "");
                      if (valor.length <= 10) setCedula(valor);
                    }}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#0070B7]"
                    placeholder="1234567890"
                    required
                    maxLength={10}
                    autoComplete="username"
                  />
                  {cedula && cedula.length !== 10 && (
                    <p className="mt-1 text-xs text-red-600">
                      La cédula debe tener 10 dígitos
                    </p>
                  )}
                </div>

                {/* Campo contraseña */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={mostrarPass ? "text" : "password"}
                      value={contrasena}
                      onChange={(e) => setContrasena(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 pr-12 focus:outline-none focus:ring-2 focus:ring-[#0070B7]"
                      placeholder="••••••••"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarPass((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-800 focus:outline-none"
                      title={
                        mostrarPass
                          ? "Ocultar contraseña"
                          : "Mostrar contraseña"
                      }
                    >
                      {mostrarPass ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Recordarme / Olvidé contraseña */}
                <div className="flex items-center justify-between">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-[#0070B7] focus:ring-[#0070B7]"
                      checked={recordarme}
                      onChange={(e) => setRecordarme(e.target.checked)}
                    />
                    Recordarme
                  </label>

                  <Link
                    to="/forgot-password"
                    className="text-sm text-[#0070B7] hover:underline"
                  >
                    Olvidé mi contraseña
                  </Link>
                </div>

                {/* Botón */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-[#0070B7] py-2 font-medium text-white hover:bg-[#005f96] focus:outline-none focus:ring-2 focus:ring-[#0070B7] disabled:opacity-70"
                >
                  {loading ? "Ingresando..." : "Iniciar Sesión"}
                </button>

                {/* Enlace de registro */}
                <p className="mt-2 text-center text-sm text-gray-600">
                  ¿No tienes cuenta?{" "}
                  <Link
                    to="/registro-paciente"
                    className="text-[#0070B7] hover:underline"
                  >
                    Regístrate
                  </Link>
                </p>
              </form>
            </div>
          </StarBorder>
        </div>
      </div>

      {/* === Panel derecho === */}
      <div className="hidden lg:block" aria-hidden="true">
        <div
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${toothImg})` }}
        />
      </div>
    </div>
  );
}