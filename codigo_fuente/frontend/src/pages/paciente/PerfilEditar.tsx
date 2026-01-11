// src/pages/paciente/PerfilEditar.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/axios";
import { Info, Eye, EyeOff } from "lucide-react";
import { e164ToLocal, localToE164 } from "../../utils/phoneFormat";
import { useFotoPerfil } from "../../hooks/useFotoPerfil";

/* =========================
    Tipos mínimos
========================= */
type Paciente = {
  id_paciente: number;
  id_usuario: number;
  contacto_emergencia_nom?: string | null;
  contacto_emergencia_cel?: string | null;
  contacto_emergencia_par?: string | null;
};

type Usuario = {
  id_usuario: number;
  foto?: string | null;
  password?: string;
  password_confirm?: string;
};

type Toast = { id: number; message: string; type?: "success" | "error" };

const PARENTESCOS = [
  "hijos",
  "padres",
  "hermanos",
  "abuelos",
  "esposos",
  "otros",
] as const;

/* =========================
    Utils
========================= */
function absolutize(url?: string | null) {
  if (!url) return null;
  try {
    new URL(url);
    return url;
  } catch {
    const base = (api.defaults as any)?.baseURL ?? "";
    let origin = "";
    try {
      origin = new URL(base).origin;
    } catch {
      origin = window.location.origin;
    }
    return `${origin.replace(/\/$/, "")}/${String(url).replace(/^\//, "")}`;
  }
}
function fullNameTwoWords(name: string): boolean {
  return /^\s*\S+\s+\S+(\s+\S+)*\s*$/.test(name);
}

/* =========================
    Toast
========================= */
function ToastView({
  items,
}: {
  items: Toast[];
  remove: (id: number) => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg px-4 py-2 shadow-md text-sm text-white ${
            t.type === "error" ? "bg-red-600" : "bg-green-600"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* =========================
    Componente
========================= */
export default function PerfilEditar() {
  const navigate = useNavigate();
  const { usuario: usuarioCtx } = useAuth();
  const { subirFoto, eliminarFoto } = useFotoPerfil();

  // Fallback por si el contexto aún no está poblado
  const usuarioStorage = useMemo(() => {
    try {
      const raw = localStorage.getItem("usuario");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const ctx = (usuarioCtx || usuarioStorage || {}) as Partial<{
    id_usuario: number;
  }>;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);

  const [pac, setPac] = useState<Paciente | null>(null);
  const [user, setUser] = useState<Usuario | null>(null);

  // Foto
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoRemove, setFotoRemove] = useState<boolean>(false);

  // Password live UI
  const [showPw1, setShowPw1] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [pwdTouched, setPwdTouched] = useState(false);
  const [pwd2Touched, setPwd2Touched] = useState(false);

  // Errores
  type Errors = Partial<
    Record<
      | "password"
      | "password_confirm"
      | "contacto_emergencia_nom"
      | "contacto_emergencia_cel"
      | "contacto_emergencia_par",
      string
    >
  >;
  const [errors, setErrors] = useState<Errors>({});

  const pushToast = (
    message: string,
    type: "success" | "error" = "success"
  ) => {
    const id = Date.now() + Math.random();
    setToasts((s) => [...s, { id, message, type }]);
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), 2400);
  };
  const removeToast = (id: number) =>
    setToasts((s) => s.filter((x) => x.id !== id));

  /* =========================
      Carga inicial
  ========================== */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // 1) Resolver el paciente del usuario autenticado
        let pacRes = await api.get(`/pacientes/`);
        let lista = Array.isArray(pacRes.data)
          ? pacRes.data
          : pacRes.data?.results ?? [];
        let p: Paciente | null = lista?.[0] ?? null;

        // Fallback por id_usuario si es necesario
        if (!p && ctx.id_usuario) {
          const r = await api.get(`/pacientes/`, {
            params: { id_usuario: ctx.id_usuario },
          });
          const l = Array.isArray(r.data) ? r.data : r.data?.results ?? [];
          p = l?.[0] ?? null;
        }

        if (!alive) return;
        if (!p) throw new Error("No se encontró el perfil de paciente.");

        // Normalizar ANTES de setPac
        const pNorm: Paciente = {
          ...p,
          contacto_emergencia_cel: e164ToLocal(p.contacto_emergencia_cel ?? ""),
          contacto_emergencia_par: (
            p.contacto_emergencia_par || ""
          ).toLowerCase(),
        };

        setPac(pNorm);

        // 2) Cargar usuario
        const usrRes = await api.get(`/usuarios/${p.id_usuario}/`);
        const u = usrRes.data as Usuario;
        u.foto = absolutize(u.foto);

        if (!alive) return;
        setUser(u);
      } catch (e) {
        console.error(e);
        if (alive) setError("No se pudo cargar la información para edición.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [ctx.id_usuario]);

  /* ======= Preview de foto seleccionada ======= */
  useEffect(() => {
    if (!fotoFile) {
      setFotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(fotoFile);
    setFotoPreview(url);
    setFotoRemove(false); // si sube nueva foto, ya no está marcada para eliminar
    return () => URL.revokeObjectURL(url);
  }, [fotoFile]);

  /* =========================
      Validaciones
  ========================== */
  const inputClass = (field?: keyof Errors) =>
    `w-full min-w-0 rounded-lg border px-3 py-2 ${
      field && errors[field]
        ? "border-red-500 focus:ring-2 focus:ring-red-500"
        : "border-gray-300"
    }`;

  // Criterios de contraseña (8 caracteres, mayúscula, número)
  const pwd = String(user?.password || "");
  const pwd2 = String(user?.password_confirm || "");

  const pwdHasMin = pwd.length >= 8;
  const pwdHasUpper = /[A-Z]/.test(pwd);
  const pwdHasDigit = /\d/.test(pwd);
  const pwdStrong = pwdHasMin && pwdHasUpper && pwdHasDigit;

  const pwdMatch = pwd.length > 0 && pwd2.length > 0 && pwd === pwd2;

  // Helpers de color/borde para UX
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

  const validateBeforeSave = (): boolean => {
    if (!user || !pac) return false;
    const newErrors: Errors = {};

    // Password - 8 caracteres, mayúscula y número
    const password = String(user.password || "").trim();
    const password_confirm = String(user.password_confirm || "").trim();
    if (password || password_confirm) {
      if (password.length < 8) newErrors.password = "Mínimo 8 caracteres.";
      if (!/[A-Z]/.test(password))
        newErrors.password = "Debe tener al menos una mayúscula.";
      if (!/\d/.test(password))
        newErrors.password = "Debe tener al menos un número.";
      if (password !== password_confirm)
        newErrors.password_confirm = "No coincide.";
    }

    // Contacto de emergencia
    const enom = String(pac.contacto_emergencia_nom || "");
    const ecel = String(pac.contacto_emergencia_cel || "");
    const epar = String(pac.contacto_emergencia_par || "");
    if (!fullNameTwoWords(enom))
      newErrors.contacto_emergencia_nom = "Nombre y apellido.";
    if (!/^09\d{8}$/.test(ecel))
      newErrors.contacto_emergencia_cel = "09xxxxxxxx.";
    if (!epar) newErrors.contacto_emergencia_par = "Selecciona parentesco.";

    setErrors(newErrors);
    if (Object.keys(newErrors).length) {
      pushToast("Corrige los campos marcados.", "error");
      return false;
    }
    return true;
  };

  /* =========================
      Guardar
  ========================== */
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !pac) return;
    if (!validateBeforeSave()) return;

    try {
      setSaving(true);
      setError(null);

      /* ======================
        1) Cambiar contraseña
       ====================== */
      const password = String(user.password || "").trim();
      if (password) {
        await api.patch(`/usuarios/${user.id_usuario}/`, {
          password,
        });

        // Limpio del estado local por seguridad
        setUser((u) =>
          u
            ? {
                ...u,
                password: "",
                password_confirm: "",
              }
            : u
        );
      }

      /* ======================
        2) Foto de perfil (Cloudinary)
       ====================== */
      // Caso A: el usuario subió una NUEVA foto
      if (fotoFile) {
        const secureUrl = await subirFoto(user.id_usuario, fotoFile);
        const abs = absolutize(secureUrl);

        setUser((u) => (u ? { ...u, foto: abs } : u));
        setFotoFile(null);
        setFotoPreview(null);
        setFotoRemove(false);
      }
      // Caso B: el usuario marcó "Quitar foto actual" y NO subió otra
      else if (fotoRemove) {
        await eliminarFoto(user.id_usuario);

        setUser((u) => (u ? { ...u, foto: null } : u));
        setFotoRemove(false);
        setFotoPreview(null);
      }

      /* ======================
        3) Contacto de emergencia
       ====================== */
      await api.patch(`/pacientes/${pac.id_paciente}/`, {
        contacto_emergencia_nom: pac.contacto_emergencia_nom ?? "",
        contacto_emergencia_cel: pac.contacto_emergencia_cel
          ? localToE164(pac.contacto_emergencia_cel)
          : null,
        contacto_emergencia_par: pac.contacto_emergencia_par ?? "",
      });

      /* ======================
        4) Éxito - toast + redirect
       ====================== */
      setShowSuccess(true);
      setTimeout(() => {
        navigate("/paciente/perfil");
      }, 1000);
    } catch (e) {
      console.error(e);
      setError("No se pudo guardar la edición. Intenta nuevamente.");
      pushToast("Error al guardar ❌", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="">
        <p>Cargando…</p>
      </div>
    );
  }
  if (!user || !pac) {
    return (
      <div className="">
        <p className="text-red-600">No se encontró tu perfil para edición.</p>
      </div>
    );
  }

  const displayedPhoto =
    fotoPreview ?? (fotoRemove ? null : user?.foto ?? null);

  return (
    <div className="space-y-6">
      {/* Toast de éxito */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
            <div className="font-semibold">¡Cambios guardados!</div>
            <div className="text-sm text-white/90">
              Redirigiendo a tu perfil…
            </div>
          </div>
        </div>
      )}

      <ToastView items={toasts} remove={removeToast} />

      {/* Header con acciones arriba */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Editar mi perfil</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/paciente/perfil")}
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            disabled={saving}
          >
            Cancelar
          </button>
          {/* Guardar cambios */}
          <button
            type="submit"
            form="perfil-edit-form"
            className="rounded-lg px-4 py-2 text-white disabled:opacity-50 bg-black/80 hover:bg-black"
            disabled={saving || loading}
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        id="perfil-edit-form"
        onSubmit={onSave}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        {/* Columna izquierda */}
        <div className="space-y-6">
          {/* Foto */}
          <div className="rounded-2xl p-4 shadow-md bg-white overflow-hidden">
            <h3 className="text-lg font-bold text-gray-900">Foto</h3>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <div className="aspect-square w-full overflow-hidden rounded-xl bg-gray-50">
                  {displayedPhoto ? (
                    <img
                      src={displayedPhoto}
                      alt="Foto/Previsualización"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
                      Sin foto
                    </div>
                  )}
                </div>
              </div>
              <div className="col-span-2 min-w-0 space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFotoFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm rounded-lg border px-3 py-2 file:mr-4 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:bg-gray-800 file:text-white hover:file:bg-black/80"
                />
                <p className="text-xs text-gray-500">
                  Formatos comunes (JPG/PNG). Opcional.
                </p>

                <div className="flex flex-wrap gap-2">
                  {fotoFile && (
                    <button
                      type="button"
                      className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                      onClick={() => {
                        setFotoFile(null);
                        setFotoPreview(null);
                      }}
                    >
                      Quitar selección
                    </button>
                  )}

                  <button
                    type="button"
                    className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                    onClick={() => {
                      setFotoRemove(true);
                      setFotoFile(null);
                      setFotoPreview(null);
                    }}
                    disabled={!user?.foto && !displayedPhoto}
                    title={
                      user?.foto ? "Eliminar foto actual" : "No hay foto actual"
                    }
                  >
                    Quitar foto actual
                  </button>

                  {fotoRemove && !fotoFile && (
                    <span className="text-xs text-red-600 self-center">
                      Foto marcada para eliminar
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Contraseña */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <h3 className="text-lg font-bold text-gray-900">
              Cambiar contraseña
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">
                  Nueva contraseña (opcional)
                </label>
                <div className="relative">
                  <input
                    type={showPw1 ? "text" : "password"}
                    value={String(user.password || "")}
                    onChange={(e) => {
                      setUser((u) =>
                        u ? { ...u, password: e.target.value } : u
                      );
                      if (!pwdTouched) setPwdTouched(true);
                    }}
                    onFocus={() => setPwdTouched(true)}
                    className={`w-full min-w-0 rounded-lg border px-3 py-2 pr-10 ${borderForPwdField(
                      pwdStrong,
                      pwdTouched,
                      pwd.length === 0
                    )}`}
                    placeholder="Deja en blanco para no cambiar"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
                    onClick={() => setShowPw1((s) => !s)}
                    aria-label={
                      showPw1 ? "Ocultar contraseña" : "Ver contraseña"
                    }
                  >
                    {showPw1 ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {/* Reglas en vivo */}
                <ul className="mt-2 text-xs space-y-1">
                  <li className={hintColor(pwdHasMin, pwdTouched, pwd)}>
                    • Mínimo 8 caracteres
                  </li>
                  <li className={hintColor(pwdHasUpper, pwdTouched, pwd)}>
                    • Al menos 1 mayúscula (A–Z)
                  </li>
                  <li className={hintColor(pwdHasDigit, pwdTouched, pwd)}>
                    • Al menos 1 número (0–9)
                  </li>
                </ul>

                {/* Estado general */}
                <p
                  className={`mt-1 text-xs ${
                    !pwdTouched && pwd.length === 0
                      ? "text-gray-500"
                      : pwdStrong
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {!pwdTouched && pwd.length === 0
                    ? "Escribe una contraseña que cumpla los requisitos."
                    : pwdStrong
                    ? "La contraseña cumple con el formato requerido."
                    : "La contraseña aún no cumple los requisitos."}
                </p>
              </div>

              <div>
                <label className="block text-sm mb-1">Repetir contraseña</label>
                <div className="relative">
                  <input
                    type={showPw2 ? "text" : "password"}
                    value={String(user.password_confirm || "")}
                    onChange={(e) => {
                      setUser((u) =>
                        u ? { ...u, password_confirm: e.target.value } : u
                      );
                      if (!pwd2Touched) setPwd2Touched(true);
                    }}
                    onFocus={() => setPwd2Touched(true)}
                    className={`w-full min-w-0 rounded-lg border px-3 py-2 pr-10 ${borderForPwdField(
                      pwdMatch,
                      pwd2Touched,
                      pwd2.length === 0
                    )}`}
                    placeholder="Vuelve a escribir la contraseña"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
                    onClick={() => setShowPw2((s) => !s)}
                    aria-label={
                      showPw2 ? "Ocultar repetición" : "Ver repetición"
                    }
                  >
                    {showPw2 ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {/* Mensaje en vivo de coincidencia */}
                <p
                  className={`mt-1 text-xs ${
                    !pwd2Touched && pwd2.length === 0
                      ? "text-gray-500"
                      : pwdMatch
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {!pwd2Touched && pwd2.length === 0
                    ? "Vuelve a escribir la contraseña."
                    : pwdMatch
                    ? "Ambas contraseñas coinciden."
                    : "Las contraseñas no coinciden."}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Columna derecha */}
        <div className="space-y-6">
          {/* Contacto de emergencia */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <h3 className="text-lg font-bold text-gray-900">
              Contacto de emergencia
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">Nombre contacto</label>
                <input
                  value={String(pac.contacto_emergencia_nom || "")}
                  onChange={(e) =>
                    setPac((pp) =>
                      pp
                        ? { ...pp, contacto_emergencia_nom: e.target.value }
                        : pp
                    )
                  }
                  className={inputClass("contacto_emergencia_nom")}
                  placeholder="Nombre y apellido"
                />
                {errors.contacto_emergencia_nom && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.contacto_emergencia_nom}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm mb-1">Parentesco</label>
                <select
                  value={pac.contacto_emergencia_par ?? ""}
                  onChange={(e) =>
                    setPac((pp) =>
                      pp
                        ? { ...pp, contacto_emergencia_par: e.target.value }
                        : pp
                    )
                  }
                  className={inputClass("contacto_emergencia_par")}
                >
                  <option value="">—</option>
                  {PARENTESCOS.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
                {errors.contacto_emergencia_par && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.contacto_emergencia_par}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm mb-1">Celular contacto</label>
                <input
                  value={String(pac.contacto_emergencia_cel || "")}
                  onChange={(e) =>
                    setPac((pp) =>
                      pp
                        ? {
                            ...pp,
                            contacto_emergencia_cel: e.target.value
                              .replace(/\D/g, "")
                              .slice(0, 10),
                          }
                        : pp
                    )
                  }
                  className={inputClass("contacto_emergencia_cel")}
                  placeholder="09xxxxxxxx"
                  inputMode="tel"
                  maxLength={10}
                />
                {errors.contacto_emergencia_cel && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.contacto_emergencia_cel}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* Nota informativa (estilo Servicios) */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 text-blue-900 p-4 flex items-start gap-3">
        <Info className="mt-0.5 shrink-0" />
        <div className="text-sm">
          Esta sección permite actualizar tu <strong>foto</strong>,{" "}
          <strong>contraseña</strong> y<strong> contacto de emergencia</strong>.
          Si deseas editar <strong>datos sensibles</strong> o información
          adicional de tu expediente, por favor acércate al consultorio o
          comunícate con nosotros.
        </div>
      </div>
    </div>
  );
}
