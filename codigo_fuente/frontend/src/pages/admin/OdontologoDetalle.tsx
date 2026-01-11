// src/pages/admin/OdontologoDetalle.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../../api/axios";
import { e164ToLocal } from "../../utils/phoneFormat";
import {
  Eye,
  Pencil,
  Eraser,
  User,
  IdCard,
  CalendarDays,
  Droplet,
  Phone,
  Mail,
  GraduationCap,
  Briefcase,
  Clock,
  Mars,
  Venus,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import type { AxiosResponse } from "axios";

/* =========================
    Tipos
   ========================= */
type Odontologo = {
  id_odontologo: number;
  cedula: string;
  nombreCompleto: string;
  sexo: string;
  is_active: boolean; // Estado del Usuario
  odontologo_activo: boolean; // Estado del Odontólogo
  foto?: string | null;

  fecha_nacimiento?: string | null; // "YYYY-MM-DD"
  tipo_sangre?: string | null;
  celular?: string | null;
  usuario_email?: string | null;

  especialidades?: string[];
  especialidades_detalle?: {
    nombre: string | null;
    universidad?: string | null;
    estado?: boolean;
  }[];

  consultorio_defecto?: { id_consultorio: number; numero: string } | null;
  horarios?: {
    dia_semana: number; // 0=Lun ... 6=Dom
    hora_inicio: string;
    hora_fin: string;
    vigente: boolean;
  }[];
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
  id_odontologo: number;
  id_paciente: number;
  fecha: string; // esperado "YYYY-MM-DD"
  hora_inicio?: string | null;
  hora_fin?: string | null;
  estado: EstadoCitaRaw;
  motivo?: string | null;
  paciente_nombre: string;
  paciente_cedula: string;
  odontologo_nombre?: string;
  consultorio?: { id_consultorio: number; numero: string } | null;
  pago?: {
    id_pago_cita: number;
    estado_pago: "pendiente" | "pagado" | "reembolsado";
    monto?: string;
  } | null;
};

const ESTADOS: readonly EstadoCanon[] = [
  "pendiente",
  "confirmada",
  "cancelada",
  "realizada",
  "reprogramación",
] as const;

const PAGE_SIZE = 15;

const DIAS: Record<number, string> = {
  0: "Lun",
  1: "Mar",
  2: "Mié",
  3: "Jue",
  4: "Vie",
  5: "Sáb",
  6: "Dom",
};
const ORDEN_SEMANA: number[] = [0, 1, 2, 3, 4, 5, 6];

function useDebounced<T>(value: T, delay = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

/* Helpers de presentación */
function sexoLabel(s?: string | null) {
  if (!s) return "—";
  if (s.toUpperCase() === "M") return "Masculino";
  if (s.toUpperCase() === "F") return "Femenino";
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

/** Formatea fecha Y-M-D como fecha local SIN desfase de huso.
 * Acepta "YYYY-MM-DD" o ISO con tiempo; usa los primeros 10 chars.
 */
function formatFechaLocalYMD(iso?: string | null) {
  if (!iso) return "—";
  const ymd = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return iso; // si viene en otro formato, muéstralo tal cual
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day); // local time, sin TZ shift
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
  }).format(d);
}

function horaRango(a?: string | null, b?: string | null) {
  if (!a && !b) return "";
  if (a && b) return `${a} - ${b}`;
  return a ?? b ?? "";
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

/* Estado: helpers canónicos + etiquetas + param */
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
  // Si el usuario selecciona “reprogramación”, enviamos “reprogramacion” al backend
  return s === "reprogramación" ? "reprogramacion" : s;
}

/* Paginador helper para KPIs */
type Paginated<T> = { results?: T[]; next?: string | null };

async function fetchAllCitas(params: Record<string, any>): Promise<Cita[]> {
  const out: Cita[] = [];
  let next: string | null = "/citas/";
  let page = 1;

  while (next) {
    const res: AxiosResponse<Cita[] | Paginated<Cita>> = await api.get(next, {
      params: page === 1 ? params : undefined,
    });
    const data = res.data;

    if (Array.isArray(data)) {
      out.push(...data);
      next = null;
    } else {
      out.push(...(data.results ?? []));
      next = data.next ?? null;
    }
    page++;
  }

  return out;
}

/* Pill de estado (incluye reprogramación en violeta) */
function estadoPill(estadoRaw: EstadoCitaRaw) {
  const estado = canonEstado(estadoRaw);
  const cls =
    estado === "pendiente"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : estado === "confirmada"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
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

/* Acciones por cita */
function AccionesCita({ id, fecha }: { id: number; fecha?: string }) {
  return (
    <div className="flex items-center justify-center">
      <Link
        to={`/admin/citas/${id}`}
        state={{ from: "odontologo", selectedDate: fecha }}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Ver detalles"
      >
        <Eye className="size-4" />
        Ver
      </Link>
    </div>
  );
}

/* ========= UI helpers ========= */
function SectionCard({
  title,
  icon,
  children,
  right,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-4 shadow-md bg-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          {icon} {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Fila inline sin espacio entre ":" y el valor */
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

/* =========================
  Componente
   ========================= */
export default function OdontologoDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const odontologoId = useMemo(() => Number(id), [id]);

  const [loadingPerfil, setLoadingPerfil] = useState(true);
  const [loadingCitas, setLoadingCitas] = useState(true);
  const [odo, setOdo] = useState<Odontologo | null>(null);
  const [, setErrorPerfil] = useState<string | null>(null);
  const [, setErrorCitas] = useState<string | null>(null);
  
  // Estado para verificar si tiene datos de paciente
  const [tieneDatosPaciente, setTieneDatosPaciente] = useState<boolean | null>(null);
  const [checkingPaciente, setCheckingPaciente] = useState(false);

  // KPIs
  const [kpiTotal, setKpiTotal] = useState(0);
  const [kpiCanceladas, setKpiCanceladas] = useState(0);
  const [kpiRealizadas, setKpiRealizadas] = useState(0);

  // Filtros historial
  const [fNombre, setFNombre] = useState("");
  const [fCedula, setFCedula] = useState("");
  const [fFecha, setFFecha] = useState("");
  const [fEstado, setFEstado] = useState<string>("");

  const dNombre = useDebounced(fNombre);
  const dCedula = useDebounced(fCedula);

  // Paginación historial de citas
  const [page, setPage] = useState(1);

  // Cargar perfil
  useEffect(() => {
    if (Number.isNaN(odontologoId)) return;
    const ctrl = new AbortController();

    async function run() {
      try {
        setErrorPerfil(null);
        setLoadingPerfil(true);
        const { data } = await api.get(`/odontologos/${odontologoId}/`, {
          signal: ctrl.signal as any,
        });
        const nombreCompleto =
          data.nombreCompleto ??
          `${data.nombres ?? ""} ${data.apellidos ?? ""}`.trim();

        const parsed: Odontologo = {
          ...data,
          nombreCompleto,
          foto: absolutize(data.foto),
          odontologo_activo: data.odontologo_activo !== undefined ? data.odontologo_activo : data.activo,
          is_active: data.is_active,
          // Convertir celular de E.164 a formato local para mostrar
          celular: data.celular ? e164ToLocal(data.celular) : data.celular,
        };

        setOdo(parsed);
        
        // Verificar si tiene datos de paciente
        if (data.id_usuario) {
          setCheckingPaciente(true);
          try {
            const verifyRes = await api.get(`/usuarios/${data.id_usuario}/verificar-rol-paciente/`);
            setTieneDatosPaciente(verifyRes.data?.existe === true);
          } catch (err) {
            console.error("Error al verificar rol paciente:", err);
            setTieneDatosPaciente(null);
          } finally {
            setCheckingPaciente(false);
          }
        }
      } catch (e: any) {
        if (e?.name === "CanceledError") return;
        console.error(e);
        setErrorPerfil("No se pudo cargar el perfil del odontólogo.");
      } finally {
        setLoadingPerfil(false);
      }
    }
    run();
    return () => ctrl.abort();
  }, [odontologoId]);

  // KPIs
  useEffect(() => {
    if (Number.isNaN(odontologoId)) return;
    (async () => {
      try {
        const all = await fetchAllCitas({
          id_odontologo: odontologoId,
          page_size: 200,
        });
        setKpiTotal(all.length);
        setKpiCanceladas(
          all.filter((c) => canonEstado(c.estado) === "cancelada").length
        );
        setKpiRealizadas(
          all.filter((c) => canonEstado(c.estado) === "realizada").length
        );
      } catch (e) {
        console.error("KPIs citas:", e);
        setKpiTotal(0);
        setKpiCanceladas(0);
        setKpiRealizadas(0);
      }
    })();
  }, [odontologoId]);

  // Citas con filtros (solo del odontólogo actual)
  const [citas, setCitas] = useState<Cita[]>([]);
  useEffect(() => {
    if (Number.isNaN(odontologoId)) return;
    const ctrl = new AbortController();

    async function run() {
      try {
        setErrorCitas(null);
        setLoadingCitas(true);

        const params: Record<string, string> = {
          id_odontologo: String(odontologoId),
          ordering: "-fecha,hora_inicio",
        };
        if (dNombre.trim()) params.paciente_nombre = dNombre.trim();
        if (dCedula.trim()) params.cedula = dCedula.trim();
        if (fFecha) params.fecha = fFecha; // esperado Y-M-D en el backend
        if (fEstado) params.estado = estadoParamValue(fEstado);

        const { data } = await api.get("/citas/", {
          params,
          signal: ctrl.signal as any,
        });

        const list: Cita[] = (Array.isArray(data) ? data : data?.results) ?? [];
        const soloEsteOdontologo = list.filter(
          (c) => Number(c.id_odontologo) === odontologoId
        );

        const ordenadas = soloEsteOdontologo.slice().sort((a, b) => {
          if (a.fecha !== b.fecha) return b.fecha.localeCompare(a.fecha);
          return (a.hora_inicio ?? "").localeCompare(b.hora_inicio ?? "");
        });

        setCitas(ordenadas);
      } catch (e: any) {
        if (e?.name === "CanceledError") return;
        console.error(e);
        setErrorCitas("No se pudo cargar el historial de citas.");
      } finally {
        setLoadingCitas(false);
      }
    }
    run();
    return () => ctrl.abort();
  }, [odontologoId, dNombre, dCedula, fFecha, fEstado]);

  // Reset de página al cambiar filtros/lista
  useEffect(() => {
    setPage(1);
  }, [dNombre, dCedula, fFecha, fEstado, citas.length]);

  const limpiarFiltros = useCallback(() => {
    setFNombre("");
    setFCedula("");
    setFFecha("");
    setFEstado("");
  }, []);

  if (Number.isNaN(odontologoId)) {
    return (
      <div className="p-6">
        <p className="text-red-600">ID de odontólogo inválido.</p>
        <button
          onClick={() => navigate("/admin/odontologos")}
          className="mt-4 rounded-lg bg-gray-800 text-white px-3 py-1.5 text-sm shadow hover:bg-black/80"
        >
          Volver
        </button>
      </div>
    );
  }

  const mapDia = (n: number) => DIAS[n] ?? `Día ${n}`;

  // Horario semanal completo
  const weekSchedule = (odo?.horarios ?? [])
    .filter((h) => h.vigente !== false)
    .reduce<Record<number, { inicio: string; fin: string }[]>>((acc, h) => {
      const arr = acc[h.dia_semana] ?? [];
      arr.push({ inicio: h.hora_inicio, fin: h.hora_fin });
      acc[h.dia_semana] = arr;
      return acc;
    }, {});

  const renderSlots = (day: number) => {
    const slots = weekSchedule[day];
    if (!slots || slots.length === 0)
      return <span className="text-gray-500">No atiende</span>;
    return (
      <span className="tabular-nums">
        {slots.map((s, i) => (
          <span key={i}>
            {s.inicio} - {s.fin}
            {i < slots.length - 1 ? ", " : ""}
          </span>
        ))}
      </span>
    );
  };

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Detalle del odontólogo
          </h1>
          {/* Indicador de datos de paciente */}
          {checkingPaciente && (
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Verificando datos de paciente...
            </p>
          )}
          {tieneDatosPaciente === true && (
            <p className="text-xs text-green-600 mt-1">
              ✓ Ya tiene datos de paciente registrados
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Volver a la IZQUIERDA: blanco con letras negras */}
          <button
            onClick={() => navigate("/admin/odontologos")}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm bg-white text-gray-900 hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>

          {/* Editar */}
          <button
            onClick={() =>
              navigate(`/admin/odontologos/${odontologoId}/editar`)
            }
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-1.5 text-sm shadow hover:bg-black/80"
            title="Editar perfil"
          >
            <Pencil className="h-4 w-4" />
            Editar
          </button>
        </div>
      </div>

      {/* ===== Franja: Datos personales + Formación + Horario ===== */}
      <div className="rounded-2xl p-4 shadow-md bg-white">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
          {/* Col 1: Título + Foto (circular) + Estado */}
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <User className="h-5 w-5" /> Datos personales
            </h3>

            <div className="flex flex-col items-center gap-3">
              <div className="w-44 h-44 overflow-hidden rounded-full bg-gray-50 border">
                {loadingPerfil ? (
                  <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                    Cargando...
                  </div>
                ) : odo?.foto ? (
                  <img
                    src={odo.foto}
                    alt="Foto"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
                    Sin foto
                  </div>
                )}
              </div>

              {/* Estado del Odontólogo */}
              {loadingPerfil ? null : (
                <div className="flex flex-col items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-sm ${
                    odo?.odontologo_activo 
                      ? "bg-green-100 text-green-700" 
                      : "bg-red-100 text-red-700"
                  }`}>
                    {odo?.odontologo_activo ? "Odontólogo Activo" : "Odontólogo Inactivo"}
                  </span>
                  
                  {/* Mensaje especial si está inactivo como odontólogo pero tiene datos de paciente Y el usuario general está activo */}
                  {odo?.is_active && !odo?.odontologo_activo && tieneDatosPaciente && (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 text-center">
                      Únicamente paciente
                    </span>
                  )}
                  
                  {/* Estado del Usuario general (solo mostrar si está inactivo) */}
                  {!odo?.is_active && (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 text-center">
                      Usuario desactivado
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Col 2: A la derecha de la foto */}
          <div className="space-y-1 pt-9 xl:pt-9">
            {/* Nombre y Sexo ARRIBA */}
            <InfoInline
              icon={<User className="h-4 w-4" />}
              label="Nombre"
              value={loadingPerfil ? "—" : odo?.nombreCompleto ?? "—"}
            />
            <InfoInline
              icon={sexoIcon(odo?.sexo)}
              label="Sexo"
              value={sexoLabel(odo?.sexo)}
            />

            {/* Resto de campos */}
            <InfoInline
              icon={<IdCard className="h-4 w-4" />}
              label="Cédula"
              value={odo?.cedula}
            />
            <InfoInline
              icon={<CalendarDays className="h-4 w-4" />}
              label="Fecha de nacimiento"
              value={formatFechaLocalYMD(odo?.fecha_nacimiento)}
            />
            <InfoInline
              icon={<Droplet className="h-4 w-4" />}
              label="Tipo de sangre"
              value={tipoSangreLabel(odo?.tipo_sangre)}
            />
            <InfoInline
              icon={<Phone className="h-4 w-4" />}
              label="Celular"
              value={odo?.celular}
            />
            <InfoInline
              icon={<Mail className="h-4 w-4" />}
              label="Correo"
              value={odo?.usuario_email}
            />
            <InfoInline
              icon={<Briefcase className="h-4 w-4" />}
              label="Consultorio"
              value={
                odo?.consultorio_defecto
                  ? `#${odo.consultorio_defecto.numero}`
                  : "—"
              }
            />
          </div>

          {/* Col 3: Formación profesional */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <GraduationCap className="h-5 w-5" /> Formación profesional
            </h3>
            {(() => {
              const list = (odo?.especialidades_detalle ?? [])
                .slice()
                .sort((a, b) => {
                  const aActiva = a.estado !== false;
                  const bActiva = b.estado !== false;
                  if (aActiva === bActiva)
                    return (a.nombre ?? "").localeCompare(b.nombre ?? "");
                  return aActiva ? -1 : 1;
                });

              if (list.length) {
                return (
                  <div className="space-y-2">
                    {list.map((esp, i) => {
                      const activa = esp.estado !== false;
                      return (
                        <div
                          key={i}
                          className="flex items-start justify-between rounded-lg border p-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {esp.nombre || "—"}
                            </p>
                            <p className="text-xs text-gray-600">
                              {esp.universidad || "—"}
                            </p>
                          </div>
                          <span
                            className={[
                              "ml-3 shrink-0 rounded px-2 py-0.5 text-xs",
                              activa
                                ? "bg-green-100 text-green-700"
                                : "bg-gray-200 text-gray-700",
                            ].join(" ")}
                          >
                            {activa ? "Activa" : "Inactiva"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              if (odo?.especialidades?.length) {
                return (
                  <div className="flex flex-wrap gap-2">
                    {odo.especialidades.map((e, i) => (
                      <span
                        key={i}
                        className="rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-800"
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                );
              }

              return <p className="text-sm text-gray-600">—</p>;
            })()}
          </div>

          {/* Col 4: Horario (siempre 7 días) */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5" /> Horario
            </h3>
            <ul className="space-y-1 text-sm">
              {ORDEN_SEMANA.map((d) => (
                <li
                  key={d}
                  className="flex items-center justify-between rounded border px-3 py-2"
                >
                  <span className="font-medium">{mapDia(d)}</span>
                  {renderSlots(d)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ===== Indicadores ===== */}
      <SectionCard title="Indicadores" icon={<BarChartIcon />}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Citas totales" value={kpiTotal} />
          <StatCard label="Canceladas" value={kpiCanceladas} />
          <StatCard label="Realizadas" value={kpiRealizadas} />
        </div>
      </SectionCard>

      {/* ===== Historial de citas: filtros ===== */}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-sm mb-1">Nombre de paciente</label>
            <input
              value={fNombre}
              onChange={(e) => setFNombre(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 bg-white"
              placeholder="Ej: Juan Pérez"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Cédula</label>
            <input
              value={fCedula}
              onChange={(e) => setFCedula(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 bg-white"
              placeholder="Ej: 0102030405"
              inputMode="numeric"
            />
          </div>
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
              <option value="">Estados</option>
              {ESTADOS.map((s) => (
                <option key={s} value={s}>
                  {estadoLabel(s)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ===== Tabla de citas (look Agenda) ===== */}
        <div className="rounded-xl bg-white shadow-md overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 text-black font-bold border-b border-black">
              <tr>
                <th className="px-4 py-3 text-center">Fecha</th>
                <th className="px-4 py-3 text-center">Hora</th>
                <th className="px-4 py-3 text-center">Paciente</th>
                <th className="px-4 py-3 text-center">Cédula</th>
                <th className="px-4 py-3 text-center">Consultorio</th>
                <th className="px-4 py-3 text-center">Estado Cita</th>
                <th className="px-4 py-3 text-center">Estado Pago</th>
                <th className="px-4 py-3 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loadingCitas ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-6 text-center text-gray-500"
                  >
                    Cargando…
                  </td>
                </tr>
              ) : currentRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-6 text-center text-gray-500"
                  >
                    Sin resultados
                  </td>
                </tr>
              ) : (
                currentRows.map((c) => (
                  <tr key={CitaKey(c)} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-center">
                      {formatFechaLocalYMD(c.fecha)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-center">
                      {horaRango(c.hora_inicio, c.hora_fin) || "—"}
                    </td>
                    <td className="px-4 py-3 text-center">{c.paciente_nombre}</td>
                    <td className="px-4 py-3 text-center">{c.paciente_cedula}</td>
                    <td className="px-4 py-3 text-center">
                      {c.consultorio ? `Cons. ${c.consultorio.numero}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">{estadoPill(c.estado)}</td>
                    <td className="px-4 py-3 text-center">{estadoPagoPill(c)}</td>
                    <td className="px-4 py-3 text-center">
                      <AccionesCita id={c.id_cita} fecha={c.fecha} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Footer de paginación estilo Odontologos */}
          {!loadingCitas && total > 0 && (
            <div className="px-4 py-3 border-t bg-gray-100 flex items-center justify-between">
              {/* Izquierda: total */}
              <div className="text-sm text-gray-700">
                Citas totales: <span className="font-semibold">{total}</span>
              </div>

              {/* Centro: controles */}
              <div className="flex items-center gap-1">
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

              {/* Derecha: conteo en la página */}
              <div className="text-sm text-gray-700 font-medium">
                Mostrando {currentRows.length} de {PAGE_SIZE}
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

/* Icono simple para Indicadores */
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

/* clave estable si no todas las APIs garantizan unicidad estricta por id */
function CitaKey(c: Cita) {
  return `${c.id_cita}-${c.fecha}-${c.hora_inicio ?? ""}-${c.hora_fin ?? ""}`;
}
