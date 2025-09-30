// src/pages/odontologo/PerfilEdicion.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import { Eye, EyeOff } from "lucide-react";

/* ===== Tipos ===== */
type Odontologo = {
  id_odontologo: number;
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
  foto?: string | null;

  especialidades?: string[];
  especialidades_detalle?: {
    nombre: string | null;
    universidad?: string | null;
    estado?: boolean;
  }[];

  horarios?: {
    dia_semana: number; // 0..6
    hora_inicio: string; // "09:00"
    hora_fin: string; // "17:00"
    vigente: boolean;
  }[];
};

type EspecialidadOption = { id_especialidad: number; nombre: string };
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

/* ===== Helpers ===== */
function timeToMinutes(raw: string): number {
  if (!raw) return NaN;
  const [hhmm, ap] = raw.trim().split(/\s+/);
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  let hh = h;
  if (ap) {
    const up = ap.toUpperCase();
    if (up.startsWith("AM")) {
      if (hh === 12) hh = 0;
    } else if (up.startsWith("PM")) {
      if (hh < 12) hh += 12;
    }
  }
  return hh * 60 + m;
}
function isValidCedulaEC(ci: string): boolean {
  if (!/^\d{10}$/.test(ci)) return false;
  const prov = +ci.slice(0, 2);
  if (prov < 1 || (prov > 24 && prov !== 30)) return false;
  const t = +ci[2];
  if (t >= 6) return false;
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let s = 0;
  for (let i = 0; i < 9; i++) {
    let p = coef[i] * +ci[i];
    if (p >= 10) p -= 9;
    s += p;
  }
  const mod = s % 10;
  return (mod === 0 ? 0 : 10 - mod) === +ci[9];
}
function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}
function useDebouncedCallback(cb: () => void, delay = 400) {
  const t = useRef<number | undefined>(undefined as any);
  return () => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(cb, delay);
  };
}
function normSexo(v?: string | null): "M" | "F" | "O" | "" {
  if (!v) return "";
  const s = v.trim().toUpperCase();
  if (s === "M" || s.startsWith("MASC")) return "M";
  if (s === "F" || s.startsWith("FEM")) return "F";
  if (s === "O" || s.startsWith("OTR")) return "O";
  return "";
}
function splitNombreCompleto(full?: string | null) {
  const t = (full ?? "").split(" ").filter(Boolean);
  const [pnom = "", snom = "", pape = "", sape = ""] = t;
  return { pnom, snom, pape, sape };
}
function absolutize(url?: string | null) {
  if (!url) return null;
  try {
    new URL(url);
    return url;
  } catch {}
  const base = (api.defaults as any)?.baseURL ?? "";
  let origin = "";
  try {
    origin = new URL(base).origin;
  } catch {
    origin = window.location.origin;
  }
  return `${origin.replace(/\/$/, "")}/${String(url).replace(/^\//, "")}`;
}

/* Toast view */
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

/* ===== Página ===== */
export default function PerfilEdicion() {
  const navigate = useNavigate();
  const { usuario } = useAuth();

  // ID del odontólogo desde el usuario autenticado
  const odontologoId = useMemo<number | null>(() => {
    const u: any = usuario;
    return (
      u?.odontologo?.id_odontologo ??
      u?.id_odontologo ??
      u?.id_usuario?.odontologo?.id_odontologo ??
      null
    );
  }, [usuario]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [odo, setOdo] = useState<Odontologo | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoRemove, setFotoRemove] = useState<boolean>(false);

  // Mostrar / ocultar contraseñas
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  const [especialidadesOpts, setEspecialidadesOpts] = useState<
    EspecialidadOption[]
  >([]);
  const [horarios, setHorarios] = useState<HorarioForm[]>(
    Array.from({ length: 7 }).map((_, i) => ({
      dia_semana: i,
      habilitado: false,
      hora_inicio: "",
      hora_fin: "",
    }))
  );

  const [form, setForm] = useState({
    primer_nombre: "",
    segundo_nombre: "",
    primer_apellido: "",
    segundo_apellido: "",
    cedula: "",
    sexo: "" as "" | "M" | "F" | "O",
    fecha_nacimiento: "",
    tipo_sangre: "",
    celular: "",
    usuario_email: "",
    password: "",
    password_confirm: "",
    especialidades_detalle: [] as {
      nombre: string | null;
      universidad?: string | null;
      estado?: boolean;
    }[],
  });

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
      | "password"
      | "password_confirm"
      | "especialidades"
      | "especialidades_universidad"
      | "especialidades_estado"
      | "horarios",
      string
    >
  >;
  const [errors, setErrors] = useState<Errors>({});

  // Verificación remota (única declaración: evita “Cannot redeclare …”)
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

  /* Carga inicial */
  useEffect(() => {
    if (!odontologoId) {
      setLoading(false);
      setError("No se encontró el odontólogo.");
      return;
    }
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [odoRes, espRes] = await Promise.allSettled([
          api.get(`/odontologos/${odontologoId}/`),
          api.get(`/especialidades/`),
        ]);

        if (!alive) return;

        if (espRes.status === "fulfilled") {
          const list = (espRes.value.data as any[])
            .map((x) => ({
              id_especialidad: x.id_especialidad ?? x.id ?? 0,
              nombre: x.nombre ?? "",
            }))
            .filter((x) => x.nombre);
          setEspecialidadesOpts(list);
        }

        if (odoRes.status === "fulfilled") {
          const data = odoRes.value.data as Odontologo;
          const foto = absolutize(data.foto);
          setOdo({ ...data, foto });

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
            especialidades_detalle: Array.isArray(data.especialidades_detalle)
              ? data.especialidades_detalle.map((d) => ({
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
      } catch (e) {
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

  /* Preview de foto */
  useEffect(() => {
    if (!fotoFile) {
      setFotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(fotoFile);
    setFotoPreview(url);
    setFotoRemove(false);
    return () => URL.revokeObjectURL(url);
  }, [fotoFile]);

  /* Handlers */
  const onField = (k: keyof typeof form, v: string | boolean) => {
    setErrors((prev) => ({ ...prev, [k as any]: "" }));
    if (k === "cedula") setCedulaExists(null);
    if (k === "usuario_email") setEmailExists(null);
    if (k === "celular") setCelularExists(null);
    setForm((s) => ({ ...s, [k]: v as any }));
  };

  const onHorarioToggle = (dia: number, enabled: boolean) => {
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
    setHorarios((arr) =>
      arr.map((h) => (h.dia_semana === dia ? { ...h, [campo]: value } : h))
    );
  };

  // especialidades
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
  const removeEsp = (idx: number) =>
    setForm((s) => {
      const arr = [...s.especialidades_detalle];
      arr.splice(idx, 1);
      return { ...s, especialidades_detalle: arr };
    });
  const changeEspNombre = (idx: number, nombre: string) =>
    setForm((s) => {
      const arr = [...s.especialidades_detalle];
      arr[idx] = { ...arr[idx], nombre };
      return { ...s, especialidades_detalle: arr };
    });

  /* Verificación remota */
  const verificarUnico = async ({
    cedula,
    email,
    celular,
  }: {
    cedula?: string;
    email?: string;
    celular?: string;
  }) => {
    try {
      const params: Record<string, string> = {};
      if (cedula) params.cedula = cedula;
      if (email) params.email = email;
      if (celular) params.celular = celular;

      if (cedula) setCheckingCedula(true);
      if (email) setCheckingEmail(true);
      if (celular) setCheckingCelular(true);

      const { data } = await api.get(`/usuarios/verificar/`, { params });

      if (data?.cedula && lastQueried.current.cedula === data.cedula.value) {
        let exists = Boolean(data.cedula.exists);
        if (odo?.cedula && String(odo.cedula) === String(data.cedula.value))
          exists = false;
        setCedulaExists(exists);
        setErrors((p) => ({ ...p, cedula: exists ? "Cédula inválida." : "" }));
      }
      if (data?.email && lastQueried.current.email === data.email.value) {
        let exists = Boolean(data.email.exists);
        if (
          odo?.usuario_email &&
          String(odo.usuario_email).toLowerCase() ===
            String(data.email.value).toLowerCase()
        )
          exists = false;
        setEmailExists(exists);
        setErrors((p) => ({
          ...p,
          usuario_email: exists ? "Correo inválido." : "",
        }));
      }
      if (data?.celular && lastQueried.current.celular === data.celular.value) {
        let exists = Boolean(data.celular.exists);
        if (odo?.celular && String(odo.celular) === String(data.celular.value))
          exists = false;
        setCelularExists(exists);
        setErrors((p) => ({
          ...p,
          celular: exists ? "Celular ya registrado." : "",
        }));
      }
    } finally {
      if (cedula) setCheckingCedula(false);
      if (email) setCheckingEmail(false);
      if (celular) setCheckingCelular(false);
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
  const debCedula = useDebouncedCallback(() => {
    const c = form.cedula.trim();
    if (/^\d{10}$/.test(c) && isValidCedulaEC(c)) {
      lastQueried.current.cedula = c;
      verificarUnico({ cedula: c });
    } else setCedulaExists(null);
  }, 400);
  const debEmail = useDebouncedCallback(() => {
    const m = form.usuario_email.trim();
    if (isValidEmail(m)) {
      lastQueried.current.email = m;
      verificarUnico({ email: m });
    } else setEmailExists(null);
  }, 400);
  const debCel = useDebouncedCallback(() => {
    const c = form.celular.trim();
    if (/^09\d{8}$/.test(c)) {
      lastQueried.current.celular = c;
      verificarUnico({ celular: c });
    } else setCelularExists(null);
  }, 400);
  useEffect(() => {
    if (form.cedula) debCedula();
  }, [form.cedula]);
  useEffect(() => {
    if (form.usuario_email) debEmail();
  }, [form.usuario_email]);
  useEffect(() => {
    if (form.celular) debCel();
  }, [form.celular]);

  /* Validaciones antes de guardar */
  const validateBeforeSave = (): boolean => {
    const newErrors: Errors = {};
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

    if (!/^09\d{8}$/.test(form.celular))
      newErrors.celular = "Formato 09xxxxxxxx.";
    if (celularExists === true) newErrors.celular = "Celular ya registrado.";

    if (!isValidEmail(form.usuario_email))
      newErrors.usuario_email = "Correo inválido.";
    if (emailExists === true) newErrors.usuario_email = "Correo inválido.";

    if (form.password.trim() || form.password_confirm.trim()) {
      if (!form.password.trim())
        newErrors.password = "Obligatoria si cambias la contraseña.";
      if (!form.password_confirm.trim())
        newErrors.password_confirm = "Obligatoria si cambias la contraseña.";
      if (form.password.trim() && form.password.trim().length < 6)
        newErrors.password = "Mínimo 6 caracteres.";
      if (
        form.password &&
        form.password_confirm &&
        form.password !== form.password_confirm
      )
        newErrors.password_confirm = "No coincide.";
    }

    // Horarios
    const anyEnabled = horarios.some((h) => h.habilitado);
    if (!anyEnabled) {
      newErrors.horarios = "Debe habilitar al menos un día.";
    } else {
      const MIN_M = 9 * 60,
        MAX_M = 22 * 60,
        LUNCH_START_M = 13 * 60,
        LUNCH_END_M = 15 * 60;
      for (const h of horarios) {
        if (!h.habilitado) continue;
        const ini = timeToMinutes(h.hora_inicio);
        const fin = timeToMinutes(h.hora_fin);
        if (Number.isNaN(ini) || Number.isNaN(fin)) {
          newErrors.horarios = "Completa las horas en días habilitados.";
          break;
        }
        if (ini < MIN_M || fin > MAX_M) {
          newErrors.horarios = "Las horas deben estar entre 09:00 y 22:00.";
          break;
        }
        const startInLunch = ini >= LUNCH_START_M && ini < LUNCH_END_M;
        const endInLunch = fin > LUNCH_START_M && fin <= LUNCH_END_M;
        if (startInLunch) {
          newErrors.horarios = "Inicio dentro del almuerzo (13:00–15:00).";
          break;
        }
        if (endInLunch) {
          newErrors.horarios = "Fin dentro del almuerzo (13:00–15:00).";
          break;
        }
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

    setErrors(newErrors);
    if (Object.keys(newErrors).length) {
      pushToast("Corrige los campos marcados.", "error");
      return false;
    }
    return true;
  };

  /* Guardar */
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!odo) return;
    if (!validateBeforeSave()) return;

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
      if (form.password.trim()) fd.append("password", form.password.trim());
      fd.append(
        "especialidades_detalle",
        JSON.stringify(form.especialidades_detalle || [])
      );
      fd.append("horarios", JSON.stringify(horariosPayload));
      if (fotoFile) fd.append("foto", fotoFile);
      if (fotoRemove && !fotoFile) fd.append("foto_remove", "true");

      await api.patch(`/odontologos/${odo.id_odontologo}/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      pushToast("Cambios guardados correctamente ✅", "success");
      setTimeout(() => navigate("/odontologo/perfil"), 600);
    } catch (e) {
      console.error(e);
      setError("No se pudo guardar la edición. Revisa los campos.");
      pushToast("Error al guardar ❌", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!odontologoId) {
    return (
      <div className="p-6">
        <p className="text-red-600">No se pudo identificar al odontólogo.</p>
      </div>
    );
  }

  const inputClass = (field?: keyof Errors) =>
    `w-full min-w-0 rounded-lg border px-3 py-2 ${
      field && errors[field]
        ? "border-red-500 focus:ring-2 focus:ring-red-500"
        : "border-gray-300"
    }`;

  const displayedPhoto = fotoPreview ?? (fotoRemove ? null : odo?.foto ?? null);
  const horariosView = DAY_ORDER.map((idx) => horarios[idx]);

  return (
    <div className="space-y-6 w-full">
      <ToastView items={toasts} remove={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Editar mi perfil</h1>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/odontologo/perfil")}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            disabled={saving}
            title="Cancelar"
          >
            Cancelar
          </button>

          <button
            type="submit"
            form="pac-edit-form"
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

      <form onSubmit={onSave} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                      alt="Foto"
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
                  <option value="O">Otro</option>
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
                  className={inputClass("password")}
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
                {errors.password && (
                  <p className="mt-1 text-xs text-red-600">{errors.password}</p>
                )}
              </div>

              <div className="relative">
                <label className="block text-sm mb-1">Repetir contraseña</label>
                <input
                  type={showPass2 ? "text" : "password"}
                  value={form.password_confirm}
                  onChange={(e) => onField("password_confirm", e.target.value)}
                  className={inputClass("password_confirm")}
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
                {errors.password_confirm && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.password_confirm}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Columna derecha: Horario + Formación */}
        <div className="space-y-6">
          {/* Horario semanal */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <h3 className="text-lg font-bold text-gray-900">Horario semanal</h3>
            <p className="text-xs text-gray-600 mb-2 mt-1">
              Horario laboral: 09:00–22:00.{" "}
              <strong>No se atiende de 13:00 a 15:00</strong> (almuerzo).
            </p>

            {errors.horarios && (
              <p className="text-xs text-red-600 mb-2">{errors.horarios}</p>
            )}

            <div className="space-y-2">
              {horariosView.map((h) => (
                <div
                  key={h.dia_semana}
                  className={`grid grid-cols-1 sm:grid-cols-12 gap-2 rounded-lg border px-3 py-2 ${
                    errors.horarios ? "border-red-500" : ""
                  }`}
                >
                  <div className="sm:col-span-3 flex items-center">
                    <span className="text-sm">{DIAS_LABEL[h.dia_semana]}</span>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="inline-flex items-center gap-2 text-sm w-full">
                      <input
                        type="checkbox"
                        checked={h.habilitado}
                        onChange={(e) =>
                          onHorarioToggle(h.dia_semana, e.target.checked)
                        }
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="truncate">Habilitar</span>
                    </label>
                  </div>
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
                      disabled={!h.habilitado}
                      step="60"
                      min="09:00"
                      max="22:00"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <input
                      type="time"
                      value={h.hora_fin}
                      onChange={(e) =>
                        onHorarioHora(h.dia_semana, "hora_fin", e.target.value)
                      }
                      className={`w-full min-w-0 rounded-lg border px-2 py-1 text-sm ${
                        errors.horarios ? "border-red-500" : "border-gray-300"
                      }`}
                      disabled={!h.habilitado}
                      step="60"
                      min="09:00"
                      max="22:00"
                    />
                  </div>
                </div>
              ))}
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
                  <div className="col-span-6 sm:col-span-3">
                    <label className="block text-xs text-gray-600">
                      Especialidad
                    </label>
                    <select
                      value={esp.nombre ?? ""}
                      onChange={(e) => changeEspNombre(idx, e.target.value)}
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

                    <button
                      type="button"
                      onClick={() => removeEsp(idx)}
                      className="mt-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                    >
                      Quitar
                    </button>
                  </div>

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
    </div>
  );
}
