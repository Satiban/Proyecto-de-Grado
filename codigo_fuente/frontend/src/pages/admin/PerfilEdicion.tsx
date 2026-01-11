// src/pages/admin/PerfilEdicion.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import { useFotoPerfil } from "../../hooks/useFotoPerfil";
import { e164ToLocal, localToE164 } from "../../utils/phoneFormat";


/* =========================
   Tipos / Catálogos
========================= */
type FormState = {
  primer_nombre: string;
  segundo_nombre: string;
  primer_apellido: string;
  segundo_apellido: string;
  cedula: string;
  sexo: string; // "M" | "F"
  fecha_nacimiento: string;
  tipo_sangre: string;
  celular: string;
  email: string;
  nueva_password?: string;
  repetir_password?: string;
  foto?: File | null;
};

const SEXO_OPC = [
  { value: "", label: "Seleccione…" },
  { value: "M", label: "Masculino" },
  { value: "F", label: "Femenino" },
];

const SANGRE_OPC = ["", "O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

/* =========================
   Helpers de validación
========================= */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
// Cédula Ecuador
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
function hasStrongPassword(pwd: string): boolean {
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
   Errores
========================= */
type Errors = Partial<
  Record<
    | "primer_nombre"
    | "primer_apellido"
    | "segundo_apellido"
    | "cedula"
    | "sexo"
    | "fecha_nacimiento"
    | "tipo_sangre"
    | "celular"
    | "email"
    | "nueva_password"
    | "repetir_password",
    string
  >
>;

export default function PerfilEdicion() {
  const navigate = useNavigate();
  const { usuario, setUsuario } = useAuth();
  const { subirFoto, eliminarFoto } = useFotoPerfil();

  const [form, setForm] = useState<FormState>({
    primer_nombre: "",
    segundo_nombre: "",
    primer_apellido: "",
    segundo_apellido: "",
    cedula: "",
    sexo: "",
    fecha_nacimiento: "",
    tipo_sangre: "",
    celular: "",
    email: "",
    nueva_password: "",
    repetir_password: "",
    foto: null,
  });

  const [saving, setSaving] = useState(false);
  const [errorTop, setErrorTop] = useState<string | null>(null);

  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fotoOriginal, setFotoOriginal] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});

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

  const currentValues = useMemo(() => {
    return {
      cedula: (usuario?.cedula ?? "")?.toString(),
      email:
        (usuario?.usuario_email as string) ?? (usuario?.email as string) ?? "",
      celular: (usuario?.celular ?? "")?.toString(),
      foto:
        typeof usuario?.foto === "string" ? (usuario?.foto as string) : null,
      id: usuario?.id_usuario,
    };
  }, [usuario]);

  /* =========================
     Precarga de datos
  ========================= */
  useEffect(() => {
    if (!usuario) return;
    setForm((prev) => ({
      ...prev,
      primer_nombre: usuario.primer_nombre ?? "",
      segundo_nombre: usuario.segundo_nombre ?? "",
      primer_apellido: usuario.primer_apellido ?? "",
      segundo_apellido: usuario.segundo_apellido ?? "",
      cedula: usuario.cedula ?? "",
      sexo: usuario.sexo ?? "",
      fecha_nacimiento: usuario.fecha_nacimiento ?? "",
      tipo_sangre: usuario.tipo_sangre ?? "",
      celular: e164ToLocal(usuario.celular ?? ""),
      email:
        (usuario.usuario_email as string) ?? (usuario.email as string) ?? "",
      nueva_password: "",
      repetir_password: "",
      foto: null,
    }));
    if (typeof usuario?.foto === "string" && usuario.foto) {
      setPreviewUrl(usuario.foto);
      setFotoOriginal(usuario.foto);
    } else {
      setPreviewUrl(null);
      setFotoOriginal(null);
    }
  }, [usuario]);

  /* =========================
     Handlers
  ========================= */
  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, files } = e.target as HTMLInputElement;

    if (name === "foto") {
      const file = files && files[0] ? files[0] : null;
      setForm((f) => ({ ...f, foto: file }));
      setPreviewUrl(
        file ? URL.createObjectURL(file) : currentValues.foto ?? null
      );
      return;
    }

    setForm((f) => ({ ...f, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));

    if (name === "cedula") setCedulaExists(null);
    if (name === "email") setEmailExists(null);
    if (name === "celular") setCelularExists(null);

    if (name === "nueva_password") {
      const pwd = value;
      setErrors((prev) => ({
        ...prev,
        nueva_password:
          pwd.length === 0
            ? ""
            : hasStrongPassword(pwd)
            ? ""
            : "Mín. 6, una mayúscula y un número.",
        repetir_password:
          form.repetir_password && pwd !== form.repetir_password
            ? "No coincide."
            : "",
      }));
    }
    if (name === "repetir_password") {
      const pwd2 = value;
      setErrors((prev) => ({
        ...prev,
        repetir_password:
          pwd2 !== (form.nueva_password ?? "") ? "No coincide." : "",
      }));
    }
  };

  const handleNumeric =
    (field: keyof FormState, maxLen: number) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.replace(/\D/g, "").slice(0, maxLen);
      setForm((prev) => ({ ...prev, [field]: val }));
      setErrors((prev) => ({ ...prev, [field]: "" }));
      if (field === "cedula") setCedulaExists(null);
      if (field === "celular") setCelularExists(null);
    };

  /* =========================
     Verificación remota (unicidad)
  ========================== */
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

      const { data } = await api.get(`/usuarios/verificar/`, { params });

      if (data?.cedula && lastQueried.current.cedula === data.cedula.value) {
        let exists = Boolean(data.cedula.exists);
        if (
          currentValues.cedula &&
          String(currentValues.cedula) === String(data.cedula.value)
        )
          exists = false;
        setCedulaExists(exists);
        setErrors((prev) => ({
          ...prev,
          cedula: exists ? "La cédula ya existe." : "",
        }));
      }

      if (data?.email && lastQueried.current.email === data.email.value) {
        let exists = Boolean(data.email.exists);
        if (
          currentValues.email &&
          String(currentValues.email).toLowerCase() ===
            String(data.email.value).toLowerCase()
        )
          exists = false;
        setEmailExists(exists);
        setErrors((prev) => ({
          ...prev,
          email: exists ? "El correo ya existe." : "",
        }));
      }

      if (data?.celular && lastQueried.current.celular === data.celular.value) {
        let exists = Boolean(data.celular.exists);
        if (
          currentValues.celular &&
          String(currentValues.celular) === String(data.celular.value)
        )
          exists = false;
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
    const c = form.cedula.trim();
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
      setErrors((p) => ({ ...p, celular: "Formato 09xxxxxxxx." }));
      setCelularExists(null);
      return;
    }
    setErrors((p) => ({ ...p, celular: "" }));
    lastQueried.current.celular = c;
    verificarUnico({ celular: c });
  };

  const debouncedCheckCedula = useDebouncedCallback(() => {
    const c = form.cedula.trim();
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

  /* =========================
     Validación antes de enviar
  ========================== */
  const validateAll = (): boolean => {
    const e: Errors = {};

    if (!form.primer_nombre.trim()) e.primer_nombre = "Obligatorio.";
    if (!form.primer_apellido.trim()) e.primer_apellido = "Obligatorio.";
    if (!form.segundo_apellido.trim()) e.segundo_apellido = "Obligatorio.";

    if (!/^\d{10}$/.test(form.cedula) || !isValidCedulaEC(form.cedula))
      e.cedula = "Cédula inválida.";
    if (cedulaExists === true) e.cedula = "La cédula ya existe.";

    if (!form.sexo) e.sexo = "Selecciona el sexo.";

    if (!form.fecha_nacimiento) e.fecha_nacimiento = "Obligatorio.";
    else if (!isAdult18(form.fecha_nacimiento))
      e.fecha_nacimiento = "Debe ser mayor de 18 años.";

    if (!form.tipo_sangre) e.tipo_sangre = "Selecciona el tipo de sangre.";

    if (!/^09\d{8}$/.test(form.celular)) e.celular = "Formato 09xxxxxxxx.";
    if (celularExists === true) e.celular = "El celular ya existe.";

    if (!isValidEmail(form.email)) e.email = "Correo inválido.";
    if (emailExists === true) e.email = "El correo ya existe.";

    const pwd = (form.nueva_password ?? "").trim();
    const pwd2 = (form.repetir_password ?? "").trim();
    if (pwd || pwd2) {
      if (!hasStrongPassword(pwd))
        e.nueva_password = "Mín. 6, una mayúscula y un número.";
      if (pwd2 !== pwd) e.repetir_password = "No coincide.";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* =========================
     Submit
  ========================== */
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorTop(null);

    if (!usuario?.id_usuario) {
      setErrorTop("No hay usuario en sesión.");
      return;
    }

    if (!validateAll()) {
      setErrorTop("Corrige los campos marcados.");
      return;
    }

    try {
      setSaving(true);

      // 1) Si marcó eliminar foto
      if (!fotoOriginal && !form.foto) {
        await eliminarFoto(usuario.id_usuario);
      }

      // 2) Si subió una foto nueva
      if (form.foto instanceof File) {
        await subirFoto(usuario.id_usuario, form.foto);
      }

      // 3) Actualizar datos del usuario SIEMPRE
      const payload: any = {
        primer_nombre: form.primer_nombre,
        segundo_nombre: form.segundo_nombre,
        primer_apellido: form.primer_apellido,
        segundo_apellido: form.segundo_apellido,
        cedula: form.cedula,
        sexo: form.sexo,
        fecha_nacimiento: form.fecha_nacimiento,
        tipo_sangre: form.tipo_sangre,
        celular: localToE164(form.celular),
        email: form.email,
      };

      if (form.nueva_password) {
        payload.password = form.nueva_password;
      }

      await api.patch(`/usuarios/${usuario.id_usuario}/`, payload);

      // 4) Traer usuario actualizado
      const { data } = await api.get(`/usuarios/${usuario.id_usuario}/`);
      setUsuario(data);
      localStorage.setItem("usuario", JSON.stringify(data));

      navigate("/admin/perfil");
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.non_field_errors?.[0] ||
        err?.response?.data?.email?.[0] ||
        err?.response?.data?.cedula?.[0] ||
        err?.response?.data?.celular?.[0] ||
        "No se pudo guardar los cambios.";

      setErrorTop(typeof detail === "string" ? detail : JSON.stringify(detail));
    } finally {
      setSaving(false);
    }
  };

  /* =========================
     UI
  ========================== */
  const inputCls = (field?: keyof Errors) =>
    `w-full rounded-lg border px-3 py-2 outline-none ${
      field && errors[field]
        ? "border-red-500 focus:ring-2 focus:ring-red-500"
        : "border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    }`;

  return (
    <div className="w-full space-y-6">
      {/* Header: título + acciones a la derecha */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Pencil className="w-6 h-6" />
          Editar perfil
        </h1>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/admin/perfil")}
            className="px-4 py-2 rounded-lg border border-black bg-white text-black hover:bg-gray-100"
          >
            Cancelar
          </button>

          <button
            type="submit"
            form="perfil-form"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80 disabled:opacity-60"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : null}
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>

      {errorTop && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorTop}
        </div>
      )}

      {/* Formulario */}
      <form id="perfil-form" onSubmit={onSubmit} className="mt-6 space-y-6">
        {/* ===== Card: Datos personales ===== */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Datos personales</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            {/* Foto (manejo completo con Cloudinary) */}
            <div className="md:col-span-1">
              <div className="flex flex-col items-center gap-4">
                {/* Vista previa circular */}
                <div className="w-40 h-40 rounded-full bg-gray-200 overflow-hidden ring-2 ring-gray-200">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Foto de perfil"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-gray-500 text-sm">
                      Sin foto
                    </div>
                  )}
                </div>

                <div className="w-full">
                  {/* Input de archivo */}
                  <input
                    type="file"
                    name="foto"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setForm((f) => ({ ...f, foto: file }));

                      setPreviewUrl(
                        file ? URL.createObjectURL(file) : fotoOriginal ?? null
                      );
                    }}
                    className="block w-full text-sm rounded-lg border px-3 py-2 file:mr-4 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:bg-gray-800 file:text-white hover:file:bg-black/80"
                  />

                  <div className="mt-3 flex flex-col items-center gap-2">
                    {/* Botón: Quitar selección (si eligió una foto nueva) */}
                    {form.foto && (
                      <button
                        type="button"
                        onClick={() => {
                          setForm((f) => ({ ...f, foto: null }));
                          setPreviewUrl(fotoOriginal ?? null);
                        }}
                        className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                      >
                        Quitar selección
                      </button>
                    )}

                    {/* Botón: Quitar foto actual (Cloudinary) */}
                    {fotoOriginal && !form.foto && (
                      <button
                        type="button"
                        onClick={() => {
                          setFotoOriginal(null); // marcar eliminar
                          setPreviewUrl(null); // reflejar en UI
                        }}
                        className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                      >
                        Quitar foto actual
                      </button>
                    )}

                    {/* Indicador cuando está marcada para eliminar */}
                    {!fotoOriginal && !form.foto && previewUrl === null && (
                      <span className="text-xs text-red-600">
                        Foto marcada para eliminar
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-500 text-center mt-2">
                    JPG/PNG. Máx. 5MB.
                  </p>
                </div>
              </div>
            </div>

            {/* Nombres y más */}
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
                  <p className="text-xs text-red-600 mt-1">
                    {errors.primer_nombre}
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm text-gray-700">Segundo nombre</label>
                <input
                  name="segundo_nombre"
                  value={form.segundo_nombre}
                  onChange={onChange}
                  className={inputCls()}
                />
              </div>
              <div>
                <label className="text-sm text-gray-700">Primer apellido</label>
                <input
                  name="primer_apellido"
                  value={form.primer_apellido}
                  onChange={onChange}
                  className={inputCls("primer_apellido")}
                  required
                />
                {errors.primer_apellido && (
                  <p className="text-xs text-red-600 mt-1">
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
                  <p className="text-xs text-red-600 mt-1">
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
                  <p className="text-xs text-red-600 mt-1">{errors.cedula}</p>
                )}
                {checkingCedula && !errors.cedula && (
                  <p className="text-xs text-gray-500 mt-1">
                    Verificando cédula…
                  </p>
                )}
                {cedulaExists === false && !errors.cedula && (
                  <p className="text-xs text-green-600 mt-1">Cédula validada</p>
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
                  <p className="text-xs text-red-600 mt-1">{errors.sexo}</p>
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
                  <p className="text-xs text-red-600 mt-1">
                    {errors.fecha_nacimiento}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-700">Tipo de sangre</label>
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
                  <p className="text-xs text-red-600 mt-1">
                    {errors.tipo_sangre}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ===== Card: Contacto ===== */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Contacto</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-700">Email</label>
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
                <p className="text-xs text-red-600 mt-1">{errors.email}</p>
              )}
              {checkingEmail && !errors.email && (
                <p className="text-xs text-gray-500 mt-1">
                  Verificando correo…
                </p>
              )}
              {emailExists === false && !errors.email && (
                <p className="text-xs text-green-600 mt-1">Correo validado</p>
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
                inputMode="tel"
                maxLength={10}
                placeholder="09xxxxxxxx"
                required
              />
              {errors.celular && (
                <p className="text-xs text-red-600 mt-1">{errors.celular}</p>
              )}
              {checkingCelular && !errors.celular && (
                <p className="text-xs text-gray-500 mt-1">
                  Verificando celular…
                </p>
              )}
              {celularExists === false && !errors.celular && (
                <p className="text-xs text-green-600 mt-1">Celular validado</p>
              )}
            </div>
          </div>
        </section>

        {/* ===== Card: Seguridad ===== */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Seguridad</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-700">Nueva contraseña</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  name="nueva_password"
                  value={form.nueva_password}
                  onChange={onChange}
                  className={`${inputCls("nueva_password")} pr-10`}
                  placeholder="Dejar vacío para no cambiar"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900"
                  aria-label={
                    showPass ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.nueva_password && (
                <p className="text-xs text-red-600 mt-1">
                  {errors.nueva_password}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Mínimo 6, con mayúscula y número.
              </p>
            </div>

            <div>
              <label className="text-sm text-gray-700">
                Repetir contraseña
              </label>
              <div className="relative">
                <input
                  type={showPass2 ? "text" : "password"}
                  name="repetir_password"
                  value={form.repetir_password}
                  onChange={onChange}
                  className={`${inputCls("repetir_password")} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass2((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900"
                  aria-label={
                    showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {showPass2 ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.repetir_password && (
                <p className="text-xs text-red-600 mt-1">
                  {errors.repetir_password}
                </p>
              )}
            </div>
          </div>
        </section>
      </form>
    </div>
  );
}
