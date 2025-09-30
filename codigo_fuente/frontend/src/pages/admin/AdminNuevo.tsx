// src/pages/admin/AdminNuevo.tsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { api } from "../../api/axios";
import { ShieldPlus, Loader2, Eye, EyeOff } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

/* =========================
   Validadores reutilizables
========================= */
function isValidCedulaEC(ci: string): boolean {
  if (!/^\d{10}$/.test(ci)) return false;
  const provincia = parseInt(ci.slice(0, 2), 10);
  if (provincia < 1 || (provincia > 24 && provincia !== 30)) return false;
  const tercer = parseInt(ci[2], 10);
  if (tercer >= 6) return false;
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let prod = coef[i] * parseInt(ci[i], 10);
    if (prod >= 10) prod -= 9;
    suma += prod;
  }
  const mod = suma % 10;
  const digitoVerif = mod === 0 ? 0 : 10 - mod;
  return digitoVerif === parseInt(ci[9], 10);
}
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
function hasStrongPassword(pwd: string): boolean {
  // Mín. 6, al menos 1 mayúscula y 1 número
  return /^(?=.*[A-Z])(?=.*\d).{6,}$/.test(pwd);
}
function isAdult18(dateStr: string): boolean {
  if (!dateStr) return false;
  const dob = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(dob.getTime())) return false;
  const today = new Date();
  let years = today.getFullYear() - dob.getFullYear();
  const mDiff = today.getMonth() - dob.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < dob.getDate())) years--;
  return years >= 18;
}
function useDebouncedCallback(cb: () => void, delay = 400) {
  const t = useRef<number | undefined>(undefined as any);
  return () => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(cb, delay);
  };
}

/* =========================
   Tipos y catálogos
========================= */
const SEXO_OPC = [
  { value: "", label: "Seleccione…" },
  { value: "M", label: "Masculino" },
  { value: "F", label: "Femenino" },
];
const SANGRE_OPC = ["", "O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

type Errors = Partial<
  Record<
    | "primer_nombre"
    | "primer_apellido"
    | "segundo_apellido"
    | "cedula"
    | "fecha_nacimiento"
    | "sexo"
    | "tipo_sangre"
    | "celular"
    | "email"
    | "password"
    | "password2",
    string
  >
>;

/* =========================
   Componente principal
========================= */
export default function AdminNuevo() {
  const navigate = useNavigate();

  const [saving, setSaving] = useState(false);
  const [errorTop, setErrorTop] = useState("");

  // Verificación remota (cédula/email/celular)
  const [checkingCedula, setCheckingCedula] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [checkingCelular, setCheckingCelular] = useState(false);
  const [cedulaExists, setCedulaExists] = useState<boolean | null>(null);
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [celularExists, setCelularExists] = useState<boolean | null>(null);
  const lastQueried = useRef<{
    cedula?: string;
    email?: string;
    celular?: string;
  }>({});

  const [errors, setErrors] = useState<Errors>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // ======== Estado del formulario (DECLÁRALO ANTES de usarlo) ========
  const [form, setForm] = useState({
    // Datos personales
    primer_nombre: "",
    segundo_nombre: "",
    primer_apellido: "",
    segundo_apellido: "",
    cedula: "",
    fecha_nacimiento: "",
    sexo: "",
    tipo_sangre: "",
    celular: "",

    // Acceso
    email: "",
    password: "",
    password2: "",

    // Foto (opcional)
    foto: null as File | null,
  });

  // show/hide passwords
  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  // --- Live password checks ---
  const [pwdTouched, setPwdTouched] = useState(false);
  const [pwd2Touched, setPwd2Touched] = useState(false);

  const pwd = form.password ?? "";
  const pwd2 = form.password2 ?? "";

  const pwdHasMin = pwd.length >= 6;
  const pwdHasUpper = /[A-Z]/.test(pwd);
  const pwdHasDigit = /\d/.test(pwd);
  const pwdStrong = pwdHasMin && pwdHasUpper && pwdHasDigit;

  // Coincidencia
  const pwdMatch = pwd.length > 0 && pwd2.length > 0 && pwd === pwd2;

  // Helpers de color (gris inicial → rojo/verde)
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

  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, files } = e.target as HTMLInputElement;

    if (name === "foto") {
      const file = files && files[0] ? files[0] : null;
      setForm((s) => ({ ...s, foto: file }));
      setPreviewUrl(file ? URL.createObjectURL(file) : null);
      return;
    }

    // escritura normal
    setForm((s) => ({ ...s, [name]: value }));

    // limpiar error puntual
    setErrors((prev) => ({ ...prev, [name]: "" }));

    // reset flags de existencia
    if (name === "cedula") setCedulaExists(null);
    if (name === "email") setEmailExists(null);
    if (name === "celular") setCelularExists(null);

    // ===== Validación inmediata de contraseña =====
    if (name === "password") {
      const nextPwd = value;
      if (!pwdTouched) setPwdTouched(true);
      setErrors((prev) => ({
        ...prev,
        password:
          nextPwd.length === 0
            ? "Obligatoria."
            : hasStrongPassword(nextPwd)
            ? ""
            : "Mín. 6, una mayúscula y un número.",
        password2:
          form.password2 && nextPwd !== form.password2 ? "No coincide." : "",
      }));
    }

    if (name === "password2") {
      const nextPwd2 = value;
      if (!pwd2Touched) setPwd2Touched(true);
      setErrors((prev) => ({
        ...prev,
        password2: nextPwd2 !== form.password ? "No coincide." : "",
      }));
    }
  };

  const handleNumeric =
    (field: keyof typeof form, maxLen: number) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.replace(/\D/g, "").slice(0, maxLen);
      setForm((prev) => ({ ...prev, [field]: val }));
      setErrors((prev) => ({ ...prev, [field]: "" }));
      if (field === "cedula") setCedulaExists(null);
      if (field === "celular") setCelularExists(null);
    };

  /* ------- Verificación remota de unicidad ------- */
  const verificarUnico = async (opts: {
    cedula?: string;
    email?: string;
    celular?: string;
  }) => {
    try {
      const params: Record<string, string> = {};
      if (opts.cedula) params.cedula = opts.cedula;
      if (opts.email) params.email = opts.email;
      if (opts.celular) params.celular = opts.celular;

      if (params.cedula) setCheckingCedula(true);
      if (params.email) setCheckingEmail(true);
      if (params.celular) setCheckingCelular(true);

      const { data } = await axios.get(`${API}/usuarios/verificar/`, {
        params,
      });

      if (data.cedula && lastQueried.current.cedula === data.cedula.value) {
        const exists = Boolean(data.cedula.exists);
        setCedulaExists(exists);
        setErrors((prev) => ({
          ...prev,
          cedula: exists ? "La cédula ya existe." : "",
        }));
      }
      if (data.email && lastQueried.current.email === data.email.value) {
        const exists = Boolean(data.email.exists);
        setEmailExists(exists);
        setErrors((prev) => ({
          ...prev,
          email: exists ? "El correo ya existe." : "",
        }));
      }
      if (data.celular && lastQueried.current.celular === data.celular.value) {
        const exists = Boolean(data.celular.exists);
        setCelularExists(exists);
        setErrors((prev) => ({
          ...prev,
          celular: exists ? "El celular ya existe." : "",
        }));
      }
    } catch (e) {
      console.error("Fallo verificación remota", e);
    } finally {
      if (opts.cedula) setCheckingCedula(false);
      if (opts.email) setCheckingEmail(false);
      if (opts.celular) setCheckingCelular(false);
    }
  };

  const handleCedulaBlur = () => {
    const c = form.cedula;
    if (!c) return;
    if (!/^\d{10}$/.test(c) || !isValidCedulaEC(c)) {
      setErrors((p) => ({ ...p, cedula: "Cédula inválida." }));
      setCedulaExists(null);
      return;
    }
    setErrors((p) => ({ ...p, cedula: "" }));
    lastQueried.current.cedula = c;
    verificarUnico({ cedula: c });
  };

  const handleEmailBlur = () => {
    const m = form.email.trim();
    if (!m) return;
    if (!isValidEmail(m)) {
      setErrors((p) => ({ ...p, email: "Correo inválido." }));
      setEmailExists(null);
      return;
    }
    setErrors((p) => ({ ...p, email: "" }));
    lastQueried.current.email = m;
    verificarUnico({ email: m });
  };

  const handleCelularBlur = () => {
    const c = form.celular.trim();
    if (!c) return;
    if (!/^09\d{8}$/.test(c)) {
      setErrors((p) => ({ ...p, celular: "Formato 09xxxxxxxx" }));
      setCelularExists(null);
      return;
    }
    setErrors((p) => ({ ...p, celular: "" }));
    lastQueried.current.celular = c;
    verificarUnico({ celular: c });
  };

  const debouncedCheckCedula = useDebouncedCallback(() => {
    const c = form.cedula;
    if (/^\d{10}$/.test(c) && isValidCedulaEC(c)) {
      lastQueried.current.cedula = c;
      verificarUnico({ cedula: c });
    } else {
      setCedulaExists(null);
    }
  }, 400);

  const debouncedCheckEmail = useDebouncedCallback(() => {
    const m = form.email.trim();
    if (isValidEmail(m)) {
      lastQueried.current.email = m;
      verificarUnico({ email: m });
    } else {
      setEmailExists(null);
    }
  }, 400);

  const debouncedCheckCelular = useDebouncedCallback(() => {
    const c = form.celular.trim();
    if (/^09\d{8}$/.test(c)) {
      lastQueried.current.celular = c;
      verificarUnico({ celular: c });
    } else {
      setCelularExists(null);
    }
  }, 400);

  useEffect(() => {
    if (form.cedula) debouncedCheckCedula();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cedula]);

  useEffect(() => {
    if (form.email) debouncedCheckEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.email]);

  useEffect(() => {
    if (form.celular) debouncedCheckCelular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.celular]);

  /* ------- Validación ------- */
  const validateAll = () => {
    const e: Errors = {};
    if (!form.primer_nombre.trim()) e.primer_nombre = "Obligatorio.";
    if (!form.primer_apellido.trim()) e.primer_apellido = "Obligatorio.";
    if (!form.segundo_apellido.trim()) e.segundo_apellido = "Obligatorio.";

    if (!/^\d{10}$/.test(form.cedula) || !isValidCedulaEC(form.cedula))
      e.cedula = "Cédula inválida.";
    if (cedulaExists === true) e.cedula = "La cédula ya existe.";

    if (!form.celular || !/^09\d{8}$/.test(form.celular))
      e.celular = "Debe iniciar con 09 y tener 10 dígitos.";
    if (celularExists === true) e.celular = "El celular ya existe.";

    if (!isValidEmail(form.email)) e.email = "Correo inválido.";
    if (emailExists === true) e.email = "El correo ya existe.";

    if (!form.fecha_nacimiento) e.fecha_nacimiento = "Obligatorio.";
    else if (!isAdult18(form.fecha_nacimiento))
      e.fecha_nacimiento = "Debe ser mayor de 18 años.";

    if (!form.sexo) e.sexo = "Selecciona el sexo.";
    if (!form.tipo_sangre) e.tipo_sangre = "Selecciona el tipo de sangre.";

    // contraseña + confirmación
    if (!hasStrongPassword(form.password))
      e.password = "Mín. 6, una mayúscula y un número.";
    if (form.password2 !== form.password) e.password2 = "No coincide.";

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const inputCls = (field?: keyof Errors) =>
    `w-full rounded-lg border px-3 py-2 outline-none ${
      field && errors[field]
        ? "border-red-500 focus:ring-2 focus:ring-red-500"
        : "border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    }`;

  /* ------- Submit ------- */
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorTop("");
    if (!validateAll()) {
      setErrorTop("Corrige los campos marcados.");
      return;
    }

    try {
      setSaving(true);

      const fd = new FormData();
      // Datos personales
      fd.append("primer_nombre", form.primer_nombre);
      fd.append("segundo_nombre", form.segundo_nombre);
      fd.append("primer_apellido", form.primer_apellido);
      fd.append("segundo_apellido", form.segundo_apellido);
      fd.append("cedula", form.cedula);
      fd.append("fecha_nacimiento", form.fecha_nacimiento);
      fd.append("sexo", form.sexo);
      fd.append("tipo_sangre", form.tipo_sangre);
      fd.append("celular", form.celular);

      // Acceso
      fd.append("email", form.email);
      fd.append("password", form.password);

      // Rol admin clínico (id_rol=4) y activo=true
      fd.append("id_rol", "4");
      fd.append("activo", "true");

      // Foto opcional
      if (form.foto) fd.append("foto", form.foto);

      await api.post(`/usuarios/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      navigate("/admin/usuarios");
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.non_field_errors?.[0] ||
        err?.response?.data?.email?.[0] ||
        err?.response?.data?.cedula?.[0] ||
        err?.response?.data?.celular?.[0] ||
        "No se pudo crear el administrador.";
      setErrorTop(typeof detail === "string" ? detail : JSON.stringify(detail));
    } finally {
      setSaving(false);
    }
  };

  /* ------- UI ------- */
  return (
    <div className="space-y-4">
      {/* Header con acciones arriba a la derecha */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldPlus className="size-6 text-blue-600" />
          Nuevo Administrador
        </h1>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/administradores"
            className="inline-flex items-center gap-2 rounded-lg border border-black bg-white text-black px-3 py-2 hover:bg-gray-100"
          >
            Cancelar
          </Link>

          {/* Botón submit fuera del form (usa form="admin-new-form") */}
          <button
            type="submit"
            form="admin-new-form"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80 disabled:opacity-60"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : null}
            {saving ? "Guardando..." : "Crear administrador"}
          </button>
        </div>
      </div>

      {errorTop && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorTop}
        </div>
      )}

      {/* Form principal */}
      <form id="admin-new-form" onSubmit={onSubmit} className="space-y-6">
        {/* Card unificada: Foto + Datos personales */}
        <section className="bg-white rounded-xl shadow">
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">Datos personales</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              {/* Col izquierda: Foto + selector */}
              <div className="md:col-span-1">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-40 h-40 rounded-full bg-gray-200 overflow-hidden ring-2 ring-gray-200">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-sm text-gray-500">
                        Sin foto
                      </div>
                    )}
                  </div>

                  <div className="w-full">
                    <input
                      type="file"
                      name="foto"
                      accept="image/*"
                      onChange={onChange}
                      className="block w-full text-sm rounded-lg border px-3 py-2 file:mr-4 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:bg-gray-800 file:text-white hover:file:bg-black/80"
                    />
                    {form.foto && (
                      <div className="mt-2 flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setForm((s) => ({ ...s, foto: null }));
                            setPreviewUrl(null);
                          }}
                          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                        >
                          Quitar selección
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-gray-500 text-center mt-2">
                      JPG/PNG. Opcional.
                    </p>
                  </div>
                </div>
              </div>

              {/* Col derecha: Campos datos personales */}
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-700">Primer nombre</label>
                  <input
                    name="primer_nombre"
                    value={form.primer_nombre}
                    onChange={onChange}
                    className={inputCls("primer_nombre")}
                    required
                  />
                  {errors.primer_nombre && (
                    <p className="text-sm text-red-600 mt-1">
                      {errors.primer_nombre}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm text-gray-700">
                    Segundo nombre
                  </label>
                  <input
                    name="segundo_nombre"
                    value={form.segundo_nombre}
                    onChange={onChange}
                    className={inputCls()}
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-700">
                    Primer apellido
                  </label>
                  <input
                    name="primer_apellido"
                    value={form.primer_apellido}
                    onChange={onChange}
                    className={inputCls("primer_apellido")}
                    required
                  />
                  {errors.primer_apellido && (
                    <p className="text-sm text-red-600 mt-1">
                      {errors.primer_apellido}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm text-gray-700">
                    Segundo apellido
                  </label>
                  <input
                    name="segundo_apellido"
                    value={form.segundo_apellido}
                    onChange={onChange}
                    className={inputCls("segundo_apellido")}
                    required
                  />
                  {errors.segundo_apellido && (
                    <p className="text-sm text-red-600 mt-1">
                      {errors.segundo_apellido}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm text-gray-700">Cédula</label>
                  <input
                    name="cedula"
                    value={form.cedula}
                    onChange={handleNumeric("cedula", 10)}
                    onBlur={handleCedulaBlur}
                    className={inputCls("cedula")}
                    placeholder="10 dígitos"
                    inputMode="numeric"
                    maxLength={10}
                    required
                  />
                  {errors.cedula && (
                    <p className="text-sm text-red-600 mt-1">{errors.cedula}</p>
                  )}
                  {checkingCedula && !errors.cedula && (
                    <p className="text-xs text-gray-500 mt-1">
                      Verificando cédula…
                    </p>
                  )}
                  {cedulaExists === false && !errors.cedula && (
                    <p className="text-xs text-green-600 mt-1">
                      Cédula disponible
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm text-gray-700">Celular</label>
                  <input
                    name="celular"
                    value={form.celular}
                    onChange={handleNumeric("celular", 10)}
                    onBlur={handleCelularBlur}
                    className={inputCls("celular")}
                    placeholder="09xxxxxxxx"
                    inputMode="numeric"
                    maxLength={10}
                    required
                  />
                  {errors.celular && (
                    <p className="text-sm text-red-600 mt-1">
                      {errors.celular}
                    </p>
                  )}
                  {checkingCelular && !errors.celular && (
                    <p className="text-xs text-gray-500 mt-1">
                      Verificando celular…
                    </p>
                  )}
                  {celularExists === false && !errors.celular && (
                    <p className="text-xs text-green-600 mt-1">
                      Celular disponible
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm text-gray-700">
                    Fecha de nacimiento
                  </label>
                  <input
                    type="date"
                    name="fecha_nacimiento"
                    value={form.fecha_nacimiento}
                    onChange={onChange}
                    className={inputCls("fecha_nacimiento")}
                    required
                  />
                  {errors.fecha_nacimiento && (
                    <p className="text-sm text-red-600 mt-1">
                      {errors.fecha_nacimiento}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm text-gray-700">Sexo</label>
                  <select
                    name="sexo"
                    value={form.sexo}
                    onChange={onChange}
                    className={inputCls("sexo")}
                    required
                  >
                    {SEXO_OPC.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {errors.sexo && (
                    <p className="text-sm text-red-600 mt-1">{errors.sexo}</p>
                  )}
                </div>

                <div>
                  <label className="text-sm text-gray-700">
                    Tipo de sangre
                  </label>
                  <select
                    name="tipo_sangre"
                    value={form.tipo_sangre}
                    onChange={onChange}
                    className={inputCls("tipo_sangre")}
                    required
                  >
                    {SANGRE_OPC.map((o) => (
                      <option key={o} value={o}>
                        {o || "Seleccione…"}
                      </option>
                    ))}
                  </select>
                  {errors.tipo_sangre && (
                    <p className="text-sm text-red-600 mt-1">
                      {errors.tipo_sangre}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Acceso */}
        <section className="bg-white rounded-xl shadow p-4">
          <h2 className="text-lg font-semibold mb-4">Acceso</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-sm text-gray-700">Correo</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={onChange}
                onBlur={handleEmailBlur}
                className={inputCls("email")}
                required
              />
              {errors.email && (
                <p className="text-sm text-red-600 mt-1">{errors.email}</p>
              )}
              {checkingEmail && !errors.email && (
                <p className="text-xs text-gray-500 mt-1">
                  Verificando correo…
                </p>
              )}
              {emailExists === false && !errors.email && (
                <p className="text-xs text-green-600 mt-1">Correo disponible</p>
              )}
            </div>

            {/* Contraseña (en vivo) */}
            <div>
              <label className="text-sm text-gray-700">Contraseña</label>
              <div className="relative">
                <input
                  type={showPass1 ? "text" : "password"}
                  name="password"
                  value={form.password}
                  onChange={onChange}
                  onFocus={() => setPwdTouched(true)}
                  className={`w-full rounded-lg border px-3 py-2 pr-10 ${borderForPwdField(
                    pwdStrong,
                    pwdTouched,
                    (form.password ?? "").length === 0
                  )}`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass1((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-800"
                  aria-label={
                    showPass1 ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {showPass1 ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Criterios en vivo */}
              <ul className="mt-2 text-xs space-y-1">
                <li className={hintColor(pwdHasMin, pwdTouched, pwd)}>
                  • Mínimo 6 caracteres
                </li>
                <li className={hintColor(pwdHasUpper, pwdTouched, pwd)}>
                  • Al menos 1 mayúscula (A–Z)
                </li>
                <li className={hintColor(pwdHasDigit, pwdTouched, pwd)}>
                  • Al menos 1 número (0–9)
                </li>
              </ul>

              {/* Estado global */}
              <p
                className={`mt-1 text-xs ${
                  !pwdTouched && pwd.length === 0
                    ? "text-gray-500"
                    : pwdStrong
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                {!pwdTouched &&
                  pwd.length === 0 &&
                  "Escribe una contraseña que cumpla los requisitos."}
                {pwdTouched &&
                  !pwdStrong &&
                  "La contraseña aún no cumple los requisitos."}
                {pwdTouched &&
                  pwdStrong &&
                  "La contraseña cumple con el formato requerido."}
              </p>

              {/* Error del submit (opcional, solo si sigue inválida) */}
              {errors.password && pwdTouched && !pwdStrong && (
                <p className="text-sm text-red-600 mt-1">{errors.password}</p>
              )}
            </div>

            {/* Repite la contraseña (en vivo) */}
            <div>
              <label className="text-sm text-gray-700">
                Repite la contraseña
              </label>
              <div className="relative">
                <input
                  type={showPass2 ? "text" : "password"}
                  name="password2"
                  value={form.password2}
                  onChange={onChange}
                  onFocus={() => setPwd2Touched(true)}
                  className={`w-full rounded-lg border px-3 py-2 pr-10 ${borderForPwdField(
                    pwdMatch,
                    pwd2Touched,
                    (form.password2 ?? "").length === 0
                  )}`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass2((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-800"
                  aria-label={
                    showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {showPass2 ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Mensaje en vivo de coincidencia */}
              <p
                className={`mt-1 text-xs ${
                  !pwd2Touched && (form.password2 ?? "").length === 0
                    ? "text-gray-500"
                    : pwdMatch
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                {!pwd2Touched &&
                  (form.password2 ?? "").length === 0 &&
                  "Vuelve a escribir la contraseña."}
                {pwd2Touched && !pwdMatch && "Las contraseñas no coinciden."}
                {pwd2Touched && pwdMatch && "Ambas contraseñas coinciden."}
              </p>

              {/* Error del submit (opcional, solo si no coincide) */}
              {errors.password2 && pwd2Touched && !pwdMatch && (
                <p className="text-sm text-red-600 mt-1">{errors.password2}</p>
              )}
            </div>
          </div>
        </section>
      </form>
    </div>
  );
}
