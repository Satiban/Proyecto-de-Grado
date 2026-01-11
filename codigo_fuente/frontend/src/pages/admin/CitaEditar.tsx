// src/pages/admin/CitaEditar.tsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import type { AxiosResponse } from "axios";
import { api } from "../../api/axios";
import {
  CalendarDays,
  ChevronDown,
  Search,
  Pencil,
  ChevronLeft,
  ChevronsLeft,
  ChevronRight,
  ChevronsRight,
} from "lucide-react";

/* ==================== Tipos ==================== */
type Opcion = { id: number; nombre: string };
type OdontologoOpt = Opcion & {
  especialidades?: string[];
  consultorio_defecto?: { id_consultorio: number; numero: string } | null;
};

type PacienteFlat = {
  id_paciente: string;
  cedula: string;
  primer_nombre: string;
  segundo_nombre?: string | null;
  primer_apellido: string;
  segundo_apellido?: string | null;
};

type HorarioVigente = {
  dia_semana: number; // BACKEND: 0=Lunes..6=Domingo (canónico)
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

type CitaDet = {
  id_cita: number;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM:SS
  motivo?: string | null;
  estado:
    | "pendiente"
    | "confirmada"
    | "cancelada"
    | "realizada"
    | "mantenimiento";
  id_odontologo: number;
  id_paciente: number;
  id_consultorio: number | null;
  paciente_nombre?: string;
  paciente_cedula?: string;
  odontologo_nombre?: string;
  consultorio?: { id_consultorio: number; numero: string };
};

type BloqueoInfo = { motivo?: string | null; scope: "global" | "odo" };

/* ==================== Constantes / helpers ==================== */
const LUNCH_FROM = 13; // 13:00
const LUNCH_TO = 15; // 15:00 (exclusivo)
const PAGE_SIZE = 7;

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
const normalizeEstado = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Día de semana 0=Lunes .. 6=Domingo para una fecha ISO. */
function dowMonday0(iso: string) {
  const d = fromISO(iso);
  return (d.getDay() + 6) % 7; // JS: 0=Dom..6=Sáb -> 0=Lun..6=Dom
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
  return ref as React.MutableRefObject<T | null>;
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
export default function CitaEditar() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const from = (location.state as any)?.from;

  const handleCancel = () => {
    if (from === "agenda" && cita?.fecha) {
      navigate("/admin/agenda", { state: { selectedDate: cita.fecha } });
    } else if (from === "odontologo" && cita?.id_odontologo) {
      navigate(`/admin/odontologos/${cita.id_odontologo}`);
    } else if (from === "paciente" && cita?.id_paciente) {
      navigate(`/admin/pacientes/${cita.id_paciente}`);
    } else {
      navigate("/admin/agenda");
    }
  };

  const [page, setPage] = useState(1);

  /* ------- Estado ------- */
  const [cita, setCita] = useState<CitaDet | null>(null);

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
  const [odontologos, setOdontologos] = useState<OdontologoOpt[]>([]);
  const [consultorios, setConsultorios] = useState<ConsultorioOpt[]>([]);

  // Cita (campos editables)
  const [odo, setOdo] = useState<number | "">("");
  const odoInfo = useMemo(() => {
    if (!odo) return null;
    const o = odontologos.find((x) => x.id === odo);
    if (!o) return null;

    return {
      nombre: o.nombre,
      especialidad: o.especialidades?.[0] ?? null,
      consultorioDefaultId: o.consultorio_defecto?.id_consultorio ?? null,
    };
  }, [odo, odontologos]);

  const [fecha, setFecha] = useState<string>(() => toISODate(new Date()));

  // Mes visible del calendario (controlado)
  const [viewYM, setViewYM] = useState<{ y: number; m0: number }>(() => {
    const d = fromISO(toISODate(new Date()));
    return { y: d.getFullYear(), m0: d.getMonth() };
  });

  const [horarios, setHorarios] = useState<HorarioVigente[]>([]);
  const [bloqueosMap, setBloqueosMap] = useState<Record<string, BloqueoInfo>>(
    {}
  );
  const [consultorio, setConsultorio] = useState<number | "">("");
  const [horasDisp, setHorasDisp] = useState<string[]>([]);
  const [horaSel, setHoraSel] = useState<string>("");

  const [loadingSlots, setLoadingSlots] = useState(false);
  const [horariosLoading, setHorariosLoading] = useState(false);
  const [bloqsLoading, setBloqsLoading] = useState(false);

  const [motivo, setMotivo] = useState<string>("");
  const [estado, setEstado] = useState<CitaDet["estado"]>("pendiente");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const morning = horasDisp.filter((h) => parseInt(h.slice(0, 2)) < LUNCH_FROM);
  const afternoon = horasDisp.filter(
    (h) => parseInt(h.slice(0, 2)) >= LUNCH_TO
  );

  /* ------- Cargar pacientes (todos) ------- */
  const loadPacientes = useCallback(async () => {
    setPacLoading(true);
    setPacErr("");
    try {
      const base = await fetchAll<any>("/pacientes/");
      const planos: PacienteFlat[] = await Promise.all(
        base.map(async (p: any) => {
          const id_paciente = String(p.id_paciente ?? p.id ?? p.pk ?? "");
          return {
            id_paciente,
            cedula: String(p.cedula ?? ""),
            primer_nombre: p.primer_nombre ?? "",
            segundo_nombre: p.segundo_nombre ?? "",
            primer_apellido: p.primer_apellido ?? "",
            segundo_apellido: p.segundo_apellido ?? "",
          };
        })
      );

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

    const filtrados = pacientes.filter((p) => {
      const fullName = [
        p.primer_nombre,
        p.segundo_nombre,
        p.primer_apellido,
        p.segundo_apellido,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const okNom = !nom || fullName.includes(nom);
      const okCed = !ced || p.cedula.includes(ced);
      return okNom && okCed;
    });

    return filtrados.sort((a, b) => {
      const apA = [a.primer_apellido, a.segundo_apellido]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const apB = [b.primer_apellido, b.segundo_apellido]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return apA.localeCompare(apB);
    });
  }, [pacientes, fNombre, fCedula]);

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

      const odList: OdontologoOpt[] = (od.data.results ?? od.data).map(
        (o: any) => {
          const nombres = [o.primer_nombre, o.segundo_nombre]
            .filter(Boolean)
            .join(" ");
          const apellidos = [o.primer_apellido, o.segundo_apellido]
            .filter(Boolean)
            .join(" ");

          // Mostrar siempre "Apellidos Nombres"
          const displayName =
            apellidos || nombres
              ? `${apellidos} ${nombres}`.trim()
              : o.nombreCompleto || "Sin nombre";

          return {
            id: o.id_odontologo,
            nombre: displayName,
            especialidades: Array.isArray(o.especialidades)
              ? o.especialidades.filter(Boolean)
              : [],
            consultorio_defecto: o.consultorio_defecto ?? null,
          };
        }
      );

      // Ordenar por apellidos, no por nombres
      odList.sort((a, b) => {
        const apA = a.nombre.split(" ")[0] || a.nombre;
        const apB = b.nombre.split(" ")[0] || b.nombre;
        return apA.localeCompare(apB, "es", { sensitivity: "base" });
      });

      setOdontologos(odList);

      const coList = (co.data.results ?? co.data).map((c: any) => ({
        id: c.id_consultorio,
        nombre: `Consultorio ${c.numero}`,
        estado: !!c.estado,
      }));

      setOdontologos(odList);
      setConsultorios(coList);
    })();
  }, []);

  /* ------- Cargar cita existente y prellenar ------- */
  useEffect(() => {
    (async () => {
      if (!id) return;
      const { data } = await api.get(`/citas/${id}/`);
      const det = data as CitaDet;
      setCita(det);

      // Prellenar paciente
      setPacSel({
        id: Number(det.id_paciente),
        cedula: det.paciente_cedula ?? "",
        nombre: det.paciente_nombre ?? "",
      });
      setOdo(det.id_odontologo);
      setConsultorio(det.id_consultorio ?? "");
      setFecha(det.fecha);
      setHoraSel((det.hora || "").slice(0, 5));
      setMotivo(det.motivo ?? "");
      setEstado(normalizeEstado(det.estado) as CitaDet["estado"]);

      // fijar mes visible del calendario
      const d = fromISO(det.fecha);
      setViewYM({ y: d.getFullYear(), m0: d.getMonth() });
    })();
  }, [id]);

  // Cuando ya tenemos cita cargada y pacientes, ubicar al paciente en su página
  useEffect(() => {
    if (!cita || pacientesFiltrados.length === 0) return;

    const idx = pacientesFiltrados.findIndex(
      (p) => Number(p.id_paciente) === cita.id_paciente
    );

    if (idx >= 0) {
      const newPage = Math.floor(idx / PAGE_SIZE) + 1;
      setPage(newPage);
    }
  }, [cita, pacientesFiltrados]);

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

        // 1) Bloqueos del odontólogo (ya expandidos)
        for (const iso of bOdo.data ?? []) {
          map[iso] = { scope: "odo", motivo: null };
        }

        // 2) Bloqueos globales (grupos)
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
            // expandir rango real
            let d = fromISO(g.fecha_inicio);
            const end = fromISO(g.fecha_fin);
            while (d <= end) {
              const iso = toISODate(d);
              if (iso >= from && iso <= to) {
                if (!map[iso]) map[iso] = { scope: "global", motivo };
                else if (!map[iso].motivo) map[iso].motivo = motivo;
              }
              d.setDate(d.getDate() + 1);
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

  /* ------- Preseleccionar consultorio por defecto del odontólogo si no hay ------- */
  useEffect(() => {
    if (!odo) {
      setConsultorio("");
      return;
    }
    if (!consultorios.length) return;

    // si ya hay uno válido y activo, respétalo
    if (consultorio) {
      const actual = consultorios.find((c) => c.id === consultorio);
      if (actual && actual.estado) return;
    }
    const defId = odoInfo?.consultorioDefaultId ?? null;
    const defActivo = defId
      ? consultorios.some((c) => c.id === defId && c.estado)
      : false;
    const target = defActivo
      ? defId!
      : consultorios.find((c) => c.estado)?.id ?? "";
    setConsultorio(target as number | "");
  }, [odo, odoInfo, consultorios]);

  /* ------- Generar horas disponibles (igual que Agendar, con tolerancia a la hora original) ------- */
  useEffect(() => {
    (async () => {
      if (!odo || !fecha || !consultorio) {
        setHorasDisp([]);
        return;
      }
      if (!horarios.length || horariosLoading || bloqsLoading) {
        setHorasDisp([]);
        return;
      }
      setLoadingSlots(true);
      try {
        const originalHHMM = (cita?.hora || "").slice(0, 5);

        // 1) Slots base por horarios vigentes (intervalos 1h, sin almuerzo)
        const dow = dowMonday0(fecha);
        const intervals = (horarios || [])
          .filter((h) => {
            const n = Number(h.dia_semana);
            if (!Number.isFinite(n) || h.vigente === false) return false;
            const mon0 = ((n % 7) + 7) % 7;
            return mon0 === dow;
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

        // No mostrar horas pasadas de hoy (pero mantener visible la hora original)
        if (isToday(fecha)) {
          const now = new Date();
          const cur = now.getHours() * 60 + (now.getMinutes() > 0 ? 60 : 0);
          for (const s of Array.from(baseSlots)) {
            if (s !== originalHHMM && timeToMinutes(s) < cur)
              baseSlots.delete(s);
          }
        }

        // Si la fecha está bloqueada y NO es la original => no hay slots
        const isBlocked = !!bloqueosMap[fecha];
        if (isBlocked && fecha !== cita?.fecha) {
          setHorasDisp([]);
          setHoraSel("");
          return;
        }

        // 2) Disponibilidad del backend
        const params: any = {
          fecha,
          id_odontologo: odo,
          id_consultorio: consultorio,
          // Ideal: exclude_id: cita?.id_cita (si el backend lo soporta)
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

        // Asegurar que la hora original esté disponible si coincide contexto
        if (
          originalHHMM &&
          fecha === cita?.fecha &&
          Number(odo) === cita?.id_odontologo &&
          Number(consultorio) === (cita?.id_consultorio ?? consultorio)
        ) {
          if (!intersec.includes(originalHHMM)) intersec.push(originalHHMM);
        }

        intersec.sort();
        setHorasDisp(intersec);
        setHoraSel((prev) =>
          prev && intersec.includes(prev)
            ? prev
            : originalHHMM && intersec.includes(originalHHMM)
            ? originalHHMM
            : ""
        );
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
    cita?.fecha,
    cita?.hora,
    cita?.id_odontologo,
    cita?.id_consultorio,
  ]);

  /* ------- Deshabilitar fechas (según horarios, bloqueos y pasado — con tolerancia a la original) ------- */
  const disabledDate = (iso: string) => {
    if (!odo) return true;
    if (horariosLoading || bloqsLoading) return true;
    if (!horarios || horarios.length === 0) return true;

    const dow = dowMonday0(iso);
    const diasServer = horarios
      .filter((h) => h && h.vigente !== false)
      .map((h) => Number(h.dia_semana))
      .filter((n) => Number.isFinite(n));
    const diasMon = new Set(diasServer.map((n) => ((n % 7) + 7) % 7));

    const habilitadoPorHorarios = diasMon.has(dow);
    const isOriginalDate = iso === cita?.fecha;

    if (!habilitadoPorHorarios && !isOriginalDate) return true;

    // bloqueado (global u odo), salvo si es la fecha original
    if (bloqueosMap[iso] && !isOriginalDate) return true;

    const hoyISO = toISODate(new Date());
    // pasado, salvo fecha original
    if (fromISO(iso) < fromISO(hoyISO) && !isOriginalDate) return true;

    return false;
  };

  /* ------- Guardar cambios (PUT) ------- */
  async function guardar() {
    if (
      !id ||
      !pacSel ||
      !odo ||
      !consultorio ||
      !fecha ||
      !horaSel ||
      !motivo.trim()
    )
      return;
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
        estado: normalizeEstado(estado),
      };

      await api.put(`/citas/${id}/`, payload);
      
      // Mostrar toast de éxito
      setShowSuccess(true);
      
      // Redirigir al detalle de la cita después de 1 segundo
      setTimeout(() => {
        navigate(`/admin/citas/${id}`);
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
        "No se pudo actualizar la cita.";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }

  /* ------- Sincronizar selección de paciente cuando cargan catálogos ------- */
  useEffect(() => {
    if (!cita || pacSel?.id) return;
    const p = pacientes.find((x) => Number(x.id_paciente) === cita.id_paciente);
    if (p) {
      setPacSel({
        id: Number(p.id_paciente),
        cedula: p.cedula,
        nombre: `${p.primer_nombre} ${p.segundo_nombre ?? ""} ${
          p.primer_apellido
        } ${p.segundo_apellido ?? ""}`.trim(),
      });
    }
  }, [cita, pacientes, pacSel?.id]);

  if (!cita) return <div className="p-4">Cargando cita…</div>;

  const bloqueadosDelMes = Object.keys(bloqueosMap).length;

  /* ==================== UI ==================== */
  return (
    <div className="space-y-6">
      {/* Toast éxito */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
            <div className="font-semibold">¡Cita actualizada correctamente!</div>
            <div className="text-sm text-white/90">Redirigiendo…</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Título sin id */}
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Pencil className="w-6 h-6" />
          Editar cita
        </h1>
        <div className="flex gap-2">
          <button
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
            onClick={handleCancel}
          >
            Cancelar
          </button>

          <button
            className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:bg-black/80 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={guardar}
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
                : "Guardar cambios"
            }
          >
            {submitting ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* --- Columna izquierda: Paciente (tabla completa) --- */}
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
            </div>
          )}
        </div>

        {/* --- Columna derecha: Detalles --- */}
        <div className="rounded-xl bg-white shadow p-4 space-y-4">
          <h2 className="font-semibold">2) Detalles de la cita</h2>

          {/* Odontólogo */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Odontólogo</label>
            <select
              className="border rounded-lg px-3 py-2 bg-white"
              value={odo}
              onChange={(e) =>
                setOdo(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">Selecciona un odontólogo…</option>
              {odontologos.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}{" "}
                  {o.especialidades?.length
                    ? `— ${o.especialidades.join(", ")}`
                    : ""}
                </option>
              ))}
            </select>

            {odoInfo?.especialidad && (
              <div className="text-xs text-gray-600">
                Especialidad principal: <b>{odoInfo.especialidad}</b>
              </div>
            )}
          </div>

          {/* Fecha */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Fecha</label>
            {horariosLoading ? (
              <div className="text-sm text-gray-500">Cargando calendario…</div>
            ) : (
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
            )}
            {!odo ? (
              <div className="text-xs text-gray-500">
                Selecciona un odontólogo para habilitar el calendario.
              </div>
            ) : bloqsLoading ? (
              <div className="text-xs text-gray-500">Cargando bloqueos…</div>
            ) : (
              bloqueadosDelMes > 0 && (
                <div className="text-xs text-gray-500">
                  Este mes tiene <b>{bloqueadosDelMes}</b> día(s) bloqueado(s).
                </div>
              )
            )}
          </div>

          {/* Consultorio */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Consultorio</label>
            <select
              className="border rounded-lg px-3 py-2 bg-white"
              value={consultorio}
              onChange={(e) =>
                setConsultorio(e.target.value ? Number(e.target.value) : "")
              }
              disabled={!odo}
            >
              <option value="">Selecciona consultorio…</option>
              {consultorios
                .filter((c) => c.estado)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              {consultorios
                .filter((c) => !c.estado)
                .map((c) => (
                  <option key={c.id} value={c.id} disabled>
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
          {odo && bloqueosMap[fecha] && fecha !== cita.fecha && (
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
            ) : horasDisp.length === 0 ? (
              <div className="text-sm text-red-600">
                {bloqueosMap[fecha] && fecha !== cita.fecha
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
                    {morning.map((h) => (
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
                    {afternoon.length === 0 && (
                      <div className="text-xs text-gray-500">Sin horarios.</div>
                    )}
                    {afternoon.map((h) => (
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
                * No se muestran horas pasadas de hoy (se mantiene visible la
                hora original de esta cita).
              </div>
            )}
          </div>

          {/* Estado */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">Estado</label>
            <select
              className="border rounded-lg px-3 py-2 bg-white"
              value={estado}
              onChange={(e) =>
                setEstado(normalizeEstado(e.target.value) as CitaDet["estado"])
              }
            >
              <option value="pendiente">Pendiente</option>
              <option value="confirmada">Confirmada</option>
              <option value="realizada">Realizada</option>
              <option value="cancelada">Cancelada</option>
              <option value="mantenimiento">Mantenimiento</option>
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
