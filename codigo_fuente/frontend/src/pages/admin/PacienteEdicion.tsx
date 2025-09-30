// src/pages/admin/PacienteEdicion.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/axios";
import { Pencil, Eye, EyeOff } from "lucide-react";

/* =========================
   Tipos
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
  primer_nombre?: string | null;
  segundo_nombre?: string | null;
  primer_apellido?: string | null;
  segundo_apellido?: string | null;
  cedula?: string | null;
  sexo?: string | null; // "M" | "F"
  fecha_nacimiento?: string | null;
  tipo_sangre?: string | null;
  celular?: string | null;
  email?: string | null;
  usuario_email?: string | null; // alias
  is_active?: boolean; // read-only
  activo?: boolean; // writable
  foto?: string | null;
};

type AntecedenteOption = { id_antecedente: number; nombre: string };
type RelFamiliar = "propio" | "padres" | "hermanos" | "abuelos";

type RowAntecedente = {
  // si viene de la BD tendrá id para borrar
  id_paciente_antecedente?: number;
  id_antecedente: number | "";
  relacion_familiar: RelFamiliar;
};

type Toast = { id: number; message: string; type?: "success" | "error" };

const PRIMARY = "#0070B7";
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
const FAMILIARES: Exclude<RelFamiliar, "propio">[] = [
  "padres",
  "hermanos",
  "abuelos",
];

/* =========================
   Validadores
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
function normSexo(v?: string | null): "" | "M" | "F" {
  if (!v) return "";
  const s = String(v).trim().toUpperCase();
  if (s === "M" || s.startsWith("MASC")) return "M";
  if (s === "F" || s.startsWith("FEM")) return "F";
  return "";
}

/* =========================
   Toast
========================= */
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

/* =========================
   Componente
========================= */
export default function PacienteEdicion() {
  const { id } = useParams();
  const pacienteId = useMemo(() => Number(id), [id]);
  const navigate = useNavigate();
  const [showPwd, setShowPwd] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Entidades
  const [pac, setPac] = useState<Paciente | null>(null);
  const [user, setUser] = useState<Usuario | null>(null);

  // Guarda los valores originales del usuario para comparación (evitar falsos duplicados)
  const originalVals = useRef<{
    cedula: string;
    email: string;
    celular: string;
  }>({
    cedula: "",
    email: "",
    celular: "",
  });

  // Foto
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoRemove, setFotoRemove] = useState<boolean>(false);

  // Catálogo de antecedentes
  const [antecedentesOpts, setAntecedentesOpts] = useState<AntecedenteOption[]>(
    []
  );
  // Antecedentes actuales del paciente
  const [propios, setPropios] = useState<RowAntecedente[]>([]);
  const [familiares, setFamiliares] = useState<RowAntecedente[]>([]);

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
    if (Number.isNaN(pacienteId)) return;
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // 1) Paciente
        const pacRes = await api.get(`/pacientes/${pacienteId}/`);
        if (!alive) return;
        const p: Paciente = pacRes.data;
        setPac(p);

        // 2) Usuario
        const usrRes = await api.get(`/usuarios/${p.id_usuario}/`);
        if (!alive) return;
        const u = usrRes.data as Usuario;
        u.foto = absolutize(u.foto);
        const normalized: Usuario = {
          ...u,
          usuario_email: u.usuario_email ?? u.email ?? "",
          activo: u.activo ?? u.is_active ?? true,
          sexo: normSexo(u.sexo),
        };
        setUser(normalized);

        // Guarda originales para verificación remota
        originalVals.current = {
          cedula: String(normalized.cedula || ""),
          email: String(
            normalized.usuario_email || normalized.email || ""
          ).toLowerCase(),
          celular: String(normalized.celular || ""),
        };

        // 3) Catálogo de antecedentes
        try {
          const antRes = await api.get(`/antecedentes/`);
          const list = (antRes.data as any[]).map((a) => ({
            id_antecedente: a.id_antecedente ?? a.id ?? 0,
            nombre: a.nombre ?? "",
          }));
          setAntecedentesOpts(list.filter((x) => x.id_antecedente && x.nombre));
        } catch {
          // fallback mínimo si falla el catálogo
          setAntecedentesOpts([
            { id_antecedente: 1, nombre: "Alergia antibiótico" },
            { id_antecedente: 2, nombre: "Alergia anestesia" },
            { id_antecedente: 3, nombre: "Hemorragias" },
            { id_antecedente: 4, nombre: "VIH/SIDA" },
            { id_antecedente: 5, nombre: "Tuberculosis" },
            { id_antecedente: 6, nombre: "Asma" },
            { id_antecedente: 7, nombre: "Diabetes" },
            { id_antecedente: 8, nombre: "Hipertensión" },
            { id_antecedente: 9, nombre: "Enf. cardíaca" },
            { id_antecedente: 10, nombre: "Otro" },
          ]);
        }

        // 4) Antecedentes del paciente (normalizado + filtrado estricto + deduplicado)
        try {
          const paRes = await api.get(`/paciente-antecedentes/`, {
            params: { id_paciente: pacienteId },
          });

          const raw: any[] = Array.isArray(paRes.data?.results)
            ? paRes.data.results
            : Array.isArray(paRes.data)
            ? paRes.data
            : [];

          const rows = raw.filter((r) => {
            const pid =
              r.id_paciente ??
              r.paciente ??
              r.id_paciente_id ??
              r?.id_paciente?.id_paciente ??
              r?.paciente?.id_paciente;
            return Number(pid) === Number(pacienteId);
          });

          const seen = new Set<string>();
          const prop: RowAntecedente[] = [];
          const fam: RowAntecedente[] = [];

          rows.forEach((r) => {
            const idAnt = r.id_antecedente ?? r?.antecedente ?? r?.id ?? "";
            const rel = (r.relacion_familiar || "propio") as RelFamiliar;
            const key = `${idAnt}-${rel}`;
            if (!idAnt || seen.has(key)) return;
            seen.add(key);

            const row: RowAntecedente = {
              id_paciente_antecedente:
                r.id_paciente_antecedente ?? r.id ?? undefined,
              id_antecedente: idAnt,
              relacion_familiar: rel,
            };
            if (rel === "propio") prop.push(row);
            else fam.push(row);
          });

          setPropios(prop);
          setFamiliares(fam);
        } catch {
          setPropios([]);
          setFamiliares([]);
        }
      } catch (e) {
        console.error(e);
        if (alive) setError("No se pudo cargar el perfil para edición.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pacienteId]);

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
     Edición de formulario
  ========================== */
  type UserFieldKey = keyof Usuario | "password" | "password_confirm";

  const setUserField = (k: UserFieldKey, v: string | boolean) => {
    if (!user) return;
    // limpiar errores de campo
    setErrors((prev) => ({ ...prev, [k as any]: "" }));
    if (k === "cedula") setCedulaExists(null);
    if (k === "usuario_email") setEmailExists(null);
    if (k === "celular") setCelularExists(null);
    setUser({ ...user, [k]: v as any });

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
        password_confirm:
          (user as any)?.password_confirm &&
          nextPwd !== (user as any).password_confirm
            ? "No coincide."
            : "",
      }));
    }

    if (k === "password_confirm") {
      const nextPwd2 = String(v ?? "");
      if (!pwd2Touched) setPwd2Touched(true);
      setErrors((prev) => ({
        ...prev,
        password_confirm:
          nextPwd2 !== (user as any)?.password ? "No coincide." : "",
      }));
    }
  };

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
      | "password"
      | "password_confirm"
      | "contacto_emergencia_nom"
      | "contacto_emergencia_cel"
      | "contacto_emergencia_par",
      string
    >
  >;
  const [errors, setErrors] = useState<Errors>({});

  // --- Live password checks ---
  const [pwdTouched, setPwdTouched] = useState(false);
  const [pwd2Touched, setPwd2Touched] = useState(false);

  // Lee los campos temporales en user (no forman parte del tipo Usuario)
  const pwd = String((user as any)?.password ?? "");
  const pwd2 = String((user as any)?.password_confirm ?? "");

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

  const inputClass = (field?: keyof Errors) =>
    `w-full min-w-0 rounded-lg border px-3 py-2 ${
      field && errors[field]
        ? "border-red-500 focus:ring-2 focus:ring-red-500"
        : "border-gray-300"
    }`;

  /* =========================
    Verificación remota (cedula/email/celular)
  ========================== */
  const verificarUnico = async (opts: {
    cedula?: string;
    email?: string;
    celular?: string;
  }) => {
    if (!user) return;
    try {
      const params: Record<string, string> = {};
      if (opts.cedula) params.cedula = opts.cedula;
      if (opts.email) params.email = opts.email;
      if (opts.celular) params.celular = opts.celular;

      // Pide al backend excluir al propio usuario
      params.exclude_id_usuario = String(user.id_usuario);

      if (params.cedula) setCheckingCedula(true);
      if (params.email) setCheckingEmail(true);
      if (params.celular) setCheckingCelular(true);

      const { data } = await api.get(`/usuarios/verificar/`, { params });

      // CÉDULA
      if (
        opts.cedula &&
        data?.cedula &&
        lastQueried.current.cedula === data.cedula.value
      ) {
        let exists = Boolean(data.cedula.exists);
        // Si coincide con el valor original del mismo paciente, NO es duplicado
        if (String(originalVals.current.cedula) === String(data.cedula.value)) {
          exists = false;
        }
        setCedulaExists(exists);
        setErrors((prev) => ({
          ...prev,
          cedula: exists ? "Cédula inválida." : "",
        }));
      }

      // EMAIL
      if (
        opts.email &&
        data?.email &&
        lastQueried.current.email === data.email.value
      ) {
        let exists = Boolean(data.email.exists);
        if (
          String(originalVals.current.email) ===
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

      // CELULAR
      if (
        opts.celular &&
        data?.celular &&
        lastQueried.current.celular === data.celular.value
      ) {
        let exists = Boolean(data.celular.exists);
        if (
          String(originalVals.current.celular) === String(data.celular.value)
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
      console.error("Fallo verificación cédula/email/celular", e);
    } finally {
      if (opts.cedula) setCheckingCedula(false);
      if (opts.email) setCheckingEmail(false);
      if (opts.celular) setCheckingCelular(false);
    }
  };

  const handleCedulaBlur = () => {
    if (!user) return;
    const c = String(user.cedula || "").trim();
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
    if (!user) return;
    const m = String(user.usuario_email || user.email || "").trim();
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
    if (!user) return;
    const c = String(user.celular || "").trim();
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
    if (!user) return;
    const c = String(user.cedula || "").trim();
    if (/^\d{10}$/.test(c) && isValidCedulaEC(c)) {
      lastQueried.current.cedula = c;
      verificarUnico({ cedula: c });
    } else {
      setCedulaExists(null);
    }
  }, 400);
  const debouncedCheckEmail = useDebouncedCallback(() => {
    if (!user) return;
    const m = String(user.usuario_email || user.email || "").trim();
    if (isValidEmail(m)) {
      lastQueried.current.email = m;
      verificarUnico({ email: m });
    } else {
      setEmailExists(null);
    }
  }, 400);
  const debouncedCheckCelular = useDebouncedCallback(() => {
    if (!user) return;
    const c = String(user.celular || "").trim();
    if (/^09\d{8}$/.test(c)) {
      lastQueried.current.celular = c;
      verificarUnico({ celular: c });
    } else {
      setCelularExists(null);
    }
  }, 400);

  useEffect(() => {
    if (user?.cedula) debouncedCheckCedula();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.cedula]);
  useEffect(() => {
    if (user?.usuario_email || user?.email) debouncedCheckEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.usuario_email]);
  useEffect(() => {
    if (user?.celular) debouncedCheckCelular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.celular]);

  /* =========================
     Validaciones antes de guardar
  ========================== */
  const validateBeforeSave = (): boolean => {
    if (!user || !pac) return false;
    const newErrors: Errors = {};

    // Datos personales
    if (!String(user.primer_nombre || "").trim())
      newErrors.primer_nombre = "Obligatorio.";
    if (!String(user.primer_apellido || "").trim())
      newErrors.primer_apellido = "Obligatorio.";
    if (!String(user.segundo_apellido || "").trim())
      newErrors.segundo_apellido = "Obligatorio.";

    const c = String(user.cedula || "");
    if (!/^\d{10}$/.test(c) || !isValidCedulaEC(c))
      newErrors.cedula = "Cédula inválida.";
    if (cedulaExists === true) newErrors.cedula = "Cédula inválida.";

    if (!user.sexo) newErrors.sexo = "Selecciona el sexo.";
    if (!user.fecha_nacimiento) newErrors.fecha_nacimiento = "Obligatorio.";
    if (!user.tipo_sangre)
      newErrors.tipo_sangre = "Selecciona el tipo de sangre.";

    // Celular
    if (!/^09\d{8}$/.test(String(user.celular || "")))
      newErrors.celular = "Formato 09xxxxxxxx.";
    if (celularExists === true) newErrors.celular = "Celular ya registrado.";

    // Email
    const m = String(user.usuario_email || user.email || "");
    if (!isValidEmail(m)) newErrors.usuario_email = "Correo inválido.";
    if (emailExists === true) newErrors.usuario_email = "Correo inválido.";

    // Emergencia
    const enom = String(pac.contacto_emergencia_nom || "");
    const ecel = String(pac.contacto_emergencia_cel || "");
    const epar = String(pac.contacto_emergencia_par || "");
    if (!fullNameTwoWords(enom))
      newErrors.contacto_emergencia_nom = "Nombre y apellido.";
    if (!/^09\d{8}$/.test(ecel))
      newErrors.contacto_emergencia_cel = "09xxxxxxxx.";
    if (!epar) newErrors.contacto_emergencia_par = "Selecciona parentesco.";

    // Antecedentes: evitar duplicados en UI
    const all = [
      ...propios.map((r) => ({
        key: `${r.id_antecedente}-propio`,
        ok: !!r.id_antecedente,
      })),
      ...familiares.map((r) => ({
        key: `${r.id_antecedente}-${r.relacion_familiar}`,
        ok: !!r.id_antecedente,
      })),
    ];
    const seen = new Set<string>();
    for (const it of all) {
      if (!it.ok) continue;
      if (seen.has(it.key)) {
        pushToast(
          "No repitas el mismo antecedente con la misma relación.",
          "error"
        );
        setErrors((e) => ({ ...e })); // re-render
        return false;
      }
      seen.add(it.key);
    }

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

    // Password opcional embebido en user
    const password = (user as any).password?.trim?.() || "";
    const password_confirm = (user as any).password_confirm?.trim?.() || "";
    if (password || password_confirm) {
      if (password.length < 6) {
        setErrors((p) => ({ ...p, password: "Mínimo 6 caracteres." }));
        pushToast("La contraseña debe tener al menos 6 caracteres.", "error");
        return;
      }
      if (password !== password_confirm) {
        setErrors((p) => ({ ...p, password_confirm: "No coincide." }));
        pushToast("Las contraseñas no coinciden.", "error");
        return;
      }
    }

    if (!validateBeforeSave()) return;

    try {
      setSaving(true);
      setError(null);

      // 1) PATCH usuario (multipart)
      const fd = new FormData();
      fd.append("primer_nombre", String(user.primer_nombre || ""));
      fd.append("segundo_nombre", String(user.segundo_nombre || ""));
      fd.append("primer_apellido", String(user.primer_apellido || ""));
      fd.append("segundo_apellido", String(user.segundo_apellido || ""));
      fd.append("cedula", String(user.cedula || ""));
      fd.append("sexo", String(user.sexo || ""));
      fd.append("fecha_nacimiento", String(user.fecha_nacimiento || ""));
      fd.append("tipo_sangre", String(user.tipo_sangre || ""));
      fd.append("celular", String(user.celular || ""));
      fd.append(
        "usuario_email",
        String(user.usuario_email || user.email || "")
      );
      fd.append("activo", user.activo ? "true" : "false");
      if (password) fd.append("password", password);

      // Foto nueva
      if (fotoFile) fd.append("foto", fotoFile);
      // Eliminar foto actual
      if (fotoRemove && !fotoFile) fd.append("foto_remove", "true");

      const usrPatch = await api.patch(`/usuarios/${user.id_usuario}/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const newUser = usrPatch.data as Usuario;
      newUser.foto = absolutize(newUser.foto);
      setUser({
        ...newUser,
        usuario_email: newUser.usuario_email ?? newUser.email ?? "",
        activo: newUser.activo ?? newUser.is_active ?? true,
        sexo: normSexo(newUser.sexo),
      });
      // Reset foto states
      setFotoFile(null);
      setFotoPreview(null);
      setFotoRemove(false);

      // 2) PATCH paciente (contacto emergencia)
      await api.patch(`/pacientes/${pac.id_paciente}/`, {
        contacto_emergencia_nom: pac.contacto_emergencia_nom ?? "",
        contacto_emergencia_cel: pac.contacto_emergencia_cel ?? "",
        contacto_emergencia_par: pac.contacto_emergencia_par ?? "",
      });

      // 3) Antecedentes: eliminar existentes del paciente y recrear únicos
      try {
        const paRes = await api.get(`/paciente-antecedentes/`, {
          params: { id_paciente: pac.id_paciente },
        });
        const rows: any[] = Array.isArray(paRes.data?.results)
          ? paRes.data.results
          : paRes.data;
        await Promise.all(
          rows.map((r) =>
            api
              .delete(
                `/paciente-antecedentes/${r.id_paciente_antecedente ?? r.id}/`
              )
              .catch(() => {})
          )
        );
      } catch {
        // ignore
      }

      const uniq = new Set<string>();
      const toCreate: RowAntecedente[] = [];
      [...propios, ...familiares].forEach((r) => {
        if (r.id_antecedente === "") return;
        const key = `${r.id_antecedente}-${r.relacion_familiar}`;
        if (uniq.has(key)) return;
        uniq.add(key);
        toCreate.push(r);
      });
      for (const r of toCreate) {
        await api.post(`/paciente-antecedentes/`, {
          id_paciente: pac.id_paciente,
          id_antecedente: r.id_antecedente,
          relacion_familiar: r.relacion_familiar,
        });
      }

      pushToast("Cambios guardados ✅", "success");
      navigate(`/admin/pacientes/${pacienteId}`);
    } catch (e: any) {
      console.error(e);
      // Mapea errores 400 del backend a los campos
      const data = e?.response?.data;
      if (data) {
        const next: Errors = {};
        if (data.cedula) {
          next.cedula = Array.isArray(data.cedula)
            ? data.cedula[0]
            : String(data.cedula);
        }
        if (data.email || data.usuario_email) {
          const msg = data.email ?? data.usuario_email;
          next.usuario_email = Array.isArray(msg) ? msg[0] : String(msg);
        }
        if (Object.keys(next).length) {
          setErrors((prev) => ({ ...prev, ...next }));
        }
      }
      setError("No se pudo guardar la edición. Revisa los campos.");
      pushToast("Error al guardar ❌", "error");
    } finally {
      setSaving(false);
    }
  }

  if (Number.isNaN(pacienteId)) {
    return (
      <div className="">
        <p className="text-red-600">ID inválido.</p>
      </div>
    );
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
        <p className="text-red-600">No se encontraron datos del paciente.</p>
      </div>
    );
  }

  const displayedPhoto =
    fotoPreview ?? (fotoRemove ? null : user?.foto ?? null);

  return (
    <div className="w-full space-y-6">
      <ToastView items={toasts} remove={removeToast} />

      {/* Header con título + acciones */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Pencil className="h-5 w-5" />
          Editar paciente
        </h1>
        <div className="flex items-center gap-2">
          {/* Cancelar (blanco, hace lo mismo que “volver al perfil”) */}
          <button
            type="button"
            onClick={() => navigate(`/admin/pacientes/${pacienteId}`)}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            disabled={saving}
            title="Cancelar"
          >
            Cancelar
          </button>

          {/* Guardar cambios (negro) */}
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

      <form
        id="pac-edit-form"
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

          {/* Datos personales */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <h3 className="text-lg font-bold text-gray-900">
              Datos personales
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {(
                [
                  ["Primer nombre", "primer_nombre"],
                  ["Segundo nombre", "segundo_nombre"],
                  ["Primer apellido", "primer_apellido"],
                  ["Segundo apellido", "segundo_apellido"],
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <label className="block text-sm mb-1">{label}</label>
                  <input
                    value={String((user as any)[key] || "")}
                    onChange={(e) => setUserField(key, e.target.value)}
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
                  value={String(user.cedula || "")}
                  onChange={(e) =>
                    setUserField(
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
                  value={user.sexo || ""}
                  onChange={(e) => setUserField("sexo", e.target.value)}
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
                  value={String(user.fecha_nacimiento || "")}
                  onChange={(e) =>
                    setUserField("fecha_nacimiento", e.target.value)
                  }
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
                  value={String(user.tipo_sangre || "")}
                  onChange={(e) => setUserField("tipo_sangre", e.target.value)}
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
                  value={String(user.celular || "")}
                  onChange={(e) =>
                    setUserField(
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
                  value={String(user.usuario_email || user.email || "")}
                  onChange={(e) =>
                    setUserField("usuario_email", e.target.value)
                  }
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

              {/* Nueva contraseña */}
              <div>
                <label className="block text-sm mb-1">
                  Nueva contraseña (opcional)
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? "text" : "password"}
                    onChange={(e) =>
                      setUserField("password" as any, e.target.value)
                    }
                    onFocus={() => setPwdTouched(true)}
                    className={`w-full rounded-lg border px-3 py-2 pr-10 ${borderForPwdField(
                      pwdStrong,
                      pwdTouched,
                      pwd.length === 0
                    )}`}
                    placeholder="Deja en blanco para no cambiar"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    title={
                      showPwd ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    {showPwd ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

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

              {/* Confirmación */}
              <div>
                <label className="block text-sm mb-1">Repetir contraseña</label>
                <div className="relative">
                  <input
                    type={showPwd2 ? "text" : "password"}
                    onChange={(e) =>
                      setUserField("password_confirm" as any, e.target.value)
                    }
                    onFocus={() => setPwd2Touched(true)}
                    className={`w-full rounded-lg border px-3 py-2 pr-10 ${borderForPwdField(
                      pwdMatch,
                      pwd2Touched,
                      pwd2.length === 0
                    )}`}
                    placeholder="Vuelve a escribir la contraseña"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd2((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    title={
                      showPwd2 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    {showPwd2 ? (
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

        {/* Columna derecha */}
        <div className="space-y-6">
          {/* Estado + contacto emergencia */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <h3 className="text-lg font-bold text-gray-900">
              Estado y contacto de emergencia
            </h3>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Estado */}
              <div>
                <label className="block text-sm mb-1">Estado</label>
                <label className="w-full rounded-lg border px-3 py-2 flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!user.activo}
                    onChange={(e) => setUserField("activo", e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span
                    className={`text-sm ${
                      user.activo ? "text-green-700" : "text-gray-700"
                    }`}
                  >
                    {user.activo ? "Activo" : "Inactivo"}
                  </span>
                </label>
              </div>

              {/* Parentesco */}
              <div>
                <label className="block text-sm mb-1">Parentesco</label>
                <select
                  value={String(pac.contacto_emergencia_par || "")}
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
                  <option value="hijos">Hijos</option>
                  <option value="padres">Padres</option>
                  <option value="hermanos">Hermanos</option>
                  <option value="abuelos">Abuelos</option>
                  <option value="esposos">Esposos</option>
                  <option value="otros">Otros</option>
                </select>
                {errors.contacto_emergencia_par && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.contacto_emergencia_par}
                  </p>
                )}
              </div>

              {/* Nombre contacto */}
              <div className="md:col-span-1">
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

              {/* Celular contacto */}
              <div className="md:col-span-1">
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

          {/* Antecedentes */}
          <div className="rounded-2xl p-4 shadow-md bg-white">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-gray-900">Antecedentes</h3>
            </div>

            {/* Propios */}
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-800 mb-2">
                  Enfermedades propias
                </p>
              </div>

              {propios.length === 0 && (
                <p className="text-sm text-gray-600">Sin registros.</p>
              )}

              <div className="space-y-2">
                {propios.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-6 gap-2"
                  >
                    <div className="sm:col-span-4">
                      <select
                        className="w-full min-w-0 rounded-lg border px-2 py-2 text-sm"
                        value={
                          row.id_antecedente === ""
                            ? ""
                            : String(row.id_antecedente)
                        }
                        onChange={(e) =>
                          setPropios((arr) =>
                            arr.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    id_antecedente:
                                      e.target.value === ""
                                        ? ""
                                        : Number(e.target.value),
                                  }
                                : r
                            )
                          )
                        }
                      >
                        <option value="">— Selecciona antecedente —</option>
                        {antecedentesOpts.map((opt) => (
                          <option
                            key={opt.id_antecedente}
                            value={String(opt.id_antecedente)}
                          >
                            {opt.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="button"
                        onClick={() =>
                          setPropios((arr) => arr.filter((_, i) => i !== idx))
                        }
                        className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setPropios((arr) => [
                    ...arr,
                    { id_antecedente: "", relacion_familiar: "propio" },
                  ])
                }
                className="mt-3 rounded-lg px-4 py-2 text-white"
                style={{ backgroundColor: PRIMARY }}
              >
                Añadir propio
              </button>
            </div>

            {/* Familiares */}
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-800 mb-2">
                  Antecedentes familiares
                </p>
              </div>

              {familiares.length === 0 && (
                <p className="text-sm text-gray-600">Sin registros.</p>
              )}

              <div className="space-y-2">
                {familiares.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-8 gap-2"
                  >
                    <div className="sm:col-span-5">
                      <select
                        className="w-full min-w-0 rounded-lg border px-2 py-2 text-sm"
                        value={
                          row.id_antecedente === ""
                            ? ""
                            : String(row.id_antecedente)
                        }
                        onChange={(e) =>
                          setFamiliares((arr) =>
                            arr.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    id_antecedente:
                                      e.target.value === ""
                                        ? ""
                                        : Number(e.target.value),
                                  }
                                : r
                            )
                          )
                        }
                      >
                        <option value="">— Selecciona antecedente —</option>
                        {antecedentesOpts.map((opt) => (
                          <option
                            key={opt.id_antecedente}
                            value={String(opt.id_antecedente)}
                          >
                            {opt.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <select
                        className="w-full min-w-0 rounded-lg border px-2 py-2 text-sm"
                        value={row.relacion_familiar}
                        onChange={(e) =>
                          setFamiliares((arr) =>
                            arr.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    relacion_familiar: e.target
                                      .value as RelFamiliar,
                                  }
                                : r
                            )
                          )
                        }
                      >
                        {FAMILIARES.map((rel) => (
                          <option key={rel} value={rel}>
                            {rel.charAt(0).toUpperCase() + rel.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-1">
                      <button
                        type="button"
                        onClick={() =>
                          setFamiliares((arr) =>
                            arr.filter((_, i) => i !== idx)
                          )
                        }
                        className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setFamiliares((arr) => [
                    ...arr,
                    { id_antecedente: "", relacion_familiar: "padres" },
                  ])
                }
                className="mt-3 rounded-lg px-4 py-2 text-white"
                style={{ backgroundColor: PRIMARY }}
              >
                Añadir familiar
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
