// src/pages/admin/AdminEdicion.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Pencil } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/axios";

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
  activa: boolean; // mapea a "activo" (is_active)
  staff: boolean; // editable (is_staff)
  nueva_password?: string;
  repetir_password?: string;
  foto?: File | null;
};

type Errors = Partial<
  Record<
    | "cedula"
    | "email"
    | "celular"
    | "fecha_nacimiento"
    | "nueva_password"
    | "repetir_password",
    string
  >
>;

const SEXO_OPC = [
  { value: "", label: "Seleccione…" },
  { value: "M", label: "Masculino" },
  { value: "F", label: "Femenino" },
];

const SANGRE_OPC = ["", "O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

/* ===== Helpers de validación ===== */
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

export default function AdminEdicion() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
    activa: true,
    staff: false,
    nueva_password: "",
    repetir_password: "",
    foto: null,
  });

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Originales (para no marcar duplicado si no cambiaron)
  const [origCedula, setOrigCedula] = useState<string>("");
  const [origEmail, setOrigEmail] = useState<string>("");
  const [origCelular, setOrigCelular] = useState<string>("");

  // Errores + verificación remota
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

  // precargar datos del usuario a editar
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get(`/usuarios/${id}/`);
        const emailFetched = data.usuario_email ?? data.email ?? "";
        setForm((prev) => ({
          ...prev,
          primer_nombre: data.primer_nombre ?? "",
          segundo_nombre: data.segundo_nombre ?? "",
          primer_apellido: data.primer_apellido ?? "",
          segundo_apellido: data.segundo_apellido ?? "",
          cedula: data.cedula ?? "",
          sexo: data.sexo ?? "",
          fecha_nacimiento: data.fecha_nacimiento ?? "",
          tipo_sangre: data.tipo_sangre ?? "",
          celular: data.celular ?? "",
          email: emailFetched,
          activa: Boolean(data.is_active),
          staff: Boolean(data.is_staff),
        }));
        setOrigCedula(String(data.cedula ?? ""));
        setOrigEmail(String(emailFetched ?? ""));
        setOrigCelular(String(data.celular ?? ""));
        if (data?.foto && typeof data.foto === "string") {
          setPreviewUrl(data.foto);
        }
      } catch (err: any) {
        const detail =
          err?.response?.data?.detail ||
          "No se pudo cargar los datos del usuario.";
        setError(detail);
      } finally {
        setLoading(false);
      }
    };
    if (id) load();
  }, [id]);

  const contrasenaNoCoincide = useMemo(() => {
    const a = form.nueva_password?.trim() ?? "";
    const b = form.repetir_password?.trim() ?? "";
    return a.length > 0 && b.length > 0 && a !== b;
  }, [form.nueva_password, form.repetir_password]);

  /* ===== Verificación remota (cédula / email / celular) ===== */
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

      // CÉDULA
      if (data?.cedula && lastQueried.current.cedula === data.cedula.value) {
        let exists = Boolean(data.cedula.exists);
        if (origCedula && String(origCedula) === String(data.cedula.value)) {
          exists = false; // es la misma de antes => permitido
        }
        setCedulaExists(exists);
        setErrors((prev) => ({
          ...prev,
          cedula: exists ? "La cédula ya existe." : "",
        }));
      }

      // EMAIL
      if (data?.email && lastQueried.current.email === data.email.value) {
        let exists = Boolean(data.email.exists);
        if (
          origEmail &&
          String(origEmail).toLowerCase() ===
            String(data.email.value).toLowerCase()
        ) {
          exists = false; // mismo correo de antes
        }
        setEmailExists(exists);
        setErrors((prev) => ({
          ...prev,
          email: exists ? "El correo ya existe." : "",
        }));
      }

      // CELULAR
      if (data?.celular && lastQueried.current.celular === data.celular.value) {
        let exists = Boolean(data.celular.exists);
        if (origCelular && String(origCelular) === String(data.celular.value)) {
          exists = false; // mismo celular de antes
        }
        setCelularExists(exists);
        setErrors((prev) => ({
          ...prev,
          celular: exists ? "El celular ya existe." : "",
        }));
      }
    } catch (e) {
      console.error("Fallo verificación cédula/email/celular", e);
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

  /* ===== Handlers ===== */
  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, files, type, checked } = e.target as HTMLInputElement;

    if (name === "foto") {
      const file = files && files[0] ? files[0] : null;
      setForm((f) => ({ ...f, foto: file }));
      setPreviewUrl(file ? URL.createObjectURL(file) : null);
      return;
    }

    if (type === "checkbox") {
      setForm((f) => ({ ...f, [name]: checked }));
      return;
    }

    if (name === "cedula") {
      const val = value.replace(/\D/g, "").slice(0, 10);
      setForm((f) => ({ ...f, cedula: val }));
      setErrors((p) => ({ ...p, cedula: "" }));
      setCedulaExists(null);
      return;
    }

    if (name === "celular") {
      const val = value.replace(/\D/g, "").slice(0, 10);
      setForm((f) => ({ ...f, celular: val }));
      setErrors((p) => ({ ...p, celular: "" }));
      setCelularExists(null);
      return;
    }

    if (name === "email") {
      setForm((f) => ({ ...f, email: value }));
      setErrors((p) => ({ ...p, email: "" }));
      setEmailExists(null);
      return;
    }

    if (name === "nueva_password") {
      const pwd = value;
      setForm((f) => ({ ...f, nueva_password: pwd }));
      setErrors((prev) => ({
        ...prev,
        nueva_password:
          pwd.length === 0
            ? ""
            : hasStrongPassword(pwd)
            ? ""
            : "Mín. 6, una mayúscula y un número.",
        repetir_password:
          (form.repetir_password ?? "") && pwd !== (form.repetir_password ?? "")
            ? "No coincide."
            : "",
      }));
      return;
    }

    if (name === "repetir_password") {
      const pwd2 = value;
      setForm((f) => ({ ...f, repetir_password: pwd2 }));
      setErrors((prev) => ({
        ...prev,
        repetir_password:
          pwd2 !== (form.nueva_password ?? "") ? "No coincide." : "",
      }));
      return;
    }

    setForm((f) => ({ ...f, [name]: value }));
  };

  /* ===== Validación antes de guardar ===== */
  const validateAll = () => {
    const e: Errors = {};

    // Cedula
    if (!/^\d{10}$/.test(form.cedula) || !isValidCedulaEC(form.cedula)) {
      e.cedula = "Cédula inválida.";
    } else if (cedulaExists === true) {
      e.cedula = "La cédula ya existe.";
    }

    // Email
    if (!isValidEmail(form.email)) {
      e.email = "Correo inválido.";
    } else if (emailExists === true) {
      e.email = "El correo ya existe.";
    }

    // Fecha de nacimiento -> mayor de 18
    if (!form.fecha_nacimiento) {
      e.fecha_nacimiento = "Obligatorio.";
    } else if (!isAdult18(form.fecha_nacimiento)) {
      e.fecha_nacimiento = "Debe ser mayor de 18 años.";
    }

    // Celular ECU 09xxxxxxxx
    if (!/^09\d{8}$/.test(form.celular)) {
      e.celular = "Formato 09xxxxxxxx.";
    } else if (celularExists === true) {
      e.celular = "El celular ya existe.";
    }

    // Contraseña (si la cambian)
    const pwd = (form.nueva_password ?? "").trim();
    const pwd2 = (form.repetir_password ?? "").trim();
    if (pwd || pwd2) {
      if (!hasStrongPassword(pwd)) {
        e.nueva_password = "Mín. 6, una mayúscula y un número.";
      }
      if (pwd2 !== pwd) {
        e.repetir_password = "No coincide.";
      }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!id) {
      setError("Falta el ID del usuario.");
      return;
    }
    if (!validateAll()) {
      setError("Corrige los campos marcados.");
      return;
    }

    try {
      setSaving(true);

      const hasPhoto = !!form.foto;
      if (hasPhoto) {
        const fd = new FormData();
        fd.append("primer_nombre", form.primer_nombre);
        fd.append("segundo_nombre", form.segundo_nombre);
        fd.append("primer_apellido", form.primer_apellido);
        fd.append("segundo_apellido", form.segundo_apellido);
        fd.append("cedula", form.cedula);
        fd.append("sexo", form.sexo);
        fd.append("fecha_nacimiento", form.fecha_nacimiento);
        fd.append("tipo_sangre", form.tipo_sangre);
        fd.append("celular", form.celular);
        fd.append("email", form.email);
        fd.append("activo", form.activa ? "true" : "false");
        fd.append("is_staff", form.staff ? "true" : "false");
        if (form.nueva_password) fd.append("password", form.nueva_password);
        if (form.foto) fd.append("foto", form.foto);

        await api.patch(`/usuarios/${id}/`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        const payload: any = {
          primer_nombre: form.primer_nombre,
          segundo_nombre: form.segundo_nombre,
          primer_apellido: form.primer_apellido,
          segundo_apellido: form.segundo_apellido,
          cedula: form.cedula,
          sexo: form.sexo,
          fecha_nacimiento: form.fecha_nacimiento,
          tipo_sangre: form.tipo_sangre,
          celular: form.celular,
          email: form.email,
          activo: form.activa,
          is_staff: form.staff,
        };
        if (form.nueva_password) payload.password = form.nueva_password;

        await api.patch(`/usuarios/${id}/`, payload);
      }

      navigate(`/admin/usuarios/${id}`);
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.non_field_errors?.[0] ||
        err?.response?.data?.email?.[0] ||
        err?.response?.data?.cedula?.[0] ||
        err?.response?.data?.celular?.[0] ||
        "No se pudo guardar los cambios.";
      setError(typeof detail === "string" ? detail : JSON.stringify(detail));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-600">
        <Loader2 className="animate-spin" />
        Cargando…
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          {/* Ícono lápiz al lado del título */}
          <Pencil className="h-5 w-5 text-gray-800" />
          Editar administrador
        </h1>

        {/* Acciones arriba a la derecha */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/admin/usuarios/${id}`)}
            className="inline-flex items-center gap-2 rounded-lg border border-black bg-white text-black px-3 py-2 hover:bg-gray-100"
          >
            Cancelar
          </button>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80 disabled:opacity-60"
            form="admin-edit-form"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : null}
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>

      <form id="admin-edit-form" onSubmit={onSubmit} className="space-y-6">
        {/* Card: Datos personales y Foto */}
        <section className="bg-white rounded-xl shadow">
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">Datos personales</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              {/* Foto (grande con selector debajo) */}
              <div className="md:col-span-1">
                <div className="flex flex-col items-center gap-4">
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
                    <input
                      type="file"
                      name="foto"
                      accept="image/*"
                      onChange={onChange}
                      className="block w-full text-sm rounded-lg border px-3 py-2 file:mr-4 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:bg-gray-800 file:text-white hover:file:bg-black/80"
                      aria-label="Seleccionar foto de perfil"
                    />
                    {form.foto && (
                      <div className="mt-2 flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setForm((f) => ({ ...f, foto: null }));
                            setPreviewUrl(null);
                          }}
                          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                        >
                          Quitar selección
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-gray-500 text-center mt-2">
                      JPG/PNG. Máx. 5MB.
                    </p>
                  </div>
                </div>
              </div>

              {/* Nombres y apellidos */}
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Primer nombre" required>
                  <Input
                    name="primer_nombre"
                    value={form.primer_nombre}
                    onChange={onChange}
                  />
                </Field>

                <Field label="Segundo nombre">
                  <Input
                    name="segundo_nombre"
                    value={form.segundo_nombre}
                    onChange={onChange}
                  />
                </Field>

                <Field label="Primer apellido" required>
                  <Input
                    name="primer_apellido"
                    value={form.primer_apellido}
                    onChange={onChange}
                  />
                </Field>

                <Field label="Segundo apellido" required>
                  <Input
                    name="segundo_apellido"
                    value={form.segundo_apellido}
                    onChange={onChange}
                  />
                </Field>

                <Field
                  label="Cédula"
                  hint="10 dígitos"
                  required
                  error={errors.cedula}
                >
                  <Input
                    name="cedula"
                    value={form.cedula}
                    onChange={onChange}
                    onBlur={handleCedulaBlur}
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10 dígitos"
                  />
                  {!errors.cedula && checkingCedula && (
                    <p className="text-xs text-gray-500 mt-1">
                      Verificando cédula…
                    </p>
                  )}
                  {!errors.cedula && cedulaExists === false && (
                    <p className="text-xs text-green-600 mt-1">
                      Cédula validada
                    </p>
                  )}
                </Field>

                <Field label="Sexo" required>
                  <Select name="sexo" value={form.sexo} onChange={onChange}>
                    {SEXO_OPC.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Fecha de nacimiento"
                  required
                  error={errors.fecha_nacimiento}
                >
                  <Input
                    type="date"
                    name="fecha_nacimiento"
                    value={form.fecha_nacimiento}
                    onChange={onChange}
                  />
                </Field>

                <Field label="Tipo de sangre" required>
                  <Select
                    name="tipo_sangre"
                    value={form.tipo_sangre}
                    onChange={onChange}
                  >
                    {SANGRE_OPC.map((o) => (
                      <option key={o} value={o}>
                        {o || "Seleccione…"}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          </div>
        </section>

        {/* Card: Acceso (estado y staff) */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Acceso</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div className="flex items-center gap-3">
              <input
                id="activa"
                type="checkbox"
                name="activa"
                checked={form.activa}
                onChange={onChange}
                className="h-4 w-4"
              />
              <label htmlFor="activa" className="text-sm text-gray-700">
                Estado activo (is_active)
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="staff"
                type="checkbox"
                name="staff"
                checked={form.staff}
                onChange={onChange}
                className="h-4 w-4"
              />
              <label htmlFor="staff" className="text-sm text-gray-700">
                Staff (is_staff)
              </label>
            </div>

            <p className="text-xs text-gray-500 md:col-span-1">
              * Cambia el acceso al panel de administración.
            </p>
          </div>
        </section>

        {/* Card: Contacto y Seguridad */}
        <section className="bg-white rounded-xl shadow">
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">Contacto y seguridad</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Email */}
              <Field label="Email" required error={errors.email}>
                <Input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={onChange}
                  onBlur={handleEmailBlur}
                />
                {!errors.email && checkingEmail && (
                  <p className="text-xs text-gray-500 mt-1">
                    Verificando correo…
                  </p>
                )}
                {!errors.email && emailExists === false && (
                  <p className="text-xs text-green-600 mt-1">Correo validado</p>
                )}
              </Field>

              {/* Celular */}
              <Field
                label="Celular"
                hint="Formato 09xxxxxxxx"
                error={errors.celular}
              >
                <Input
                  name="celular"
                  value={form.celular}
                  onChange={onChange}
                  onBlur={handleCelularBlur}
                  inputMode="tel"
                  maxLength={10}
                  placeholder="09xxxxxxxx"
                />
                {!errors.celular && checkingCelular && (
                  <p className="text-xs text-gray-500 mt-1">
                    Verificando celular…
                  </p>
                )}
                {!errors.celular && celularExists === false && (
                  <p className="text-xs text-green-600 mt-1">
                    Celular validado
                  </p>
                )}
              </Field>

              {/* Nueva contraseña */}
              <Field label="Nueva contraseña" error={errors.nueva_password}>
                <div className="relative">
                  <Input
                    type={showPass ? "text" : "password"}
                    name="nueva_password"
                    value={form.nueva_password}
                    onChange={onChange}
                    placeholder="Dejar vacío para no cambiar"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    aria-label={
                      showPass ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Mínimo 6, con mayúscula y número.
                </p>
              </Field>

              {/* Repetir contraseña */}
              <Field
                label="Repetir contraseña"
                error={
                  errors.repetir_password ||
                  (contrasenaNoCoincide ? "No coincide" : undefined)
                }
              >
                <div className="relative">
                  <Input
                    type={showPass2 ? "text" : "password"}
                    name="repetir_password"
                    value={form.repetir_password}
                    onChange={onChange}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass2((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    aria-label={
                      showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    {showPass2 ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
            </div>
          </div>
        </section>

        {/* Errores globales */}
        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}

/* ---------- UI helpers (sin dependencias externas) ---------- */
function Field({
  label,
  children,
  required,
  hint,
  error,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </label>
      <div className="mt-1">{children}</div>
      {hint && !error ? (
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      ) : null}
      {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full rounded-lg border px-3 py-2 outline-none " +
        "focus:ring-2 focus:ring-blue-500 focus:border-blue-500 " +
        "placeholder:text-gray-400 " +
        (props.className ?? "")
      }
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={
        "w-full rounded-lg border px-3 py-2 outline-none bg-white " +
        "focus:ring-2 focus:ring-blue-500 focus:border-blue-500 " +
        (props.className ?? "")
      }
    />
  );
}
