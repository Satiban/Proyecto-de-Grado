// src/pages/admin/AgendarCita.tsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AxiosResponse } from "axios";
import { api } from "../../api/axios";
import {
  CalendarDays,
  ChevronDown,
  Search,
  ArrowLeft,
  CalendarPlus,
  ChevronLeft,
  ChevronsLeft,
  ChevronRight,
  ChevronsRight,
} from "lucide-react";

/* ==================== Tipos ==================== */
type Opcion = { id: number; nombre: string };
type OdontologoOpt = Opcion & { 
  id_usuario?: number | null;
  especialidades?: string[];
};

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
  dia_semana: number; // BACKEND: 0=Lunes..6=Domingo
  hora_inicio: string; // "HH:MM"
  hora_fin: string; // "HH:MM"
  vigente?: boolean;
};

type ConsultorioOpt = { id: number; nombre: string; estado: boolean };

type DisponibilidadResp = {
  fecha: string;
  id_odontologo: number;
  id_consultorio: number | null;
  disponibles: string[]; // "HH:MM"
};

type BloqueoInfo = { motivo?: string | null; scope: "global" | "odo" };

/* ==================== Constantes / helpers ==================== */
const LUNCH_FROM = 13; // 13:00
const LUNCH_TO = 15; // 15:00 (exclusivo)

// Límite de agendamiento: hasta 1 año desde hoy
const ONE_YEAR_DAYS = 365;

/** suma días a una fecha ISO */
function addDaysISO(iso: string, days: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Devuelve todas las fechas ISO entre from..to (incl). */
function eachDayISO(from: string, to: string): string[] {
  const out: string[] = [];
  let d = fromISO(from);
  const end = fromISO(to);
  while (d <= end) {
    out.push(toISODate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** ¿El MM-DD de `dayISO` cae dentro del rango anual [startISO..endISO]? (ignora año) */
function occursOnAnnualRange(
  dayISO: string,
  startISO: string,
  endISO: string
): boolean {
  const md = dayISO.slice(5); // "MM-DD"
  const ms = startISO.slice(5);
  const me = endISO.slice(5);
  if (ms <= me) {
    // rango que no cruza año
    return md >= ms && md <= me;
  } else {
    // cruza año (p.ej. 12-24 .. 01-02)
    return md >= ms || md <= me;
  }
}

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
const isToday = (iso: string) => {
  const a = fromISO(iso);
  const b = new Date();
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

/** Día de semana 0=Lunes .. 6=Domingo para una fecha ISO. */
function dowMonday0(iso: string) {
  const d = fromISO(iso);
  return (d.getDay() + 6) % 7; // JS: 0=Dom..6=Sáb -> 0=Lun..6=Dom
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

/* ====== ClickAway + Calendario Popover (con selects Mes/Año) ====== */
function useClickAway<T extends HTMLElement>(cb: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      // @ts-ignore
      if (!ref.current.contains(e.target)) cb();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [cb]);
  return ref;
}
function buildGrid(year: number, month0: number) {
  // Semana inicia Lunes
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

function DatePopover({
  date,
  onChange,
  disabledDate,
  getDateMeta,
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
  disabledAll?: boolean;
  viewYM: { y: number; m0: number };
  onViewYMChange: (next: { y: number; m0: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromISO(date);

  // Cursor controlado por el padre (mes visible)
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
                  {blocked && (
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
export default function AgendarCita() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const qs = new URLSearchParams(search);

  /* ------- Estado ------- */
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
  const [odontologos, setOdontologos] = useState<OdontologoOpt[]>([]);
  const [consultorios, setConsultorios] = useState<ConsultorioOpt[]>([]);

  // Cita
  const [odo, setOdo] = useState<number | "">(
    qs.get("id_odontologo") ? Number(qs.get("id_odontologo")) : ""
  );
  const [odoInfo, setOdoInfo] = useState<{
    nombre?: string;
    especialidad?: string;
    consultorioDefaultId?: number | null;
  } | null>(null);

  // Fechas: hoy y límite (hoy + 365 días)
  const hoyISO = toISODate(new Date());
  const maxISO = addDaysISO(hoyISO, ONE_YEAR_DAYS);

  const [fecha, setFecha] = useState<string>(() => {
    const qf = qs.get("fecha");
    const base = qf || hoyISO;
    // normaliza si viene una fecha fuera de rango
    if (fromISO(base) < fromISO(hoyISO)) return hoyISO;
    if (fromISO(base) > fromISO(maxISO)) return maxISO;
    return base;
  });

  // Mes visible del calendario (controlado)
  const [viewYM, setViewYM] = useState<{ y: number; m0: number }>(() => {
    const d = fromISO(
      typeof window !== "undefined" && qs.get("fecha")
        ? String(qs.get("fecha"))
        : hoyISO
    );
    return { y: d.getFullYear(), m0: d.getMonth() };
  });

  const [horarios, setHorarios] = useState<HorarioVigente[]>([]);
  // Bloqueos del odontólogo + globales (por fecha del mes visible)
  const [bloqueosMap, setBloqueosMap] = useState<Record<string, BloqueoInfo>>(
    {}
  );
  const [consultorio, setConsultorio] = useState<number | "">(
    qs.get("id_consultorio") ? Number(qs.get("id_consultorio")) : ""
  );
  const [horasDisp, setHorasDisp] = useState<string[]>([]);
  const [horaSel, setHoraSel] = useState<string>("");

  const [loadingSlots, setLoadingSlots] = useState(false);
  const [horariosLoading, setHorariosLoading] = useState(false);
  const [bloqsLoading, setBloqsLoading] = useState(false);

  const [motivo, setMotivo] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  /* ------- utils de actividad ------- */
  const isActiveFlag = (v: any) =>
    !(v === false || v === 0 || v === "0" || v === "false");

  /* ------- Cargar pacientes (solo activos) ------- */
  const loadPacientes = useCallback(async () => {
    setPacLoading(true);
    setPacErr("");
    try {
      const base = await fetchAll<any>("/pacientes/");
      const planos: PacienteFlat[] = [];
      for (const p of base) {
        const id_paciente = String(p.id_paciente ?? p.id ?? p.pk ?? "");
        const idUsuario =
          p.id_usuario ?? p.usuario?.id_usuario ?? p.usuario_id ?? p.usuario;

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

        // Determinar si el paciente está activo
        const activoPaciente =
          isActiveFlag(p.activo) &&
          isActiveFlag(p.estado) &&
          isActiveFlag(p.usuario_activo ?? uDet?.is_active);

        if (!activoPaciente) continue; // filtra inactivos

        planos.push({
          id_paciente: Number(id_paciente),
          id_usuario: Number(idUsuario),
          cedula: String(p.cedula ?? uDet?.cedula ?? p.usuario_cedula ?? ""),
          primer_nombre: p.primer_nombre ?? uDet?.primer_nombre ?? "",
          segundo_nombre: p.segundo_nombre ?? uDet?.segundo_nombre ?? "",
          primer_apellido: p.primer_apellido ?? uDet?.primer_apellido ?? "",
          segundo_apellido: p.segundo_apellido ?? uDet?.segundo_apellido ?? "",
        });
      }

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

    return pacientes
      .filter((p) => {
        const nombreComp = [
          p.primer_nombre,
          p.segundo_nombre,
          p.primer_apellido,
          p.segundo_apellido,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const okNom = !nom || nombreComp.includes(nom);
        const okCed = !ced || p.cedula.includes(ced);
        return okNom && okCed;
      })
      .sort((a, b) => {
        const apA = [a.primer_apellido, a.segundo_apellido]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const apB = [b.primer_apellido, b.segundo_apellido]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return apA.localeCompare(apB, "es", { sensitivity: "base" });
      });
  }, [pacientes, fNombre, fCedula]);

  // Paginación de pacientes
  const PAGE_SIZE = 7;
  const [page, setPage] = useState(1);

  const total = pacientesFiltrados.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, total);

  const currentRows = useMemo(
    () => pacientesFiltrados.slice(startIndex, endIndex),
    [pacientesFiltrados, startIndex, endIndex]
  );

  // Handlers
  const goFirst = () => setPage(1);
  const goPrev = () => setPage((p) => Math.max(1, p - 1));
  const goNext = () => setPage((p) => Math.min(totalPages, p + 1));
  const goLast = () => setPage(totalPages);

  const limpiarFiltrosPac = () => {
    setFNombre("");
    setFCedula("");
  };

  /* ------- Cargar catálogos ------- */
  useEffect(() => {
    (async () => {
      const [od, co] = await Promise.all([
        api.get("/odontologos/?page_size=1000"),
        api.get("/consultorios/?page_size=1000"),
      ]);

      // Solo odontólogos activos (ambos campos: odontologo_activo Y is_active)
      const odList: OdontologoOpt[] = (od.data.results ?? od.data)
        .filter((o: any) => {
          // Usar odontologo_activo como campo principal, con fallback a activo
          const odontActivo = o.odontologo_activo !== undefined 
            ? isActiveFlag(o.odontologo_activo)
            : isActiveFlag(o.activo);
          
          // Verificar que el usuario general también esté activo
          const usuarioActivo = isActiveFlag(
            o.is_active ?? o.usuario_activo ?? o.user_activo ?? true
          );
          
          return odontActivo && usuarioActivo;
        })
        .map((o: any) => ({
          id: o.id_odontologo,
          id_usuario: o.id_usuario ?? o.usuario?.id_usuario ?? o.usuario_id ?? null,
          nombre:
            o.nombreCompleto ??
            [
              o.primer_nombre,
              o.segundo_nombre,
              o.primer_apellido,
              o.segundo_apellido,
            ]
              .filter(Boolean)
              .join(" "),
          especialidades: Array.isArray(o.especialidades)
            ? o.especialidades.filter(Boolean)
            : [],
        }));

      const coList = (co.data.results ?? co.data).map((c: any) => ({
        id: c.id_consultorio,
        nombre: `Consultorio ${c.numero}`,
        estado: !!c.estado,
      }));

      setOdontologos(odList);
      setConsultorios(coList);
    })();
  }, []);

  /* ------- Info del odontólogo seleccionado ------- */
  useEffect(() => {
    (async () => {
      if (!odo) {
        setOdoInfo(null);
        return;
      }
      try {
        const r = await api.get(`/odontologos/${odo}/`);
        const o = r.data;

        // Validar que el odontólogo no sea el mismo paciente
        if (pacSel?.id) {
          const pacienteSeleccionado = pacientes.find(p => p.id_paciente === pacSel.id);
          const odoUsuarioId = o.id_usuario ?? o.usuario?.id_usuario ?? o.usuario_id;
          
          if (pacienteSeleccionado?.id_usuario && odoUsuarioId && 
              pacienteSeleccionado.id_usuario === odoUsuarioId) {
            setErrorMsg("No puedes agendar una cita contigo mismo.");
            setOdoInfo(null);
            setOdo("");
            return;
          }
        }

        // Si el odontólogo viene inactivo por alguna razón, limpiamos selección
        const odontActivo = o.odontologo_activo !== undefined
          ? isActiveFlag(o.odontologo_activo)
          : isActiveFlag(o.activo);
        const usuarioActivo = isActiveFlag(o.is_active ?? o.usuario_activo ?? true);
        
        if (!odontActivo || !usuarioActivo) {
          setOdoInfo(null);
          setOdo("");
          return;
        }

        setOdoInfo({
          nombre:
            o.nombreCompleto ??
            [
              o.primer_nombre,
              o.segundo_nombre,
              o.primer_apellido,
              o.segundo_apellido,
            ]
              .filter(Boolean)
              .join(" "),
          especialidad:
            o.especialidad_nombre ?? o.especialidad?.nombre ?? o.especialidad,
          consultorioDefaultId:
            o.consultorio_default?.id_consultorio ??
            o.id_consultorio_default ??
            o.consultorio_defecto_id ??
            o.id_consultorio_defecto ??
            null,
        });
      } catch {
        setOdoInfo(null);
      }
    })();
  }, [odo, pacSel, pacientes]);

  /* ------- Helpers bloqueos ------- */
  function expandRange(from: string, to: string): string[] {
    const out: string[] = [];
    let d = fromISO(from);
    const end = fromISO(to);
    while (d <= end) {
      out.push(toISODate(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  /* ------- Horarios del odontólogo (no dependen del mes) ------- */
  useEffect(() => {
    (async () => {
      if (!odo) {
        setHorarios([]);
        return;
      }
      setHorariosLoading(true);
      try {
        const h = await api.get(`/odontologos/${odo}/horarios_vigentes/`);
        setHorarios(h.data ?? []);
      } finally {
        setHorariosLoading(false);
      }
    })();
  }, [odo]);

  /* ------- Bloqueos del mes VISIBLE (odo + global) ------- */
  useEffect(() => {
    (async () => {
      if (!odo) {
        setBloqueosMap({});
        return;
      }
      setBloqsLoading(true);
      try {
        const y = viewYM.y;
        const m = viewYM.m0 + 1;
        const lastDay = new Date(y, m, 0).getDate();
        const from = `${y}-${pad2(m)}-01`;
        const to = `${y}-${pad2(m)}-${pad2(lastDay)}`;

        const [bOdo, bGlobal] = await Promise.all([
          api.get(`/odontologos/${odo}/bloqueos/`, { params: { from, to } }),
          api.get(`/bloqueos-dias/`, {
            params: { start: from, end: to, odontologo: "global" },
          }),
        ]);

        const map: Record<string, BloqueoInfo> = {};

        // 1) Bloqueos del odontólogo ya vienen EXPANDIDOS por fecha desde el backend
        for (const iso of bOdo.data ?? []) {
          map[iso] = { scope: "odo", motivo: null };
        }

        // 2) Bloqueos globales
        const monthDays = eachDayISO(from, to);
        for (const g of bGlobal.data ?? []) {
          const motivo = g.motivo || null;
          if (g.recurrente_anual) {
            const fi = String(g.fecha_inicio);
            const ff = String(g.fecha_fin);
            for (const iso of monthDays) {
              if (occursOnAnnualRange(iso, fi, ff)) {
                if (!map[iso]) map[iso] = { scope: "global", motivo };
                else if (!map[iso].motivo) map[iso].motivo = motivo;
              }
            }
          } else {
            const rango = expandRange(g.fecha_inicio, g.fecha_fin);
            for (const iso of rango) {
              if (iso >= from && iso <= to) {
                if (!map[iso]) map[iso] = { scope: "global", motivo };
                else if (!map[iso].motivo) map[iso].motivo = motivo;
              }
            }
          }
        }

        setBloqueosMap(map);
      } catch {
        setBloqueosMap({});
      } finally {
        setBloqsLoading(false);
      }
    })();
  }, [odo, viewYM]);

  /* ------- Preseleccionar/actualizar consultorio según odontólogo ------- */
  useEffect(() => {
    if (!odo) {
      setConsultorio("");
      return;
    }
    if (!consultorios.length) return;

    const defId = odoInfo?.consultorioDefaultId ?? null;
    const defActivo = defId
      ? consultorios.some((c) => c.id === defId && c.estado)
      : false;

    const targetId = defActivo
      ? defId!
      : consultorios.find((c) => c.estado)?.id ?? "";

    if (String(consultorio || "") !== String(targetId || "")) {
      setConsultorio(targetId as number | "");
      setHoraSel("");
    }
  }, [odo, odoInfo?.consultorioDefaultId, consultorios]);

  /* ------- Generar horas disponibles (horarios ∩ disponibilidad backend) ------- */
  useEffect(() => {
    (async () => {
      if (
        !odo ||
        !fecha ||
        !consultorio ||
        !horarios.length ||
        horariosLoading ||
        bloqsLoading
      ) {
        setHorasDisp([]);
        return;
      }

      // si la fecha está fuera del rango permitido, no calcular slots
      if (
        fromISO(fecha) > fromISO(maxISO) ||
        fromISO(fecha) < fromISO(hoyISO)
      ) {
        setHorasDisp([]);
        setHoraSel("");
        return;
      }

      setLoadingSlots(true);
      try {
        // 1) Slots base por horarios vigentes del odontólogo (intervalos de 1h, sin almuerzo)
        const dow = dowMonday0(fecha);

        const intervals = (horarios || [])
          .filter((h) => {
            const n = Number(h.dia_semana);
            if (!Number.isFinite(n) || h.vigente === false) return false;

            // Backend: 0=Lunes..6=Domingo (canónico)
            const mon0 = ((n % 7) + 7) % 7;
            return mon0 === dow; // <- comparar únicamente contra el día actual
          })
          .map((h) => ({
            from: timeToMinutes(h.hora_inicio),
            to: timeToMinutes(h.hora_fin),
          }))
          .filter((it) => it.to > it.from);

        const baseSlots = new Set<string>();
        for (const iv of intervals) {
          for (let t = iv.from; t + 60 <= iv.to; t += 60) {
            const H = Math.floor(t / 60);
            if (H >= LUNCH_FROM && H < LUNCH_TO) continue; // excluir almuerzo
            baseSlots.add(minutesToHHMM(t));
          }
        }

        // No mostrar horas pasadas de hoy
        if (isToday(fecha)) {
          const now = new Date();
          const cur = now.getHours() * 60 + (now.getMinutes() > 0 ? 60 : 0);
          for (const s of Array.from(baseSlots)) {
            if (timeToMinutes(s) < cur) baseSlots.delete(s);
          }
        }

        // Si la fecha está bloqueada (odo o global), no hay slots
        if (bloqueosMap[fecha]) {
          setHorasDisp([]);
          setHoraSel("");
          return;
        }

        // 2) Disponibilidad del backend
        const params: any = {
          fecha,
          id_odontologo: odo,
          id_consultorio: consultorio,
        };
        const { data } = await api.get<DisponibilidadResp>(
          "/citas/disponibilidad/",
          { params }
        );
        const disponiblesBackend = new Set<string>(data?.disponibles ?? []);

        // 3) Intersección
        const intersec = Array.from(baseSlots).filter((h) =>
          disponiblesBackend.has(h)
        );

        intersec.sort();
        setHorasDisp(intersec);
        setHoraSel((prev) => (prev && !intersec.includes(prev) ? "" : prev));
      } finally {
        setLoadingSlots(false);
      }
    })();
  }, [
    odo,
    fecha,
    consultorio,
    horarios,
    bloqueosMap,
    horariosLoading,
    bloqsLoading,
    hoyISO,
    maxISO,
  ]);

  /* ------- Deshabilitar fechas (según horarios, bloqueos y rango 1 año) ------- */
  const disabledDate = (iso: string) => {
    if (!odo) return true;
    if (horariosLoading || bloqsLoading) return true;
    if (!horarios || horarios.length === 0) return true;

    // límite de rango: hoy <= iso <= hoy+365
    if (fromISO(iso) < fromISO(hoyISO)) return true;
    if (fromISO(iso) > fromISO(maxISO)) return true;

    const dow = dowMonday0(iso);
    const diasServer = horarios
      .filter((h) => h && h.vigente !== false)
      .map((h) => Number(h.dia_semana))
      .filter((n) => Number.isFinite(n));

    // Normalizamos al esquema canónico (0=Lunes..6=Domingo)
    const diasMon = new Set(diasServer.map((n) => ((n % 7) + 7) % 7)); // 0=Lun..6=Dom

    const habilitadoPorHorarios = diasMon.has(dow);

    if (!habilitadoPorHorarios) return true;
    if (bloqueosMap[iso]) return true; // bloqueado global u odontólogo

    return false;
  };

  // Auto-corrección si la fecha actual queda inválida
  useEffect(() => {
    if (!odo || horariosLoading || !horarios.length || bloqsLoading) return;
    if (disabledDate(fecha)) {
      // busca próxima fecha hábil en 60 días o hasta el límite de 1 año
      let d = fromISO(fecha);
      const limite = fromISO(maxISO);
      for (let i = 0; i <= 60 && d <= limite; i++) {
        const iso = toISODate(d);
        if (!disabledDate(iso)) {
          setFecha(iso);
          break;
        }
        d.setDate(d.getDate() + 1);
      }
      // si no encontró en 60 días, fuerza a hoy si es habilitado o al primer habilitado desde hoy
      if (disabledDate(fecha)) {
        let cur = fromISO(hoyISO);
        while (cur <= limite) {
          const iso = toISODate(cur);
          if (!disabledDate(iso)) {
            setFecha(iso);
            break;
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
    }
  }, [
    odo,
    horariosLoading,
    horarios,
    fecha,
    bloqueosMap,
    bloqsLoading,
    hoyISO,
    maxISO,
  ]);

  /* ------- Confirmar ------- */
  async function confirmar() {
    if (!pacSel || !odo || !consultorio || !fecha || !horaSel || !motivo.trim())
      return;

    // Validación final de fecha en rango permitido
    if (fromISO(fecha) < fromISO(hoyISO) || fromISO(fecha) > fromISO(maxISO)) {
      setErrorMsg("La fecha de la cita debe estar dentro del próximo año.");
      return;
    }

    setSubmitting(true);
    setErrorMsg("");
    try {
      const payload = {
        id_paciente: pacSel.id,
        id_odontologo: odo,
        id_consultorio: consultorio,
        fecha,
        hora: `${horaSel}:00`,
        motivo: motivo.trim(),
        estado: "pendiente",
      };
      await api.post("/citas/", payload);
      setShowSuccess(true);
      setTimeout(() => {
        navigate("/admin/agenda", {
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
        "No se pudo crear la cita.";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const bloqueadosDelMes = Object.keys(bloqueosMap).length;

  /* ==================== UI ==================== */
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
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarPlus className="w-6 h-6" />
          Agendar cita
        </h1>
        <div className="flex gap-2">
          <button
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
            onClick={() => navigate("/admin/agenda")}
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a Agenda
          </button>

          <button
            className="px-3 py-2 rounded-lg border bg-black/80 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={confirmar}
            disabled={
              !pacSel ||
              !odo ||
              !consultorio ||
              !fecha ||
              !horaSel ||
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
            {submitting ? "Creando…" : "Confirmar cita"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* --- Columna izquierda: Paciente (solo activos) --- */}
        <div className="rounded-xl bg-white shadow p-4 space-y-4">
          <h2 className="font-semibold">1) Seleccionar paciente</h2>

          <div className="text-xs text-gray-600">
            * Solo se muestran pacientes activos. Rango permitido de
            agendamiento: <b>{hoyISO}</b> a <b>{maxISO}</b>.
          </div>

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
              onClick={limpiarFiltrosPac}
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

          {/* Tabla */}
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
                    const selected = pacSel?.id === Number(p.id_paciente);
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
                                id: Number(p.id_paciente),
                                cedula: p.cedula || "",
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

          {/* Odontólogo (solo activos) */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Odontólogo</label>
            <select
              className="border rounded-lg px-3 py-2 bg-white w-full max-w-full overflow-hidden text-ellipsis"
              value={odo}
              onChange={(e) => {
                setOdo(e.target.value ? Number(e.target.value) : "");
                // al cambiar de odontólogo, mantenemos el mes visible;
                // el efecto de bloqueos se encargará de recargar para ese mes
              }}
            >
              <option value="">Selecciona un odontólogo…</option>
              {odontologos.map((o) => {
                // Detectar si este odontólogo es el mismo paciente seleccionado
                const pacienteSeleccionado = pacSel?.id ? pacientes.find(p => p.id_paciente === pacSel.id) : null;
                const esMismoPaciente = !!(pacienteSeleccionado?.id_usuario && 
                  o.id_usuario === pacienteSeleccionado.id_usuario);
                
                return (
                  <option 
                    key={o.id} 
                    value={o.id}
                    disabled={esMismoPaciente}
                    style={esMismoPaciente ? { color: '#9CA3AF' } : undefined}
                  >
                    {o.nombre}
                    {o.especialidades?.length
                      ? ` — ${o.especialidades.join(", ")}`
                      : ""}
                    {esMismoPaciente ? " (No disponible - Es el mismo paciente)" : ""}
                  </option>
                );
              })}
            </select>
            {odoInfo?.especialidad && (
              <div className="text-xs text-gray-600">
                Especialidad principal: <b>{odoInfo.especialidad}</b>
              </div>
            )}
            <div className="text-xs text-gray-600">
              * Solo se listan odontólogos activos.
              {pacSel?.id && (() => {
                const pacienteSeleccionado = pacientes.find(p => p.id_paciente === pacSel.id);
                const esOdontologo = pacienteSeleccionado?.id_usuario && 
                  odontologos.some(o => o.id_usuario === pacienteSeleccionado.id_usuario);
                
                if (esOdontologo) {
                  return (
                    <span className="block text-amber-600 mt-1">
                      ⚠️ El paciente seleccionado también es odontólogo (aparece deshabilitado en la lista).
                    </span>
                  );
                }
                return null;
              })()}
            </div>
          </div>

          {/* Fecha (limitada a 1 año) */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Fecha</label>
            <DatePopover
              date={fecha}
              onChange={setFecha}
              disabledDate={disabledDate}
              getDateMeta={(iso) =>
                bloqueosMap[iso]
                  ? { blocked: true, motivo: bloqueosMap[iso].motivo || null }
                  : undefined
              }
              disabledAll={!odo}
              viewYM={viewYM}
              onViewYMChange={setViewYM}
            />
            {!odo ? (
              <div className="text-xs text-gray-500">
                Selecciona un odontólogo para habilitar el calendario.
              </div>
            ) : bloqsLoading ? (
              <div className="text-xs text-gray-500">Cargando bloqueos…</div>
            ) : (
              <>
                {bloqueadosDelMes > 0 && (
                  <div className="text-xs text-gray-500">
                    Este mes tiene <b>{bloqueadosDelMes}</b> día(s)
                    bloqueado(s).
                  </div>
                )}
                <div className="text-xs text-gray-600">
                  Rango permitido: <b>{hoyISO}</b> a <b>{maxISO}</b>.
                </div>
              </>
            )}
          </div>

          {/* Consultorio */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Consultorio</label>
            <select
              className="border rounded-lg px-3 py-2 bg-white w-full max-w-full overflow-hidden text-ellipsis"
              value={consultorio === "" ? "" : String(consultorio)}
              onChange={(e) =>
                setConsultorio(e.target.value ? Number(e.target.value) : "")
              }
              disabled={!odo}
            >
              <option value="">Selecciona consultorio…</option>
              {consultorios
                .filter((c) => c.estado)
                .map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre}
                  </option>
                ))}
              {consultorios
                .filter((c) => !c.estado)
                .map((c) => (
                  <option key={c.id} value={String(c.id)} disabled>
                    {c.nombre} (inactivo)
                  </option>
                ))}
            </select>

            {odoInfo?.consultorioDefaultId && (
              <div className="text-xs text-gray-500">
                Por defecto del odontólogo:{" "}
                <b>
                  {
                    consultorios.find(
                      (c) => c.id === odoInfo.consultorioDefaultId
                    )?.nombre
                  }
                </b>
              </div>
            )}
          </div>

          {/* Banner si el día seleccionado está bloqueado */}
          {odo && bloqueosMap[fecha] && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              No habrá atención el <b>{fecha}</b>
              {bloqueosMap[fecha].motivo ? (
                <>
                  {" "}
                  — Motivo: <i>{bloqueosMap[fecha].motivo}</i>
                </>
              ) : null}
              {bloqueosMap[fecha].scope === "global"
                ? " (bloqueo global)"
                : " (bloqueo del odontólogo)"}
            </div>
          )}

          {/* Horas disponibles */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Hora</label>
            {!odo || !consultorio ? (
              <div className="text-sm text-gray-500">
                Selecciona odontólogo y consultorio para ver horarios.
              </div>
            ) : loadingSlots || horariosLoading || bloqsLoading ? (
              <div className="text-sm text-gray-500">
                Calculando disponibilidad…
              </div>
            ) : fromISO(fecha) < fromISO(hoyISO) ||
              fromISO(fecha) > fromISO(maxISO) ? (
              <div className="text-sm text-red-600">
                La fecha seleccionada está fuera del rango permitido ({hoyISO} a{" "}
                {maxISO}).
              </div>
            ) : horasDisp.length === 0 ? (
              <div className="text-sm text-red-600">
                {bloqueosMap[fecha]
                  ? `No hay horarios: el día ${fecha} está bloqueado.`
                  : `No hay horarios disponibles para ${fecha}.`}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Mañana */}
                <div>
                  <div className="text-sm font-medium mb-1">En la mañana</div>
                  <div className="flex flex-wrap gap-2">
                    {horasDisp.filter(
                      (h) => parseInt(h.slice(0, 2)) < LUNCH_FROM
                    ).length === 0 && (
                      <div className="text-xs text-gray-500">Sin horarios.</div>
                    )}
                    {horasDisp
                      .filter((h) => parseInt(h.slice(0, 2)) < LUNCH_FROM)
                      .map((h) => (
                        <button
                          key={`m-${h}`}
                          onClick={() => setHoraSel(h)}
                          className={[
                            "px-3 py-2 rounded-lg border text-sm",
                            horaSel === h
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white hover:bg-gray-50",
                          ].join(" ")}
                        >
                          {h}
                        </button>
                      ))}
                  </div>
                </div>

                {/* Tarde */}
                <div>
                  <div className="text-sm font-medium mb-1">En la tarde</div>
                  <div className="flex flex-wrap gap-2">
                    {horasDisp.filter(
                      (h) => parseInt(h.slice(0, 2)) >= LUNCH_TO
                    ).length === 0 && (
                      <div className="text-xs text-gray-500">Sin horarios.</div>
                    )}
                    {horasDisp
                      .filter((h) => parseInt(h.slice(0, 2)) >= LUNCH_TO)
                      .map((h) => (
                        <button
                          key={`t-${h}`}
                          onClick={() => setHoraSel(h)}
                          className={[
                            "px-3 py-2 rounded-lg border text-sm",
                            horaSel === h
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white hover:bg-gray-50",
                          ].join(" ")}
                        >
                          {h}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
            {isToday(fecha) && (
              <div className="text-xs text-gray-500">
                * No se muestran horas pasadas de hoy.
              </div>
            )}
          </div>

          {/* Motivo (obligatorio) */}
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
