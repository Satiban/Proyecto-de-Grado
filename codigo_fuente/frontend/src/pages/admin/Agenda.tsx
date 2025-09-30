// src/pages/admin/Agenda.tsx
import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/axios";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  CalendarPlus,
  Eye,
  Pencil,
} from "lucide-react";

/* ===== Tipos ===== */
type Opcion = { id: number; nombre: string };
type OdontologoOpt = Opcion & { especialidades?: string[] };

type Cita = {
  id_cita: number;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM:SS
  hora_inicio?: string; // HH:MM
  motivo?: string | null;
  estado:
    | "pendiente"
    | "confirmada"
    | "cancelada"
    | "realizada"
    | "mantenimiento";
  id_odontologo: number;
  id_paciente: number;
  paciente_nombre?: string;
  paciente_cedula?: string;
  odontologo_nombre?: string;
  consultorio?: { id_consultorio: number; numero: string };
};

type DiaMeta = {
  lleno: boolean;
  slots_totales: number;
  slots_ocupados: number;
  bloqueado?: boolean;
  motivo_bloqueo?: string | null;
};

type HorarioVigente = {
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  vigente?: boolean;
};

type ConsultorioOpt = { id: number; nombre: string; estado: boolean };

type ResumenDia = {
  total_citas: number;
  slots_totales: number;
  slots_ocupados: number;
  lleno: boolean;
  bloqueado: boolean;
};

/* ===== Constantes / helpers ===== */
const ESTADOS = [
  { value: "", label: "Estados" },
  { value: "pendiente", label: "Pendiente" },
  { value: "confirmada", label: "Confirmada" },
  { value: "cancelada", label: "Cancelada" },
  { value: "realizada", label: "Realizada" },
  { value: "mantenimiento", label: "Mantenimiento" },
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromISO = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};
const hhmm = (h: number) => `${pad2(h)}:00`;

function addDays(iso: string, days: number) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}
function lastDayOfMonth(year: number, month1: number) {
  return new Date(year, month1, 0).getDate();
}

// --- Helpers de normalización y fechas ---
function normalizeDias(dias: number[]): number[] {
  if (!dias || dias.length === 0) return [];
  const hasZero = dias.some((d) => d === 0);
  const allInZeroSix = dias.every((d) => d >= 0 && d <= 6);
  if (hasZero || allInZeroSix) return dias; // ya están 0..6
  return dias.map((d) => (d - 1 + 7) % 7);
}
function dowMonday0(iso: string) {
  const d = fromISO(iso);
  return (d.getDay() + 6) % 7; // 0=Lun..6=Dom
}

/* ====== Calendario popover con Mes/Año + badges ====== */
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
  dayBadge,
  onMonthVisible,
}: {
  date: string;
  onChange: (iso: string) => void;
  disabledDate?: (iso: string) => boolean;
  dayBadge?: (iso: string) => "bloqueado" | number | null;
  onMonthVisible?: (year: number, month0: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromISO(date);
  const [cursor, setCursor] = useState<Date>(
    new Date(selected.getFullYear(), selected.getMonth(), 1)
  );
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

  // Notificar mes visible (al abrir y cuando cambie)
  useEffect(() => {
    if (open && onMonthVisible)
      onMonthVisible(cursor.getFullYear(), cursor.getMonth());
  }, [open, cursor, onMonthVisible]);

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

  function setCursorAndNotify(y: number, m0: number) {
    const n = new Date(y, m0, 1);
    setCursor(n);
    if (onMonthVisible) onMonthVisible(n.getFullYear(), n.getMonth());
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
      >
        <CalendarDays className="w-4 h-4" />
        <span className="font-medium">{date}</span>
        <ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-80 rounded-xl border bg-white shadow-lg p-3">
          <div className="flex items-center justify-between mb-2 gap-2">
            <button
              onClick={() =>
                setCursorAndNotify(cursor.getFullYear(), cursor.getMonth() - 1)
              }
              className="px-2 py-1 rounded-lg hover:bg-gray-100"
              aria-label="Mes anterior"
            >
              ◀
            </button>

            <div className="flex items-center gap-2">
              <select
                className="border rounded-lg px-2 py-1"
                value={cursor.getMonth()}
                onChange={(e) =>
                  setCursorAndNotify(
                    cursor.getFullYear(),
                    Number(e.target.value)
                  )
                }
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
                onChange={(e) =>
                  setCursorAndNotify(Number(e.target.value), cursor.getMonth())
                }
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() =>
                setCursorAndNotify(cursor.getFullYear(), cursor.getMonth() + 1)
              }
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
              const badge = dayBadge?.(iso) ?? null;
              const sel = isSameDay(d, selected);
              return (
                <button
                  key={i}
                  onClick={() => pick(d)}
                  disabled={disabled}
                  title={iso}
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
                  {typeof badge === "number" && badge > 0 && (
                    <span className="absolute top-1 right-1 text-[10px] px-1 rounded bg-gray-800 text-white">
                      {badge}
                    </span>
                  )}
                  {badge === "bloqueado" && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-red-600" />
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

function AccionesCita({ id }: { id: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <Link
        to={`/admin/citas/${id}`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Ver detalles"
      >
        <Eye className="size-4" />
        Ver
      </Link>

      <Link
        to={`/admin/citas/${id}/editar`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Editar"
      >
        <Pencil className="size-4" />
        Editar
      </Link>
    </div>
  );
}

/* ====== Agenda (lista del día) — Admin ====== */
export default function Agenda() {
  const navigate = useNavigate();

  /* ------- Estado principal ------- */
  const [fecha, setFecha] = useState<string>(() => toISODate(new Date()));
  const [odontologos, setOdontologos] = useState<OdontologoOpt[]>([]);
  const [consultorios, setConsultorios] = useState<ConsultorioOpt[]>([]);
  const [fOdonto, setFOdonto] = useState<number | "">("");
  const [fConsul, setFConsul] = useState<number | "">("");
  const [fEstado, setFEstado] = useState<string>("");

  const [citas, setCitas] = useState<Cita[]>([]);
  const [openModalMantenimiento, setOpenModalMantenimiento] = useState(false);
  const [citasMantenimiento, setCitasMantenimiento] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(false);

  // Reglas / info calendario
  const [diasHabiles, setDiasHabiles] = useState<number[]>([]);
  const [bloqueos, setBloqueos] = useState<string[]>([]);
  const [metaDia, setMetaDia] = useState<DiaMeta | null>(null);
  const [resumenMes, setResumenMes] = useState<Record<string, ResumenDia>>({});

  // Cache de meses (para no repetir llamadas)
  const fetchedMonthsRef = useRef<Set<string>>(new Set());
  // Evita peticiones duplicadas para el mismo (año, mes) mientras están en vuelo
  const inflightMonthsRef = useRef<Map<string, Promise<void>>>(new Map());

  // Mapa id→nombre para odontólogos
  const odontoNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const o of odontologos) m.set(o.id, o.nombre);
    return m;
  }, [odontologos]);

  // Grilla fija 09:00 → 21:00 (sin 13 y 14)
  const horas = useMemo(() => {
    const arr: string[] = [];
    for (let h = 9; h <= 21; h++) {
      if (h === 13 || h === 14) continue;
      arr.push(hhmm(h));
    }
    return arr;
  }, []);

  // Indexar citas por HH:MM
  const citasByHora = useMemo(() => {
    const map = new Map<string, Cita[]>();
    for (const c of citas) {
      const key = c.hora_inicio ?? (c.hora ? c.hora.slice(0, 5) : "");
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        const na = a.consultorio?.numero ?? "";
        const nb = b.consultorio?.numero ?? "";
        if (na !== nb) return String(na).localeCompare(String(nb));
        return a.id_odontologo - b.id_odontologo;
      });
      map.set(k, arr);
    }
    return map;
  }, [citas]);

  function goHoy() {
    setFecha(toISODate(new Date()));
  }
  function goAgendar() {
    const qs = new URLSearchParams();
    qs.set("fecha", fecha);
    if (fOdonto) qs.set("id_odontologo", String(fOdonto));
    if (fConsul) qs.set("id_consultorio", String(fConsul));
    navigate(`/admin/agenda/agendar?${qs.toString()}`);
  }
  function goAyer() {
    setFecha((prev) => addDays(prev, -1));
  }
  function goManiana() {
    setFecha((prev) => addDays(prev, +1));
  }
  function onDownloadCsvMantenimiento() {
    const headers = ["ID", "Paciente", "Odontólogo", "Fecha", "Hora", "Motivo"];
    const rows = citasMantenimiento.map((c) => [
      c.id_cita,
      c.paciente_nombre ?? `#${c.id_paciente}`,
      c.odontologo_nombre ?? `#${c.id_odontologo}`,
      c.fecha,
      c.hora_inicio ?? c.hora.slice(0, 5),
      c.motivo ?? "—",
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "citas_mantenimiento.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // catálogos
  useEffect(() => {
    (async () => {
      const [od, co] = await Promise.all([
        api.get("/odontologos/?page_size=1000"),
        api.get("/consultorios/?page_size=1000"),
      ]);

      const odList: OdontologoOpt[] = (od.data.results ?? od.data).map(
        (o: any) => ({
          id: o.id_odontologo,
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
        })
      );

      const coList = (co.data.results ?? co.data).map((c: any) => ({
        id: c.id_consultorio,
        nombre: `Consultorio ${c.numero}`,
        estado: !!c.estado,
      }));

      setOdontologos(odList);
      setConsultorios(coList);
    })();
  }, []);

  // Cargar citas del día
  async function fetchCitas() {
    setLoading(true);
    try {
      const params: any = { fecha, ordering: "hora" };
      if (fOdonto) params.id_odontologo = fOdonto;
      if (fConsul) params.id_consultorio = fConsul;
      if (fEstado) params.estado = fEstado;

      const res = await api.get("/citas/", { params });
      setCitas(res.data.results ?? res.data);
    } finally {
      setLoading(false);
    }
  }

  // Meta del día (lleno / bloqueado / motivo / slots)
  async function fetchMetaDia() {
    try {
      const params: any = { fecha };
      if (fOdonto) params.id_odontologo = fOdonto;
      if (fConsul) params.id_consultorio = fConsul;
      const r = await api.get("/citas/dia-metadata/", { params });
      setMetaDia(r.data);
    } catch {
      setMetaDia(null);
    }
  }

  // Traer todas las citas en mantenimiento (sin importar la fecha)
  async function fetchCitasMantenimiento() {
    try {
      const res = await api.get("/citas/", {
        params: { estado: "mantenimiento" },
      });
      setCitasMantenimiento(res.data.results ?? res.data);
    } catch {
      setCitasMantenimiento([]);
    }
  }

  const refetchDayTimer = useRef<number | null>(null);
  function refetchDay() {
    if (refetchDayTimer.current) window.clearTimeout(refetchDayTimer.current);
    refetchDayTimer.current = window.setTimeout(() => {
      fetchCitas();
      fetchMetaDia();
    }, 120);
  }
  // Utilidades de mes (cache)
  const ymKey = (y: number, m1: number) => `${y}-${pad2(m1)}`;
  const ymAdd = (y: number, m1to12: number, delta: number) => {
    const d0 = new Date(y, m1to12 - 1 + delta, 1);
    return { y: d0.getFullYear(), m: d0.getMonth() + 1 };
  };

  // 🔁 Reset de caché al cambiar filtros que afectan el calendario
  function resetMonthCaches() {
    fetchedMonthsRef.current = new Set();
    setResumenMes({});
    setBloqueos([]);
  }

  // Traer bloqueos + resumen del mes y fusionar estado
  async function fetchMonthData(y: number, m1: number) {
    const last = lastDayOfMonth(y, m1);

    // Globales (y si backend soporta ?id_odontologo aquí, ya vienen fusionados)
    const promGlobal = api.get(`/citas/bloqueos-mes`, {
      params: {
        from: `${y}-${pad2(m1)}-01`,
        to: `${y}-${pad2(m1)}-${pad2(last)}`,
        ...(fOdonto ? { id_odontologo: fOdonto } : {}),
      },
    });

    // Individuales por odontólogo (asegura visibles aunque /citas/bloqueos-mes no los incluya)
    const promIndiv = fOdonto
      ? api.get(`/odontologos/${fOdonto}/bloqueos/`, {
          params: {
            from: `${y}-${pad2(m1)}-01`,
            to: `${y}-${pad2(m1)}-${pad2(last)}`,
            include: "all",
          },
        })
      : Promise.resolve({ data: [] });

    const promResumen = api.get(`/citas/resumen-mensual/`, {
      params: {
        year: y,
        month: m1,
        ...(fOdonto ? { id_odontologo: fOdonto } : {}),
        ...(fConsul ? { id_consultorio: fConsul } : {}),
      },
    });

    const [bGlobal, bIndiv, rm] = await Promise.all([
      promGlobal,
      promIndiv,
      promResumen,
    ]);

    // Merge bloqueos (admite [{fecha,...}] o ["YYYY-MM-DD"])
    setBloqueos((prev) => {
      const set = new Set(prev);
      const listG = Array.isArray(bGlobal.data)
        ? bGlobal.data.map((x: any) => (typeof x === "string" ? x : x?.fecha))
        : [];
      const listI = Array.isArray(bIndiv.data)
        ? bIndiv.data.map((x: any) => (typeof x === "string" ? x : x?.fecha))
        : [];
      [...listG, ...listI]
        .filter(Boolean)
        .forEach((iso: string) => set.add(iso));
      return Array.from(set);
    });

    // Merge resumen
    setResumenMes((prev) => ({ ...prev, ...(rm.data ?? {}) }));
  }

  // Garantiza cache del mes visible y vecinos
  async function ensureMonthCached(y: number, m0: number) {
    const around = [-1, 0, +1].map((off) => ymAdd(y, m0 + 1, off));

    const promises: Promise<void>[] = [];

    for (const { y: yy, m } of around) {
      const key = ymKey(yy, m);

      // Ya cacheado: nada que hacer
      if (fetchedMonthsRef.current.has(key)) continue;

      // Si ya hay una promesa en vuelo para este mes, úsala
      const existing = inflightMonthsRef.current.get(key);
      if (existing) {
        promises.push(existing);
        continue;
      }

      // Crea y registra la promesa en vuelo
      const p = (async () => {
        try {
          await fetchMonthData(yy, m);
          fetchedMonthsRef.current.add(key);
        } finally {
          inflightMonthsRef.current.delete(key);
        }
      })();

      inflightMonthsRef.current.set(key, p);
      promises.push(p);
    }

    if (promises.length) await Promise.all(promises);
  }

  // Horarios vigentes para deshabilitar fechas (solo si hay odontólogo)
  async function fetchHorarios() {
    if (!fOdonto) {
      setDiasHabiles([]);
      return;
    }
    const h = await api.get(`/odontologos/${fOdonto}/horarios_vigentes/`);
    const hv = (h.data as HorarioVigente[]) ?? [];
    setDiasHabiles(normalizeDias(hv.map((x) => x.dia_semana)));
  }

  // Carga inicial + cuando cambian fecha/estado (no rompen caché)
  useEffect(() => {
    refetchDay();
    fetchHorarios();
    fetchCitasMantenimiento(); // 👈 nuevo
    const d = fromISO(fecha);
    ensureMonthCached(d.getFullYear(), d.getMonth());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, fEstado]);

  // Al cambiar filtros que alteran el universo (odontólogo / consultorio) → reset cache
  const skipFirstFiltersRef = useRef(true);
  useEffect(() => {
    if (skipFirstFiltersRef.current) {
      skipFirstFiltersRef.current = false;
      return; // evita duplicado en el primer render
    }

    resetMonthCaches();
    fetchHorarios();
    const d = fromISO(fecha);
    ensureMonthCached(d.getFullYear(), d.getMonth());
    refetchDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fOdonto, fConsul]);

  // Precarga cuando cambia el mes visible en el calendario
  const monthVisibleTimer = useRef<number | null>(null);
  const handleMonthVisible = (year: number, month0: number) => {
    if (monthVisibleTimer.current)
      window.clearTimeout(monthVisibleTimer.current);
    monthVisibleTimer.current = window.setTimeout(() => {
      ensureMonthCached(year, month0);
    }, 120);
  };

  // deshabilitar fechas
  const isDisabledDate = (iso: string) => {
    const dow = dowMonday0(iso);
    if (fOdonto) {
      const noEsDiaHabil = !diasHabiles.includes(dow);
      const estaBloqueado =
        bloqueos.includes(iso) || !!resumenMes[iso]?.bloqueado;
      return noEsDiaHabil || estaBloqueado;
    }
    if (fConsul) {
      const consulSel = consultorios.find((c) => c.id === fConsul);
      const consulInactivo = consulSel && !consulSel.estado;
      return !!consulInactivo;
    }
    return false;
  };

  // Badge del calendario: número de citas o punto rojo si bloqueado
  const dayBadge = (iso: string): "bloqueado" | number | null => {
    if (bloqueos.includes(iso) || resumenMes[iso]?.bloqueado)
      return "bloqueado";
    const cnt = resumenMes[iso]?.total_citas ?? 0;
    return cnt > 0 ? cnt : null;
  };

  const normalizeEstado = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  // dentro de Agenda()
  const estadoPill = (estado: Cita["estado"]) => {
    const n = normalizeEstado(estado);

    let cls =
      n === "pendiente"
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : n === "confirmada"
        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
        : n === "realizada"
        ? "bg-blue-100 text-blue-800 border-blue-200"
        : n === "mantenimiento"
        ? "bg-violet-100 text-violet-800 border-violet-200"
        : "bg-rose-100 text-rose-800 border-rose-200";

    const label =
      estado.charAt(0).toUpperCase() + estado.slice(1).toLowerCase();

    return (
      <span
        className={`inline-block text-xs px-2 py-1 rounded-full border ${cls}`}
      >
        {label}
      </span>
    );
  };

  // Conteo de bloqueos del mes visible (para aviso)
  const selDate = fromISO(fecha);
  const selYM = `${selDate.getFullYear()}-${pad2(selDate.getMonth() + 1)}`;
  const bloqueosMesActual = bloqueos.filter((d) => d.startsWith(selYM)).length;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">🗓️ Agenda</h1>
        <button
          onClick={goAgendar}
          title="Crear nueva cita"
          className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
        >
          <CalendarPlus className="w-4 h-4" />
          Agendar cita
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <DatePopover
          date={fecha}
          onChange={setFecha}
          disabledDate={isDisabledDate}
          dayBadge={dayBadge}
          onMonthVisible={handleMonthVisible}
        />

        <div className="flex items-center gap-1">
          <button
            className="inline-flex items-center justify-center border rounded-lg px-2 py-2 bg-white hover:bg-gray-50"
            title="Ayer"
            onClick={goAyer}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            className="inline-flex items-center justify-center border rounded-lg px-2 py-2 bg-white hover:bg-gray-50"
            title="Mañana"
            onClick={goManiana}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <button
          className="border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
          onClick={goHoy}
          title="Ir a hoy"
        >
          Hoy
        </button>

        <select
          className="border rounded-lg px-3 py-2 bg-white"
          value={fOdonto}
          onChange={(e) =>
            setFOdonto(e.target.value ? Number(e.target.value) : "")
          }
        >
          <option value="">Odontólogos</option>
          {odontologos.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre}
              {o.especialidades?.length
                ? ` — ${o.especialidades.join(", ")}`
                : ""}
            </option>
          ))}
        </select>

        <select
          className="border rounded-lg px-3 py-2 bg-white"
          value={fConsul}
          onChange={(e) =>
            setFConsul(e.target.value ? Number(e.target.value) : "")
          }
        >
          <option value="">Consultorios</option>
          {consultorios.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} {c.estado ? "" : "(inactivo)"}
            </option>
          ))}
        </select>

        <select
          className="border rounded-lg px-3 py-2 bg-white"
          value={fEstado}
          onChange={(e) => setFEstado(e.target.value)}
        >
          {ESTADOS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <button
          className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
          onClick={() => {
            setFOdonto("");
            setFConsul("");
            setFEstado("");
          }}
          title="Limpiar filtros"
        >
          <Eraser className="w-4 h-4" />
          <span>Limpiar</span>
        </button>
      </div>

      {/* Avisos */}
      {fOdonto && (
        <div className="rounded-lg border bg-blue-50 text-blue-900 px-3 py-2 text-sm flex items-center gap-2">
          <CalendarDays className="w-4 h-4" />
          <span>
            Este odontólogo atiende:{" "}
            <b>
              {(() => {
                const map = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
                return normalizeDias(diasHabiles)
                  .sort((a, b) => a - b)
                  .map((i) => map[i])
                  .join(", ");
              })() || "—"}
            </b>
            {bloqueosMesActual ? (
              <>
                {" "}
                · Días bloqueados este mes: <b>{bloqueosMesActual}</b>
              </>
            ) : null}
          </span>
        </div>
      )}
      {(() => {
        const csel = fConsul
          ? consultorios.find((c) => c.id === fConsul)
          : null;
        return csel && !csel.estado ? (
          <div className="rounded-lg border bg-amber-50 text-amber-900 px-3 py-2 text-sm">
            El {csel.nombre} está <b>inactivo</b>. No se pueden agendar citas.
          </div>
        ) : null;
      })()}
      {metaDia?.lleno && (
        <div className="rounded-lg border bg-red-50 text-red-900 px-3 py-2 text-sm">
          Día <b>{fecha}</b> lleno ({metaDia.slots_ocupados}/
          {metaDia.slots_totales}).
        </div>
      )}
      {metaDia?.bloqueado && (
        <div className="rounded-lg border bg-red-50 text-red-900 px-3 py-2 text-sm">
          Día <b>{fecha}</b> <b>bloqueado</b>
          {metaDia.motivo_bloqueo ? (
            <>
              : <i>{metaDia.motivo_bloqueo}</i>
            </>
          ) : (
            "."
          )}
        </div>
      )}

      {/* Aviso de citas en mantenimiento */}
      {citasMantenimiento.length > 0 && (
        <div className="rounded-lg border bg-purple-50 text-purple-900 px-3 py-2 text-sm flex items-center justify-between">
          <span>
            Existen <b>{citasMantenimiento.length}</b> cita(s) en estado{" "}
            <b>Mantenimiento</b>. Por favor contacte con los pacientes u
            odontólogos para ajustar estas citas.
          </span>
          <button
            onClick={() => setOpenModalMantenimiento(true)}
            className="ml-4 px-3 py-1 rounded-lg border bg-white hover:bg-gray-50 text-sm"
          >
            Ver citas con este estado
          </button>
        </div>
      )}

      {/* Tabla */}
      <div className="rounded-xl bg-white shadow-md overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">Citas del {fecha}</h2>
          <div className="text-sm text-gray-500">
            {loading ? "Cargando…" : `${citas.length} cita(s)`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-100 text-black font-bold">
              <tr className="border-b border-black">
                <th className="py-2 px-3 w-24 text-center">Hora</th>
                <th className="py-2 px-3 text-center">Paciente</th>
                <th className="py-2 px-3 text-center">Motivo</th>
                <th className="py-2 px-3 text-center">Odontólogo</th>
                <th className="py-2 px-3 text-center">Consultorio</th>
                <th className="py-2 px-3 text-center">Estado</th>
                <th className="py-2 px-3 text-center w-40">Acción</th>
              </tr>
            </thead>

            <tbody>
              {horas.map((h) => {
                const lista = citasByHora.get(h) ?? [];

                if (lista.length > 0) {
                  const first = lista[0];
                  const rest = lista.slice(1);

                  return (
                    <Fragment key={h}>
                      <tr className="border-b border-gray-200">
                        <td
                          className="py-2 px-3 font-medium align-top text-center"
                          rowSpan={lista.length}
                        >
                          {h}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <div className="font-medium">
                            {first.paciente_nombre ?? `#${first.id_paciente}`}
                          </div>
                          <div className="text-xs">{first.paciente_cedula}</div>
                        </td>
                        <td className="py-2 px-3 text-center">
                          {first.motivo ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {first.odontologo_nombre ??
                            odontoNameById.get(first.id_odontologo) ??
                            `#${first.id_odontologo}`}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {first.consultorio
                            ? `Cons. ${first.consultorio.numero}`
                            : "—"}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {estadoPill(first.estado)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <AccionesCita id={first.id_cita} />
                        </td>
                      </tr>

                      {rest.map((cita, idx) => {
                        return (
                          <tr
                            key={`${h}-sub-${idx}`}
                            className="border-b border-gray-200"
                          >
                            <td className="py-2 px-3 text-center">
                              <div className="font-medium">
                                {cita.paciente_nombre ?? `#${cita.id_paciente}`}
                              </div>
                              <div className="text-xs">
                                {cita.paciente_cedula}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-center">
                              {cita.motivo ?? "—"}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {cita.odontologo_nombre ??
                                odontoNameById.get(cita.id_odontologo) ??
                                `#${cita.id_odontologo}`}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {cita.consultorio
                                ? `Cons. ${cita.consultorio.numero}`
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {estadoPill(cita.estado)}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <AccionesCita id={cita.id_cita} />
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                }

                // Fila “Libre”
                return (
                  <tr key={h} className="border-b border-gray-200">
                    <td className="py-2 px-3 font-medium text-center">{h}</td>
                    <td className="py-2 px-3 text-center">Libre</td>
                    <td className="py-2 px-3 text-center">—</td>
                    <td className="py-2 px-3 text-center">—</td>
                    <td className="py-2 px-3 text-center">—</td>
                    <td className="py-2 px-3 text-center">—</td>
                    <td className="py-2 px-3 text-center">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-500 p-4 pt-3">
          * Agenda fija de 09:00 a 21:00 (intervalos de 1h). Las 13:00–15:00 no
          se muestran.
        </p>
      </div>
      {/* Modal de citas en mantenimiento */}
      {openModalMantenimiento && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl p-4">
            <h2 className="text-lg font-semibold mb-3">
              Citas en estado Mantenimiento
            </h2>
            <table className="w-full text-sm border-collapse mb-4">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Paciente</th>
                  <th className="px-3 py-2 text-left">Odontólogo</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Hora</th>
                  <th className="px-3 py-2 text-left">Motivo</th>
                  <th className="px-3 py-2 text-left">Acción</th>
                </tr>
              </thead>
              <tbody>
                {citasMantenimiento.map((c) => (
                  <tr key={c.id_cita} className="border-t">
                    <td className="px-3 py-1">
                      {c.paciente_nombre ?? `#${c.id_paciente}`}
                    </td>
                    <td className="px-3 py-1">
                      {c.odontologo_nombre ?? `#${c.id_odontologo}`}
                    </td>
                    <td className="px-3 py-1">{c.fecha}</td>
                    <td className="px-3 py-1">
                      {c.hora_inicio ?? c.hora.slice(0, 5)}
                    </td>
                    <td className="px-3 py-1">{c.motivo ?? "—"}</td>
                    <td className="px-3 py-1">
                      <Link
                        to={`/admin/citas/${c.id_cita}/editar`}
                        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm hover:bg-gray-50"
                      >
                        <Pencil className="size-4" />
                        Editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end gap-2">
              <button
                onClick={onDownloadCsvMantenimiento}
                className="px-3 py-2 rounded-lg border bg-gray-100 hover:bg-gray-200 text-sm"
              >
                Descargar CSV
              </button>
              <button
                onClick={() => setOpenModalMantenimiento(false)}
                className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
