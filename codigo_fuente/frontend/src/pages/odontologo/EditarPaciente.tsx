// src/pages/odontologo/EditarPaciente.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Info, Loader2 } from "lucide-react";
import { api } from "../../api/axios";
import { e164ToLocal, localToE164 } from "../../utils/phoneFormat";
import { useFotoPerfil } from "../../hooks/useFotoPerfil";

/* =========================
   Tipos
========================= */
type Paciente = {
  id_paciente: number;
  id_usuario: number;
  contacto_emergencia_nom?: string | null;
  contacto_emergencia_cel?: string | null;
  contacto_emergencia_par?: string | null;
  contacto_emergencia_email?: string | null;
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
  id_paciente_antecedente?: number;
  id_antecedente: number | "";
  relacion_familiar: RelFamiliar;
};

type Toast = { id: number; message: string; type?: "success" | "error" };

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
   Validadores + helpers
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
function isValidEmail(
  email: string,
  permitirSistema: boolean = false
): boolean {
  if (!email) return false;
  // Rechazar emails del sistema SOLO si NO se permite (es decir, si es mayor de edad)
  if (!permitirSistema && email.toLowerCase().includes("@oralflow.system"))
    return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
function fullNameTwoWords(name: string): boolean {
  return /^\s*\S+\s+\S+(\s+\S+)*\s*$/.test(name);
}

// Calcular fecha mínima permitida (6 meses atrás desde hoy)
function getFechaMin6Meses(): string {
  const hoy = new Date();
  hoy.setMonth(hoy.getMonth() - 6);
  return hoy.toISOString().split("T")[0];
}

// Mensaje dinámico según edad
function getMensajeEdad(esMenor: boolean): string {
  if (esMenor) {
    return "Menor: celular y correo opcionales. Email de emergencia obligatorio.";
  }
  return "Mayor: celular y correo obligatorios. Email de emergencia opcional.";
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

  // No absolutizar archivos tipo "7.JPG"
  if (!url.startsWith("http") && !url.includes("/")) {
    return null;
  }

  try {
    // Si es URL absoluta válida
    new URL(url);
    return url;
  } catch {
    // Convertir rutas relativas del backend
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
    <>
      {/* Errores abajo a la derecha */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {items
          .filter((t) => t.type === "error")
          .map((t) => (
            <div
              key={t.id}
              className="rounded-lg px-4 py-2 shadow-md text-sm text-white bg-red-600"
              onAnimationEnd={() => remove(t.id)}
            >
              {t.message}
            </div>
          ))}
      </div>
      {items
        .filter((t) => t.type === "success")
        .map((t) => (
          <div
            key={t.id}
            className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200"
          >
            <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
              <div className="font-semibold">{t.message}</div>
              <div className="text-sm text-white/90">Redirigiendo…</div>
            </div>
          </div>
        ))}
    </>
  );
}

/* =========================
   Componente
========================= */
export default function EditarPacienteOdontologo() {
  const { id } = useParams();
  const pacienteId = useMemo(() => Number(id), [id]);
  const navigate = useNavigate();
  const { subirFoto, eliminarFoto } = useFotoPerfil();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Entidades
  const [pac, setPac] = useState<Paciente | null>(null);
  const [user, setUser] = useState<Usuario | null>(null);

  // Estado para verificar si es menor de edad
  const [esMenor, setEsMenor] = useState<boolean>(false);

  // Estado para verificar si también es odontólogo
  const [esOdontologo, setEsOdontologo] = useState<boolean | null>(null);
  const [checkingOdontologo, setCheckingOdontologo] = useState(false);

  // Estado para verificar si también es administrador
  const [esAdmin, setEsAdmin] = useState<boolean | null>(null);
  const [checkingAdmin, setCheckingAdmin] = useState(false);

  // Valores originales (para verificación remota)
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
        // Convertir celular de emergencia a formato local
        p.contacto_emergencia_cel = e164ToLocal(p.contacto_emergencia_cel);
        // Normalizar parentesco a minúsculas (backend usa minúsculas: 'padres', 'hijos', etc.)
        if (p.contacto_emergencia_par) {
          p.contacto_emergencia_par = p.contacto_emergencia_par.toLowerCase();
        }
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
          celular: e164ToLocal(u.celular ?? null),
        };
        setUser(normalized);

        originalVals.current = {
          cedula: String(normalized.cedula || ""),
          email: String(
            normalized.usuario_email || normalized.email || ""
          ).toLowerCase(),
          celular: String(normalized.celular || ""),
        };

        // Calcular si es menor de edad
        if (normalized.fecha_nacimiento) {
          const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(
            normalized.fecha_nacimiento
          );
          if (match) {
            const year = Number(match[1]);
            const month = Number(match[2]) - 1;
            const day = Number(match[3]);
            const birth = new Date(year, month, day);
            if (!Number.isNaN(birth.getTime())) {
              const now = new Date();
              let age = now.getFullYear() - birth.getFullYear();
              const monthDiff = now.getMonth() - birth.getMonth();
              if (
                monthDiff < 0 ||
                (monthDiff === 0 && now.getDate() < birth.getDate())
              ) {
                age--;
              }
              setEsMenor(age < 18);
            }
          }
        }

        // Verificar si también es odontólogo
        if (p.id_usuario) {
          setCheckingOdontologo(true);
          try {
            const verifyRes = await api.get(
              `/usuarios/${p.id_usuario}/verificar-rol-odontologo/`
            );
            setEsOdontologo(verifyRes.data?.existe === true);
          } catch (err) {
            setEsOdontologo(null);
          } finally {
            setCheckingOdontologo(false);
          }
        }

        // Verificar si también es administrador (is_staff=true)
        if (p.id_usuario) {
          setCheckingAdmin(true);
          try {
            const userRes = await api.get(`/usuarios/${p.id_usuario}/`);
            setEsAdmin(userRes.data?.is_staff === true);
          } catch (err) {
            setEsAdmin(null);
          } finally {
            setCheckingAdmin(false);
          }
        }

        // 3) Catálogo antecedentes
        try {
          const antRes = await api.get(`/antecedentes/`);
          const list = (antRes.data as any[]).map((a) => ({
            id_antecedente: a.id_antecedente ?? a.id ?? 0,
            nombre: a.nombre ?? "",
          }));
          setAntecedentesOpts(list.filter((x) => x.id_antecedente && x.nombre));
        } catch {
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

        // 4) Antecedentes del paciente
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
        if (alive) setError("No se pudo cargar el perfil para edición.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pacienteId]);

  /* ======= Preview de foto ======= */
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

  /* =========================
     Edición de formulario
  ========================== */
  const setUserField = (k: keyof Usuario, v: string | boolean) => {
    if (!user) return;
    setErrors((prev) => ({ ...prev, [k as any]: "" }));
    if (k === "cedula") setCedulaExists(null);
    if (k === "usuario_email") setEmailExists(null);
    if (k === "celular") setCelularExists(null);
    setUser({ ...user, [k]: v as any });

    // Recalcular edad si cambia fecha de nacimiento
    if (k === "fecha_nacimiento") {
      const fechaNac = String(v);
      if (fechaNac) {
        const fechaSeleccionada = new Date(fechaNac);
        const fechaMin1930 = new Date("1930-01-01");
        const fechaMin6Meses = new Date(getFechaMin6Meses());

        // Validar rango y mostrar error inmediatamente
        if (fechaSeleccionada < fechaMin1930) {
          setErrors((prev) => ({
            ...prev,
            fecha_nacimiento: "La fecha no puede ser anterior a 1930.",
          }));
          setEsMenor(false);
          return;
        }
        if (fechaSeleccionada > fechaMin6Meses) {
          setErrors((prev) => ({
            ...prev,
            fecha_nacimiento: "El paciente debe tener al menos 6 meses.",
          }));
          setEsMenor(false);
          return;
        }

        // Si está en el rango válido, limpiar error y calcular edad
        if (!Number.isNaN(fechaSeleccionada.getTime())) {
          setErrors((prev) => ({ ...prev, fecha_nacimiento: "" }));
          const now = new Date();
          let age = now.getFullYear() - fechaSeleccionada.getFullYear();
          const monthDiff = now.getMonth() - fechaSeleccionada.getMonth();
          if (
            monthDiff < 0 ||
            (monthDiff === 0 && now.getDate() < fechaSeleccionada.getDate())
          ) {
            age--;
          }
          setEsMenor(age < 18);
        } else {
          setEsMenor(false);
        }
      } else {
        setEsMenor(false);
      }
    }
  };

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
      | "contacto_emergencia_nom"
      | "contacto_emergencia_cel"
      | "contacto_emergencia_par"
      | "contacto_emergencia_email",
      string
    >
  >;
  const [errors, setErrors] = useState<Errors>({});

  const inputClass = (field?: keyof Errors) =>
    `w-full min-w-0 rounded-lg border px-3 py-2 ${
      field && errors[field]
        ? "border-red-500 focus:ring-2 focus:ring-red-500"
        : "border-gray-300"
    }`;

  /* =========================
    Verificación remota (cédula/email/celular)
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
        if (String(originalVals.current.cedula) === String(data.cedula.value))
          exists = false;
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
        const orig = originalVals.current.email.toLowerCase();
        const val = String(data.email.value || "").toLowerCase();
        if (orig === val) exists = false;
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
        if (String(originalVals.current.celular) === String(data.celular.value))
          exists = false;
        setCelularExists(exists);
        setErrors((prev) => ({
          ...prev,
          celular: exists ? "Celular ya registrado." : "",
        }));
      }
    } catch (e) {
      // Error en verificación remota
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
    // Solo rechazar email del sistema si es MAYOR de edad
    if (!esMenor && m.toLowerCase().includes("@oralflow.system")) {
      setErrors((p) => ({
        ...p,
        usuario_email: "Los mayores de edad no pueden usar emails del sistema.",
      }));
      setEmailExists(null);
      return;
    }
    if (!isValidEmail(m, esMenor)) {
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
    // Solo rechazar email del sistema si es MAYOR de edad
    if (!esMenor && m.toLowerCase().includes("@oralflow.system")) {
      setErrors((p) => ({
        ...p,
        usuario_email: "Los mayores de edad no pueden usar emails del sistema.",
      }));
      setEmailExists(null);
    } else if (isValidEmail(m, esMenor)) {
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

    // Validar fecha de nacimiento
    if (!user.fecha_nacimiento) {
      newErrors.fecha_nacimiento = "Obligatorio.";
    } else {
      const fechaSeleccionada = new Date(user.fecha_nacimiento);
      const fechaMin1930 = new Date("1930-01-01");
      const fechaMin6Meses = new Date(getFechaMin6Meses());

      if (fechaSeleccionada < fechaMin1930) {
        newErrors.fecha_nacimiento = "La fecha no puede ser anterior a 1930.";
      } else if (fechaSeleccionada > fechaMin6Meses) {
        newErrors.fecha_nacimiento = "El paciente debe tener al menos 6 meses.";
      }
    }

    if (!user.tipo_sangre)
      newErrors.tipo_sangre = "Selecciona el tipo de sangre.";

    // Validaciones condicionales según edad
    if (esMenor) {
      // MENOR DE EDAD: celular y email propios son OPCIONALES (y pueden usar @oralflow.system)
      const celularPropio = String(user.celular || "").trim();
      if (celularPropio && !/^09\d{8}$/.test(celularPropio))
        newErrors.celular = "Formato 09xxxxxxxx.";
      if (celularExists === true) newErrors.celular = "Celular ya registrado.";

      const emailPropio = String(user.usuario_email || user.email || "").trim();
      if (emailPropio && !isValidEmail(emailPropio, true))
        newErrors.usuario_email = "Correo inválido.";
      if (emailExists === true) newErrors.usuario_email = "Correo inválido.";
    } else {
      // MAYOR DE EDAD: celular y email propios son OBLIGATORIOS (NO pueden usar @oralflow.system)
      if (!/^09\d{8}$/.test(String(user.celular || "")))
        newErrors.celular = "Formato 09xxxxxxxx.";
      if (celularExists === true) newErrors.celular = "Celular ya registrado.";

      const m = String(user.usuario_email || user.email || "");
      if (m.toLowerCase().includes("@oralflow.system"))
        newErrors.usuario_email =
          "Los mayores de edad no pueden usar emails del sistema.";
      else if (!isValidEmail(m, false))
        newErrors.usuario_email = "Correo inválido.";
      if (emailExists === true) newErrors.usuario_email = "Correo inválido.";
    }

    // Emergencia: validaciones condicionales según edad
    const enom = String(pac.contacto_emergencia_nom || "").trim();
    const ecel = String(pac.contacto_emergencia_cel || "").trim();
    const eemail = String(pac.contacto_emergencia_email || "").trim();
    const epar = String(pac.contacto_emergencia_par || "");

    // Nombre contacto emergencia: SIEMPRE obligatorio
    if (!fullNameTwoWords(enom))
      newErrors.contacto_emergencia_nom = "Nombre y apellido.";

    // Celular contacto emergencia: SIEMPRE obligatorio
    if (!/^09\d{8}$/.test(ecel))
      newErrors.contacto_emergencia_cel = "09xxxxxxxx.";

    // Parentesco: SIEMPRE obligatorio
    if (!epar) newErrors.contacto_emergencia_par = "Selecciona parentesco.";

    // Email contacto emergencia: OBLIGATORIO solo si es MENOR, opcional si es MAYOR
    // NUNCA puede ser @oralflow.system (debe ser email real de contacto)
    if (esMenor) {
      if (!eemail)
        newErrors.contacto_emergencia_email =
          "Correo obligatorio para menores.";
      else if (eemail.toLowerCase().includes("@oralflow.system"))
        newErrors.contacto_emergencia_email =
          "El contacto de emergencia debe tener email real.";
      else if (!isValidEmail(eemail, false))
        newErrors.contacto_emergencia_email = "Correo inválido.";
    } else {
      // Si es mayor y proporciona email, validar formato (pero no es obligatorio)
      if (eemail) {
        if (eemail.toLowerCase().includes("@oralflow.system"))
          newErrors.contacto_emergencia_email =
            "El contacto de emergencia debe tener email real.";
        else if (!isValidEmail(eemail, false))
          newErrors.contacto_emergencia_email = "Correo inválido.";
      }
    }

    // Antecedentes: duplicados en UI
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
        setErrors((e) => ({ ...e }));
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

      // Convertir celular a E.164 antes de enviar
      const celularE164 = localToE164(String(user.celular || ""));
      if (celularE164) {
        fd.append("celular", celularE164);
      }

      fd.append(
        "usuario_email",
        String(user.usuario_email || user.email || "")
      );
      fd.append("activo", user.activo ? "true" : "false");

      // 1) PATCH usuario (multipart sin foto)
      await api.patch(`/usuarios/${user.id_usuario}/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // 1.1 Subir foto (nuevo hook)
      if (fotoFile) {
        await subirFoto(user.id_usuario, fotoFile);
      }

      // 1.2 Eliminar foto (nuevo hook)
      if (fotoRemove && !fotoFile) {
        await eliminarFoto(user.id_usuario);
      }

      // 1.3 Recargar usuario REAL desde backend
      const freshUserResp = await api.get(`/usuarios/${user.id_usuario}/`);
      const newUser = freshUserResp.data as Usuario;

      // Absolutizar la URL real
      newUser.foto = absolutize(newUser.foto);

      // Convertir celular a formato local
      newUser.celular = e164ToLocal(newUser.celular);

      setUser({
        ...newUser,
        usuario_email: newUser.usuario_email ?? newUser.email ?? "",
        activo: newUser.activo ?? newUser.is_active ?? true,
        sexo: normSexo(newUser.sexo),
      });

      // Reset
      setFotoFile(null);
      setFotoPreview(null);
      setFotoRemove(false);

      // 2) PATCH paciente (contacto emergencia)
      const celularEmergenciaE164 = localToE164(
        pac.contacto_emergencia_cel ?? ""
      );
      await api.patch(`/pacientes/${pac.id_paciente}/`, {
        contacto_emergencia_nom: pac.contacto_emergencia_nom ?? "",
        contacto_emergencia_cel: celularEmergenciaE164,
        contacto_emergencia_par: pac.contacto_emergencia_par ?? "",
        contacto_emergencia_email: pac.contacto_emergencia_email ?? "",
      });

      // 3) Antecedentes: borrar y recrear únicos
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
      } catch {}

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

      pushToast("¡Cambios guardados correctamente!", "success");
      setTimeout(() => {
        navigate(`/odontologo/pacientes/${pacienteId}`, { replace: true });
      }, 1500);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setError("No tienes permisos para editar alguno(s) de los campos.");
        pushToast("Permisos insuficientes ❌", "error");
      } else {
        const data = e?.response?.data;
        if (data) {
          const next: any = {};
          if (data.cedula)
            next.cedula = Array.isArray(data.cedula)
              ? data.cedula[0]
              : String(data.cedula);
          if (data.email || data.usuario_email) {
            const msg = data.email ?? data.usuario_email;
            next.usuario_email = Array.isArray(msg) ? msg[0] : String(msg);
          }
          if (Object.keys(next).length)
            setErrors((prev) => ({ ...prev, ...next }));
        }
        setError("No se pudo guardar la edición. Revisa los campos.");
        pushToast("Error al guardar ❌", "error");
      }
    } finally {
      setSaving(false);
    }
  }

  if (Number.isNaN(pacienteId)) {
    return (
      <div className="p-6">
        <p className="text-red-600">ID inválido.</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="p-6">
        <p>Cargando…</p>
      </div>
    );
  }
  if (!user || !pac) {
    return (
      <div className="p-6">
        <p className="text-red-600">No se encontraron datos del paciente.</p>
      </div>
    );
  }

  const displayedPhoto =
    fotoPreview ?? (fotoRemove ? null : user?.foto ?? null);

  return (
    <div className="w-full space-y-6">
      <ToastView items={toasts} remove={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Editar paciente
          </h1>

          {/* Indicadores de verificación */}
          <div className="space-y-1 mt-1">
            {/* Verificando odontólogo */}
            {checkingOdontologo && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Verificando datos de odontólogo...
              </p>
            )}
            {/* Es odontólogo */}
            {esOdontologo === true && (
              <p className="text-xs text-blue-600 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Este paciente también es odontólogo (fecha de nacimiento
                bloqueada)
              </p>
            )}

            {/* Verificando admin */}
            {checkingAdmin && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Verificando permisos de administrador...
              </p>
            )}
            {/* Es admin */}
            {esAdmin === true && (
              <p className="text-xs text-purple-600 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Este paciente también es administrador
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/odontologo/pacientes/${pacienteId}`)}
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
                    onChange={(e) => setUserField(key as any, e.target.value)}
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
                  value={String(user.fecha_nacimiento || "")}
                  onChange={(e) =>
                    setUserField("fecha_nacimiento", e.target.value)
                  }
                  min="1930-01-01"
                  max={getFechaMin6Meses()}
                  disabled={esOdontologo === true}
                  className={`${inputClass("fecha_nacimiento")} ${
                    esOdontologo === true
                      ? "bg-gray-100 cursor-not-allowed"
                      : ""
                  }`}
                />
                {errors.fecha_nacimiento && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.fecha_nacimiento}
                  </p>
                )}
                {esOdontologo && (
                  <p className="mt-1 text-xs text-blue-600">
                    No se puede modificar la fecha de nacimiento de un
                    odontólogo registrado
                  </p>
                )}
                {user.fecha_nacimiento && (
                  <p
                    className={`mt-1 text-xs ${
                      esMenor ? "text-blue-600" : "text-gray-600"
                    }`}
                  >
                    {getMensajeEdad(esMenor)}
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

              {/* Celular del paciente */}
              <div>
                <label className="block text-sm mb-1">
                  Celular {!esMenor && <span className="text-red-600">*</span>}
                </label>
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
                  placeholder="09xxxxxxxx"
                  inputMode="tel"
                  maxLength={10}
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
                {esMenor && (
                  <p className="mt-1 text-xs text-gray-600">
                    Opcional para menores
                  </p>
                )}
              </div>

              {/* Email del paciente */}
              <div>
                <label className="block text-sm mb-1">
                  Correo {!esMenor && <span className="text-red-600">*</span>}
                </label>
                <input
                  type="email"
                  value={String(user.usuario_email || user.email || "")}
                  onChange={(e) =>
                    setUserField("usuario_email", e.target.value.trim())
                  }
                  onBlur={handleEmailBlur}
                  className={inputClass("usuario_email")}
                  placeholder="correo@ejemplo.com"
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
                {esMenor && (
                  <p className="mt-1 text-xs text-gray-600">
                    Opcional para menores
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
              {/* Estado (si tu backend no permite, mostrará 403 y lo manejamos arriba) */}
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

              {/* Email contacto de emergencia */}
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">
                  Correo contacto{" "}
                  {esMenor && <span className="text-red-600">*</span>}
                </label>
                <input
                  type="email"
                  value={String(pac.contacto_emergencia_email || "")}
                  onChange={(e) =>
                    setPac((pp) =>
                      pp
                        ? {
                            ...pp,
                            contacto_emergencia_email: e.target.value.trim(),
                          }
                        : pp
                    )
                  }
                  className={inputClass("contacto_emergencia_email")}
                  placeholder="correo@ejemplo.com"
                />
                {errors.contacto_emergencia_email && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.contacto_emergencia_email}
                  </p>
                )}
                {esMenor && (
                  <p className="mt-1 text-xs text-gray-600">
                    {getMensajeEdad(esMenor)}
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
                className="mt-3 inline-flex items-center gap-2 border rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
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
                className="mt-3 inline-flex items-center gap-2 border rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
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
