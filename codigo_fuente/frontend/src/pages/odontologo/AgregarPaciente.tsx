// src/pages/odontologo/AgregarPaciente.tsx
import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/axios";
import axios from "axios";
import { Eye, EyeOff, Loader2, User } from "lucide-react";

/* =========================
   Constantes
========================= */
const PRIMARY = "#1f2937"; // gris oscuro para odontólogo
const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

// Id del “Otros” en tu BD (por .env o hardcode)
const ANT_OTROS_ID = Number(import.meta.env.VITE_ANT_OTROS_ID || NaN);
// Si prefieres hardcodear: descomenta la línea de abajo y borra la de arriba
// const ANT_OTROS_ID = 10;

// Sentinel para la opción "Otro (especificar…)"
const OTHER = "__other__" as const;

/* =========================
   Tipos
========================= */
type FamiliarRel = "padres" | "hermanos" | "abuelos" | "propio";
type PersonalRow = { id: string; sel: number | "" };
type FamiliarRow = { id: string; sel: number | ""; relacion: Exclude<FamiliarRel, "propio"> };
type AntecedenteOpt = { id_antecedente: number; nombre: string };

/* =========================
   Helpers
========================= */
const makeId = (() => {
  let c = 0;
  return () => `antecedente_${++c}_${Date.now()}`;
})();

// Validadores
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
function atLeastSixMonthsOld(isoDate: string): boolean {
  if (!isoDate) return false;
  const birth = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(birth.getTime())) return false;
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  return birth <= sixMonthsAgo;
}
function hasLettersAndNumbers(s: string): boolean {
  return /[A-Za-z]/.test(s) && /\d/.test(s);
}
function fullNameTwoWords(name: string): boolean {
  return /^\s*\S+\s+\S+(\s+\S+)*\s*$/.test(name);
}
function useDebouncedCallback(cb: () => void, delay = 400) {
  const t = useRef<number | undefined>(undefined as any);
  return () => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(cb, delay);
  };
}

// “Otros” de la BD: por id o por nombre (defensa adicional por nombre)
function isDBOtros(a: AntecedenteOpt) {
  const n = (a.nombre || "").trim().toLowerCase();
  const byId = Number.isFinite(ANT_OTROS_ID) && a.id_antecedente === ANT_OTROS_ID;
  const byName = n === "otros" || n === "otro";
  return byId || byName;
}

/* =========================
   Modal: Agregar antecedente
========================= */
function AddAntecedenteModal({
  open,
  initialValue = "",
  onCancel,
  onConfirmName,
  busy = false,
}: {
  open: boolean;
  initialValue?: string;
  onCancel: () => void;
  onConfirmName: (name: string) => Promise<void>;
  busy?: boolean;
}) {
  const [name, setName] = useState(initialValue);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(initialValue);
    setErr(null);
  }, [initialValue, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-xl border overflow-hidden">
        <header className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">Agregar antecedente</h3>
          <button
            onClick={onCancel}
            className="rounded-xl border px-2 py-1 hover:bg-gray-50"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>
        <div className="p-4 space-y-2">
          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {err}
            </div>
          )}
          <label className="block text-sm text-gray-600">Nombre del antecedente</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            placeholder='Ej. "Artritis reumatoide"'
          />
          <p className="text-xs text-gray-500">Se validará que no exista duplicado en la base de datos.</p>
        </div>
        <footer className="flex items-center justify-end gap-2 p-4 border-t">
          <button onClick={onCancel} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            Cancelar
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              try {
                setErr(null);
                await onConfirmName(name);
              } catch (e: any) {
                setErr(
                  e?.response?.data?.nombre?.[0] ||
                    e?.message ||
                    "No se pudo crear el antecedente."
                );
              }
            }}
            className="rounded-xl text-white px-3 py-2 text-sm hover:opacity-90"
            style={{ backgroundColor: PRIMARY }}
          >
            {busy ? "Guardando…" : "Crear"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* =========================
   Componente principal
========================= */
export default function AgregarPaciente() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);
  const [errorTop, setErrorTop] = useState("");

  // Toast de éxito
  const [showSuccess, setShowSuccess] = useState(false);

  // Verificación remota (cédula/email/celular)
  const [checkingCedula, setCheckingCedula] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [checkingCelular, setCheckingCelular] = useState(false);
  const [cedulaExists, setCedulaExists] = useState<boolean | null>(null);
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [celularExists, setCelularExists] = useState<boolean | null>(null);
  const lastQueried = useRef<{ cedula?: string; email?: string; celular?: string }>({});

  // Errores por campo
  type Errors = Partial<
    Record<
      | "primer_nombre"
      | "primer_apellido"
      | "segundo_apellido"
      | "cedula"
      | "celular"
      | "email"
      | "fecha_nacimiento"
      | "password"
      | "password2"
      | "sexo"
      | "tipo_sangre"
      | "contacto_emergencia_nom"
      | "contacto_emergencia_cel",
      string
    >
  >;
  const [errors, setErrors] = useState<Errors>({});

  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  // Paso 1: datos personales
  const [personal, setPersonal] = useState({
    primer_nombre: "",
    segundo_nombre: "",
    primer_apellido: "",
    segundo_apellido: "",
    cedula: "",
    fecha_nacimiento: "",
    email: "",
    password: "",
    password2: "",
    celular: "",
  });

  // Paso 2: datos clínicos
  const [clinico, setClinico] = useState({ sexo: "", tipo_sangre: "" });

  // Foto (opcional)
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const fotoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!foto) {
      setFotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setFotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  const handleSelectFoto: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (f) setFoto(f);
  };
  const handleClearFoto = () => {
    setFoto(null);
    if (fotoInputRef.current) fotoInputRef.current.value = "";
  };

  // Paso 3: contacto de emergencia
  const [emergencia, setEmergencia] = useState({
    contacto_emergencia_nom: "",
    contacto_emergencia_cel: "",
    parSelect: "", // hijos|padres|hermanos|abuelos|esposos|otros
  });

  // Antecedentes seleccionados
  const [propias, setPropias] = useState<PersonalRow[]>([]);
  const [familiares, setFamiliares] = useState<FamiliarRow[]>([]);

  // Opciones de antecedentes desde BD
  const [antecedentesOpts, setAntecedentesOpts] = useState<AntecedenteOpt[]>([]);
  const [loadingAnt, setLoadingAnt] = useState(true);
  const [errorAnt, setErrorAnt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingAnt(true);
        setErrorAnt(null);
        const res = await api.get("/antecedentes/");
        const data: AntecedenteOpt[] = (Array.isArray(res.data) ? res.data : res.data?.results ?? [])
          .map((a: any) => ({
            id_antecedente: a.id_antecedente,
            nombre: String(a.nombre ?? "").trim(),
          }))
          .filter((a: AntecedenteOpt) => a.nombre)
          .sort((a: AntecedenteOpt, b: AntecedenteOpt) =>
            a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
          );
        // Oculta el "Otros" de tu BD en esta pantalla de odontólogo
        if (alive) setAntecedentesOpts(data.filter((a) => !isDBOtros(a)));
      } catch (e) {
        if (alive) setErrorAnt("No se pudieron cargar los antecedentes.");
      } finally {
        if (alive) setLoadingAnt(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Crear antecedente si no existe (case-insensitive) y devolver id
  async function ensureAntecedenteByName(rawName: string): Promise<number> {
    const name = rawName.trim();
    if (!name) throw new Error("El nombre no puede estar vacío.");
    const lower = name.toLowerCase();
    // Bloquea nombres reservados "otros"/"otro"
    if (lower === "otros" || lower === "otro") {
      throw new Error('Usa "Otro (especificar…)" y escribe el nombre real (no "Otros").');
    }
    const exist = antecedentesOpts.find((a) => a.nombre.toLowerCase() === lower);
    if (exist) return exist.id_antecedente;

    const res = await api.post("/antecedentes/", { nombre: name });
    const created: AntecedenteOpt = {
      id_antecedente: res.data.id_antecedente,
      nombre: String(res.data.nombre ?? "").trim(),
    };
    setAntecedentesOpts((prev) =>
      [...prev, created].sort((x, y) => x.nombre.localeCompare(y.nombre, "es", { sensitivity: "base" }))
    );
    return created.id_antecedente;
  }

  /* ------- Helpers UI ------- */
  const onChange = (
    setter: React.Dispatch<React.SetStateAction<any>>,
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setter((s: any) => ({ ...s, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
    setErrorTop("");
    if (name === "cedula") setCedulaExists(null);
    if (name === "email") setEmailExists(null);
    if (name === "celular") setCelularExists(null);
  };

  const handleNumeric =
    <T extends Record<string, any>>(
      setter: React.Dispatch<React.SetStateAction<T>>,
      field: keyof T,
      maxLen: number
    ) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.replace(/\D/g, "").slice(0, maxLen);
      setter((prev) => ({ ...prev, [field]: val }));
      setErrors((prev) => ({ ...prev, [field as string]: "" }));
      setErrorTop("");
      if (field === "cedula") setCedulaExists(null);
      if (field === "celular") setCelularExists(null);
    };

  /* ------- Verificación remota de unicidad ------- */
  const verificarUnico = async (opts: { cedula?: string; email?: string; celular?: string }) => {
    try {
      const params: Record<string, string> = {};
      if (opts.cedula) params.cedula = opts.cedula;
      if (opts.email) params.email = opts.email;
      if (opts.celular) params.celular = opts.celular;

      if (params.cedula) setCheckingCedula(true);
      if (params.email) setCheckingEmail(true);
      if (params.celular) setCheckingCelular(true);

      const { data } = await axios.get(`${API}/usuarios/verificar/`, { params });

      if (data?.cedula && lastQueried.current.cedula === data.cedula.value) {
        const exists = Boolean(data.cedula.exists);
        setCedulaExists(exists);
        setErrors((prev) => ({ ...prev, cedula: exists ? "Cédula ya registrada." : "" }));
      }
      if (data?.email && lastQueried.current.email === data.email.value) {
        const exists = Boolean(data.email.exists);
        setEmailExists(exists);
        setErrors((prev) => ({ ...prev, email: exists ? "Correo ya registrado." : "" }));
      }
      if (data?.celular && lastQueried.current.celular === data.celular.value) {
        const exists = Boolean(data.celular.exists);
        setCelularExists(exists);
        setErrors((prev) => ({ ...prev, celular: exists ? "Celular ya registrado." : "" }));
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
    const c = personal.cedula;
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
    const m = personal.email.trim();
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
    const c = personal.celular.trim();
    if (!c) return;
    if (!/^09\d{8}$/.test(c)) {
      setErrors((p) => ({ ...p, celular: "El celular debe iniciar con 09 y tener 10 dígitos." }));
      setCelularExists(null);
      return;
    }
    setErrors((p) => ({ ...p, celular: "" }));
    lastQueried.current.celular = c;
    verificarUnico({ celular: c });
  };

  const debouncedCheckCedula = useDebouncedCallback(() => {
    const c = personal.cedula;
    if (/^\d{10}$/.test(c) && isValidCedulaEC(c)) {
      lastQueried.current.cedula = c;
      verificarUnico({ cedula: c });
    } else setCedulaExists(null);
  }, 400);
  const debouncedCheckEmail = useDebouncedCallback(() => {
    const m = personal.email.trim();
    if (isValidEmail(m)) {
      lastQueried.current.email = m;
      verificarUnico({ email: m });
    } else setEmailExists(null);
  }, 400);
  const debouncedCheckCelular = useDebouncedCallback(() => {
    const c = personal.celular.trim();
    if (/^09\d{8}$/.test(c)) {
      lastQueried.current.celular = c;
      verificarUnico({ celular: c });
    } else setCelularExists(null);
  }, 400);

  useEffect(() => {
    if (personal.cedula) debouncedCheckCedula();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal.cedula]);
  useEffect(() => {
    if (personal.email) debouncedCheckEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal.email]);
  useEffect(() => {
    if (personal.celular) debouncedCheckCelular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal.celular]);

  /* ------- Validaciones por paso ------- */
  const validateStep1 = () => {
    const newErrors: Errors = {};
    if (!personal.primer_nombre.trim()) newErrors.primer_nombre = "El primer nombre es obligatorio.";
    if (!personal.primer_apellido.trim()) newErrors.primer_apellido = "El primer apellido es obligatorio.";
    if (!personal.segundo_apellido.trim()) newErrors.segundo_apellido = "Ingrese el segundo apellido.";
    if (!/^\d{10}$/.test(personal.cedula) || !isValidCedulaEC(personal.cedula)) newErrors.cedula = "Cédula inválida.";
    if (!/^09\d{8}$/.test(personal.celular))
      newErrors.celular = "El celular debe iniciar con 09 y tener 10 dígitos.";
    if (cedulaExists === true) newErrors.cedula = "Cédula ya registrada.";
    if (!isValidEmail(personal.email)) newErrors.email = "Correo inválido.";
    if (emailExists === true) newErrors.email = "Correo ya registrado.";
    if (celularExists === true) newErrors.celular = "Celular ya registrado.";
    if (!personal.fecha_nacimiento) newErrors.fecha_nacimiento = "La fecha de nacimiento es obligatoria.";
    else if (!atLeastSixMonthsOld(personal.fecha_nacimiento))
      newErrors.fecha_nacimiento = "Debe tener al menos 6 meses de edad.";
    if (personal.password.length < 6) newErrors.password = "Mínimo 6 caracteres.";
    else if (!hasLettersAndNumbers(personal.password)) newErrors.password = "Debe contener letras y números.";
    if (personal.password2 !== personal.password) newErrors.password2 = "Las contraseñas no coinciden.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0 ? "" : "Corrige los campos marcados.";
  };
  const validateStep2 = () => {
    const newErrors: Errors = {};
    if (!clinico.sexo) newErrors.sexo = "Selecciona el sexo.";
    if (!clinico.tipo_sangre) newErrors.tipo_sangre = "Selecciona el tipo de sangre.";
    setErrors((prev) => ({ ...prev, ...newErrors }));
    return Object.keys(newErrors).length === 0 ? "" : "Completa los campos requeridos.";
  };
  const validateStep3 = () => {
    const newErrors: Errors = {};
    if (!fullNameTwoWords(emergencia.contacto_emergencia_nom))
      newErrors.contacto_emergencia_nom = "Ingresa nombre y apellido del contacto.";
    if (!/^09\d{8}$/.test(emergencia.contacto_emergencia_cel))
      newErrors.contacto_emergencia_cel = "El celular debe iniciar con 09 y tener 10 dígitos.";
    setErrors((prev) => ({ ...prev, ...newErrors }));
    return Object.keys(newErrors).length === 0 ? "" : "Corrige los datos del contacto.";
  };

  const next = () => {
    setErrorTop("");
    if (step === 1) {
      const e = validateStep1();
      if (e) return setErrorTop(e);
      setStep(2);
    } else if (step === 2) {
      const e = validateStep2();
      if (e) return setErrorTop(e);
      setStep(3);
    } else if (step === 3) {
      const e = validateStep3();
      if (e) return setErrorTop(e);
      setStep(4);
    }
  };
  const back = () => {
    setErrorTop("");
    setStep((s) => (s === 4 ? 3 : s === 3 ? 2 : 1));
  };

  const inputClass = (field?: keyof Errors) =>
    `w-full rounded-lg border px-4 py-2 ${
      field && errors[field] ? "border-red-500 focus:ring-2 focus:ring-red-500" : "border-gray-300"
    }`;

  /* ------- Envío ------- */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorTop("");
    if (step < 4) return next();

    try {
      setLoading(true);
      // 1) Crear Usuario (rol=2 Paciente) + activo=true
      const fd = new FormData();
      Object.entries({
        ...personal,
        password: personal.password,
        id_rol: "2",
        sexo: clinico.sexo,
        tipo_sangre: clinico.tipo_sangre,
      }).forEach(([k, v]) => fd.append(k, String(v)));
      fd.delete("password2");
      fd.append("activo", "true");
      if (foto) fd.append("foto", foto);

      const userRes = await api.post(`/usuarios/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const id_usuario = userRes.data.id_usuario;

      // 2) Crear Paciente
      const pacRes = await api.post(`/pacientes/`, {
        id_usuario,
        contacto_emergencia_nom: emergencia.contacto_emergencia_nom,
        contacto_emergencia_cel: emergencia.contacto_emergencia_cel,
        contacto_emergencia_par: emergencia.parSelect,
      });
      const id_paciente = pacRes.data.id_paciente ?? pacRes.data.id;

      // 3) Registrar ENFERMEDADES PROPIAS
      for (const row of propias) {
        if (id_paciente && row.sel) {
          await api.post(`/paciente-antecedentes/`, {
            id_paciente,
            id_antecedente: row.sel,
            relacion_familiar: "propio",
          });
        }
      }
      // 4) Registrar ANTECEDENTES FAMILIARES
      for (const row of familiares) {
        if (id_paciente && row.sel) {
          await api.post(`/paciente-antecedentes/`, {
            id_paciente,
            id_antecedente: row.sel,
            relacion_familiar: row.relacion,
          });
        }
      }

      // 5) Éxito
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        navigate("/odontologo/pacientes");
      }, 1000);
    } catch (err: any) {
      console.error("Registro (odontólogo) falló:", err?.response?.data || err);
      setErrorTop(
        err?.response?.data
          ? JSON.stringify(err.response.data)
          : "No se pudo completar el registro. Revisa los datos e intenta nuevamente."
      );
    } finally {
      setLoading(false);
    }
  };

  /* ------- Select de antecedentes (dinámico + “Otro” + botón Agregar) ------- */
  const AntecedenteSelect = ({
    value,
    onChangeSel,
    withRelacion,
    relacion,
    onChangeRelacion,
    options,
    onAskAdd,
  }: {
    value: number | "" | typeof OTHER;
    onChangeSel: (val: number | "" | typeof OTHER) => void;
    withRelacion?: boolean;
    relacion?: Exclude<FamiliarRel, "propio">;
    onChangeRelacion?: (rel: Exclude<FamiliarRel, "propio">) => void;
    options: AntecedenteOpt[];
    onAskAdd: () => void;
  }) => {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="flex gap-2">
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            value={value === "" ? "" : String(value)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === OTHER) onChangeSel(OTHER);
              else onChangeSel(v === "" ? "" : Number(v));
            }}
          >
            <option value="">Selecciona antecedente…</option>
            {options.map((opt) => (
              <option key={opt.id_antecedente} value={String(opt.id_antecedente)}>
                {opt.nombre}
              </option>
            ))}
            <option value={OTHER}>Otro (especificar…)</option>
          </select>

          <button
            type="button"
            onClick={onAskAdd}
            className="shrink-0 rounded-md border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            title="Agregar un antecedente nuevo"
          >
            Agregar
          </button>
        </div>

        {withRelacion && (
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            value={relacion}
            onChange={(e) => onChangeRelacion?.(e.target.value as Exclude<FamiliarRel, "propio">)}
          >
            <option value="padres">Padres</option>
            <option value="hermanos">Hermanos</option>
            <option value="abuelos">Abuelos</option>
          </select>
        )}
      </div>
    );
  };

  const sexoLabel = (s: string) => (s === "M" ? "Masculino" : s === "F" ? "Femenino" : "—");
  const nombreAntecedente = (id: number) =>
    antecedentesOpts.find((a) => a.id_antecedente === id)?.nombre ?? `#${id}`;

  /* ------- Control modal “Agregar antecedente” ------- */
  const [addAntOpen, setAddAntOpen] = useState(false);
  const [addAntBusy, setAddAntBusy] = useState(false);
  const [addAntPrefill, setAddAntPrefill] = useState("");
  const [triggerRow, setTriggerRow] = useState<{ kind: "propio" | "familiar"; id: string } | null>(null);

  function openAddModal(kind: "propio" | "familiar", rowId: string, prefill = "") {
    setTriggerRow({ kind, id: rowId });
    setAddAntPrefill(prefill);
    setAddAntOpen(true);
  }
  async function handleCreateAntecedente(name: string) {
    setAddAntBusy(true);
    try {
      const newId = await ensureAntecedenteByName(name);
      if (triggerRow) {
        if (triggerRow.kind === "propio") {
          setPropias((arr) => arr.map((r) => (r.id === triggerRow.id ? { ...r, sel: newId } : r)));
        } else {
          setFamiliares((arr) => arr.map((r) => (r.id === triggerRow.id ? { ...r, sel: newId } : r)));
        }
      }
      setAddAntOpen(false);
    } finally {
      setAddAntBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl text-white shadow-lg px-4 py-3" style={{ backgroundColor: PRIMARY }}>
            <div className="font-semibold">¡Paciente creado correctamente!</div>
            <div className="text-sm text-white/90">Redirigiendo…</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">👤 Nuevo Paciente</h1>
        <Link to="/odontologo/pacientes" className="rounded-lg text-white px-4 py-2 shadow hover:opacity-90" style={{ backgroundColor: PRIMARY }}>
          Volver al listado
        </Link>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-6">
        {[{ n: 1, t: "Datos personales" }, { n: 2, t: "Datos clínicos" }, { n: 3, t: "Contacto de emergencia" }, { n: 4, t: "Revisión" }].map((s) => (
          <div key={s.n} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full grid place-items-center text-sm font-semibold ${
                step >= (s.n as 1 | 2 | 3 | 4) ? "text-white" : "bg-gray-200 text-gray-600"
              }`}
              style={step >= (s.n as 1 | 2 | 3 | 4) ? { backgroundColor: PRIMARY } : {}}
            >
              {s.n}
            </div>
            <span className="hidden sm:block text-sm text-gray-700">{s.t}</span>
          </div>
        ))}
      </div>

      {errorTop && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorTop}</div>
      )}

      {/* Formulario */}
      <form onSubmit={handleSubmit} className="rounded-xl bg-white shadow-md p-4 space-y-6">
        {/* PASO 1 */}
        {step === 1 && (
          <>
            {/* Foto */}
            <div className="rounded-lg border p-4 bg-gray-50">
              <label className="block text-sm font-medium text-gray-700 mb-3">Foto (opcional)</label>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="w-28 h-28 rounded-full overflow-hidden border bg-white grid place-items-center">
                  {fotoPreview ? (
                    <img src={fotoPreview} alt="Vista previa" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-10 h-10 text-gray-400" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input id="fotoPaciente" ref={fotoInputRef} type="file" accept="image/*" className="hidden" onChange={handleSelectFoto} />
                  <label
                    htmlFor="fotoPaciente"
                    className="cursor-pointer rounded-lg text-white px-4 py-2 shadow hover:opacity-90"
                    style={{ backgroundColor: PRIMARY }}
                  >
                    Seleccionar archivo
                  </label>
                  {foto && (
                    <button
                      type="button"
                      onClick={handleClearFoto}
                      className="rounded-lg border bg-white px-4 py-2 hover:bg-gray-50"
                      title="Quitar la foto seleccionada"
                    >
                      Quitar selección
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Formatos: JPG/PNG. Recomendado: imagen cuadrada.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Primer nombre</label>
                <input name="primer_nombre" value={personal.primer_nombre} onChange={(e) => onChange(setPersonal, e)} className={inputClass("primer_nombre")} required />
                {errors.primer_nombre && <p className="mt-1 text-sm text-red-600">{errors.primer_nombre}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Segundo nombre (Opcional)</label>
                <input name="segundo_nombre" value={personal.segundo_nombre} onChange={(e) => onChange(setPersonal, e)} className="w-full rounded-lg border border-gray-300 px-4 py-2" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Primer apellido</label>
                <input name="primer_apellido" value={personal.primer_apellido} onChange={(e) => onChange(setPersonal, e)} className={inputClass("primer_apellido")} required />
                {errors.primer_apellido && <p className="mt-1 text-sm text-red-600">{errors.primer_apellido}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Segundo apellido</label>
                <input name="segundo_apellido" value={personal.segundo_apellido} onChange={(e) => onChange(setPersonal, e)} className={inputClass("segundo_apellido")} required />
                {errors.segundo_apellido && <p className="mt-1 text-sm text-red-600">{errors.segundo_apellido}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Cédula</label>
                <input
                  name="cedula"
                  value={personal.cedula}
                  onChange={handleNumeric(setPersonal, "cedula", 10)}
                  onBlur={handleCedulaBlur}
                  className={inputClass("cedula")}
                  placeholder="10 dígitos"
                  inputMode="numeric"
                  maxLength={10}
                  required
                />
                {errors.cedula && <p className="mt-1 text-sm text-red-600">{errors.cedula}</p>}
                {checkingCedula && !errors.cedula && <p className="mt-1 text-xs text-gray-500">Verificando cédula…</p>}
                {cedulaExists === false && !errors.cedula && <p className="mt-1 text-xs text-green-600">Cédula validada</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Celular</label>
                <input
                  name="celular"
                  value={personal.celular}
                  onChange={handleNumeric(setPersonal, "celular", 10)}
                  onBlur={handleCelularBlur}
                  className={inputClass("celular")}
                  placeholder="09xxxxxxxx"
                  inputMode="numeric"
                  maxLength={10}
                  required
                />
                {errors.celular && <p className="mt-1 text-sm text-red-600">{errors.celular}</p>}
                {checkingCelular && !errors.celular && <p className="mt-1 text-xs text-gray-500">Verificando celular…</p>}
                {celularExists === false && !errors.celular && <p className="mt-1 text-xs text-green-600">Celular validado</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Correo</label>
                <input type="email" name="email" value={personal.email} onChange={(e) => onChange(setPersonal, e)} onBlur={handleEmailBlur} className={inputClass("email")} required />
                {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
                {checkingEmail && !errors.email && <p className="mt-1 text-xs text-gray-500">Verificando correo…</p>}
                {emailExists === false && !errors.email && <p className="mt-1 text-xs text-green-600">Correo validado</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Fecha de nacimiento</label>
                <input type="date" name="fecha_nacimiento" value={personal.fecha_nacimiento} onChange={(e) => onChange(setPersonal, e)} className={inputClass("fecha_nacimiento")} required />
                {errors.fecha_nacimiento && <p className="mt-1 text-sm text-red-600">{errors.fecha_nacimiento}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Contraseña</label>
                <div className="relative">
                  <input type={showPass1 ? "text" : "password"} name="password" value={personal.password} onChange={(e) => onChange(setPersonal, e)} className={`${inputClass("password")} pr-12`} required />
                  <button
                    type="button"
                    onClick={() => setShowPass1((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    aria-label={showPass1 ? "Ocultar contraseña" : "Mostrar contraseña"}
                    title={showPass1 ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPass1 ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {errors.password && <p className="mt-1 text-sm text-red-600">{errors.password}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Repite la contraseña</label>
                <div className="relative">
                  <input type={showPass2 ? "text" : "password"} name="password2" value={personal.password2} onChange={(e) => onChange(setPersonal, e)} className={`${inputClass("password2")} pr-12`} required />
                  <button
                    type="button"
                    onClick={() => setShowPass2((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    aria-label={showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"}
                    title={showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPass2 ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {errors.password2 && <p className="mt-1 text-sm text-red-600">{errors.password2}</p>}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Link to="/odontologo/pacientes" className="text-sm text-gray-600 hover:underline">
                Cancelar
              </Link>
              <button
                type="button"
                onClick={next}
                disabled={
                  checkingCedula ||
                  checkingEmail ||
                  checkingCelular ||
                  cedulaExists === true ||
                  emailExists === true ||
                  celularExists === true
                }
                className="rounded-lg px-5 py-2 font-medium text-white disabled:opacity-70"
                style={{ backgroundColor: PRIMARY }}
              >
                Siguiente
              </button>
            </div>
          </>
        )}

        {/* PASO 2 */}
        {step === 2 && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700">Sexo</label>
              <select name="sexo" value={clinico.sexo} onChange={(e) => onChange(setClinico, e)} className={inputClass("sexo")} required>
                <option value="">Selecciona…</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
              {errors.sexo && <p className="mt-1 text-sm text-red-600">{errors.sexo}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Tipo de sangre</label>
              <select name="tipo_sangre" value={clinico.tipo_sangre} onChange={(e) => onChange(setClinico, e)} className={inputClass("tipo_sangre")} required>
                <option value="">Selecciona…</option>
                <option value="Desconocido">Desconocido</option>
                {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              {errors.tipo_sangre && <p className="mt-1 text-sm text-red-600">{errors.tipo_sangre}</p>}
            </div>

            {/* Estado de carga/errores de antecedentes */}
            {loadingAnt && (
              <div className="rounded-md border bg-gray-50 p-2 text-sm text-gray-600 mb-2">
                Cargando antecedentes…
              </div>
            )}
            {errorAnt && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 mb-2">
                {errorAnt}
              </div>
            )}

            {/* Propias (opcional) */}
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Enfermedades propias (opcional)</h3>
              {propias.length === 0 && <p className="text-sm text-gray-500 mb-2">No has añadido ninguna.</p>}

              <div className="space-y-3">
                {propias.map((row) => (
                  <div key={row.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <AntecedenteSelect
                        value={row.sel as any}
                        options={antecedentesOpts}
                        onAskAdd={() => openAddModal("propio", row.id)}
                        onChangeSel={(val) => {
                          if (val === OTHER) {
                            openAddModal("propio", row.id);
                            return;
                          }
                          setPropias((arr) => arr.map((r) => (r.id === row.id ? { ...r, sel: val as any } : r)));
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setPropias((arr) => arr.filter((r) => r.id !== row.id))}
                        className="self-start rounded-md border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={loadingAnt}
                onClick={() => setPropias((arr) => [...arr, { id: makeId(), sel: "" }])}
                className="mt-3 rounded-lg px-4 py-2 text-white"
                style={{ backgroundColor: PRIMARY }}
              >
                Añadir enfermedad propia
              </button>
            </div>

            {/* Familiares (opcional) */}
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Antecedentes familiares (opcional)</h3>
              {familiares.length === 0 && <p className="text-sm text-gray-500 mb-2">No has añadido ninguno.</p>}

              <div className="space-y-3">
                {familiares.map((row) => (
                  <div key={row.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <AntecedenteSelect
                        value={row.sel as any}
                        options={antecedentesOpts}
                        withRelacion
                        relacion={row.relacion}
                        onAskAdd={() => openAddModal("familiar", row.id)}
                        onChangeRelacion={(rel) =>
                          setFamiliares((arr) => arr.map((r) => (r.id === row.id ? { ...r, relacion: rel } : r)))
                        }
                        onChangeSel={(val) => {
                          if (val === OTHER) {
                            openAddModal("familiar", row.id);
                            return;
                          }
                          setFamiliares((arr) => arr.map((r) => (r.id === row.id ? { ...r, sel: val as any } : r)));
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setFamiliares((arr) => arr.filter((r) => r.id !== row.id))}
                        className="self-start sm:ml-auto rounded-md border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={loadingAnt}
                onClick={() => setFamiliares((arr) => [...arr, { id: makeId(), sel: "", relacion: "padres" }])}
                className="mt-3 rounded-lg px-4 py-2 text-white"
                style={{ backgroundColor: PRIMARY }}
              >
                Añadir antecedente familiar
              </button>
            </div>

            <div className="flex items-center justify-between">
              <button type="button" onClick={back} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">
                Atrás
              </button>

              <div className="flex gap-3">
                <Link to="/odontologo/pacientes" className="text-sm text-gray-600 hover:underline">
                  Cancelar
                </Link>
                <button type="button" onClick={next} className="rounded-lg px-5 py-2 font-medium text-white" style={{ backgroundColor: PRIMARY }}>
                  Continuar
                </button>
              </div>
            </div>
          </>
        )}

        {/* PASO 3 */}
        {step === 3 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Nombre contacto emergencia</label>
                <input
                  name="contacto_emergencia_nom"
                  value={emergencia.contacto_emergencia_nom}
                  onChange={(e) => onChange(setEmergencia, e)}
                  className={inputClass("contacto_emergencia_nom")}
                  placeholder="Nombre y apellido"
                  required
                />
                {errors.contacto_emergencia_nom && (
                  <p className="mt-1 text-sm text-red-600">{errors.contacto_emergencia_nom}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Celular emergencia</label>
                <input
                  name="contacto_emergencia_cel"
                  value={emergencia.contacto_emergencia_cel}
                  onChange={handleNumeric(setEmergencia, "contacto_emergencia_cel", 10)}
                  className={inputClass("contacto_emergencia_cel")}
                  placeholder="09xxxxxxxx"
                  inputMode="numeric"
                  maxLength={10}
                  required
                />
                {errors.contacto_emergencia_cel && (
                  <p className="mt-1 text-sm text-red-600">{errors.contacto_emergencia_cel}</p>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Parentesco</label>
                <select
                  name="parSelect"
                  value={emergencia.parSelect}
                  onChange={(e) => onChange(setEmergencia, e)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2"
                  required
                >
                  <option value="">Selecciona…</option>
                  <option value="hijos">Hijos</option>
                  <option value="padres">Padres</option>
                  <option value="hermanos">Hermanos</option>
                  <option value="abuelos">Abuelos</option>
                  <option value="esposos">Esposos</option>
                  <option value="otros">Otros</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button type="button" onClick={back} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">
                Atrás
              </button>

              <div className="flex gap-3">
                <Link to="/odontologo/pacientes" className="text-sm text-gray-600 hover:underline">
                  Cancelar
                </Link>
                <button type="button" onClick={next} className="rounded-lg px-5 py-2 font-medium text-white" style={{ backgroundColor: PRIMARY }}>
                  Continuar
                </button>
              </div>
            </div>
          </>
        )}

        {/* PASO 4: Revisión */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="font-semibold">Revisión</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <strong>Nombre:</strong> {personal.primer_nombre} {personal.segundo_nombre} {personal.primer_apellido} {personal.segundo_apellido}
              </div>
              <div><strong>Cédula:</strong> {personal.cedula}</div>
              <div><strong>Correo:</strong> {personal.email}</div>
              <div><strong>Celular:</strong> {personal.celular}</div>
              <div><strong>Fecha de nacimiento:</strong> {personal.fecha_nacimiento || "—"}</div>
              <div><strong>Sexo:</strong> {sexoLabel(clinico.sexo)}</div>
              <div><strong>Tipo de sangre:</strong> {clinico.tipo_sangre || "—"}</div>

              <div className="sm:col-span-2">
                <strong>Enfermedades propias:</strong>{" "}
                {propias.filter((p) => p.sel).length === 0
                  ? "—"
                  : propias.filter((p) => p.sel).map((p) => nombreAntecedente(p.sel as number)).join(", ")}
              </div>
              <div className="sm:col-span-2">
                <strong>Antecedentes familiares:</strong>{" "}
                {familiares.filter((f) => f.sel).length === 0
                  ? "—"
                  : familiares
                      .filter((f) => f.sel)
                      .map((f) => `${nombreAntecedente(f.sel as number)} (${f.relacion})`)
                      .join(", ")}
              </div>

              <div className="sm:col-span-2">
                <strong>Contacto de emergencia:</strong>{" "}
                {emergencia.contacto_emergencia_nom || "—"} — {emergencia.contacto_emergencia_cel || "—"} — {emergencia.parSelect || "—"}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button type="button" onClick={back} className="rounded-lg border px-4 py-2 text-gray-700 hover:bg-gray-50">
                Atrás
              </button>
              <div className="flex items-center gap-3">
                <Link to="/odontologo/pacientes" className="text-sm text-gray-600 hover:underline">
                  Cancelar
                </Link>
                <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-lg px-5 py-2 font-medium text-white disabled:opacity-60" style={{ backgroundColor: PRIMARY }}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {loading ? "Guardando…" : "Guardar paciente"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal agregar antecedente */}
        <AddAntecedenteModal
          open={addAntOpen}
          initialValue={addAntPrefill}
          busy={addAntBusy}
          onCancel={() => setAddAntOpen(false)}
          onConfirmName={handleCreateAntecedente}
        />
      </form>
    </div>
  );
}