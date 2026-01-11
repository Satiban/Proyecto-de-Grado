// src/pages/admin/PacienteDetalle.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import type { AxiosResponse } from "axios";
import { api } from "../../api/axios";
import { e164ToLocal } from "../../utils/phoneFormat";
import {
  Pencil,
  Eraser,
  User,
  IdCard,
  CalendarDays,
  Droplet,
  Phone,
  Mail,
  Eye,
  Mars,
  Venus,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowLeft,
  Loader2,
  Info,
} from "lucide-react";

/* =========================
    Tipos
   ========================= */
type Paciente = {
  id_paciente: number;
  cedula?: string | null;
  nombreCompleto?: string | null;
  nombres?: string | null;
  apellidos?: string | null;
  sexo?: string | null; // "M" | "F" | otro
  fecha_nacimiento?: string | null; // "YYYY-MM-DD"
  tipo_sangre?: string | null;
  celular?: string | null;
  usuario_email?: string | null;
  foto?: string | null;
  activo?: boolean | null;
  contacto_emergencia_nom?: string | null;
  contacto_emergencia_cel?: string | null;
  contacto_emergencia_par?: string | null;
  contacto_emergencia_email?: string | null;
};

type EstadoCitaRaw =
  | "pendiente"
  | "confirmada"
  | "cancelada"
  | "realizada"
  | "reprogramacion"
  | "reprogramación";

type EstadoCanon =
  | "pendiente"
  | "confirmada"
  | "cancelada"
  | "realizada"
  | "reprogramación";

type Cita = {
  id_cita: number;
  fecha: string; // "YYYY-MM-DD"
  hora?: string | null; // "HH:MM" o "HH:MM:SS"
  motivo?: string | null;
  estado: EstadoCitaRaw;
  id_odontologo?: number | null;
  odontologo_nombre?: string | null;
  consultorio?: { id_consultorio: number; numero: string } | null;
  pago?: {
    id_pago_cita: number;
    estado_pago: "pendiente" | "pagado" | "reembolsado";
    monto?: string;
  } | null;
};

type Opcion = { value: string; label: string };

type AntecedentePaciente = {
  antecedente?: { id_antecedente?: number; nombre?: string };
  id_antecedente?: number | { nombre?: string };
  antecedente_nombre?: string;
  id_antecedente_nombre?: string;
  descripcion?: string | null;
  observacion?: string | null;
  relacion?: "propio" | "padres" | "hermanos" | "abuelos" | null;
  relacion_familiar?: "propio" | "padres" | "hermanos" | "abuelos" | null;
};

/* Estados canónicos que mostraremos en UI */
const ESTADOS: readonly EstadoCanon[] = [
  "pendiente",
  "confirmada",
  "cancelada",
  "realizada",
  "reprogramación",
] as const;

const PAGE_SIZE = 10;

/* =========================
   Helpers
   ========================= */
function canonEstado(s: EstadoCitaRaw): EstadoCanon {
  if (s === "reprogramacion" || s === "reprogramación") return "reprogramación";
  if (s === "pendiente") return "pendiente";
  if (s === "confirmada") return "confirmada";
  if (s === "cancelada") return "cancelada";
  return "realizada";
}
function estadoLabel(s: EstadoCitaRaw | EstadoCanon): string {
  const c = canonEstado(s as EstadoCitaRaw);
  switch (c) {
    case "pendiente":
      return "Pendiente";
    case "confirmada":
      return "Confirmada";
    case "cancelada":
      return "Cancelada";
    case "realizada":
      return "Realizada";
    case "reprogramación":
      return "Reprogramación";
  }
}
function estadoParamValue(s: string): string {
  // Para el backend: si viene con tilde, enviamos sin tilde
  return s === "reprogramación" ? "reprogramacion" : s;
}

function sexoLabel(s?: string | null) {
  if (!s) return "—";
  const u = s.toUpperCase();
  if (u === "M") return "Masculino";
  if (u === "F") return "Femenino";
  return s;
}
function sexoIcon(s?: string | null) {
  if (!s) return null;
  const u = s.toUpperCase();
  if (u === "M") return <Mars className="h-4 w-4" />;
  if (u === "F") return <Venus className="h-4 w-4" />;
  return null;
}
function tipoSangreLabel(s?: string | null) {
  return s ? s.toUpperCase() : "—";
}

/** Formatea YYYY-MM-DD en local sin desfase de zona horaria. */
function formatFechaLocalYMD(iso?: string | null) {
  if (!iso) return "—";
  const ymd = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return iso ?? "—";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
  }).format(dt);
}

function formatHora(h?: string | null) {
  if (!h) return "";
  const m = /^(\d{2}:\d{2})(:\d{2})?$/.exec(h);
  return m ? m[1] : h;
}

/* Convierte foto relativa a absoluta si hace falta */
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

/* DRF: helper para traer todas las páginas */
async function fetchAll<T = any>(
  url: string,
  params?: Record<string, any>
): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  let page = 1;

  while (next) {
    const res: AxiosResponse<any> = await api.get(next, {
      params: page === 1 ? params : undefined,
    });
    const data: any = res.data;
    if (Array.isArray(data)) {
      out.push(...(data as T[]));
      next = null;
    } else {
      out.push(...((data?.results ?? []) as T[]));
      next = data?.next ?? null;
    }
    page++;
  }
  return out;
}

/* ====== UI helpers ====== */
function SectionCard({
  title,
  icon,
  children,
  right,
  bare,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
  bare?: boolean;
}) {
  return (
    <div
      className={bare ? "bg-transparent" : "rounded-2xl p-4 shadow-md bg-white"}
    >
      <div
        className={
          bare
            ? "flex items-center justify-between mb-3"
            : "flex items-center justify-between mb-3 px-0"
        }
      >
        <h3 className="text-lg font-semibold flex items-center gap-2">
          {icon} {title}
        </h3>
        {right}
      </div>
      <div className={bare ? "" : ""}>{children}</div>
    </div>
  );
}

function InfoInline({
  label,
  value,
  icon,
}: {
  label: string;
  value?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm leading-6">
      {icon ? <span className="text-gray-500">{icon}</span> : null}
      <span className="text-gray-600">{label}:</span>
      <span className="font-medium text-gray-900">{value ?? "—"}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/* Pill de estado con colores (incluye reprogramación en violeta) */
function estadoPill(estadoRaw: EstadoCitaRaw) {
  const estado = canonEstado(estadoRaw);
  const cls =
    estado === "pendiente"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : estado === "confirmada"
      ? "bg-green-100 text-green-800 border-green-200"
      : estado === "realizada"
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : estado === "reprogramación"
      ? "bg-violet-100 text-violet-800 border-violet-200"
      : "bg-rose-100 text-rose-800 border-rose-200"; // cancelada
  return (
    <span
      className={`inline-block text-xs px-2 py-1 rounded-full border ${cls}`}
      title={`Estado: ${estadoLabel(estado)}`}
    >
      {estadoLabel(estado)}
    </span>
  );
}

/* Pill de estado de pago */
function estadoPagoPill(cita: Cita) {
  // Si la cita no está realizada, no aplica mostrar pago
  if (cita.estado !== "realizada") {
    return <span className="text-gray-400 text-xs">—</span>;
  }

  // Si no hay pago registrado, mostrar como Pendiente
  if (!cita.pago) {
    return (
      <span className="inline-block text-xs px-2 py-1 rounded-full border bg-amber-100 text-amber-800 border-amber-200">
        Pendiente
      </span>
    );
  }

  const estado = cita.pago.estado_pago;
  const cls =
    estado === "pagado"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : estado === "reembolsado"
      ? "bg-red-100 text-red-800 border-red-200"
      : "bg-amber-100 text-amber-800 border-amber-200";

  const label =
    estado === "pagado"
      ? "Pagado"
      : estado === "reembolsado"
      ? "Reembolsado"
      : "Pendiente";

  return (
    <span
      className={`inline-block text-xs px-2 py-1 rounded-full border ${cls}`}
    >
      {label}
    </span>
  );
}

/* Icono simple para “Indicadores” */
function BarChartIcon() {
  return (
    <svg
      className="h-5 w-5 text-gray-900"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      <rect x="3" y="10" width="4" height="10" rx="1" />
      <rect x="10" y="6" width="4" height="14" rx="1" />
      <rect x="17" y="3" width="4" height="17" rx="1" />
    </svg>
  );
}

/* =========================
   Componente
   ========================= */
export default function PacienteDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pacienteId = useMemo(() => Number(id), [id]);

  const [loadingPerfil, setLoadingPerfil] = useState(true);
  const [loadingCitas, setLoadingCitas] = useState(true);
  const [loadingFiltros, setLoadingFiltros] = useState(true);
  const [loadingAnt, setLoadingAnt] = useState(true);

  const [pac, setPac] = useState<Paciente | null>(null);
  const [citas, setCitas] = useState<Cita[]>([]);
  const [antecedentes, setAntecedentes] = useState<AntecedentePaciente[]>([]);
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);
  const [errorCitas, setErrorCitas] = useState<string | null>(null);
  const [errorAnt, setErrorAnt] = useState<string | null>(null);
  
  // Estado para verificar si también es odontólogo
  const [esOdontologo, setEsOdontologo] = useState<boolean | null>(null);
  const [checkingOdontologo, setCheckingOdontologo] = useState(false);
  
  // Estado para verificar si también es administrador
  const [esAdmin, setEsAdmin] = useState<boolean | null>(null);
  const [checkingAdmin, setCheckingAdmin] = useState(false);

  // Catálogos para filtros
  const [odOptions, setOdOptions] = useState<Opcion[]>([]);
  const [espOptions, setEspOptions] = useState<Opcion[]>([]);

  // Filtros
  const [fFecha, setFFecha] = useState("");
  const [fEstado, setFEstado] = useState<string>("");
  const [fOdonto, setFOdonto] = useState<string>("");
  const [fEsp, setFEsp] = useState<string>("");

  // Paginación de historial de citas
  const [page, setPage] = useState(1);

  const limpiarFiltros = useCallback(() => {
    setFFecha("");
    setFEstado("");
    setFOdonto("");
    setFEsp("");
  }, []);

  /* ====== PERFIL: paciente + usuario ====== */
  useEffect(() => {
    if (Number.isNaN(pacienteId)) return;
    const ctrl = new AbortController();

    (async () => {
      try {
        setErrorPerfil(null);
        setLoadingPerfil(true);

        // 1) Paciente base (el serializer ya devuelve todos los campos necesarios)
        const { data: p } = await api.get(`/pacientes/${pacienteId}/`, {
          signal: ctrl.signal as any,
        });

        // 2) Mapea directamente los datos del serializer
        const parsed: Paciente = {
          id_paciente: Number(p.id_paciente ?? p.id ?? pacienteId),
          cedula: p.cedula ?? null,
          nombreCompleto: p.nombreCompleto ?? null,
          nombres: p.nombres ?? null,
          apellidos: p.apellidos ?? null,
          sexo: p.sexo ?? null,
          fecha_nacimiento: p.fecha_nacimiento ?? null,
          tipo_sangre: p.tipo_sangre ?? null,
          celular: e164ToLocal(p.celular ?? null),
          usuario_email: p.usuario_email ?? null,
          foto: absolutize(p.foto ?? null),
          activo:
            typeof p.is_active === "boolean"
              ? p.is_active
              : typeof p.activo === "boolean"
              ? p.activo
              : null,
          contacto_emergencia_nom: p.contacto_emergencia_nom ?? null,
          contacto_emergencia_cel: e164ToLocal(p.contacto_emergencia_cel ?? null),
          contacto_emergencia_par: p.contacto_emergencia_par ? p.contacto_emergencia_par.toLowerCase() : null,
          contacto_emergencia_email: p.contacto_emergencia_email ?? null,
        };

        setPac(parsed);
        
        // Verificar si también es odontólogo
        if (p.id_usuario) {
          setCheckingOdontologo(true);
          try {
            const verifyRes = await api.get(`/usuarios/${p.id_usuario}/verificar-rol-odontologo/`);
            setEsOdontologo(verifyRes.data?.existe === true);
          } catch (err) {
            console.error("Error al verificar rol odontólogo:", err);
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
            console.error("Error al verificar permisos de admin:", err);
            setEsAdmin(null);
          } finally {
            setCheckingAdmin(false);
          }
        }
      } catch (e: any) {
        if (e?.name === "CanceledError") return;
        console.error(e);
        setErrorPerfil("No se pudo cargar el perfil del paciente.");
      } finally {
        setLoadingPerfil(false);
      }
    })();

    return () => ctrl.abort();
  }, [pacienteId]);

  /* ====== ANTECEDENTES (con nuevos campos) ====== */
  useEffect(() => {
    if (Number.isNaN(pacienteId)) return;
    const ctrl = new AbortController();
    let alive = true;

    (async () => {
      try {
        setLoadingAnt(true);
        setErrorAnt(null);

        const res = await api.get(`/paciente-antecedentes/`, {
          params: { id_paciente: pacienteId },
          signal: ctrl.signal as any,
        });

        if (!alive) return;

        const raw: any[] = Array.isArray(res.data?.results)
          ? res.data.results
          : Array.isArray(res.data)
          ? res.data
          : [];

        setAntecedentes(raw);
      } catch (e: any) {
        if (
          e?.name === "CanceledError" ||
          e?.code === "ERR_CANCELED" ||
          e?.message === "canceled"
        ) {
          return;
        }
        console.error("Antecedentes detalle:", e);
        setErrorAnt("No se pudieron cargar los antecedentes.");
      } finally {
        if (alive) setLoadingAnt(false);
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [pacienteId]);

  // Catálogos
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        setLoadingFiltros(true);
        const [odos, esps] = await Promise.all([
          fetchAll<any>("/odontologos/"),
          fetchAll<any>("/especialidades/"),
        ]);

        setOdOptions(
          odos.map((o: any) => {
            const composed =
              `${o.nombres ?? ""} ${o.apellidos ?? ""}`
                .replace(/\s+/g, " ")
                .trim() || undefined;
            return {
              value: String(o.id_odontologo ?? o.id ?? o.pk),
              label: o.nombreCompleto ?? composed ?? "Sin nombre",
            };
          })
        );

        setEspOptions(
          esps.map((e: any) => ({
            value: String(e.id_especialidad ?? e.id ?? e.pk),
            label: String(e.nombre ?? "—"),
          }))
        );
      } catch (e) {
        console.error("Error cargando catálogos:", e);
      } finally {
        setLoadingFiltros(false);
      }
    })();
    return () => ctrl.abort();
  }, []);

  // Citas con filtros (SOLO del paciente actual)
  useEffect(() => {
    if (Number.isNaN(pacienteId)) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        setErrorCitas(null);
        setLoadingCitas(true);

        const params: Record<string, string> = {
          id_paciente: String(pacienteId),
          ordering: "-fecha,hora",
        };
        if (fFecha) params.fecha = fFecha;
        if (fEstado) params.estado = estadoParamValue(fEstado);
        if (fOdonto) params.id_odontologo = fOdonto;
        if (fEsp) params.id_especialidad = fEsp;

        const { data } = await api.get("/citas/", {
          params,
          signal: ctrl.signal as any,
        });

        const items: Cita[] = Array.isArray(data) ? data : data?.results ?? [];

        // Orden: fecha desc, hora asc
        const ordenadas: Cita[] = items.slice().sort((a: Cita, b: Cita) => {
          if (a.fecha !== b.fecha) return b.fecha.localeCompare(a.fecha);
          return (a.hora ?? "").localeCompare(b.hora ?? "");
        });

        setCitas(ordenadas);
      } catch (e: any) {
        if (e?.name === "CanceledError") return;
        console.error(e);
        setErrorCitas("No se pudo cargar el historial de citas.");
      } finally {
        setLoadingCitas(false);
      }
    })();
    return () => ctrl.abort();
  }, [pacienteId, fFecha, fEstado, fOdonto, fEsp]);

  // Reset de página cuando cambian filtros o el total de citas
  useEffect(() => {
    setPage(1);
  }, [fFecha, fEstado, fOdonto, fEsp, citas.length]);

  if (Number.isNaN(pacienteId)) {
    return (
      <div className="px-0">
        <p className="text-red-600">ID de paciente inválido.</p>
        <button
          onClick={() => navigate("/admin/pacientes")}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-1.5 text-sm shadow hover:bg-black/80"
        >
          Volver
        </button>
      </div>
    );
  }

  /* KPIs */
  const kpis = useMemo(() => {
    const total = citas.length;
    const porEstado = ESTADOS.reduce<Record<EstadoCanon, number>>((acc, s) => {
      acc[s] = citas.filter((c) => canonEstado(c.estado) === s).length;
      return acc;
    }, {} as any);
    return { total, porEstado };
  }, [citas]);

  /* ====== Derivados de antecedentes ====== */
  function antNombre(a: AntecedentePaciente) {
    return (
      a.antecedente_nombre ||
      a.antecedente?.nombre ||
      (typeof a.id_antecedente === "object"
        ? a.id_antecedente?.nombre
        : undefined) ||
      a.id_antecedente_nombre ||
      "—"
    );
  }

  function antRel(a: AntecedentePaciente) {
    return (a.relacion_familiar ??
      a.relacion ??
      null) as AntecedentePaciente["relacion"];
  }
  const antPropios = antecedentes.filter(
    (a) => (antRel(a) ?? "propio") === "propio"
  );
  const antFamilia = antecedentes.filter((a) => {
    const r = antRel(a);
    return r && r !== "propio";
  });
  
  // Datos del paciente: mostrar solo los propios o "—"
  const pacienteCelular = pac?.celular?.trim() || null;
  const pacienteEmail = pac?.usuario_email?.trim() || null;
  
  // Si el email es del sistema, mostrar "—"
  const esEmailSistema = pacienteEmail?.includes("@oralflow.system");
  const displayCorreoPaciente = (pacienteEmail && !esEmailSistema) ? pacienteEmail : null;
  
  // Datos del contacto de emergencia
  const contactoNombre = pac?.contacto_emergencia_nom?.trim() || null;
  const contactoCelular = pac?.contacto_emergencia_cel?.trim() || null;
  const contactoEmail = pac?.contacto_emergencia_email?.trim() || null;
  const contactoParentesco = pac?.contacto_emergencia_par || null;
  
  // Calcular si es menor de edad (< 18 años)
  const esMenor = pac?.fecha_nacimiento 
    ? (() => {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(pac.fecha_nacimiento);
        if (!match) return false;
        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        const birth = new Date(year, month, day);
        if (Number.isNaN(birth.getTime())) return false;
        const now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        const monthDiff = now.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
          age--;
        }
        return age < 18;
      })()
    : false;

  // ====== Paginación (derivados para citas) ======
  const total = citas.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, total);

  const currentRows = useMemo(
    () => citas.slice(startIndex, endIndex),
    [citas, startIndex, endIndex]
  );

  const goFirst = () => setPage(1);
  const goPrev = () => setPage((p) => Math.max(1, p - 1));
  const goNext = () => setPage((p) => Math.min(totalPages, p + 1));
  const goLast = () => setPage(totalPages);

  return (
    <div className="px-0 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Detalle del paciente</h1>
          
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
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/admin/pacientes")}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm bg-white text-gray-900 hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>

          <button
            onClick={() => navigate(`/admin/pacientes/${pacienteId}/editar`)}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-1.5 text-sm shadow hover:bg-black/80"
            title="Editar perfil"
          >
            <Pencil className="h-4 w-4" />
            Editar
          </button>
        </div>
      </div>

      {/* Mensajes de error */}
      {(errorPerfil || errorCitas) && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorPerfil ?? errorCitas}
        </div>
      )}

      {/* ===== Franja superior: 2/3 (Datos+Antecedentes) | 1/3 (Indicadores) ===== */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* 2/3: Datos personales + Antecedentes (con card) */}
        <div className="xl:col-span-2">
          <SectionCard
            title="Datos personales"
            icon={<User className="h-5 w-5" />}
          >
            <div className="grid grid-cols-1 gap-6">
              {/* Fila superior: Foto + Datos básicos + Contacto de emergencia */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                {/* Col izq: Foto + Estado */}
                <div className="md:col-span-3 flex flex-col items-center gap-3">
                <div className="w-44 h-44 overflow-hidden rounded-full bg-gray-50 border">
                  {loadingPerfil ? (
                    <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                      Cargando...
                    </div>
                  ) : pac?.foto ? (
                    <img
                      src={pac.foto}
                      alt="Foto"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
                      Sin foto
                    </div>
                  )}
                </div>

                {loadingPerfil ? null : (
                  <div className="flex items-center gap-2 justify-center">
                    <span className={`rounded px-2 py-0.5 text-sm ${pac?.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {pac?.activo ? 'Activo' : 'Inactivo'}
                    </span>
                    {esMenor && (
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-sm text-blue-700">
                        Menor
                      </span>
                    )}
                  </div>
                )}
                </div>

                {/* Col centro: Datos básicos */}
                <div className="md:col-span-5 space-y-1">
                <InfoInline
                  icon={<User className="h-4 w-4" />}
                  label="Nombre"
                  value={loadingPerfil ? "—" : pac?.nombreCompleto ?? "—"}
                />
                <InfoInline
                  icon={sexoIcon(pac?.sexo)}
                  label="Sexo"
                  value={sexoLabel(pac?.sexo)}
                />
                <InfoInline
                  icon={<IdCard className="h-4 w-4" />}
                  label="Cédula"
                  value={pac?.cedula ?? "—"}
                />
                <InfoInline
                  icon={<CalendarDays className="h-4 w-4" />}
                  label="Fecha de nacimiento"
                  value={formatFechaLocalYMD(pac?.fecha_nacimiento)}
                />
                <InfoInline
                  icon={<Droplet className="h-4 w-4" />}
                  label="Tipo de sangre"
                  value={tipoSangreLabel(pac?.tipo_sangre)}
                />
                <InfoInline
                  icon={<Phone className="h-4 w-4" />}
                  label="Celular"
                  value={pacienteCelular ?? "—"}
                />
                <InfoInline
                  icon={<Mail className="h-4 w-4" />}
                  label="Correo"
                  value={displayCorreoPaciente ?? "—"}
                />
                </div>

                {/* Col derecha: Contacto de Emergencia */}
                <div className="md:col-span-4 border-l pl-6">
                  <h4 className="text-sm font-semibold mb-2">Contacto de Emergencia</h4>
                <div className="space-y-1">
                  <InfoInline
                    icon={<User className="h-4 w-4" />}
                    label="Nombre"
                    value={contactoNombre ?? "—"}
                  />
                  <InfoInline
                    icon={<Phone className="h-4 w-4" />}
                    label="Celular"
                    value={contactoCelular ?? "—"}
                  />
                  <InfoInline
                    icon={<Mail className="h-4 w-4" />}
                    label="Correo"
                    value={contactoEmail ?? "—"}
                  />
                  <InfoInline
                    icon={<User className="h-4 w-4" />}
                    label="Parentesco"
                    value={contactoParentesco ? contactoParentesco.charAt(0).toUpperCase() + contactoParentesco.slice(1) : "—"}
                  />
                  </div>
                </div>
              </div>

              {/* Fila inferior: Antecedentes (ancho completo) */}
              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold mb-3">Antecedentes</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Propios */}
                  <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                    Propios
                  </p>
                  {loadingAnt ? (
                    <p className="text-sm text-gray-400">Cargando…</p>
                  ) : errorAnt ? (
                    <p className="text-sm text-red-600">{errorAnt}</p>
                  ) : antPropios.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      Sin antecedentes propios
                    </p>
                  ) : (
                    <ul className="list-disc pl-4 space-y-1 text-sm marker:text-gray-400">
                      {antPropios.map((a, i) => (
                        <li key={`ap-${i}`} className="leading-6">
                          <span className="font-normal text-gray-900">
                            {antNombre(a)}
                          </span>
                          {a.observacion || a.descripcion ? (
                            <span className="text-gray-600">
                              {" "}
                              — {a.observacion ?? a.descripcion}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  </div>

                  {/* Familiares por parentesco */}
                  <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                    Familiares
                  </p>
                  {loadingAnt ? (
                    <p className="text-sm text-gray-400">Cargando…</p>
                  ) : errorAnt ? (
                    <p className="text-sm text-red-600">{errorAnt}</p>
                  ) : antFamilia.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      Sin antecedentes familiares
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {["padres", "hermanos", "abuelos"].map((par) => {
                        const grupo = antFamilia.filter(
                          (a) => (antRel(a) as string) === par
                        );
                        if (grupo.length === 0) return null;
                        return (
                          <div key={par}>
                            <p className="text-xs text-gray-600 mb-0.5 capitalize">
                              {par}
                            </p>
                            <ul className="list-disc pl-4 space-y-1 text-sm marker:text-gray-400">
                              {grupo.map((a, i) => (
                                <li
                                  key={`af-${par}-${i}`}
                                  className="leading-6"
                                >
                                  <span className="font-normal text-gray-900">
                                    {antNombre(a)}
                                  </span>
                                  {a.observacion || a.descripcion ? (
                                    <span className="text-gray-600">
                                      {" "}
                                      — {a.observacion ?? a.descripcion}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* 1/3: Indicadores */}
        <div className="xl:col-span-1">
          <SectionCard title="Indicadores" icon={<BarChartIcon />}>
            <div className="grid grid-cols-1 gap-3">
              <StatCard label="Citas totales" value={kpis.total} />
              <StatCard
                label="Canceladas"
                value={kpis.porEstado["cancelada"] ?? 0}
              />
              <StatCard
                label="Realizadas"
                value={kpis.porEstado["realizada"] ?? 0}
              />
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ===== Historial de citas ===== */}
      <SectionCard
        title="Historial de citas"
        icon={<CalendarDays className="h-5 w-5" />}
        right={
          <button
            onClick={limpiarFiltros}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm bg-white hover:bg-gray-50"
            title="Limpiar filtros"
          >
            <Eraser className="w-4 h-4" />
            Limpiar
          </button>
        }
      >
        {/* filtros */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-sm mb-1">Fecha</label>
            <input
              type="date"
              value={fFecha}
              onChange={(e) => setFFecha(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Estado</label>
            <select
              value={fEstado}
              onChange={(e) => setFEstado(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 capitalize bg-white"
            >
              <option value="">Todos</option>
              {ESTADOS.map((s) => (
                <option key={s} value={s}>
                  {estadoLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1">Odontólogo</label>
            <select
              value={fOdonto}
              onChange={(e) => setFOdonto(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 bg-white"
              disabled={loadingFiltros}
            >
              <option value="">
                {loadingFiltros ? "Cargando..." : "Todos"}
              </option>
              {odOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1">Especialidad</label>
            <select
              value={fEsp}
              onChange={(e) => setFEsp(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 bg-white"
              disabled={loadingFiltros}
            >
              <option value="">
                {loadingFiltros ? "Cargando..." : "Todas"}
              </option>
              {espOptions.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* tabla dentro de la misma card */}
        <div className="rounded-xl bg-white shadow-md overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-100 text-black font-bold">
              <tr className="border-b border-black">
                <th className="py-2 px-3 text-center">Fecha</th>
                <th className="py-2 px-3 text-center">Hora</th>
                <th className="py-2 px-3 text-center">Motivo</th>
                <th className="py-2 px-3 text-center">Odontólogo</th>
                <th className="py-2 px-3 text-center">Consultorio</th>
                <th className="py-2 px-3 text-center">Estado Cita</th>
                <th className="py-2 px-3 text-center">Estado Pago</th>
                <th className="py-2 px-3 text-center">Acción</th>
              </tr>
            </thead>

            <tbody>
              {loadingCitas ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center">
                    Cargando…
                  </td>
                </tr>
              ) : currentRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-gray-500">
                    Sin resultados
                  </td>
                </tr>
              ) : (
                currentRows.map((c) => (
                  <tr
                    key={`${c.id_cita}-${c.fecha}-${c.hora ?? ""}`}
                    className="border-b border-gray-200"
                  >
                    <td className="py-2 px-3 text-center">
                      {formatFechaLocalYMD(c.fecha)}
                    </td>
                    <td className="py-2 px-3 text-center tabular-nums">
                      {formatHora(c.hora) || "—"}
                    </td>
                    <td className="py-2 px-3 text-center">{c.motivo ?? "—"}</td>
                    <td className="py-2 px-3 text-center">
                      {c.odontologo_nombre ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {c.consultorio ? `Cons. ${c.consultorio.numero}` : "—"}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {estadoPill(c.estado)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {estadoPagoPill(c)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center">
                        <Link
                          to={`/admin/citas/${c.id_cita}`}
                          state={{ from: "paciente", selectedDate: c.fecha }}
                          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
                          title="Ver detalles"
                        >
                          <Eye className="size-4" />
                          Ver
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* paginación dentro de la card */}
          {!loadingCitas && total > 0 && (
            <div className="px-4 py-3 border-t bg-gray-100">
              <div className="flex items-center justify-center gap-1">
                <button
                  onClick={goFirst}
                  disabled={safePage === 1}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                  title="Primera página"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={goPrev}
                  disabled={safePage === 1}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                  title="Anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <span className="px-3 text-sm">
                  Página <span className="font-semibold">{safePage}</span> de{" "}
                  <span className="font-semibold">{totalPages}</span>
                </span>

                <button
                  onClick={goNext}
                  disabled={safePage === totalPages}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                  title="Siguiente"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <button
                  onClick={goLast}
                  disabled={safePage === totalPages}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                  title="Última página"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
