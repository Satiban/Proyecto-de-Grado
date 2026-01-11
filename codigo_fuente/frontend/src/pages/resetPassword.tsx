// src/pages/resetPassword.tsx
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { publicApi } from "../api/publicApi";
import { Eye, EyeOff } from "lucide-react";
import logoUrl from "../assets/belladent-logo5.png";
import toothImg from "../assets/diente-login.png";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const uid = params.get("uid") || "";
  const token = params.get("token") || "";
  const navigate = useNavigate();

  const [valid, setValid] = useState<boolean | null>(null);
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mostrar/ocultar
  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  // Touched para hints
  const [pwdTouched, setPwdTouched] = useState(false);
  const [pwd2Touched, setPwd2Touched] = useState(false);

  // Reglas de contraseña (mismas del ejemplo)
  const pwdHasMin = pwd1.length >= 8;
  const pwdHasUpper = /[A-Z]/.test(pwd1);
  const pwdHasDigit = /\d/.test(pwd1);
  const pwdStrong = pwdHasMin && pwdHasUpper && pwdHasDigit;
  const pwdMatch = pwd1.length > 0 && pwd2.length > 0 && pwd1 === pwd2;

  // Helpers de color/border (idéntica lógica del ejemplo)
  function hintColor(valid: boolean, touched: boolean, value: string) {
    if (!touched && value.length === 0) return "text-gray-500";
    return valid ? "text-green-600" : "text-red-600";
  }
  function borderForPwdField(valid: boolean, touched: boolean, empty: boolean) {
    if (!touched && empty) return "border-gray-300";
    return valid
      ? "border-green-600 focus:ring-2 focus:ring-green-500"
      : "border-red-500 focus:ring-2 focus:ring-red-500";
  }

  useEffect(() => {
    publicApi
      .post("/auth/password-reset/validate/", { uid, token })
      .then(() => setValid(true))
      .catch(() => setValid(false));
  }, [uid, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Forzar touched para mostrar ayudas si intenta enviar vacío
    if (!pwdTouched) setPwdTouched(true);
    if (!pwd2Touched) setPwd2Touched(true);

    // Validaciones locales
    if (!pwdStrong) {
      setError("La contraseña aún no cumple los requisitos.");
      return;
    }
    if (!pwdMatch) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await publicApi.post("/auth/password-reset/confirm/", {
        uid,
        token,
        new_password: pwd1,
      });
      setDone(true);
    } catch (err: any) {
      const data = err?.response?.data;
      let msg = "El enlace es inválido/expiró o la contraseña no es válida.";
      if (typeof data === "string") msg = data;
      else if (data?.detail) msg = data.detail;
      else if (data?.new_password?.length) {
        // Si el mensaje es sobre contraseña anterior, mostrarlo claramente
        const passwordErrors = data.new_password.join(" ");
        if (passwordErrors.includes("contraseña anterior")) {
          msg = "Por seguridad, no puedes usar tu contraseña anterior. Elige una contraseña diferente.";
        } else {
          msg = passwordErrors;
        }
      }
      else if (data?.token?.length) msg = data.token.join(" ");
      else if (data?.uid?.length) msg = data.uid.join(" ");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Distintos estados
  if (valid === null) {
    return (
      <div className="min-h-screen grid place-items-center">
        <p className="text-gray-600">Verificando enlace…</p>
      </div>
    );
  }

  if (!valid) {
    return (
      <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
        <div className="relative flex items-center justify-center px-8 py-10">
          <div className="fixed lg:absolute left-4 top-4 lg:left-8 lg:top-6 z-20">
            <img src={logoUrl} alt="OralFlow" className="h-25 w-auto" />
          </div>
          <div className="w-full max-w-md mt-28 lg:mt-24">
            <div className="rounded-2xl shadow-lg border border-gray-100 p-6 bg-white text-center">
              <h1 className="text-2xl font-semibold text-gray-900">
                Enlace inválido o expirado
              </h1>
              <p className="text-gray-600 mt-3">
                Solicita nuevamente el restablecimiento de contraseña.
              </p>
              <button
                onClick={() => navigate("/forgot-password")}
                className="mt-6 w-full rounded-lg bg-[#0070B7] py-2 font-medium text-white hover:bg-[#005f96]"
              >
                Volver a recuperar contraseña
              </button>
            </div>
          </div>
        </div>
        <div className="hidden lg:block" aria-hidden="true">
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${toothImg})` }}
          />
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
        <div className="relative flex items-center justify-center px-8 py-10">
          <div className="fixed lg:absolute left-4 top-4 lg:left-8 lg:top-6 z-20">
            <img src={logoUrl} alt="OralFlow" className="h-16 w-auto" />
          </div>
          <div className="w-full max-w-md mt-28 lg:mt-24">
            <div className="rounded-2xl shadow-lg border border-gray-100 p-6 bg-white text-center">
              <h1 className="text-2xl font-semibold text-gray-900">
                Contraseña actualizada
              </h1>
              <p className="text-gray-600 mt-3">
                Ya puedes iniciar sesión con tu nueva contraseña.
              </p>
              <button
                onClick={() => navigate("/login", { replace: true })}
                className="mt-6 w-full rounded-lg bg-[#0070B7] py-2 font-medium text-white hover:bg-[#005f96]"
              >
                Ir al inicio de sesión
              </button>
            </div>
          </div>
        </div>
        <div className="hidden lg:block" aria-hidden="true">
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${toothImg})` }}
          />
        </div>
      </div>
    );
  }

  // Formulario principal
  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      {/* Panel izquierdo */}
      <div className="relative flex items-center justify-center px-8 py-10">
        <div className="fixed lg:absolute left-4 top-4 lg:left-8 lg:top-6 z-20">
          <img src={logoUrl} alt="OralFlow" className="h-16 w-auto" />
        </div>

        <div className="w-full max-w-md mt-28 lg:mt-24">
          <div className="mb-6 text-center">
            <p className="text-gray-500">Estás a un paso</p>
            <h1 className="text-3xl font-semibold text-gray-900">
              Nueva contraseña
            </h1>
          </div>

          <div className="rounded-2xl shadow-lg border border-gray-100 p-6 bg-white">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Contraseña */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPass1 ? "text" : "password"}
                    value={pwd1}
                    onChange={(e) => {
                      setPwd1(e.target.value);
                      if (!pwdTouched) setPwdTouched(true);
                    }}
                    onFocus={() => setPwdTouched(true)}
                    className={`w-full rounded-lg border px-4 py-2 pr-12 ${borderForPwdField(
                      pwdStrong,
                      pwdTouched,
                      pwd1.length === 0
                    )}`}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass1((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    aria-label={
                      showPass1 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                    title={
                      showPass1 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    {showPass1 ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>

                {/* Criterios en vivo */}
                <ul className="mt-2 text-xs space-y-1">
                  <li className={hintColor(pwdHasMin, pwdTouched, pwd1)}>
                    • Mínimo 8 caracteres
                  </li>
                  <li className={hintColor(pwdHasUpper, pwdTouched, pwd1)}>
                    • Al menos 1 mayúscula (A–Z)
                  </li>
                  <li className={hintColor(pwdHasDigit, pwdTouched, pwd1)}>
                    • Al menos 1 número (0–9)
                  </li>
                </ul>

                {/* Estado global */}
                <p
                  className={`mt-1 text-xs ${
                    !pwdTouched && pwd1.length === 0
                      ? "text-gray-500"
                      : pwdStrong
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {!pwdTouched &&
                    pwd1.length === 0 &&
                    "Escribe una contraseña que cumpla los requisitos."}
                  {pwdTouched &&
                    !pwdStrong &&
                    "La contraseña aún no cumple los requisitos."}
                  {pwdTouched &&
                    pwdStrong &&
                    "La contraseña cumple con el formato requerido."}
                </p>
              </div>

              {/* Repetir contraseña */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Repetir contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPass2 ? "text" : "password"}
                    value={pwd2}
                    onChange={(e) => {
                      setPwd2(e.target.value);
                      if (!pwd2Touched) setPwd2Touched(true);
                    }}
                    onFocus={() => setPwd2Touched(true)}
                    className={`w-full rounded-lg border px-4 py-2 pr-12 ${borderForPwdField(
                      pwdMatch,
                      pwd2Touched,
                      pwd2.length === 0
                    )}`}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass2((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    aria-label={
                      showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                    title={
                      showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    {showPass2 ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>

                {/* Coincidencia en vivo */}
                <p
                  className={`mt-1 text-xs ${
                    !pwd2Touched && pwd2.length === 0
                      ? "text-gray-500"
                      : pwdMatch
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {!pwd2Touched &&
                    pwd2.length === 0 &&
                    "Vuelve a escribir la contraseña."}
                  {pwd2Touched && !pwdMatch && "Las contraseñas no coinciden."}
                  {pwd2Touched && pwdMatch && "Ambas contraseñas coinciden."}
                </p>
              </div>

              {/* Error global del submit */}
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
                  {loading ? "Guardando..." : "Guardar contraseña"}
                </button>
              </div>

              <p className="text-center text-sm text-gray-500">
                ¿Ya tienes tu contraseña?{" "}
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
