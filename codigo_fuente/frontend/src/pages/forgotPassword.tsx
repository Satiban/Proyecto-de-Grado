// src/pages/forgotPassword.tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { publicApi } from "../api/publicApi";
import logoUrl from "../assets/oralflow-logo.png";
import toothImg from "../assets/diente-login.png";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await publicApi.post("/auth/password-reset/request/", { email: email.trim().toLowerCase() });
      setSent(true);
    } catch {
      setError("Hubo un problema al enviar el correo. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  // Vista de éxito
  if (sent) {
    return (
      <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
        {/* Panel izquierdo */}
        <div className="relative flex items-center justify-center px-8 py-10">
          <div className="fixed lg:absolute left-4 top-4 lg:left-8 lg:top-6 z-20">
            <img src={logoUrl} alt="OralFlow" className="h-16 w-auto" />
          </div>

          <div className="w-full max-w-md mt-28 lg:mt-24">
            <div className="rounded-2xl shadow-lg border border-gray-100 p-6 bg-white">
              <h1 className="text-2xl font-semibold text-gray-900 text-center">
                Correo enviado
              </h1>
              <p className="text-gray-600 mt-3 text-center">
                Si el correo existe en nuestro sistema, recibirás un enlace para
                restablecer tu contraseña.
              </p>
              <p className="text-gray-500 mt-3 text-sm text-center">
                Si los problemas persisten o no te llega el correo, por favor
                comunícate con el consultorio.
              </p>

              <button
                onClick={() => navigate("/login", { replace: true })}
                className="mt-6 w-full rounded-lg bg-[#0070B7] py-2 font-medium text-white hover:bg-[#005f96] focus:outline-none focus:ring-2 focus:ring-[#0070B7]"
              >
                Volver al inicio de sesión
              </button>
            </div>
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

  // Vista del formulario
  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      {/* Panel izquierdo */}
      <div className="relative flex items-center justify-center px-8 py-10">
        <div className="fixed lg:absolute left-4 top-4 lg:left-8 lg:top-6 z-20">
          <img src={logoUrl} alt="OralFlow" className="h-16 w-auto" />
        </div>

        <div className="w-full max-w-md mt-28 lg:mt-24">
          <div className="mb-6 text-center">
            <p className="text-gray-500">¿No puedes iniciar sesión?</p>
            <h1 className="text-3xl font-semibold text-gray-900">
              Recuperar contraseña
            </h1>
          </div>

          <div className="rounded-2xl shadow-lg border border-gray-100 p-6 bg-white">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#0070B7]"
                  placeholder="tu@email.com"
                  required
                  autoComplete="email"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className="w-1/2 rounded-lg border border-gray-300 bg-white py-2 font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-1/2 rounded-lg bg-[#0070B7] py-2 font-medium text-white hover:bg-[#005f96] focus:outline-none focus:ring-2 focus:ring-[#0070B7] disabled:opacity-70"
                >
                  {loading ? "Enviando..." : "Enviar enlace"}
                </button>
              </div>

              <p className="text-center text-sm text-gray-500">
                ¿Recordaste tu clave?{" "}
                <Link to="/login" className="text-[#0070B7] hover:underline">
                  Inicia sesión
                </Link>
              </p>
            </form>
          </div>
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
