// src/pages/admin/OdontologoEdicion.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/axios";
import { Eye, EyeOff, Pencil } from "lucide-react";

/* ===== Tipos ===== */
type Odontologo = {
  id_odontologo: number;
  // Usuario
  cedula: string | null;
  primer_nombre?: string | null;
  segundo_nombre?: string | null;
  primer_apellido?: string | null;
  segundo_apellido?: string | null;
  nombreCompleto?: string | null;
  sexo?: string | null;
  fecha_nacimiento?: string | null;
  tipo_sangre?: string | null;
  celular?: string | null;
  usuario_email?: string | null;
  is_active: boolean;
  foto?: string | null;

  // Profesional
  especialidades?: string[];
  especialidades_detalle?: {
    nombre: string | null;
    universidad?: string | null;
    estado?: boolean;
  }[];

  // Laboral
  consultorio_defecto?: { id_consultorio: number; numero: string } | null;
  horarios?: {
    dia_semana: number; // 0..6
    hora_inicio: string; // "09:00"
    hora_fin: string; // "17:00"
    vigente: boolean;
  }[];
};

type Consultorio = {
  id_consultorio: number;
  numero: string;
};

type EspecialidadOption = {
  id_especialidad: number;
  nombre: string;
};

type HorarioForm = {
  dia_semana: number;
  habilitado: boolean;
  hora_inicio: string;
  hora_fin: string;
};

type Toast = { id: number; message: string; type?: "success" | "error" };

const DIAS_LABEL: Record<number, string> = {
  0: "Lun",
  1: "Mar",
  2: "Mié",
  3: "Jue",
  4: "Vie",
  5: "Sáb",
  6: "Dom",
};
// Orden de visualización: L → D
const DAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;

const TIPOS_SANGRE = [
  "O+",
  "O-",
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
] as const;

/* ===========================
   Helpers de validación
=========================== */
// Convierte "HH:MM", "HH:MM:SS" o "HH:MM AM/PM" a minutos desde 00:00.
// Devuelve NaN si no se puede parsear.
function timeToMinutes(raw: string): number {
  if (!raw) return NaN;
  const s = raw.trim();
  const [hhmm, ampm] = s.split(/\s+/);
  const parts = hhmm.split(":");
  if (parts.length < 2) return NaN;
  let hh = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return NaN;
  if (ampm) {
    const up = ampm.toUpperCase();
    if (up.startsWith("AM")) {
      if (hh === 12) hh = 0;
    } else if (up.startsWith("PM")) {
      if (hh < 12) hh += 12;
    }
  }
  return hh * 60 + mm;
}

// Cédula Ecuador (persona natural)
function isValidCedulaEC(ci: string): boolean {
  if (!/^\d{10}$/.test(ci)) return false;
  const provincia = parseInt(ci.slice(0, 2), 10);
  if (provincia < 1 || (provincia > 24 && provincia !== 30)) return false; // 30 opcional
  const tercer = parseInt(ci[2], 10);
  if (tercer >= 6) return false; // natural
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

function useDebouncedCallback(cb: () => void, delay = 400) {
  const t = useRef<number | undefined>(undefined as any);
  return () => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(cb, delay);
  };
}

function normSexo(v?: string | null): "M" | "F" | "" {
  if (!v) return "";
  const s = String(v).trim().toUpperCase();
  if (s === "M" || s.startsWith("MASC")) return "M";
  if (s === "F" || s.startsWith("FEM")) return "F";
  return "";
}

function splitNombreCompleto(full?: string | null) {
  const tokens = (full ?? "").split(" ").filter(Boolean);
  const [pnom = "", snom = "", pape = "", sape = ""] = tokens;
  return { pnom, snom, pape, sape };
}

/* ========= Helper URL de foto (evita /api/v1 en media) ========= */
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

/* ===========================
   Toast
=========================== */
function ToastView({
  items,
  remove,
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
          onAnimationEnd={() => remove(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ===========================
   Componente
=========================== */
export default function OdontologoEdicion() {
  const { id } = useParams();
  const odontologoId = useMemo(() => Number(id), [id]);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [odo, setOdo] = useState<Odontologo | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoRemove, setFotoRemove] = useState<boolean>(false);

  // Mostrar/Ocultar contraseñas
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  // ---------- DECLARA EL FORM ANTES DE USARLO ----------
  const [form, setForm] = useState({
    primer_nombre: "",
    segundo_nombre: "",
    primer_apellido: "",
    segundo_apellido: "",
    cedula: "",
    sexo: "" as "" | "M" | "F",
    fecha_nacimiento: "",
    tipo_sangre: "",
    celular: "",
    usuario_email: "",
    password: "",
    password_confirm: "",
    is_active: false,
    especialidades_detalle: [] as {
      nombre: string | null;
      universidad?: string | null;
      estado?: boolean;
    }[],
  });

  // --- Live password checks ---
  const [pwdTouched, setPwdTouched] = useState(false);
  const [pwd2Touched, setPwd2Touched] = useState(false);

  const pwd = form.password ?? "";
  const pwd2 = form.password_confirm ?? "";

  // Criterios
  const pwdHasMin = pwd.length >= 6;
  const pwdHasUpper = /[A-Z]/.test(pwd);
  const pwdHasDigit = /\d/.test(pwd);
  const pwdStrong = pwdHasMin && pwdHasUpper && pwdHasDigit;

  // Coincidencia
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

  // Consultorios / Especialidades opciones
  const [consultorios, setConsultorios] = useState<Consultorio[]>([]);
  const [consultorioId, setConsultorioId] = useState<number | "">("");
  const [especialidadesOpts, setEspecialidadesOpts] = useState<
    EspecialidadOption[]
  >([]);

  // Horarios form (7 días)
  const [horarios, setHorarios] = useState<HorarioForm[]>(
    Array.from({ length: 7 }).map((_, i) => ({
      dia_semana: i,
      habilitado: false,
      hora_inicio: "",
      hora_fin: "",
    }))
  );

  // Errores por campo
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
      | "usuario_email"
      | "consultorio_defecto_id"
      | "especialidades"
      | "especialidades_universidad"
      | "especialidades_estado"
      | "horarios"
      | "password"
      | "password_confirm",
      string
    >
  >;
  const [errors, setErrors] = useState<Errors>({});
  // ==== Modal de confirmación de estado ====
  const [modalOpen, setModalOpen] = useState(false);
  const [previewCitas, setPreviewCitas] = useState<any[]>([]);
  const [changingToActive, setChangingToActive] = useState<boolean | null>(
    null
  );

  // Verificación remota (cédula / email / celular)
  const [checkingCedula, setCheckingCedula] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [checkingCelular, setCheckingCelular] = useState(false); // NUEVO
  const [cedulaExists, setCedulaExists] = useState<boolean | null>(null);
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [celularExists, setCelularExists] = useState<boolean | null>(null); // NUEVO
  const lastQueried = useRef<{
    cedula?: string;
    email?: string;
    celular?: string;
  }>({}); // NUEVO

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

  /* ===========================
     Carga inicial
  =========================== */
  useEffect(() => {
    if (Number.isNaN(odontologoId)) return;
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const [odoRes, consRes, espRes] = await Promise.allSettled([
          api.get(`/odontologos/${odontologoId}/`),
          api.get(`/consultorios/`),
          api.get(`/especialidades/`),
        ]);

        if (!alive) return;

        // Especialidades opciones
        if (espRes.status === "fulfilled") {
          const list = (espRes.value.data as any[])
            .map((x) => ({
              id_especialidad: x.id_especialidad ?? x.id ?? 0,
              nombre: x.nombre ?? "",
            }))
            .filter((x) => x.nombre);
          setEspecialidadesOpts(list);
        }

        // Consultorios
        if (consRes.status === "fulfilled") {
          const list = consRes.value.data as Consultorio[];
          setConsultorios(list);
        }

        // Odontólogo
        if (odoRes.status === "fulfilled") {
          const data = odoRes.value.data as Odontologo;
          const foto = absolutize(data.foto);
          const normalized = { ...data, foto };
          setOdo(normalized);

          // reset bandera de eliminar foto
          setFotoRemove(false);

          const { pnom, snom, pape, sape } =
            !data.primer_nombre && data.nombreCompleto
              ? splitNombreCompleto(data.nombreCompleto)
              : {
                  pnom: data.primer_nombre ?? "",
                  snom: data.segundo_nombre ?? "",
                  pape: data.primer_apellido ?? "",
                  sape: data.segundo_apellido ?? "",
                };

          setForm({
            primer_nombre: pnom,
            segundo_nombre: snom,
            primer_apellido: pape,
            segundo_apellido: sape,
            cedula: (data.cedula ?? "").toString(),
            sexo: normSexo(data.sexo),
            fecha_nacimiento: data.fecha_nacimiento ?? "",
            tipo_sangre: (data.tipo_sangre ?? "").toString(),
            celular: (data.celular ?? "").toString(),
            usuario_email: (data.usuario_email ?? "").toString(),
            password: "",
            password_confirm: "",
            is_active: !!data.is_active,
            especialidades_detalle: Array.isArray(data.especialidades_detalle)
              ? data.especialidades_detalle.map((d: any) => ({
                  nombre: d?.nombre ?? null,
                  universidad: d?.universidad ?? "",
                  estado: !!d?.estado,
                }))
              : Array.isArray(data.especialidades)
              ? data.especialidades.map((n) => ({
                  nombre: n ?? null,
                  universidad: "",
                  estado: true,
                }))
              : [],
          });

          if (data.consultorio_defecto?.id_consultorio) {
            setConsultorioId(Number(data.consultorio_defecto.id_consultorio));
          }

          const base = Array.from({ length: 7 }).map((_, i) => ({
            dia_semana: i,
            habilitado: false,
            hora_inicio: "",
            hora_fin: "",
          })) as HorarioForm[];

          if (Array.isArray(data.horarios) && data.horarios.length) {
            data.horarios.forEach((h) => {
              const idx = h.dia_semana;
              if (idx >= 0 && idx <= 6) {
                base[idx] = {
                  dia_semana: idx,
                  habilitado: !!h.vigente,
                  hora_inicio: h.hora_inicio || "",
                  hora_fin: h.hora_fin || "",
                };
              }
            });
          }
          setHorarios(base);
        } else {
          setError("No se pudo cargar el perfil para edición.");
        }
      } catch (e: any) {
        console.error(e);
        setError("Error al cargar datos.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [odontologoId]);

  /* ======= Preview de foto seleccionada ======= */
  useEffect(() => {
    if (!fotoFile) {
      setFotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(fotoFile);
    setFotoPreview(url);
    // si sube una nueva foto, ya no se “elimina” la anterior explícitamente
    setFotoRemove(false);
    return () => URL.revokeObjectURL(url);
  }, [fotoFile]);

  /* ===========================
     Handlers básicos
  =========================== */
  const onField = (k: keyof typeof form, v: string | boolean) => {
    setErrors((prev) => ({ ...prev, [k as any]: "" }));
    if (k === "cedula") setCedulaExists(null);
    if (k === "usuario_email") setEmailExists(null);
    if (k === "celular") setCelularExists(null); // NUEVO
    setForm((s) => ({ ...s, [k]: v as any }));
    // Validación en vivo de contraseña
    if (k === "password") {
      const nextPwd = String(v ?? "");
      if (!pwdTouched) setPwdTouched(true);
      setErrors((prev) => ({
        ...prev,
        password:
          nextPwd.length === 0
            ? ""
            : /^(?=.*[A-Z])(?=.*\d).{6,}$/.test(nextPwd)
            ? ""
            : "Mín. 6, una mayúscula y un número.",
        // si ya hay confirmación escrita, valida coincidencia al vuelo
        password_confirm:
          form.password_confirm && nextPwd !== form.password_confirm
            ? "No coincide."
            : "",
      }));
    }

    if (k === "password_confirm") {
      const nextPwd2 = String(v ?? "");
      if (!pwd2Touched) setPwd2Touched(true);
      setErrors((prev) => ({
        ...prev,
        password_confirm: nextPwd2 !== form.password ? "No coincide." : "",
      }));
    }
  };

  const onHorarioToggle = (dia: number, enabled: boolean) => {
    if (!form.is_active) return;
    setHorarios((arr) =>
      arr.map((h) =>
        h.dia_semana === dia
          ? {
              ...h,
              habilitado: enabled,
              ...(enabled
                ? {
                    hora_inicio: h.hora_inicio || "09:00",
                    hora_fin: h.hora_fin || "22:00",
                  }
                : { hora_inicio: "", hora_fin: "" }),
            }
          : h
      )
    );
  };

  const onHorarioHora = (
    dia: number,
    campo: "hora_inicio" | "hora_fin",
    value: string
  ) => {
    if (!form.is_active) return;
    setHorarios((arr) =>
      arr.map((h) => (h.dia_semana === dia ? { ...h, [campo]: value } : h))
    );
  };

  // Formación profesional
  const addEspecialidad = () => {
    setErrors((e) => ({ ...e, especialidades: "" }));
    setForm((s) => ({
      ...s,
      especialidades_detalle: [
        ...s.especialidades_detalle,
        { nombre: null, universidad: "", estado: true },
      ],
    }));
  };
  const removeEspecialidad = (idx: number) => {
    setForm((s) => {
      const arr = [...s.especialidades_detalle];
      arr.splice(idx, 1);
      return { ...s, especialidades_detalle: arr };
    });
  };
  const changeEspecialidadNombre = (idx: number, nombre: string) => {
    setForm((s) => {
      const arr = [...s.especialidades_detalle];
      arr[idx] = { ...arr[idx], nombre };
      return { ...s, especialidades_detalle: arr };
    });
  };

  /* ===========================
     Verificación remota (cedula/email/celular)
  =========================== */
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
        if (odo?.cedula && String(odo.cedula) === String(data.cedula.value)) {
          exists = false;
        }
        setCedulaExists(exists);
        setErrors((prev) => ({
          ...prev,
          cedula: exists ? "Cédula inválida." : "",
        }));
      }

      if (data?.email && lastQueried.current.email === data.email.value) {
        let exists = Boolean(data.email.exists);
        if (
          odo?.usuario_email &&
          String(odo.usuario_email).toLowerCase() ===
            String(data.email.value).toLowerCase()
        ) {
          exists = false;
        }
        setEmailExists(exists);
        setErrors((prev) => ({
          ...prev,
          usuario_email: exists ? "Correo inválido." : "",
        }));
      }

      if (data?.celular && lastQueried.current.celular === data.celular.value) {
        let exists = Boolean(data.celular.exists);
        if (
          odo?.celular &&
          String(odo.celular) === String(data.celular.value)
        ) {
          exists = false;
        }
        setCelularExists(exists);
        setErrors((prev) => ({
          ...prev,
          celular: exists ? "Celular ya registrado." : "",
        }));
      }
    } catch (e) {
      console.error("Fallo al verificar cedula/email/celular", e);
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
    const m = form.usuario_email.trim();
    if (!m) return;
    if (!isValidEmail(m)) {
      setErrors((p) => ({ ...p, usuario_email: "Correo inválido." }));
      setEmailExists(null);
      return;
    }
    setErrors((p) => ({ ...p, usuario_email: "" }));
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
    const m = form.usuario_email.trim();
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
    if (form.usuario_email) debouncedCheckEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.usuario_email]);

  useEffect(() => {
    if (form.celular) debouncedCheckCelular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.celular]);

  /* ===========================
     Validaciones antes de guardar
  =========================== */
  const validateBeforeSave = (): boolean => {
    const newErrors: Errors = {};

    // Datos personales
    if (!form.primer_nombre.trim()) newErrors.primer_nombre = "Obligatorio.";
    if (!form.primer_apellido.trim())
      newErrors.primer_apellido = "Obligatorio.";
    if (!form.segundo_apellido.trim())
      newErrors.segundo_apellido = "Obligatorio.";

    if (!/^\d{10}$/.test(form.cedula) || !isValidCedulaEC(form.cedula))
      newErrors.cedula = "Cédula inválida.";
    if (cedulaExists === true) newErrors.cedula = "Cédula inválida.";

    if (!form.sexo) newErrors.sexo = "Selecciona el sexo.";
    if (!form.fecha_nacimiento) newErrors.fecha_nacimiento = "Obligatorio.";
    if (!form.tipo_sangre)
      newErrors.tipo_sangre = "Selecciona el tipo de sangre.";

    // Celular: 10 dígitos y formato 09xxxxxxxx
    if (!/^09\d{8}$/.test(form.celular))
      newErrors.celular = "Formato 09xxxxxxxx.";
    if (celularExists === true) newErrors.celular = "Celular ya registrado.";

    // Email
    if (!isValidEmail(form.usuario_email))
      newErrors.usuario_email = "Correo inválido.";
    if (emailExists === true) newErrors.usuario_email = "Correo inválido.";

    // Contraseña (si se intenta cambiar)
    if (form.password.trim() || form.password_confirm.trim()) {
      if (!form.password.trim())
        newErrors.password = "Obligatoria si cambias la contraseña.";
      if (!form.password_confirm.trim())
        newErrors.password_confirm = "Obligatoria si cambias la contraseña.";
      if (form.password.trim() && form.password.trim().length < 6)
        newErrors.password = "Mínimo 6 caracteres.";
      if (
        form.password.trim() &&
        form.password_confirm.trim() &&
        form.password !== form.password_confirm
      )
        newErrors.password_confirm = "No coincide.";
    }

    // Consultorio por defecto
    if (consultorioId === "")
      newErrors.consultorio_defecto_id = "Selecciona un consultorio.";

    // Horarios
    if (form.is_active) {
      const anyEnabled = horarios.some((h) => h.habilitado);
      if (!anyEnabled) {
        newErrors.horarios = "Debe habilitar al menos un día.";
      } else {
        const MIN_M = 9 * 60;
        const MAX_M = 22 * 60; // 22:00
        const LUNCH_START_M = 13 * 60; // 13:00
        const LUNCH_END_M = 15 * 60; // 15:00

        for (const h of horarios) {
          if (!h.habilitado) continue;

          const ini = timeToMinutes(h.hora_inicio);
          const fin = timeToMinutes(h.hora_fin);

          if (Number.isNaN(ini) || Number.isNaN(fin)) {
            newErrors.horarios = "Completa las horas en días habilitados.";
            break;
          }

          // límites generales 09:00–22:00
          if (ini < MIN_M || fin > MAX_M) {
            newErrors.horarios = "Las horas deben estar entre 09:00 y 22:00.";
            break;
          }

          // ❌ Solo inválido si el INICIO o el FIN caen en 13:00–15:00
          const startInLunch = ini >= LUNCH_START_M && ini < LUNCH_END_M;
          const endInLunch = fin > LUNCH_START_M && fin <= LUNCH_END_M;
          if (startInLunch) {
            newErrors.horarios =
              "Fuera del horario laboral: inicio dentro del almuerzo (13:00–15:00).";
            break;
          }
          if (endInLunch) {
            newErrors.horarios =
              "Fuera del horario laboral: fin dentro del almuerzo (13:00–15:00).";
            break;
          }

          // orden y duración
          if (ini >= fin) {
            newErrors.horarios =
              "La hora de inicio debe ser menor que la hora fin.";
            break;
          }
          if (fin - ini < 120) {
            newErrors.horarios = "El rango mínimo por día es de 2 horas.";
            break;
          }
        }
      }
    }

    // Especialidades
    if (!form.especialidades_detalle.length) {
      newErrors.especialidades = "Debe añadir al menos una especialidad.";
    } else {
      const faltaNombre = form.especialidades_detalle.some(
        (e) => !e.nombre || !String(e.nombre).trim()
      );
      const faltaUniv = form.especialidades_detalle.some(
        (e) => !e.universidad || !String(e.universidad).trim()
      );
      const alguienAtiende = form.especialidades_detalle.some(
        (e) => !!e.estado
      );

      if (faltaNombre) newErrors.especialidades = "Selecciona la especialidad.";
      if (faltaUniv)
        newErrors.especialidades_universidad =
          "Universidad obligatoria por especialidad.";
      if (!alguienAtiende)
        newErrors.especialidades_estado =
          "Al menos una especialidad debe estar en 'Atiende'.";
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length) {
      pushToast("Corrige los campos marcados.", "error");
      return false;
    }
    return true;
  };

  /* ===========================
     Guardar
  =========================== */
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!odo) return;

    // Validaciones rápidas de contraseña (duplicadas a propósito para UX)
    if (form.password.trim() || form.password_confirm.trim()) {
      if (!form.password.trim()) {
        setErrors((p) => ({
          ...p,
          password: "Obligatoria si cambias la contraseña.",
        }));
        pushToast("Completa la contraseña.", "error");
        return;
      }
      if (!form.password_confirm.trim()) {
        setErrors((p) => ({
          ...p,
          password_confirm: "Obligatoria si cambias la contraseña.",
        }));
        pushToast("Confirma la contraseña.", "error");
        return;
      }
      if (form.password.trim().length < 6) {
        setErrors((p) => ({ ...p, password: "Mínimo 6 caracteres." }));
        pushToast("La contraseña debe tener al menos 6 caracteres.", "error");
        return;
      }
      if (form.password !== form.password_confirm) {
        setErrors((p) => ({ ...p, password_confirm: "No coincide." }));
        pushToast("Las contraseñas no coinciden.", "error");
        return;
      }
    }

    if (!validateBeforeSave()) return;

    // Si cambia el estado, abrimos modal en vez de guardar directo
    if (form.is_active !== odo.is_active) {
      setChangingToActive(form.is_active);
      try {
        const prev = await api.post(
          `/odontologos/${odo.id_odontologo}/preview-mantenimiento/`
        );
        setPreviewCitas(prev.data.items || []);
        setModalOpen(true);
      } catch (err) {
        pushToast("Error al previsualizar citas ❌", "error");
      }
      return; // detenemos el flujo hasta que confirme en modal
    }

    try {
      setSaving(true);
      setError(null);

      const horariosPayload = horarios.map((h) => ({
        dia_semana: h.dia_semana,
        hora_inicio: h.habilitado ? h.hora_inicio : "",
        hora_fin: h.habilitado ? h.hora_fin : "",
        vigente: h.habilitado,
      }));

      const fd = new FormData();
      fd.append("primer_nombre", form.primer_nombre || "");
      fd.append("segundo_nombre", form.segundo_nombre || "");
      fd.append("primer_apellido", form.primer_apellido || "");
      fd.append("segundo_apellido", form.segundo_apellido || "");
      fd.append("cedula", form.cedula || "");
      fd.append("sexo", form.sexo || "");
      fd.append("fecha_nacimiento", form.fecha_nacimiento || "");
      fd.append("tipo_sangre", form.tipo_sangre || "");
      fd.append("celular", form.celular || "");
      fd.append("usuario_email", form.usuario_email || "");
      fd.append("is_active", form.is_active ? "true" : "false");

      if (consultorioId !== "") {
        fd.append("consultorio_defecto_id", String(consultorioId));
      }

      if (form.password.trim()) {
        fd.append("password", form.password.trim());
      }

      fd.append(
        "especialidades_detalle",
        JSON.stringify(form.especialidades_detalle || [])
      );
      fd.append("horarios", JSON.stringify(horariosPayload));

      // Foto nueva
      if (fotoFile) {
        fd.append("foto", fotoFile);
      }

      // Eliminar foto actual
      if (fotoRemove && !fotoFile) {
        fd.append("foto_remove", "true");
      }

      const { data } = await api.patch(
        `/odontologos/${odo.id_odontologo}/`,
        fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      );

      const updated: Odontologo = { ...data, foto: absolutize(data.foto) };
      setOdo(updated);

      // Reset estados de foto
      setFotoFile(null);
      setFotoPreview(null);
      setFotoRemove(false);

      // Toast de éxito + redirección
      pushToast("Cambios guardados correctamente ✅", "success");
      const targetId =
        (data && (data.id_odontologo as number)) ?? odo.id_odontologo;

      // pequeña pausa para que el toast se vea y luego navegamos
      setTimeout(() => {
        navigate(`/admin/odontologos/${targetId}`);
      }, 600);
    } catch (e: any) {
      console.error(e);
      setError("No se pudo guardar la edición. Revisa los campos.");
      pushToast("Error al guardar ❌", "error");
    } finally {
      setSaving(false);
    }
  }

  async function confirmEstadoChange() {
    if (!odo) return;
    try {
      if (changingToActive === false) {
        await api.post(`/odontologos/${odo.id_odontologo}/apply-mantenimiento/`, {
          confirm: true,
        });
      } else {
        await api.post(`/odontologos/${odo.id_odontologo}/apply-reactivate/`, {
          confirm: true,
        });
      }

      // Exportar CSV
      const rows = previewCitas.map(
        (c: any) =>
          `${c.id_cita},${c.fecha},${c.hora},${c.paciente_nombre || "—"},${
            c.estado
          }`
      );
      const header = "ID,Fecha,Hora,Paciente,Estado";
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `citas_afectadas_${odo.id_odontologo}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setModalOpen(false);

      // Aquí mostramos toast distinto según acción
      pushToast(
        changingToActive
          ? "Odontólogo reactivado y cambios guardados"
          : "Odontólogo desactivado y citas puestas en mantenimiento",
        "success"
      );

      // Redirigir directo al detalle
      setTimeout(() => {
        navigate(`/admin/odontologos/${odo.id_odontologo}`);
      }, 800);
    } catch (err) {
      console.error(err);
      pushToast("Error al aplicar cambio de estado", "error");
    }
  }

  if (Number.isNaN(odontologoId)) {
    return (
      <div className="">
        <p className="text-red-600">ID inválido.</p>
      </div>
    );
  }

  const inputClass = (field?: keyof Errors) =>
    `w-full min-w-0 rounded-lg border px-3 py-2 ${
      field && errors[field]
        ? "border-red-500 focus:ring-2 focus:ring-red-500"
        : "border-gray-300"
    }`;

  const disabledHorario = !form.is_active;

  // Foto que se muestra: prioridad preview > (no eliminar && foto actual)
  const displayedPhoto = fotoPreview ?? (fotoRemove ? null : odo?.foto ?? null);

  // Horarios en orden L → D
  const horariosView = DAY_ORDER.map((idx) => horarios[idx]);

  return (
    <div className="space-y-6 w-full">
      <ToastView items={toasts} remove={removeToast} />
      {/* Header con título + acciones */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Pencil className="h-5 w-5" />
          Editar odontólogo
        </h1>

        <div className="flex items-center gap-2">
          {/* Cancelar (blanco, hace lo mismo que “volver al perfil”) */}
          <button
            type="button"
            onClick={() => navigate(`/admin/odontologos/${odontologoId}`)}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            disabled={saving}
            title="Cancelar"
          >
            Cancelar
          </button>

          {/* Guardar cambios (negro) */}
          <button
            type="submit"
            form="odo-edit-form"
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80 disabled:opacity-50"
            disabled={saving || loading}
            title="Guardar cambios"
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

      {/* ===== Dos columnas ===== */}
      <form
        id="odo-edit-form"
        onSubmit={onSave}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        {/* Columna izquierda: Datos personales + Contacto */}
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
                {/* Input de archivo estilizado como input real */}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFotoFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm rounded-lg border px-3 py-2 file:mr-4 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:bg-gray-800 file:text-white hover:file:bg-black/80"
                />
                <p className="text-xs text-gray-500">
                  Formatos comunes (JPG/PNG). Opcional.
                </p>

                {/* Botones de acciones de foto */}
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
                      // marcar para eliminar foto actual del servidor
                      setFotoRemove(true);
                      setFotoFile(null);
                      setFotoPreview(null);
                    }}
                    disabled={!odo?.foto && !displayedPhoto}
                    title={
                      odo?.foto ? "Eliminar foto actual" : "No hay foto actual"
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

          {/* Datos personales */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <h3 className="text-lg font-bold text-gray-900">
              Datos personales
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                ["Primer nombre", "primer_nombre"],
                ["Segundo nombre", "segundo_nombre"],
                ["Primer apellido", "primer_apellido"],
                ["Segundo apellido", "segundo_apellido"],
              ].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-sm mb-1">{label}</label>
                  <input
                    value={(form as any)[key]}
                    onChange={(e) => onField(key as any, e.target.value)}
                    className={inputClass(key as any)}
                  />
                  {errors[key as keyof Errors] && (
                    <p className="mt-1 text-xs text-red-600">
                      {errors[key as keyof Errors]}
                    </p>
                  )}
                </div>
              ))}

              <div>
                <label className="block text-sm mb-1">Cédula</label>
                <input
                  value={form.cedula}
                  onChange={(e) =>
                    onField(
                      "cedula",
                      e.target.value.replace(/\D/g, "").slice(0, 10)
                    )
                  }
                  onBlur={handleCedulaBlur}
                  className={inputClass("cedula")}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10 dígitos"
                />
                {errors.cedula && (
                  <p className="mt-1 text-xs text-red-600">{errors.cedula}</p>
                )}
                {checkingCedula && !errors.cedula && (
                  <p className="mt-1 text-xs text-gray-500">
                    Verificando cédula…
                  </p>
                )}
                {cedulaExists === false && !errors.cedula && (
                  <p className="mt-1 text-xs text-green-600">Cédula validada</p>
                )}
              </div>

              <div>
                <label className="block text-sm mb-1">Sexo</label>
                <select
                  value={form.sexo}
                  onChange={(e) => onField("sexo", e.target.value)}
                  className={inputClass("sexo")}
                >
                  <option value="">—</option>
                  <option value="M">Masculino</option>
                  <option value="F">Femenino</option>
                </select>
                {errors.sexo && (
                  <p className="mt-1 text-xs text-red-600">{errors.sexo}</p>
                )}
              </div>

              <div>
                <label className="block text-sm mb-1">
                  Fecha de nacimiento
                </label>
                <input
                  type="date"
                  value={form.fecha_nacimiento || ""}
                  onChange={(e) => onField("fecha_nacimiento", e.target.value)}
                  className={inputClass("fecha_nacimiento")}
                />
                {errors.fecha_nacimiento && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.fecha_nacimiento}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm mb-1">Tipo de sangre</label>
                <select
                  value={form.tipo_sangre}
                  onChange={(e) => onField("tipo_sangre", e.target.value)}
                  className={inputClass("tipo_sangre")}
                >
                  <option value="">—</option>
                  {TIPOS_SANGRE.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {errors.tipo_sangre && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.tipo_sangre}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Contacto y cuenta */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <h3 className="text-lg font-bold text-gray-900">
              Contacto y cuenta
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Celular</label>
                <input
                  value={form.celular}
                  onChange={(e) =>
                    onField(
                      "celular",
                      e.target.value.replace(/\D/g, "").slice(0, 10)
                    )
                  }
                  onBlur={handleCelularBlur}
                  className={inputClass("celular")}
                  inputMode="tel"
                  maxLength={10}
                  placeholder="09xxxxxxxx"
                />
                {errors.celular && (
                  <p className="mt-1 text-xs text-red-600">{errors.celular}</p>
                )}
                {checkingCelular && !errors.celular && (
                  <p className="mt-1 text-xs text-gray-500">
                    Verificando celular…
                  </p>
                )}
                {celularExists === false && !errors.celular && (
                  <p className="mt-1 text-xs text-green-600">
                    Celular validado
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm mb-1">Correo</label>
                <input
                  type="email"
                  value={form.usuario_email}
                  onChange={(e) => onField("usuario_email", e.target.value)}
                  onBlur={handleEmailBlur}
                  className={inputClass("usuario_email")}
                />
                {errors.usuario_email && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.usuario_email}
                  </p>
                )}
                {checkingEmail && !errors.usuario_email && (
                  <p className="mt-1 text-xs text-gray-500">
                    Verificando correo…
                  </p>
                )}
                {emailExists === false && !errors.usuario_email && (
                  <p className="mt-1 text-xs text-green-600">Correo validado</p>
                )}
              </div>

              <div className="relative">
                <label className="block text-sm mb-1">
                  Nueva contraseña (opcional)
                </label>
                <input
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => onField("password", e.target.value)}
                  onFocus={() => setPwdTouched(true)}
                  className={`w-full rounded-lg border px-3 py-2 pr-10 ${borderForPwdField(
                    pwdStrong,
                    pwdTouched,
                    (form.password ?? "").length === 0
                  )}`}
                  placeholder="Deja en blanco para no cambiar"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute right-2 top-[30px] p-1 text-gray-600 hover:text-gray-900"
                  aria-label={
                    showPass ? "Ocultar contraseña" : "Ver contraseña"
                  }
                  title={showPass ? "Ocultar contraseña" : "Ver contraseña"}
                >
                  {showPass ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>

                {/* Reglas en vivo */}
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

                {/* Error del submit solo si sigue inválida */}
                {errors.password && pwdTouched && !pwdStrong && (
                  <p className="mt-1 text-xs text-red-600">{errors.password}</p>
                )}
              </div>

              <div className="relative">
                <label className="block text-sm mb-1">Repetir contraseña</label>
                <input
                  type={showPass2 ? "text" : "password"}
                  value={form.password_confirm}
                  onChange={(e) => onField("password_confirm", e.target.value)}
                  onFocus={() => setPwd2Touched(true)}
                  className={`w-full rounded-lg border px-3 py-2 pr-10 ${borderForPwdField(
                    pwdMatch,
                    pwd2Touched,
                    (form.password_confirm ?? "").length === 0
                  )}`}
                  placeholder="Vuelve a escribir la contraseña"
                />
                <button
                  type="button"
                  onClick={() => setShowPass2((s) => !s)}
                  className="absolute right-2 top-[30px] p-1 text-gray-600 hover:text-gray-900"
                  aria-label={
                    showPass2 ? "Ocultar contraseña" : "Ver contraseña"
                  }
                  title={showPass2 ? "Ocultar contraseña" : "Ver contraseña"}
                >
                  {showPass2 ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>

                {/* Mensaje en vivo de coincidencia */}
                <p
                  className={`mt-1 text-xs ${
                    !pwd2Touched && (form.password_confirm ?? "").length === 0
                      ? "text-gray-500"
                      : pwdMatch
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {!pwd2Touched && (form.password_confirm ?? "").length === 0
                    ? "Vuelve a escribir la contraseña."
                    : pwdMatch
                    ? "Ambas contraseñas coinciden."
                    : "Las contraseñas no coinciden."}
                </p>

                {/* Error del submit solo si no coincide */}
                {errors.password_confirm && pwd2Touched && !pwdMatch && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.password_confirm}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Columna derecha: Información laboral + Formación */}
        <div className="space-y-6">
          {/* Información laboral */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <h3 className="text-lg font-bold text-gray-900">
              Información laboral
            </h3>

            {/* Estado y consultorio */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Estado */}
              <div>
                <label className="block text-sm mb-1">Estado</label>
                <label className="w-full rounded-lg border px-3 py-2 flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, is_active: e.target.checked }))
                    }
                    className="h-4 w-4"
                  />
                  <span>{form.is_active ? "Activo" : "Inactivo"}</span>
                </label>
              </div>

              {/* Consultorio por defecto */}
              <div>
                <label className="block text-sm mb-1">
                  Consultorio por defecto
                </label>
                <select
                  value={consultorioId === "" ? "" : String(consultorioId)}
                  onChange={(e) =>
                    setConsultorioId(
                      e.target.value ? Number(e.target.value) : ""
                    )
                  }
                  className={`${inputClass("consultorio_defecto_id")}`}
                >
                  <option value="">— Selecciona —</option>
                  {consultorios.map((c) => (
                    <option key={c.id_consultorio} value={c.id_consultorio}>
                      #{c.numero}
                    </option>
                  ))}
                </select>
                {errors.consultorio_defecto_id && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.consultorio_defecto_id}
                  </p>
                )}
              </div>
            </div>

            {/* Horario semanal */}
            <div className="mt-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-800 mb-2">
                  Horario semanal
                </p>
                {errors.horarios && (
                  <p className="text-xs text-red-600">{errors.horarios}</p>
                )}
              </div>

              <p className="text-xs text-gray-600 mb-2">
                Horario laboral: 09:00–22:00.{" "}
                <strong>No se atiende de 13:00 a 15:00</strong> (almuerzo).
              </p>

              <div
                className={`space-y-2 ${disabledHorario ? "opacity-60" : ""}`}
              >
                {horariosView.map((h) => (
                  <div
                    key={h.dia_semana}
                    className={`grid grid-cols-1 sm:grid-cols-12 gap-2 rounded-lg border px-3 py-2 ${
                      errors.horarios ? "border-red-500" : ""
                    }`}
                  >
                    {/* Día */}
                    <div className="sm:col-span-3 flex items-center">
                      <span className="text-sm">
                        {DIAS_LABEL[h.dia_semana]}
                      </span>
                    </div>

                    {/* Switch habilitar */}
                    <div className="sm:col-span-3">
                      <label
                        className={`inline-flex items-center gap-2 text-sm w-full ${
                          disabledHorario ? "pointer-events-none" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={h.habilitado}
                          onChange={(e) =>
                            onHorarioToggle(h.dia_semana, e.target.checked)
                          }
                          className="h-4 w-4 shrink-0"
                          disabled={disabledHorario}
                        />
                        <span className="truncate">Habilitar</span>
                      </label>
                    </div>

                    {/* Hora inicio */}
                    <div className="sm:col-span-3">
                      <input
                        type="time"
                        value={h.hora_inicio}
                        onChange={(e) =>
                          onHorarioHora(
                            h.dia_semana,
                            "hora_inicio",
                            e.target.value
                          )
                        }
                        className={`w-full min-w-0 rounded-lg border px-2 py-1 text-sm ${
                          errors.horarios ? "border-red-500" : "border-gray-300"
                        }`}
                        disabled={!h.habilitado || disabledHorario}
                        step="60"
                        min="09:00"
                        max="22:00"
                      />
                    </div>

                    {/* Hora fin */}
                    <div className="sm:col-span-3">
                      <input
                        type="time"
                        value={h.hora_fin}
                        onChange={(e) =>
                          onHorarioHora(
                            h.dia_semana,
                            "hora_fin",
                            e.target.value
                          )
                        }
                        className={`w-full min-w-0 rounded-lg border px-2 py-1 text-sm ${
                          errors.horarios ? "border-red-500" : "border-gray-300"
                        }`}
                        disabled={!h.habilitado || disabledHorario}
                        step="60"
                        min="09:00"
                        max="22:00"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Formación profesional */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-gray-900">
                Formación profesional
              </h3>
              <button
                type="button"
                onClick={addEspecialidad}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Añadir especialidad
              </button>
            </div>

            <div className="mt-3 space-y-3">
              {form.especialidades_detalle.length === 0 && (
                <p className="text-sm text-gray-600">
                  Sin especialidades registradas.
                </p>
              )}

              {errors.especialidades && (
                <p className="text-xs text-red-600">{errors.especialidades}</p>
              )}
              {errors.especialidades_universidad && (
                <p className="text-xs text-red-600">
                  {errors.especialidades_universidad}
                </p>
              )}
              {errors.especialidades_estado && (
                <p className="text-xs text-red-600">
                  {errors.especialidades_estado}
                </p>
              )}

              {form.especialidades_detalle.map((esp, idx) => (
                <div key={idx} className="grid grid-cols-6 gap-2 items-start">
                  {/* Especialidad */}
                  <div className="col-span-6 sm:col-span-3">
                    <label className="block text-xs text-gray-600">
                      Especialidad
                    </label>
                    <select
                      value={esp.nombre ?? ""}
                      onChange={(e) =>
                        changeEspecialidadNombre(idx, e.target.value)
                      }
                      className={`w-full min-w-0 rounded-lg border px-2 py-2 text-sm ${
                        errors.especialidades
                          ? "border-red-500 focus:ring-2 focus:ring-red-500"
                          : "border-gray-300"
                      }`}
                    >
                      <option value="">— Selecciona —</option>
                      {especialidadesOpts.map((opt) => (
                        <option key={opt.id_especialidad} value={opt.nombre}>
                          {opt.nombre}
                        </option>
                      ))}
                    </select>

                    {/* Quitar elemento */}
                    <button
                      type="button"
                      onClick={() => removeEspecialidad(idx)}
                      className="mt-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                    >
                      Quitar
                    </button>
                  </div>

                  {/* Universidad */}
                  <div className="col-span-6 sm:col-span-2">
                    <label className="block text-xs text-gray-600">
                      Universidad
                    </label>
                    <input
                      value={esp.universidad ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setForm((s) => {
                          const arr = [...s.especialidades_detalle];
                          arr[idx] = { ...arr[idx], universidad: v };
                          return { ...s, especialidades_detalle: arr };
                        });
                      }}
                      className={`w-full min-w-0 rounded-lg border px-2 py-2 text-sm ${
                        errors.especialidades_universidad
                          ? "border-red-500 focus:ring-2 focus:ring-red-500"
                          : "border-gray-300"
                      }`}
                    />
                  </div>

                  {/* Estado (atiende) */}
                  <div className="col-span-6 sm:col-span-1">
                    <label className="block text-xs invisible select-none">
                      Estado
                    </label>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={!!esp.estado}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setForm((s) => {
                            const arr = [...s.especialidades_detalle];
                            arr[idx] = { ...arr[idx], estado: checked };
                            return { ...s, especialidades_detalle: arr };
                          });
                        }}
                        className="h-4 w-4"
                      />
                      <span
                        className={`ml-2 text-xs leading-5 whitespace-nowrap ${
                          esp.estado ? "text-green-700" : "text-gray-700"
                        }`}
                        style={{ minWidth: 72 }}
                      >
                        {esp.estado ? "Atiende" : "No atiende"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </form>
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-6">
            <h2 className="text-lg font-bold mb-4">
              {changingToActive
                ? "Reactivar odontólogo"
                : "Desactivar odontólogo"}
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Se verán afectadas las siguientes citas:
            </p>

            <div className="max-h-64 overflow-y-auto border rounded-lg mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-left">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Hora</th>
                    <th className="px-3 py-2">Paciente</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {previewCitas.map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1">{c.id_cita}</td>
                      <td className="px-3 py-1">{c.fecha}</td>
                      <td className="px-3 py-1">{c.hora}</td>
                      <td className="px-3 py-1">{c.paciente_nombre || "—"}</td>
                      <td className="px-3 py-1">{c.estado}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-lg border hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmEstadoChange}
                className={`px-4 py-2 rounded-lg text-white ${
                  changingToActive ? "bg-green-600" : "bg-red-600"
                }`}
              >
                {changingToActive
                  ? "Reactivar y guardar"
                  : "Desactivar y guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
