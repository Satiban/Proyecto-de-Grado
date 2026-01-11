// src/pages/odontologo/AgendarCita.tsx
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type MutableRefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import type { AxiosResponse } from "axios";
import { api } from "../../api/axios";
import {
  Search,
  Clock,
  CalendarDays,
  ChevronDown,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

/* ==================== Tipos ==================== */

type PacienteFlat = {
  id_paciente: number;
  id_usuario: number;
  cedula: string;
  primer_nombre?: string | null;
  segundo_nombre?: string | null;
  primer_apellido?: string | null;
  segundo_apellido?: string | null;
};

type HorarioVigente = {
  dia_semana: number; // 0=Lunes..6=Domingo (canónico)
  hora_inicio: string; // "HH:MM"
  hora_fin: string; // "HH:MM"
  vigente?: boolean;
};

type ConsultorioOpt = {
  id: number;
  nombre: string;
  numero?: string;
  estado: boolean;
};

type DisponibilidadResp = {
  fecha: string;
  id_odontologo: number;
  id_consultorio: number | null;
  disponibles: string[]; // "HH:MM"
};

type BloqueoInfo = { motivo?: string | null; scope: "global" | "odo" };

type OdoDetalle = {
  id_odontologo: number;
  nombreCompleto?: string;
  consultorio_default?: {
    id_consultorio: number;
    numero?: string;
    nombre?: string;
  } | null;
  consultorio_defecto?: {
    id_consultorio: number;
    numero?: string;
    nombre?: string;
  } | null;
  id_consultorio_default?: number | null;
  id_consultorio_defecto?: number | null;
};

type Estado = "pendiente" | "confirmada" | "cancelada" | "realizada";

/* ==================== Constantes / helpers ==================== */
const LUNCH_FROM = 13; // 13:00
const LUNCH_TO = 15; // 15:00 (exclusivo)
const PAGE_SIZE = 7;
const isActiveFlag = (v: any) =>
  !(v === false || v === 0 || v === "0" || v === "false");

const pad2 = (n: number) => String(n).padStart(2, "0");
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromISO = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};
const timeToMinutes = (t: string) => {
  const [H, M] = t.split(":").map(Number);
  return (H ?? 0) * 60 + (M ?? 0);
};
const minutesToHHMM = (m: number) =>
  `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
/** 0=Lunes..6=Domingo para una fecha ISO */
const dowMonday0 = (iso: string) => (fromISO(iso).getDay() + 6) % 7;

/** grid del calendario (lunes-inicio) */
function buildGrid(year: number, month0: number) {
  const first = new Date(year, month0, 1);
  const start = new Date(first);
  const dow = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - dow);
  const rows: Date[][] = [];
  let cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    rows.push(row);
  }
  return rows;
}

/** ¿El MM-DD de `dayISO` cae dentro del rango anual [startISO..endISO]? (ignora año) */
function occursOnAnnualRange(dayISO: string, startISO: string, endISO: string) {
  const md = dayISO.slice(5),
    ms = startISO.slice(5),
    me = endISO.slice(5);
  return ms <= me ? md >= ms && md <= me : md >= ms || md <= me;
}

/* ---------- DRF helper para traer todas las páginas ---------- */
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
    const data = res.data;
    if (Array.isArray(data)) {
      out.push(...(data as T[]));
      next = null; // sin paginación
    } else {
      out.push(...((data?.results ?? []) as T[]));
      next = data?.next ?? null;
    }
    page++;
  }
  return out;
}

/* ====== Hook: click-away para el popover ====== */
function useClickAway<T extends HTMLElement>(cb: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      const target = e.target as Node | null;
      if (target && !ref.current.contains(target)) cb();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [cb]);
  return ref as MutableRefObject<T | null>;
}

/* ====== Calendario Popover (reutilizado) ====== */
function DatePopover({
  date,
  onChange,
  disabledDate,
  getDateMeta,
  dayBadge, // NUEVO: contador de citas o "bloqueado"
  disabledAll,
  viewYM,
  onViewYMChange,
}: {
  date: string; // YYYY-MM-DD
  onChange: (iso: string) => void;
  disabledDate?: (iso: string) => boolean;
  getDateMeta?: (
    iso: string
  ) => { blocked?: boolean; motivo?: string | null } | undefined;
  dayBadge?: (iso: string) => "bloqueado" | number | null;
  disabledAll?: boolean;
  viewYM: { y: number; m0: number };
  onViewYMChange: (next: { y: number; m0: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromISO(date);
  const [cursor, setCursor] = useState<Date>(new Date(viewYM.y, viewYM.m0, 1));
  useEffect(() => {
    setCursor(new Date(viewYM.y, viewYM.m0, 1));
  }, [viewYM.y, viewYM.m0]);

  const monthNames = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Sept.",
    "Oct.",
    "Nov.",
    "Dic.",
  ];
  const dowShort = ["L", "M", "X", "J", "V", "S", "D"];
  const ref = useClickAway<HTMLDivElement>(() => setOpen(false));

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 21 }, (_, i) => currentYear - 10 + i);

  const grid = buildGrid(cursor.getFullYear(), cursor.getMonth());
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  function pick(d: Date) {
    const iso = toISODate(d);
    if (disabledDate?.(iso)) return;
    onChange(iso);
    setOpen(false);
  }

  function moveMonth(delta: number) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    setCursor(next);
    onViewYMChange({ y: next.getFullYear(), m0: next.getMonth() });
  }

  function setMonth(m0: number) {
    const next = new Date(cursor.getFullYear(), m0, 1);
    setCursor(next);
    onViewYMChange({ y: next.getFullYear(), m0: next.getMonth() });
  }

  function setYear(y: number) {
    const next = new Date(y, cursor.getMonth(), 1);
    setCursor(next);
    onViewYMChange({ y: next.getFullYear(), m0: next.getMonth() });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
        onClick={() => !disabledAll && setOpen((v) => !v)}
        aria-haspopup="dialog"
        disabled={!!disabledAll}
        title={disabledAll ? "Selecciona un odontólogo" : "Elegir fecha"}
      >
        <CalendarDays className="w-4 h-4" />
        <span className="font-medium">{date}</span>
        <ChevronDown className="w-4 h-4" />
      </button>

      {open && !disabledAll && (
        <div className="absolute z-20 mt-2 w-80 rounded-xl border bg-white shadow-lg p-3">
          <div className="flex items-center justify-between mb-2 gap-2">
            <button
              onClick={() => moveMonth(-1)}
              className="px-2 py-1 rounded-lg hover:bg-gray-100"
              aria-label="Mes anterior"
            >
              ◀
            </button>

            <div className="flex items-center gap-2">
              <select
                className="border rounded-lg px-2 py-1"
                value={cursor.getMonth()}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {monthNames.map((n, i) => (
                  <option key={i} value={i}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                className="border rounded-lg px-2 py-1"
                value={cursor.getFullYear()}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => moveMonth(1)}
              className="px-2 py-1 rounded-lg hover:bg-gray-100"
              aria-label="Mes siguiente"
            >
              ▶
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-1">
            {dowShort.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.flat().map((d, i) => {
              const iso = toISODate(d);
              const muted = d.getMonth() !== cursor.getMonth();
              const disabled = disabledDate?.(iso) ?? false;
              const sel = isSameDay(d, selected);
              const meta = getDateMeta?.(iso);
              const blocked = !!meta?.blocked;
              const tip = blocked
                ? meta?.motivo
                  ? `Bloqueado: ${meta.motivo}`
                  : `Bloqueado`
                : iso;

              const badge = dayBadge?.(iso) ?? null;

              return (
                <button
                  key={i}
                  onClick={() => pick(d)}
                  disabled={disabled}
                  title={tip}
                  className={[
                    "relative aspect-square rounded-lg text-sm border",
                    muted ? "text-gray-400" : "text-gray-800",
                    sel ? "bg-blue-600 text-white border-blue-600" : "bg-white",
                    disabled
                      ? "opacity-40 cursor-not-allowed"
                      : "hover:bg-gray-50",
                  ].join(" ")}
                >
                  {d.getDate()}

                  {/* Badge de conteo */}
                  {typeof badge === "number" && badge > 0 && (
                    <span className="absolute top-1 right-1 text-[10px] px-1 rounded bg-gray-800 text-white">
                      {badge}
                    </span>
                  )}

                  {/* Indicador de bloqueo */}
                  {(badge === "bloqueado" || blocked) && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 block w-1.5 h-1.5 rounded-full bg-red-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ==================== Página ==================== */
export default function AgendarCitaOdontologo() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const [page, setPage] = useState(1);

  /* ------- Estado principal ------- */
  // Pacientes
  const [pacientes, setPacientes] = useState<PacienteFlat[]>([]);
  const [pacLoading, setPacLoading] = useState(true);
  const [pacErr, setPacErr] = useState("");
  const [fNombre, setFNombre] = useState("");
  const [fCedula, setFCedula] = useState("");
  const [pacSel, setPacSel] = useState<{
    id: number;
    cedula: string;
    nombre: string;
  } | null>(null);

  // Catálogos
  const [consultorios, setConsultorios] = useState<ConsultorioOpt[]>([]);

  // Odontólogo
  const [odoId, setOdoId] = useState<number | null>(null);
  const [odoDet, setOdoDet] = useState<OdoDetalle | null>(null);

  // Horarios y bloqueos
  const [horarios, setHorarios] = useState<HorarioVigente[]>([]);
  const [bloqueosGlobalMap, setBloqueosGlobalMap] = useState<
    Record<string, BloqueoInfo>
  >({});
  const [bloqueosOdoMap, setBloqueosOdoMap] = useState<
    Record<string, BloqueoInfo>
  >({});
  const bloqueosMap = useMemo(
    () => ({ ...bloqueosGlobalMap, ...bloqueosOdoMap }),
    [bloqueosGlobalMap, bloqueosOdoMap]
  );

  // Resumen mensual (para badges de conteo en el calendario)
  const [resumenMes, setResumenMes] = useState<
    Record<string, { total_citas: number; bloqueado?: boolean }>
  >({});

  // Fecha (controlada) + calendario
  const [fecha, setFecha] = useState<string>(() => toISODate(new Date()));
  const [viewYM, setViewYM] = useState<{ y: number; m0: number }>(() => {
    const d = new Date();
    return { y: d.getFullYear(), m0: d.getMonth() };
  });

  // Horas disponibles (con consultorio decidido)
  const [horaOptions, setHoraOptions] = useState<
    Array<{
      t: string;
      consultorioId: number;
      consultorioLabel: string;
      isDefault: boolean;
    }>
  >([]);
  const [horaSel, setHoraSel] = useState<string>("");
  const [horaSelConsultorio, setHoraSelConsultorio] = useState<number | null>(
    null
  );

  const [loadingHoras, setLoadingHoras] = useState(false);
  const [horariosLoading] = useState(false);
  const [bloqsLoading, setBloqsLoading] = useState(false);

  // Form
  const [motivo, setMotivo] = useState<string>("");
  const [estado, setEstado] = useState<Estado>("pendiente");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  /* ------- Obtener odóntologo de la sesión (me) ------- */
  useEffect(() => {
    (async () => {
      try {
        // 1) Si el AuthContext ya trae el id_odontologo, úsalo
        const fromCtx =
          (usuario as any)?.odontologo?.id_odontologo ??
          (usuario as any)?.id_odontologo ??
          null;
        if (fromCtx) {
          setOdoId(Number(fromCtx));
          return;
        }
        // 2) Si no, pedir /usuarios/me/
        const { data: me } = await api.get("/usuarios/me/");
        const oid = me?.odontologo?.id_odontologo ?? me?.id_odontologo ?? null;
        setOdoId(oid ? Number(oid) : null);
      } catch {
        setOdoId(null);
      }
    })();
  }, [usuario]);

  /* ------- Cargar pacientes (todos) ------- */
  const loadPacientes = useCallback(async () => {
    setPacLoading(true);
    setPacErr("");
    try {
      const base = await fetchAll<any>("/pacientes/");
      const planos: PacienteFlat[] = (
        await Promise.all(
          base.map(async (p: any) => {
            const id_paciente = String(p.id_paciente ?? p.id ?? p.pk ?? "");
            const idUsuario =
              p.id_usuario ??
              p.usuario?.id_usuario ??
              p.usuario_id ??
              p.usuario;

            let uDet: any = null;
            const missingKeyFields =
              !p.cedula ||
              !(
                p.nombres ||
                p.nombreCompleto ||
                (p.primer_nombre && p.primer_apellido)
              );
            if (idUsuario != null && missingKeyFields) {
              try {
                const { data: u } = await api.get(`/usuarios/${idUsuario}/`);
                uDet = u;
              } catch {
                uDet = null;
              }
            }

            const cedula = String(
              p.cedula ?? uDet?.cedula ?? p.usuario_cedula ?? ""
            );

            // 🔹 Validar que esté activo
            const activoPaciente =
              isActiveFlag(p.activo) &&
              isActiveFlag(p.estado) &&
              isActiveFlag(p.usuario_activo ?? uDet?.is_active);

            if (!activoPaciente) return null;

            return {
              id_paciente: Number(id_paciente),
              id_usuario: Number(idUsuario),
              cedula,
              primer_nombre: p.primer_nombre ?? uDet?.primer_nombre ?? "",
              segundo_nombre: p.segundo_nombre ?? uDet?.segundo_nombre ?? "",
              primer_apellido: p.primer_apellido ?? uDet?.primer_apellido ?? "",
              segundo_apellido:
                p.segundo_apellido ?? uDet?.segundo_apellido ?? "",
            };
          })
        )
      ).filter(Boolean) as PacienteFlat[];

      setPacientes(planos);
    } catch (e: any) {
      setPacErr(
        e?.response?.data?.detail || "No se pudo cargar la lista de pacientes."
      );
      setPacientes([]);
    } finally {
      setPacLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPacientes();
  }, [loadPacientes]);

  const pacientesFiltrados = useMemo(() => {
    const nom = fNombre.trim().toLowerCase();
    const ced = fCedula.trim();

    // Obtener el id_usuario del odontólogo actual para excluirlo
    const odoUsuarioId = usuario?.id_usuario ?? (usuario as any)?.usuario?.id_usuario ?? null;

    return pacientes
      .filter((p) => {
        if (odoUsuarioId && p.id_usuario === odoUsuarioId) return false;
        
        const fullName = `${p.primer_apellido ?? ""} ${
          p.segundo_apellido ?? ""
        } ${p.primer_nombre ?? ""} ${p.segundo_nombre ?? ""}`.toLowerCase();
        const okNom = !nom || fullName.includes(nom);
        const okCed = !ced || p.cedula.includes(ced);
        return okNom && okCed;
      })
      .sort((a, b) =>
        `${a.primer_apellido ?? ""} ${a.segundo_apellido ?? ""}`.localeCompare(
          `${b.primer_apellido ?? ""} ${b.segundo_apellido ?? ""}`
        )
      );
  }, [pacientes, fNombre, fCedula, usuario]);

  const total = pacientesFiltrados.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, total);

  const currentRows = useMemo(
    () => pacientesFiltrados.slice(startIndex, endIndex),
    [pacientesFiltrados, startIndex, endIndex]
  );

  /* ------- Cargar catálogos (consultorios) ------- */
  useEffect(() => {
    (async () => {
      const co = await api.get("/consultorios/?page_size=1000");
      const coList: ConsultorioOpt[] = (co.data.results ?? co.data).map(
        (c: any) => ({
          id: Number(c.id_consultorio),
          nombre:
            c.nombre ??
            (c.numero
              ? `Consultorio ${c.numero}`
              : `Consultorio ${c.id_consultorio}`),
          numero: c.numero,
          estado: !!c.estado,
        })
      );
      setConsultorios(coList);
    })();
  }, []);

  /* ------- Detalle del odontólogo y horarios ------- */
  useEffect(() => {
    (async () => {
      if (!odoId) {
        setOdoDet(null);
        setHorarios([]);
        return;
      }
      try {
        const [{ data: det }, { data: hrs }] = await Promise.all([
          api.get(`/odontologos/${odoId}/`),
          api.get(`/odontologos/${odoId}/horarios_vigentes/`),
        ]);
        setOdoDet(det);
        setHorarios(hrs ?? []);
      } catch {
        setOdoDet(null);
        setHorarios([]);
      }
    })();
  }, [odoId]);

  /* ------- Bloqueos + resumen de citas del mes visible ------- */
  useEffect(() => {
    (async () => {
      if (!odoId) {
        setBloqueosGlobalMap({});
        setBloqueosOdoMap({});
        setResumenMes({});
        return;
      }
      setBloqsLoading(true);
      try {
        const y = viewYM.y,
          m = viewYM.m0 + 1;
        const lastDay = new Date(y, m, 0).getDate();
        const from = `${y}-${pad2(m)}-01`;
        const to = `${y}-${pad2(m)}-${pad2(lastDay)}`;

        const [bGlobalRes, bOdoRes, resumenRes] = await Promise.all([
          api.get(`/bloqueos-dias/`, {
            params: { start: from, end: to, odontologo: "global" },
          }),
          api.get(`/odontologos/${odoId}/bloqueos/`, { params: { from, to } }),
          api.get(`/citas/resumen-mensual/`, {
            params: { year: y, month: m, id_odontologo: odoId },
          }),
        ]);

        // Expandir globales
        const eachDay = (f: string, t: string) => {
          const out: string[] = [];
          let d = fromISO(f),
            end = fromISO(t);
          while (d <= end) {
            out.push(toISODate(d));
            d.setDate(d.getDate() + 1);
          }
          return out;
        };
        const monthDays = eachDay(from, to);

        const mapG: Record<string, BloqueoInfo> = {};
        for (const g of bGlobalRes.data ?? []) {
          const motivo = g.motivo || null;
          if (g.recurrente_anual) {
            const fi = String(g.fecha_inicio),
              ff = String(g.fecha_fin);
            for (const iso of monthDays) {
              if (occursOnAnnualRange(iso, fi, ff)) {
                mapG[iso] = mapG[iso] ?? { scope: "global", motivo };
                if (!mapG[iso].motivo) mapG[iso].motivo = motivo;
              }
            }
          } else {
            let d = fromISO(g.fecha_inicio),
              end = fromISO(g.fecha_fin);
            while (d <= end) {
              const iso = toISODate(d);
              if (iso >= from && iso <= to) {
                mapG[iso] = mapG[iso] ?? { scope: "global", motivo };
                if (!mapG[iso].motivo) mapG[iso].motivo = motivo;
              }
              d.setDate(d.getDate() + 1);
            }
          }
        }
        setBloqueosGlobalMap(mapG);

        const mapO: Record<string, BloqueoInfo> = {};
        for (const iso of bOdoRes.data ?? [])
          mapO[iso] = { scope: "odo", motivo: null };
        setBloqueosOdoMap(mapO);

        // Resumen para badges (espera un objeto { 'YYYY-MM-DD': { total_citas, ... } })
        const resumenObj: Record<
          string,
          { total_citas: number; bloqueado?: boolean }
        > = resumenRes.data ?? {};
        setResumenMes(resumenObj);
      } finally {
        setBloqsLoading(false);
      }
    })();
  }, [odoId, viewYM]);

  /* ------- Helpers de fecha habilitada ------- */
  const fechaBloqueada = (iso: string) => !!bloqueosMap[iso];
  const fechaHabilitadaPorHorarios = (iso: string) => {
    if (!horarios?.length) return false;
    const dow = dowMonday0(iso);
    const dias = new Set(
      horarios
        .filter((h) => h && h.vigente !== false)
        .map((h) => ((Number(h.dia_semana) % 7) + 7) % 7)
    );
    return dias.has(dow);
  };

  /* ------- Construir slots base (por horarios, sin almuerzo, con lead time hoy) ------- */
  const buildBaseSlots = useCallback(
    (dateISO: string) => {
      if (!horarios?.length) return new Set<string>();
      const dow = dowMonday0(dateISO);
      const intervals = horarios
        .filter((h) => h && h.vigente !== false)
        .filter((h) => ((Number(h.dia_semana) % 7) + 7) % 7 === dow)
        .map((h) => ({
          from: timeToMinutes(h.hora_inicio),
          to: timeToMinutes(h.hora_fin),
        }))
        .filter((iv) => iv.to > iv.from);

      const base = new Set<string>();
      for (const iv of intervals) {
        for (let t = iv.from; t + 60 <= iv.to; t += 60) {
          const H = Math.floor(t / 60);
          if (H >= LUNCH_FROM && H < LUNCH_TO) continue; // respeta almuerzo
          base.add(minutesToHHMM(t));
        }
      }

      // Ocultar horas pasadas si la fecha es hoy
      const dSel = fromISO(dateISO);
      const now = new Date();
      const isToday =
        dSel.getFullYear() === now.getFullYear() &&
        dSel.getMonth() === now.getMonth() &&
        dSel.getDate() === now.getDate();

      if (isToday) {
        const minutesNow = now.getHours() * 60 + now.getMinutes();
        const cutoff = Math.floor(minutesNow / 60) * 60; // hora actual redondeada hacia abajo
        for (const s of Array.from(base)) {
          if (timeToMinutes(s) < cutoff) base.delete(s);
        }
      }

      return base;
    },
    [horarios]
  );

  /* ------- Generar horas disponibles ------- */
  useEffect(() => {
    (async () => {
      setHoraOptions([]);
      setHoraSel("");
      setHoraSelConsultorio(null);

      if (!odoId || !fecha) return;
      if (!fechaHabilitadaPorHorarios(fecha)) return;
      if (fechaBloqueada(fecha)) return;

      const base = buildBaseSlots(fecha);
      if (!base.size) return;

      const activos = consultorios.filter((c) => c.estado);
      if (!activos.length) return;

      const consultorioDefaultId =
        odoDet?.consultorio_default?.id_consultorio ??
        odoDet?.consultorio_defecto?.id_consultorio ??
        odoDet?.id_consultorio_default ??
        odoDet?.id_consultorio_defecto ??
        null;

      // Ordenar consultorios: default primero
      const ordered = [...activos].sort((a, b) => {
        if (!consultorioDefaultId) return a.id - b.id;
        if (a.id === consultorioDefaultId) return -1;
        if (b.id === consultorioDefaultId) return 1;
        return a.id - b.id;
      });

      setLoadingHoras(true);
      try {
        const resp = await Promise.all(
          ordered.map((c) =>
            api
              .get<DisponibilidadResp>("/citas/disponibilidad/", {
                params: { fecha, id_odontologo: odoId, id_consultorio: c.id },
              })
              .then((r) => ({
                id: c.id,
                label:
                  c.nombre ??
                  (c.numero
                    ? `Consultorio ${c.numero}`
                    : `Consultorio ${c.id}`),
                set: new Set(r.data?.disponibles ?? []),
              }))
          )
        );

        const opts: Array<{
          t: string;
          consultorioId: number;
          consultorioLabel: string;
          isDefault: boolean;
        }> = [];
        const baseList = Array.from(base).sort();
        for (const t of baseList) {
          let chosen: { id: number; label: string; isDefault: boolean } | null =
            null;

          // 1) Intentar default
          if (consultorioDefaultId) {
            const d = resp.find((x) => x.id === consultorioDefaultId);
            if (d && d.set.has(t))
              chosen = { id: d.id, label: d.label, isDefault: true };
          }
          // 2) Alterno
          if (!chosen) {
            const alt = resp.find(
              (x) => x.id !== consultorioDefaultId && x.set.has(t)
            );
            if (alt)
              chosen = { id: alt.id, label: alt.label, isDefault: false };
          }
          if (chosen) {
            opts.push({
              t,
              consultorioId: chosen.id,
              consultorioLabel: chosen.label,
              isDefault: chosen.isDefault,
            });
          }
        }

        setHoraOptions(opts.sort((a, b) => a.t.localeCompare(b.t)));
        // Selección por defecto
        if (opts.length) {
          setHoraSel(opts[0].t);
          setHoraSelConsultorio(opts[0].consultorioId);
        }
      } finally {
        setLoadingHoras(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    odoId,
    fecha,
    consultorios,
    odoDet?.consultorio_default,
    odoDet?.consultorio_defecto,
    horarios,
    bloqueosMap,
  ]);

  /* ------- Guardar (POST) ------- */
  async function guardar() {
    if (
      !pacSel ||
      !odoId ||
      !fecha ||
      !horaSel ||
      !horaSelConsultorio ||
      !motivo.trim()
    )
      return;
    setSubmitting(true);
    setErrorMsg("");
    try {
      const payload = {
        id_paciente: pacSel.id,
        id_odontologo: odoId,
        id_consultorio: horaSelConsultorio,
        fecha,
        hora: `${horaSel}:00`,
        motivo: motivo.trim(),
        estado, // para staff/odo/admin se permite
      };
      await api.post(`/citas/`, payload);
      setShowSuccess(true);
      setTimeout(() => {
        navigate("/odontologo/agenda", {
          state: { fechaNueva: fecha },
        });
      }, 1000);
    } catch (err: any) {
      const data = err?.response?.data;
      const msg =
        (typeof data === "string" && data) ||
        data?.hora?.[0] ||
        data?.id_consultorio?.[0] ||
        data?.id_paciente?.[0] ||
        data?.motivo?.[0] ||
        data?.detail ||
        "No se pudo crear la cita.";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }

  /* ==================== UI ==================== */

  const morning = horaOptions.filter(
    (h) => parseInt(h.t.slice(0, 2)) < LUNCH_FROM
  );
  const afternoon = horaOptions.filter(
    (h) => parseInt(h.t.slice(0, 2)) >= LUNCH_TO
  );

  // Nota de auto-confirmación (< 24h)
  const hoursUntil = useMemo(() => {
    if (!fecha || !horaSel) return null;
    try {
      const [yy, mm, dd] = fecha.split("-").map(Number);
      const [HH, MM] = horaSel.split(":").map(Number);
      const dt = new Date(yy, (mm ?? 1) - 1, dd ?? 1, HH ?? 0, MM ?? 0, 0, 0);
      return (dt.getTime() - Date.now()) / 3600000;
    } catch {
      return null;
    }
  }, [fecha, horaSel]);

  // Badge para el calendario (conteo de citas y bloqueos)
  const dayBadge = (iso: string): "bloqueado" | number | null => {
    if (bloqueosMap[iso]) return "bloqueado";
    const cnt = resumenMes[iso]?.total_citas ?? 0;
    return cnt > 0 ? cnt : null;
  };

  return (
    <div className="space-y-6">
      {/* Toast éxito */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
            <div className="font-semibold">¡Cita creada correctamente!</div>
            <div className="text-sm text-white/90">Redirigiendo…</div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Icono + título alineados y con tamaño similar */}
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarPlus className="w-6 h-6 -mt-0.5" />
          <span>Agendar cita</span>
        </h1>
        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
            onClick={() => navigate(`/odontologo/agenda`)}
          >
            Volver a agenda
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:bg-black/80 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={guardar}
            disabled={
              !pacSel ||
              !odoId ||
              !fecha ||
              !horaSel ||
              !horaSelConsultorio ||
              !motivo.trim() ||
              submitting
            }
            title={
              !pacSel
                ? "Selecciona un paciente"
                : !horaSel
                ? "Selecciona una hora disponible"
                : !motivo.trim()
                ? "Ingresa el motivo"
                : "Crear cita"
            }
          >
            {submitting ? "Guardando…" : "Crear cita"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* --- Columna izquierda: Paciente --- */}
        <div className="rounded-xl bg-white shadow p-4 space-y-4">
          <h2 className="font-semibold">1) Seleccionar paciente</h2>

          {/* Filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
              <input
                value={fNombre}
                onChange={(e) => setFNombre(e.target.value)}
                placeholder="Filtrar por nombre"
                className="w-full pl-9 pr-3 py-2 border rounded-lg"
              />
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
              <input
                value={fCedula}
                onChange={(e) => setFCedula(e.target.value.replace(/\D/g, ""))}
                placeholder="Filtrar por cédula"
                className="w-full pl-9 pr-3 py-2 border rounded-lg"
                inputMode="numeric"
                maxLength={10}
              />
            </div>
          </div>

          <div className="flex sm:justify-end">
            <button
              onClick={() => {
                setFNombre("");
                setFCedula("");
              }}
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Limpiar filtros
            </button>
          </div>

          {/* Mensaje de error */}
          {pacErr && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {pacErr}
            </div>
          )}

          {/* Tabla de pacientes */}
          <div className="rounded-xl bg-white shadow-md overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-black font-bold border-b border-black">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Cédula</th>
                  <th className="px-4 py-3 text-left font-medium">Apellidos</th>
                  <th className="px-4 py-3 text-left font-medium">Nombres</th>
                  <th className="px-4 py-3 text-left font-medium">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pacLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center">
                      Cargando…
                    </td>
                  </tr>
                )}

                {!pacLoading && currentRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center text-gray-500"
                    >
                      No se encontraron pacientes con esos filtros.
                    </td>
                  </tr>
                )}

                {!pacLoading &&
                  currentRows.map((p) => {
                    const selected = pacSel?.id === p.id_paciente;
                    const nombres = [p.primer_nombre, p.segundo_nombre]
                      .filter(Boolean)
                      .join(" ");
                    const apellidos = [p.primer_apellido, p.segundo_apellido]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <tr
                        key={p.id_paciente}
                        className={`hover:bg-gray-50 ${
                          selected ? "bg-blue-50" : ""
                        }`}
                      >
                        <td className="px-4 py-3">{p.cedula || "—"}</td>
                        <td className="px-4 py-3">{apellidos || "—"}</td>
                        <td className="px-4 py-3">{nombres || "—"}</td>
                        <td className="px-4 py-3">
                          <button
                            className={`px-3 py-1 rounded-lg border ${
                              selected
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white hover:bg-gray-50"
                            }`}
                            onClick={() =>
                              setPacSel({
                                id: p.id_paciente,
                                cedula: p.cedula,
                                nombre: `${nombres} ${apellidos}`,
                              })
                            }
                          >
                            {selected ? "Seleccionado" : "Elegir"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>

            {/* Paginación */}
            {!pacLoading && total > 0 && (
              <div className="px-4 py-3 border-t bg-gray-100 flex items-center justify-between">
                {/* Izquierda: total */}
                <div className="text-sm text-gray-700">
                  Pacientes totales:{" "}
                  <span className="font-semibold">{total}</span>
                </div>

                {/* Centro: controles */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={safePage === 1}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                    title="Primera página"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                    title="Siguiente"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setPage(totalPages)}
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

          {pacSel && (
            <div className="mt-1 text-sm text-green-700">
              Seleccionado: <b>{pacSel.cedula}</b> — {pacSel.nombre}{" "}
              <button
                className="underline ml-2"
                onClick={() => setPacSel(null)}
              >
                Cambiar
              </button>
            </div>
          )}
        </div>

        {/* --- Columna derecha: Detalles --- */}
        <div className="rounded-xl bg-white shadow p-4 space-y-4">
          <h2 className="font-semibold">2) Detalles de la cita</h2>

          {/* Fecha (popup) */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Fecha</label>
            <DatePopover
              date={fecha}
              onChange={(iso: string) => {
                setFecha(iso);
                setHoraSel("");
                setHoraSelConsultorio(null);
              }}
              disabledDate={(iso: string) => {
                if (!fechaHabilitadaPorHorarios(iso)) return true;
                if (fechaBloqueada(iso)) return true;
                return false;
              }}
              getDateMeta={(iso: string) =>
                bloqueosMap[iso]
                  ? { blocked: true, motivo: bloqueosMap[iso].motivo || null }
                  : undefined
              }
              dayBadge={dayBadge} // contador de citas
              disabledAll={!odoId}
              viewYM={viewYM}
              onViewYMChange={setViewYM}
            />
            {!odoId ? (
              <div className="text-xs text-gray-500">Cargando odontólogo…</div>
            ) : bloqsLoading || horariosLoading ? (
              <div className="text-xs text-gray-500">Cargando calendario…</div>
            ) : (
              Object.keys(bloqueosMap).length > 0 && (
                <div className="text-xs text-gray-500">
                  * Hay días bloqueados este mes (globales y/o del odontólogo).
                </div>
              )
            )}
          </div>

          {/* Horas disponibles (mañana/tarde) */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Hora</label>

            {!odoId ? (
              <div className="text-sm text-gray-500">Cargando…</div>
            ) : loadingHoras || bloqsLoading || horariosLoading ? (
              <div className="text-sm text-gray-500">
                Calculando disponibilidad…
              </div>
            ) : horaOptions.length === 0 ? (
              <div className="text-sm text-red-600">
                {fechaBloqueada(fecha)
                  ? `No hay horarios: el día ${fecha} está bloqueado.`
                  : `No hay horarios disponibles para ${fecha}.`}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Mañana */}
                <div>
                  <div className="text-sm font-medium mb-1">En la mañana</div>
                  <div className="flex flex-wrap gap-2">
                    {morning.length === 0 && (
                      <div className="text-xs text-gray-500">Sin horarios.</div>
                    )}
                    {morning.map((h) => {
                      const active =
                        horaSel === h.t &&
                        horaSelConsultorio === h.consultorioId;
                      return (
                        <button
                          key={`m-${h.t}-${h.consultorioId}`}
                          onClick={() => {
                            setHoraSel(h.t);
                            setHoraSelConsultorio(h.consultorioId);
                          }}
                          className={[
                            "px-2.5 py-1.5 rounded-lg border text-xs",
                            active
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white hover:bg-gray-50",
                          ].join(" ")}
                        >
                          {h.t} ·{" "}
                          <span className="opacity-80">
                            {h.consultorioLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Tarde */}
                <div>
                  <div className="text-sm font-medium mb-1">En la tarde</div>
                  <div className="flex flex-wrap gap-2">
                    {afternoon.length === 0 && (
                      <div className="text-xs text-gray-500">Sin horarios.</div>
                    )}
                    {afternoon.map((h) => {
                      const active =
                        horaSel === h.t &&
                        horaSelConsultorio === h.consultorioId;
                      return (
                        <button
                          key={`t-${h.t}-${h.consultorioId}`}
                          onClick={() => {
                            setHoraSel(h.t);
                            setHoraSelConsultorio(h.consultorioId);
                          }}
                          className={[
                            "px-2.5 py-1.5 rounded-lg border text-xs",
                            active
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white hover:bg-gray-50",
                          ].join(" ")}
                        >
                          {h.t} ·{" "}
                          <span className="opacity-80">
                            {h.consultorioLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="text-xs text-gray-600 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Se prioriza el consultorio por defecto; si está ocupado, se
                  ofrece un alterno.
                </div>

                {hoursUntil !== null && hoursUntil < 24 && hoursUntil > 0 && (
                  <div className="text-xs mt-1 rounded-md border border-green-200 bg-green-50 text-green-800 px-2 py-1">
                    Esta cita se <b>confirmará automáticamente</b> al guardar
                    porque faltan menos de 24 horas.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Estado */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Estado</label>
            <select
              className="border rounded-lg px-3 py-2 bg-white"
              value={estado}
              onChange={(e) => setEstado(e.target.value as Estado)}
            >
              <option value="pendiente">Pendiente</option>
              <option value="confirmada">Confirmada</option>
              <option value="realizada">Realizada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>

          {/* Motivo (OBLIGATORIO) */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">
              Motivo <span className="text-red-600">*</span>
            </label>
            <input
              className="border rounded-lg px-3 py-2 bg-white"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Describe el motivo de la cita"
              required
            />
            {!motivo.trim() && (
              <div className="text-xs text-red-600">
                El motivo es obligatorio.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
