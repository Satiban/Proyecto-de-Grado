// src/pages/login.tsx
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { login as loginApi, getProfile } from "../api/auth";

/* Utils de roles (unificados) */
import { rolId, homeByRole } from "../utils/roles";

import logoUrl from "../assets/oralflow-logo.png";
import toothImg from "../assets/diente-login.png";

export default function LoginPage() {
  const [email, setEmail] = useState("");
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
      // 1) Login → tokens
      const { access, refresh } = await loginApi(email, contrasena);

      // 2) Decide dónde guardar
      const store = recordarme ? localStorage : sessionStorage;
      store.setItem("accessToken", access);
      store.setItem("refreshToken", refresh);

      // 3) Marca ubicación de tokens para api/axios.ts
      localStorage.setItem("tokenStore", recordarme ? "local" : "session");

      // 4) Perfil actual
      const usuario = await getProfile();
      setUsuario(usuario); // AuthContext persistirá en localStorage

      // 5) Navega según rol (robusto)
      const idRol = rolId(usuario?.id_rol);
      navigate(homeByRole(idRol, usuario?.is_superuser), { replace: true });
    } catch {
      setError("Credenciales incorrectas o error de conexión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      {/* Panel izquierdo */}
      <div className="relative flex items-center justify-center px-8 py-10">
        <div className="fixed lg:absolute left-4 top-4 lg:left-8 lg:top-6 z-20">
          <img src={logoUrl} alt="OralFlow" className="h-16 w-auto" />
        </div>

        <div className="w-full max-w-md mt-28 lg:mt-24">
          <div className="mb-6 text-center">
            <p className="text-gray-500">Bienvenido</p>
            <h1 className="text-3xl font-semibold text-gray-900">
              Iniciar Sesión
            </h1>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Correo
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#0070B7]"
                placeholder="correo@ejemplo.com"
                required
                autoComplete="email"
              />
            </div>

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
                  aria-pressed={mostrarPass}
                  aria-label={
                    mostrarPass ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                  title={
                    mostrarPass ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-800 focus:outline-none"
                >
                  {mostrarPass ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

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

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#0070B7] py-2 font-medium text-white hover:bg-[#005f96] focus:outline-none focus:ring-2 focus:ring-[#0070B7] disabled:opacity-70"
            >
              {loading ? "Ingresando..." : "Iniciar Sesión"}
            </button>

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
      </div>

      {/* Panel derecho: imagen */}
      <div className="hidden lg:block" aria-hidden="true">
        <div
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${toothImg})` }}
        />
      </div>
    </div>
  );
}