// src/pages/admin/PacienteEdicion.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/axios";
import { e164ToLocal, localToE164 } from "../../utils/phoneFormat";
import { Pencil, Eye, EyeOff, Loader2, Info } from "lucide-react";
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
  // si viene de la BD tendrá id para borrar
  id_paciente_antecedente?: number;
  id_antecedente: number | "" | typeof OTHER;
  relacion_familiar: RelFamiliar;
};

type Toast = { id: number; message: string; type?: "success" | "error" };

const PRIMARY = "#0070B7";
const OTHER = "__other__" as const; // sentinel para opción "Otro (especificar…)"
const ANT_OTROS_ID = Number(import.meta.env.VITE_ANT_OTROS_ID || NaN);
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
// Límites para antecedentes
const MAX_PROP = 8;
const MAX_FAM = 8;

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
function useDebouncedCallback(cb: () => void, delay = 400) {
  const t = useRef<number | undefined>(undefined as any);
  return () => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(cb, delay);
  };
}
function absolutize(url?: string | null) {
  if (!url) return null;

  if (!url.includes("/") && !url.startsWith("http")) {
    return null;
  }

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

// Calcular fecha mínima permitida (6 meses atrás desde hoy)
function getFechaMin6Meses(): string {
  const hoy = new Date();
  hoy.setMonth(hoy.getMonth() - 6);
  return hoy.toISOString().split("T")[0];
}

// Mensaje dinámico según edad
function getMensajeEdad(esMenor: boolean): string {
  if (esMenor) {
    return "Este paciente es menor de edad. El celular y correo propios son opcionales, pero el correo de contacto de emergencia es obligatorio.";
  }
  return "Este paciente es mayor de edad. El celular y correo propios son obligatorios, pero el correo de contacto de emergencia es opcional.";
}

// "Otros" de la BD: por id o por nombre (defensa adicional por nombre)
function isDBOtros(a: { id_antecedente: number; nombre: string }) {
  const n = (a.nombre || "").trim().toLowerCase();
  const byId =
    Number.isFinite(ANT_OTROS_ID) && a.id_antecedente === ANT_OTROS_ID;
  const byName = n === "otros" || n === "otro";
  return byId || byName;
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
   Modal para agregar antecedente
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
          <label className="block text-sm text-gray-600">
            Nombre del antecedente
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            placeholder="Ej. Artritis reumatoide"
          />
          <p className="text-xs text-gray-500">
            Se validará que no exista duplicado en la base de datos.
          </p>
        </div>
        <footer className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            onClick={onCancel}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              try {
                await onConfirmName(name);
              } catch (e: any) {
                setErr(
                  e?.message ||
                    "No se pudo crear el antecedente. Intenta de nuevo."
                );
              }
            }}
            className="rounded-xl bg-blue-600 text-white px-3 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Crear"}
          </button>
        </footer>
      </div>
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
  const [showSuccess, setShowSuccess] = useState(false);

  const { subirFoto, eliminarFoto } = useFotoPerfil();

  // Entidades
  const [pac, setPac] = useState<Paciente | null>(null);
  const [user, setUser] = useState<Usuario | null>(null);

  // Estado para verificar si también es odontólogo
  const [esOdontologo, setEsOdontologo] = useState<boolean | null>(null);
  const [checkingOdontologo, setCheckingOdontologo] = useState(false);

  // Estado para verificar si también es administrador
  const [esAdmin, setEsAdmin] = useState<boolean | null>(null);
  const [checkingAdmin, setCheckingAdmin] = useState(false);

  // Estado para verificar si es menor de edad
  const [esMenor, setEsMenor] = useState<boolean>(false);

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

  // --- LÍMITES y flags de integridad ---
  const propiasIncomplete = propios.some(
    (p) => !p.id_antecedente || p.id_antecedente === OTHER
  );
  const familiaresIncomplete = familiares.some(
    (f) => !f.id_antecedente || f.id_antecedente === OTHER
  );

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

  // Control del modal "Agregar antecedente"
  const [addAntOpen, setAddAntOpen] = useState(false);
  const [addAntBusy, setAddAntBusy] = useState(false);
  const [addAntPrefill, setAddAntPrefill] = useState("");
  const [triggerRow, setTriggerRow] = useState<{
    kind: "propio" | "familiar";
    idx: number;
  } | null>(null);

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

        // 2) Usuario lo construimos directo con lo que ya viene en el serializer
        const u: Usuario = {
          id_usuario: Number((p as any).id_usuario),
          primer_nombre: (p as any).primer_nombre ?? null,
          segundo_nombre: (p as any).segundo_nombre ?? null,
          primer_apellido: (p as any).primer_apellido ?? null,
          segundo_apellido: (p as any).segundo_apellido ?? null,
          cedula: (p as any).cedula ?? null,
          sexo: normSexo((p as any).sexo ?? null),
          celular: e164ToLocal((p as any).celular ?? null),
          email: (p as any).usuario_email ?? null,
          usuario_email: (p as any).usuario_email ?? null,
          fecha_nacimiento: (p as any).fecha_nacimiento ?? "",
          tipo_sangre: (p as any).tipo_sangre ?? "",
          is_active: (p as any).is_active ?? true,
          activo: (p as any).is_active ?? true,
          foto: absolutize((p as any).foto || (p as any).usuario_foto || null),
        };

        setUser(u);

        // Inicializar preview de foto con la foto existente
        if (u.foto) {
          setFotoPreview(u.foto);
        }

        // Calcular si es menor de edad
        if (u.fecha_nacimiento) {
          const hoy = new Date();
          const nacimiento = new Date(u.fecha_nacimiento);
          let edad = hoy.getFullYear() - nacimiento.getFullYear();
          const mes = hoy.getMonth() - nacimiento.getMonth();
          if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) {
            edad--;
          }
          setEsMenor(edad < 18);
        } else {
          setEsMenor(false);
        }

        // Guarda originales para verificación remota (en formato local para comparación)
        originalVals.current = {
          cedula: String(u.cedula || ""),
          email: String(u.usuario_email || u.email || "").toLowerCase(),
          celular: String(u.celular || ""), // Ya está en formato local
        };

        // Convertir celulares del contacto de emergencia a formato local
        p.contacto_emergencia_cel = e164ToLocal(p.contacto_emergencia_cel);
        // Normalizar parentesco a minúsculas (backend usa minúsculas: 'padres', 'hijos', etc.)
        if (p.contacto_emergencia_par) {
          p.contacto_emergencia_par = p.contacto_emergencia_par.toLowerCase();
        }
        setPac(p);

        // 3) Catálogo de antecedentes
        try {
          const antRes = await api.get(`/antecedentes/`);
          const list = (antRes.data as any[])
            .map((a) => ({
              id_antecedente: a.id_antecedente ?? a.id ?? 0,
              nombre: String(a.nombre ?? "").trim(),
            }))
            .filter((x) => x.id_antecedente && x.nombre && !isDBOtros(x))
            .sort((a, b) =>
              a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
            );
          setAntecedentesOpts(list);
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
          ]);
        }

        // 4) Antecedentes del paciente (ya filtrados en el backend con ?id_paciente=)
        try {
          const paRes = await api.get(`/paciente-antecedentes/`, {
            params: { id_paciente: pacienteId },
          });

          const raw: any[] = Array.isArray(paRes.data?.results)
            ? paRes.data.results
            : Array.isArray(paRes.data)
            ? paRes.data
            : [];

          const seen = new Set<string>();
          const prop: RowAntecedente[] = [];
          const fam: RowAntecedente[] = [];

          raw.forEach((r) => {
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

        // 5) Verificar si también es odontólogo
        if (u.id_usuario) {
          setCheckingOdontologo(true);
          try {
            const verifyRes = await api.get(
              `/usuarios/${u.id_usuario}/verificar-rol-odontologo/`
            );
            setEsOdontologo(verifyRes.data?.existe === true);
          } catch (err) {
            console.error("Error al verificar rol odontólogo:", err);
            setEsOdontologo(null);
          } finally {
            setCheckingOdontologo(false);
          }
        }

        // 6) Verificar si también es administrador (is_staff=true)
        if (u.id_usuario) {
          setCheckingAdmin(true);
          try {
            const userRes = await api.get(`/usuarios/${u.id_usuario}/`);
            setEsAdmin(userRes.data?.is_staff === true);
          } catch (err) {
            console.error("Error al verificar permisos de admin:", err);
            setEsAdmin(null);
          } finally {
            setCheckingAdmin(false);
          }
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

  /* =========================
      Funciones del modal de antecedentes
  ========================== */
  // Helper: crear antecedente si no existe (case-insensitive) y devolver el id
  async function ensureAntecedenteByName(rawName: string): Promise<number> {
    const name = rawName.trim();
    if (!name) throw new Error("El nombre no puede estar vacío.");

    // Bloquea nombres reservados "otros"/"otro"
    const lower = name.toLowerCase();
    if (lower === "otros" || lower === "otro") {
      throw new Error(
        'Usa "Otro (especificar…)" y escribe el nombre real (no "Otros").'
      );
    }

    const exist = antecedentesOpts.find(
      (a) => a.nombre.toLowerCase() === lower
    );
    if (exist) return exist.id_antecedente;

    const res = await api.post("/antecedentes/", { nombre: name });
    const created: AntecedenteOption = {
      id_antecedente: res.data.id_antecedente,
      nombre: String(res.data.nombre ?? "").trim(),
    };
    setAntecedentesOpts((prev) =>
      [...prev, created].sort((x, y) =>
        x.nombre.localeCompare(y.nombre, "es", { sensitivity: "base" })
      )
    );
    return created.id_antecedente;
  }

  function openAddModal(
    kind: "propio" | "familiar",
    idx: number,
    prefill = ""
  ) {
    setTriggerRow({ kind, idx });
    setAddAntPrefill(prefill);
    setAddAntOpen(true);
  }

  async function handleCreateAntecedente(name: string) {
    setAddAntBusy(true);
    try {
      const newId = await ensureAntecedenteByName(name);
      if (triggerRow) {
        if (triggerRow.kind === "propio") {
          setPropios((arr) =>
            arr.map((r, i) =>
              i === triggerRow.idx ? { ...r, id_antecedente: newId } : r
            )
          );
        } else {
          setFamiliares((arr) =>
            arr.map((r, i) =>
              i === triggerRow.idx ? { ...r, id_antecedente: newId } : r
            )
          );
        }
      }
      setAddAntOpen(false);
    } finally {
      setAddAntBusy(false);
    }
  }

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
            : /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(nextPwd)
            ? ""
            : "Mín. 8, una mayúscula y un número.",
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

    // Recalcular edad si cambia fecha de nacimiento
    if (k === "fecha_nacimiento") {
      const fechaNac = String(v);
      if (fechaNac) {
        const fechaSeleccionada = new Date(fechaNac);
        const fechaMin1930 = new Date("1930-01-01");
        const fechaMin6Meses = new Date(getFechaMin6Meses());
        const hoy = new Date();

        // Validar rango
        if (fechaSeleccionada < fechaMin1930) {
          setErrors((prev) => ({
            ...prev,
            fecha_nacimiento: "La fecha no puede ser anterior a 1930.",
          }));
          return;
        }
        if (fechaSeleccionada > fechaMin6Meses) {
          setErrors((prev) => ({
            ...prev,
            fecha_nacimiento:
              "El paciente debe tener al menos 6 meses de edad.",
          }));
          return;
        }

        // Calcular edad
        const nacimiento = new Date(fechaNac);
        let edad = hoy.getFullYear() - nacimiento.getFullYear();
        const mes = hoy.getMonth() - nacimiento.getMonth();
        if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) {
          edad--;
        }

        const erasMenor = esMenor;
        const ahoraMenor = edad < 18;
        setEsMenor(ahoraMenor);

        // Mostrar toast si cambió de menor a mayor de edad
        if (erasMenor && !ahoraMenor) {
          pushToast(
            "El paciente ahora es mayor de edad. El celular y correo propios son obligatorios.",
            "success"
          );
        }
        // Mostrar toast si cambió de mayor a menor de edad
        if (!erasMenor && ahoraMenor) {
          pushToast(
            "El paciente ahora es menor de edad. El correo de contacto de emergencia es obligatorio.",
            "success"
          );
        }
      } else {
        setEsMenor(false);
      }
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
      | "contacto_emergencia_par"
      | "contacto_emergencia_email",
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
  const pwdHasMin = pwd.length >= 8;
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
        newErrors.fecha_nacimiento =
          "El paciente debe tener al menos 6 meses de edad.";
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

    // Validar antecedentes: no permitir filas vacías
    if (propiasIncomplete) {
      pushToast("Selecciona cada enfermedad propia o quítala.", "error");
      setErrors(newErrors);
      return false;
    }
    if (familiaresIncomplete) {
      pushToast("Selecciona cada antecedente familiar o quítalo.", "error");
      setErrors(newErrors);
      return false;
    }
    if (propios.length > MAX_PROP) {
      pushToast("Solo puedes añadir hasta 3 enfermedades propias.", "error");
      setErrors(newErrors);
      return false;
    }
    if (familiares.length > MAX_FAM) {
      pushToast("Solo puedes añadir hasta 3 antecedentes familiares.", "error");
      setErrors(newErrors);
      return false;
    }

    // Antecedentes: evitar duplicados en UI
    const all = [
      ...propios.map((r) => ({
        key: `${r.id_antecedente}-propio`,
        ok: !!r.id_antecedente && r.id_antecedente !== OTHER,
      })),
      ...familiares.map((r) => ({
        key: `${r.id_antecedente}-${r.relacion_familiar}`,
        ok: !!r.id_antecedente && r.id_antecedente !== OTHER,
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
      if (password.length < 8) {
        setErrors((p) => ({ ...p, password: "Mínimo 8 caracteres." }));
        pushToast("La contraseña debe tener al menos 8 caracteres.", "error");
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

      // Convertir celular a E.164
      const celularOriginal = String(user.celular || "").trim();
      const celularE164 = localToE164(celularOriginal);

      // Solo enviar si no está vacío (para mayor de edad es obligatorio, validado antes)
      if (celularE164) {
        fd.append("celular", celularE164);
      }

      fd.append(
        "usuario_email",
        String(user.usuario_email || user.email || "")
      );
      fd.append("activo", user.activo ? "true" : "false");
      if (password) fd.append("password", password);

      const usrPatch = await api.patch(`/usuarios/${user.id_usuario}/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // =======================
      // CLOUDINARY FOTO
      // =======================

      // Crear newUser primero
      const newUser = usrPatch.data as Usuario;

      // Si subió una foto nueva
      if (fotoFile) {
        await subirFoto(user.id_usuario, fotoFile);
      } else if (fotoRemove && !fotoFile) {
        await eliminarFoto(user.id_usuario);
      }

      // Siempre recargar usuario para obtener la URL real de Cloudinary
      const freshUser = await api.get(`/usuarios/${user.id_usuario}/`);
      newUser.foto = absolutize(
        freshUser.data.foto || freshUser.data.usuario_foto || null
      );

      // Convertir celular a formato local
      newUser.celular = e164ToLocal(newUser.celular);

      // Actualizar estado en React
      setUser({
        ...newUser,
        usuario_email: newUser.usuario_email ?? newUser.email ?? "",
        activo: newUser.activo ?? newUser.is_active ?? true,
        sexo: normSexo(newUser.sexo),
      });

      // Limpiar estados de foto
      setFotoFile(null);
      setFotoPreview(null);
      setFotoRemove(false);

      // 2) PATCH paciente (contacto emergencia)
      const celularEmergenciaE164 = localToE164(
        pac.contacto_emergencia_cel ?? ""
      );

      const pacPatch = await api.patch(`/pacientes/${pac.id_paciente}/`, {
        contacto_emergencia_nom: pac.contacto_emergencia_nom ?? "",
        contacto_emergencia_cel: celularEmergenciaE164,
        contacto_emergencia_par: pac.contacto_emergencia_par ?? "",
        contacto_emergencia_email: pac.contacto_emergencia_email ?? "",
      });
      const newPac = pacPatch.data as Paciente;
      // Convertir celular de emergencia de E.164 a formato local para mostrar
      newPac.contacto_emergencia_cel = e164ToLocal(
        newPac.contacto_emergencia_cel
      );
      // Normalizar parentesco a minúsculas
      if (newPac.contacto_emergencia_par) {
        newPac.contacto_emergencia_par =
          newPac.contacto_emergencia_par.toLowerCase();
      }
      setPac(newPac);

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
        if (r.id_antecedente === "" || r.id_antecedente === OTHER) return;
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

      setShowSuccess(true);
      setTimeout(() => {
        navigate(`/admin/pacientes/${pacienteId}`);
      }, 1000);
    } catch (e: any) {
      // Mapea errores 400 del backend a los campos
      const data = e?.response?.data;
      let errorMessage = "No se pudo guardar la edición. ";

      if (data) {
        const next: Errors = {};

        // Mapear todos los errores posibles del backend
        if (data.cedula) {
          const msg = Array.isArray(data.cedula)
            ? data.cedula[0]
            : String(data.cedula);
          next.cedula = msg;
          errorMessage += `Cédula: ${msg}. `;
        }
        if (data.email || data.usuario_email) {
          const msg = data.email ?? data.usuario_email;
          const msgStr = Array.isArray(msg) ? msg[0] : String(msg);
          next.usuario_email = msgStr;
          errorMessage += `Email: ${msgStr}. `;
        }
        if (data.celular) {
          const msg = Array.isArray(data.celular)
            ? data.celular[0]
            : String(data.celular);
          next.celular = msg;
          errorMessage += `Celular: ${msg}. `;
        }
        if (data.contacto_emergencia_cel) {
          const msg = Array.isArray(data.contacto_emergencia_cel)
            ? data.contacto_emergencia_cel[0]
            : String(data.contacto_emergencia_cel);
          next.contacto_emergencia_cel = msg;
          errorMessage += `Celular emergencia: ${msg}. `;
        }
        if (data.contacto_emergencia_email) {
          const msg = Array.isArray(data.contacto_emergencia_email)
            ? data.contacto_emergencia_email[0]
            : String(data.contacto_emergencia_email);
          next.contacto_emergencia_email = msg;
          errorMessage += `Email emergencia: ${msg}. `;
        }
        if (data.contacto_emergencia_nom) {
          const msg = Array.isArray(data.contacto_emergencia_nom)
            ? data.contacto_emergencia_nom[0]
            : String(data.contacto_emergencia_nom);
          next.contacto_emergencia_nom = msg;
          errorMessage += `Nombre emergencia: ${msg}. `;
        }

        // Capturar cualquier otro error no mapeado
        if (data.detail) {
          errorMessage += String(data.detail);
        } else if (data.non_field_errors) {
          const nfe = Array.isArray(data.non_field_errors)
            ? data.non_field_errors[0]
            : String(data.non_field_errors);
          errorMessage += nfe;
        } else if (Object.keys(next).length === 0) {
          // Si hay data pero no mapeamos nada, mostrar todo
          errorMessage += JSON.stringify(data);
        }

        if (Object.keys(next).length) {
          setErrors((prev) => ({ ...prev, ...next }));
        }
      } else {
        // Error de red u otro tipo de error
        errorMessage += e?.message || "Error desconocido. Revisa la consola.";
      }

      setError(errorMessage);
      pushToast(errorMessage, "error");
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
      {/* Toast éxito */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
            <div className="font-semibold">
              ¡Cambios guardados correctamente!
            </div>
            <div className="text-sm text-white/90">Redirigiendo…</div>
          </div>
        </div>
      )}

      <ToastView items={toasts} remove={removeToast} />

      {/* Header con título + acciones */}
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
                Este paciente también es odontólogo
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

            {/* Mensaje dinámico según edad */}
            <p
              className={`text-xs flex items-center gap-1 ${
                esMenor ? "text-orange-600" : "text-blue-600"
              }`}
            >
              <Info className="h-3 w-3" />
              {getMensajeEdad(esMenor)}
            </p>
          </div>
        </div>
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
                  min="1930-01-01"
                  max={getFechaMin6Meses()}
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
                <label className="block text-sm mb-1">
                  Celular{!esMenor && " *"}
                  {esMenor && (
                    <span className="text-xs text-gray-500 ml-1">
                      (opcional)
                    </span>
                  )}
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
                <label className="block text-sm mb-1">
                  Correo{!esMenor && " *"}
                  {esMenor && (
                    <span className="text-xs text-gray-500 ml-1">
                      (opcional)
                    </span>
                  )}
                </label>
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
                  value={String(
                    pac.contacto_emergencia_par || ""
                  ).toLowerCase()}
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
                <label className="block text-sm mb-1">Nombre contacto *</label>
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
                <label className="block text-sm mb-1">Celular contacto *</label>
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

              {/* Email contacto */}
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">
                  Correo contacto{esMenor && " *"}
                  {!esMenor && (
                    <span className="text-xs text-gray-500 ml-1">
                      (opcional)
                    </span>
                  )}
                </label>
                <input
                  type="email"
                  value={String(pac.contacto_emergencia_email || "")}
                  onChange={(e) =>
                    setPac((pp) =>
                      pp
                        ? { ...pp, contacto_emergencia_email: e.target.value }
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
                {propios.map((row, idx) => {
                  // IDs ya seleccionados en propios (excluyendo el actual)
                  const yaSeleccionados = propios
                    .filter((_, i) => i !== idx)
                    .map((r) => r.id_antecedente)
                    .filter((id) => id !== "" && id !== OTHER);

                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-6 gap-2"
                    >
                      <div className="sm:col-span-4">
                        <select
                          className="w-full min-w-0 rounded-lg border px-2 py-2 text-sm"
                          value={
                            row.id_antecedente === "" ||
                            row.id_antecedente === OTHER
                              ? String(row.id_antecedente)
                              : String(row.id_antecedente)
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === OTHER) {
                              // Abre modal para crear nuevo
                              openAddModal("propio", idx);
                            } else {
                              setPropios((arr) =>
                                arr.map((r, i) =>
                                  i === idx
                                    ? {
                                        ...r,
                                        id_antecedente:
                                          v === "" ? "" : Number(v),
                                      }
                                    : r
                                )
                              );
                            }
                          }}
                        >
                          <option value="">— Selecciona antecedente —</option>
                          {antecedentesOpts.map((opt) => {
                            const estaSeleccionado = yaSeleccionados.includes(
                              opt.id_antecedente
                            );
                            return (
                              <option
                                key={opt.id_antecedente}
                                value={String(opt.id_antecedente)}
                                disabled={estaSeleccionado}
                              >
                                {opt.nombre}
                                {estaSeleccionado ? " (ya seleccionado)" : ""}
                              </option>
                            );
                          })}
                          <option value={OTHER}>Otro (especificar…)</option>
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
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() =>
                  setPropios((arr) => [
                    ...arr,
                    { id_antecedente: "", relacion_familiar: "propio" },
                  ])
                }
                className="mt-3 rounded-lg px-4 py-2 text-white disabled:opacity-60"
                style={{ backgroundColor: PRIMARY }}
                disabled={propios.length >= MAX_PROP || propiasIncomplete}
              >
                {propios.length >= MAX_PROP
                  ? "Límite alcanzado (3)"
                  : "Añadir propio"}
              </button>

              {propiasIncomplete && (
                <p className="mt-1 text-xs text-red-600">
                  Primero selecciona la enfermedad anterior o quítala.
                </p>
              )}
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
                {familiares.map((row, idx) => {
                  // IDs ya seleccionados en familiares (excluyendo el actual)
                  const yaSeleccionados = familiares
                    .filter((_, i) => i !== idx)
                    .map((r) => r.id_antecedente)
                    .filter((id) => id !== "" && id !== OTHER);

                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-8 gap-2"
                    >
                      <div className="sm:col-span-5">
                        <select
                          className="w-full min-w-0 rounded-lg border px-2 py-2 text-sm"
                          value={
                            row.id_antecedente === "" ||
                            row.id_antecedente === OTHER
                              ? String(row.id_antecedente)
                              : String(row.id_antecedente)
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === OTHER) {
                              openAddModal("familiar", idx);
                            } else {
                              setFamiliares((arr) =>
                                arr.map((r, i) =>
                                  i === idx
                                    ? {
                                        ...r,
                                        id_antecedente:
                                          v === "" ? "" : Number(v),
                                      }
                                    : r
                                )
                              );
                            }
                          }}
                        >
                          <option value="">— Selecciona antecedente —</option>
                          {antecedentesOpts.map((opt) => {
                            const estaSeleccionado = yaSeleccionados.includes(
                              opt.id_antecedente
                            );
                            return (
                              <option
                                key={opt.id_antecedente}
                                value={String(opt.id_antecedente)}
                                disabled={estaSeleccionado}
                              >
                                {opt.nombre}
                                {estaSeleccionado ? " (ya seleccionado)" : ""}
                              </option>
                            );
                          })}
                          <option value={OTHER}>Otro (especificar…)</option>
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
                  );
                })}
              </div>{" "}
              <button
                type="button"
                onClick={() =>
                  setFamiliares((arr) => [
                    ...arr,
                    { id_antecedente: "", relacion_familiar: "padres" },
                  ])
                }
                className="mt-3 rounded-lg px-4 py-2 text-white disabled:opacity-60"
                style={{ backgroundColor: PRIMARY }}
                disabled={familiares.length >= MAX_FAM || familiaresIncomplete}
              >
                {familiares.length >= MAX_FAM
                  ? "Límite alcanzado (3)"
                  : "Añadir familiar"}
              </button>
              {familiaresIncomplete && (
                <p className="mt-1 text-xs text-red-600">
                  Primero selecciona el antecedente anterior o quítalo.
                </p>
              )}
            </div>
          </div>
        </div>
      </form>

      {/* Modal agregar antecedente */}
      <AddAntecedenteModal
        open={addAntOpen}
        initialValue={addAntPrefill}
        busy={addAntBusy}
        onCancel={() => setAddAntOpen(false)}
        onConfirmName={handleCreateAntecedente}
      />
    </div>
  );
}
