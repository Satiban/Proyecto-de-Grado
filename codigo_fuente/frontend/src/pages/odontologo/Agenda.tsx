// src/pages/odontologo/Agenda.tsx
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
  Stethoscope,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "react-router-dom";

/* ===== Tipos ===== */
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
  pago?: {
    id_pago_cita: number;
    estado_pago: "pendiente" | "pagado" | "reembolsado";
    monto?: string;
  } | null;
};

type HorarioVigente = {
  dia_semana: number; // 0=Lun..6=Dom
  hora_inicio: string;
  hora_fin: string;
  vigente?: boolean;
};

type ConsultorioOpt = { id: number; nombre: string; estado: boolean };

type DiaMeta = {
  slots_totales: number;
  slots_ocupados: number;
  lleno: boolean;
  bloqueado: boolean;
  motivo_bloqueo?: string | null;
};

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
const endOfMonthDay = (year: number, month1to12: number) =>
  new Date(year, month1to12, 0).getDate();

function addDays(iso: string, days: number) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}
const normalizeEstado = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

function isDiaLaboral(iso: string, horarios: HorarioVigente[]): boolean {
  if (!horarios?.length) return false;
  const dow = (fromISO(iso).getDay() + 6) % 7; // lunes=0
  return horarios.some((h) => h.dia_semana === dow && h.vigente !== false);
}

/* ===== Hook: click outside ===== */
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

/* ===== Calendar helpers ===== */
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
  dayBadge,
  onMonthVisible,
}: {
  date: string;
  onChange: (iso: string) => void;
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

  useEffect(() => {
    if (onMonthVisible) onMonthVisible(cursor.getFullYear(), cursor.getMonth());
  }, [cursor, onMonthVisible]);

  const grid = buildGrid(cursor.getFullYear(), cursor.getMonth());
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  function pick(d: Date) {
    const iso = toISODate(d);
    onChange(iso);
    setOpen(false);
  }
  function setCursorAndNotify(y: number, m0: number) {
    setCursor(new Date(y, m0, 1));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && onMonthVisible) {
            onMonthVisible(cursor.getFullYear(), cursor.getMonth());
          }
        }}
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
              const sel = isSameDay(d, selected);
              const badge = dayBadge?.(iso) ?? null;
              return (
                <button
                  key={i}
                  onClick={() => pick(d)}
                  className={[
                    "relative aspect-square rounded-lg text-sm border",
                    muted ? "text-gray-400" : "text-gray-800",
                    sel ? "bg-blue-600 text-white border-blue-600" : "bg-white",
                    "hover:bg-gray-50",
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

function AccionesCita({ cita, fecha }: { cita: Cita; fecha: string }) {
  const { id_cita, estado } = cita;

  return (
    <div className="flex items-center justify-center gap-2">
      {/* Pendiente - solo Ver */}
      {estado === "pendiente" && (
        <Link
          to={`/odontologo/citas/${id_cita}/ver`}
          state={{ fecha }}
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        >
          <Eye className="size-4" /> Ver
        </Link>
      )}

      {/* Confirmada - Ver y Atender */}
      {estado === "confirmada" && (
        <>
          <Link
            to={`/odontologo/citas/${id_cita}/ver`}
            state={{ fecha }}
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
          >
            <Eye className="size-4" /> Ver
          </Link>
          <Link
            to={`/odontologo/citas/${id_cita}/atencion`}
            state={{ fecha }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <Stethoscope className="size-4" /> Atender
          </Link>
        </>
      )}

      {/* Cancelada - solo Ver */}
      {estado === "cancelada" && (
        <Link
          to={`/odontologo/citas/${id_cita}/ver`}
          state={{ fecha }}
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        >
          <Eye className="size-4" /> Ver
        </Link>
      )}

      {/* Mantenimiento - solo Editar */}
      {estado === "mantenimiento" && (
        <Link
          to={`/odontologo/citas/${id_cita}/editar`}
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        >
          <Pencil className="size-4" /> Editar
        </Link>
      )}

      {/* Realizada - solo Ver */}
      {estado === "realizada" && (
        <Link
          to={`/odontologo/citas/${id_cita}/ver`}
          state={{ fecha }}
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        >
          <Eye className="size-4" /> Ver
        </Link>
      )}
    </div>
  );
}

/* ===== Main ===== */
export default function Agenda() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const location = useLocation();
  const [fecha, setFecha] = useState<string>(() => {
    const state = location.state as any;
    return state?.fechaNueva || state?.fecha || toISODate(new Date());
  });

  const odontologoId: number | null =
    (usuario as any)?.odontologo?.id_odontologo ??
    (usuario as any)?.id_odontologo ??
    null;
  const [consultorios, setConsultorios] = useState<ConsultorioOpt[]>([]);
  const [fConsul, setFConsul] = useState<number | "">("");
  const [fEstado, setFEstado] = useState<string>("");

  const [citas, setCitas] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(false);

  const [horarios, setHorarios] = useState<HorarioVigente[]>([]);
  const [bloqueos, setBloqueos] = useState<string[]>([]);
  const [metaDia, setMetaDia] = useState<DiaMeta | null>(null);
  const [resumenMes, setResumenMes] = useState<Record<string, ResumenDia>>({});
  const fetchedMonthsRef = useRef<Set<string>>(new Set());

  const horariosPorDia = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const h of horarios) {
      const list = map.get(h.dia_semana) ?? [];
      list.push(`${h.hora_inicio}–${h.hora_fin}`);
      map.set(h.dia_semana, list);
    }
    return map;
  }, [horarios]);

  const etiquetaDiaActual = useMemo(() => {
    const idx = (fromISO(fecha).getDay() + 6) % 7; // Lunes=0
    const rangos = horariosPorDia.get(idx) ?? [];
    const nombre = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][idx];
    return `${nombre}: ${rangos.length ? rangos.join(" | ") : "—"}`;
  }, [fecha, horariosPorDia]);

  /* Horas de agenda */
  const horas = useMemo(() => {
    const arr: string[] = [];
    for (let h = 9; h <= 21; h++) {
      if (h === 13 || h === 14) continue;
      arr.push(hhmm(h));
    }
    return arr;
  }, []);

  const citasByHora = useMemo(() => {
    const map = new Map<string, Cita[]>();
    for (const c of citas) {
      const key = c.hora_inicio ?? (c.hora ? c.hora.slice(0, 5) : "");
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    for (const [, arr] of map.entries()) {
      arr.sort((a, b) =>
        String(a.consultorio?.numero ?? "").localeCompare(
          String(b.consultorio?.numero ?? "")
        )
      );
    }
    return map;
  }, [citas]);

  /* Navegación */
  function goHoy() {
    setFecha(toISODate(new Date()));
  }
  function goAyer() {
    setFecha((prev) => addDays(prev, -1));
  }
  function goManiana() {
    setFecha((prev) => addDays(prev, +1));
  }
  function goAgendar() {
    const qs = new URLSearchParams();
    qs.set("fecha", fecha);
    if (odontologoId) qs.set("id_odontologo", String(odontologoId));
    if (fConsul) qs.set("id_consultorio", String(fConsul));
    navigate(`/odontologo/citas/agendar?${qs.toString()}`);
  }

  /* Consultorios y horarios (una sola vez) */
  useEffect(() => {
    if (!odontologoId) return;
    if (consultorios.length > 0 && horarios.length > 0) return;

    (async () => {
      try {
        const [coRes, hRes] = await Promise.all([
          consultorios.length === 0
            ? api.get("/consultorios/?page_size=1000")
            : null,
          horarios.length === 0
            ? api.get(`/odontologos/${odontologoId}/horarios_vigentes/`)
            : null,
        ]);

        if (coRes) {
          const coList = (coRes.data.results ?? coRes.data).map((c: any) => ({
            id: c.id_consultorio,
            nombre: `Consultorio ${c.numero}`,
            estado: !!c.estado,
          }));
          setConsultorios(coList);
        }
        if (hRes) setHorarios(hRes.data ?? []);
      } catch (err) {
        console.error("Error cargando consultorios/horarios", err);
      }
    })();
  }, [odontologoId]);

  /* Citas + metadata del día */
  async function fetchDia() {
    if (!odontologoId) return;
    setLoading(true);
    try {
      const d = fromISO(fecha);
      const params: any = {
        fecha,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        id_odontologo: odontologoId,
      };
      if (fConsul) params.id_consultorio = fConsul;
      if (fEstado) params.estado = fEstado;

      const res = await api.get("/citas/agenda-completa/", { params });

      setCitas(res.data.citas ?? []);
      setMetaDia(res.data.dia_meta ?? null);
      setResumenMes((prev) => ({ ...prev, ...(res.data.resumen_mes ?? {}) }));
      setBloqueos((prev) => {
        const set = new Set(prev);
        const nuevos = (res.data.bloqueos ?? []).map((x: any) =>
          typeof x === "string" ? x : x?.fecha
        );
        nuevos.filter(Boolean).forEach((iso: string) => set.add(iso));
        return Array.from(set);
      });
    } finally {
      setLoading(false);
    }
  }

  /* Cache de resumen mensual */
  function ymKey(y: number, m1: number, consul?: number | "", estado?: string) {
    return `${y}-${pad2(m1)}-${consul || "all"}-${estado || "all"}`;
  }

  function ymAdd(y: number, m1to12: number, delta: number) {
    const d0 = new Date(y, m1to12 - 1 + delta, 1);
    return { y: d0.getFullYear(), m: d0.getMonth() + 1 };
  }
  async function fetchMonthData(y: number, m: number) {
    if (!odontologoId) return;
    const last = endOfMonthDay(y, m);
    const [b, rm] = await Promise.all([
      api.get(`/odontologos/${odontologoId}/bloqueos/`, {
        params: {
          from: `${y}-${pad2(m)}-01`,
          to: `${y}-${pad2(m)}-${pad2(last)}`,
          include: "all",
        },
      }),
      api.get(`/citas/resumen-mensual/`, {
        params: {
          year: y,
          month: m,
          id_odontologo: odontologoId,
          ...(fConsul ? { id_consultorio: fConsul } : {}),
        },
      }),
    ]);
    setBloqueos((prev) => {
      const set = new Set(prev);
      const nuevos = (b.data ?? []).map((x: any) =>
        typeof x === "string" ? x : x?.fecha
      );
      nuevos.filter(Boolean).forEach((iso: string) => set.add(iso));
      return Array.from(set);
    });

    setResumenMes((prev) => ({ ...prev, ...(rm.data ?? {}) }));
  }
  async function ensureMonthCached(y: number, m0: number) {
    if (!odontologoId) return;
    const around = [-1, 0, +1].map((off) => ymAdd(y, m0 + 1, off));
    const toFetch = around.filter(
      ({ y, m }) => !fetchedMonthsRef.current.has(ymKey(y, m, fConsul, fEstado))
    );
    if (toFetch.length === 0) return;
    toFetch.forEach(({ y, m }) =>
      fetchedMonthsRef.current.add(ymKey(y, m, fConsul, fEstado))
    );
    await Promise.all(toFetch.map(({ y, m }) => fetchMonthData(y, m)));
  }

  /* Carga inicial */
  useEffect(() => {
    fetchDia();
    const d = fromISO(fecha);
    ensureMonthCached(d.getFullYear(), d.getMonth());
  }, [fecha, fConsul, fEstado, odontologoId]);

  const handleMonthVisible = async (year: number, month0: number) => {
    await ensureMonthCached(year, month0);
  };

  /* Badge calendario */
  const dayBadge = (iso: string): "bloqueado" | number | null => {
    if (bloqueos.includes(iso) || resumenMes[iso]?.bloqueado)
      return "bloqueado";
    const cnt = resumenMes[iso]?.total_citas ?? 0;
    return cnt > 0 ? cnt : null;
  };

  /* Estado pill */
  const estadoPill = (estado: Cita["estado"]) => {
    const n = normalizeEstado(estado);
    const cls =
      n === "pendiente"
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : n === "confirmada"
        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
        : n === "realizada"
        ? "bg-blue-100 text-blue-800 border-blue-200"
        : n === "mantenimiento"
        ? "bg-violet-100 text-violet-800 border-violet-200"
        : "bg-red-100 text-red-800 border-red-200";

    const label =
      n === "mantenimiento"
        ? "Mantenimiento"
        : estado.charAt(0).toUpperCase() + estado.slice(1).toLowerCase();

    return (
      <span
        className={`inline-block text-xs px-2 py-1 rounded-full border ${cls}`}
      >
        {label}
      </span>
    );
  };

  const estadoPagoPill = (cita: Cita) => {
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
  };

  if (!odontologoId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Agenda</h1>
        <div className="rounded-lg border bg-amber-50 text-amber-900 px-3 py-2 text-sm">
          No se pudo determinar el <b>id_odontologo</b>.
        </div>
      </div>
    );
  }

  const selDate = fromISO(fecha);
  const selYM = `${selDate.getFullYear()}-${pad2(selDate.getMonth() + 1)}`;
  const bloqueosMesActual = bloqueos.filter((d) => d.startsWith(selYM)).length;

  /* Render */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">🗓️ Agenda</h1>
        <button
          onClick={goAgendar}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
        >
          <CalendarPlus className="w-4 h-4" /> Agendar cita
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <DatePopover
          date={fecha}
          onChange={setFecha}
          dayBadge={dayBadge}
          onMonthVisible={handleMonthVisible}
        />
        <div className="flex items-center gap-1">
          <button
            onClick={goAyer}
            className="border rounded-lg px-2 py-2 bg-white hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goManiana}
            className="border rounded-lg px-2 py-2 bg-white hover:bg-gray-50"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={goHoy}
          className="border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
        >
          Hoy
        </button>
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
          onClick={() => {
            setFConsul("");
            setFEstado("");
          }}
          className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
        >
          <Eraser className="w-4 h-4" /> Limpiar
        </button>
      </div>

      <div className="rounded-lg border bg-blue-50 text-blue-900 px-3 py-2 text-sm flex items-center gap-2">
        <CalendarDays className="w-4 h-4" />
        <div className="space-y-1">
          <div>
            <span className="font-medium">Días de atención:</span>{" "}
            {(() => {
              const nombres = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
              return Array.from({ length: 7 }, (_, i) => {
                const rangos = horariosPorDia.get(i) ?? [];
                return `${nombres[i]}: ${
                  rangos.length ? rangos.join(" | ") : "—"
                }`;
              }).join(" | ");
            })()}
          </div>
          <div className="text-gray-700">
            <span className="font-medium">Horario del día seleccionado:</span>{" "}
            {etiquetaDiaActual}
          </div>
          <div className="text-gray-700">
            Días bloqueados del mes: <b>{bloqueosMesActual}</b>
          </div>
        </div>
      </div>

      {/* Banner */}
      <div
        className={[
          "rounded-lg border px-3 py-2 text-sm",
          !isDiaLaboral(fecha, horarios)
            ? "bg-red-50 text-red-900 border-red-200"
            : metaDia?.bloqueado
            ? "bg-red-50 text-red-900 border-red-200"
            : metaDia?.lleno
            ? "bg-amber-50 text-amber-900 border-amber-200"
            : "bg-emerald-50 text-emerald-900 border-emerald-200",
        ].join(" ")}
      >
        {!isDiaLaboral(fecha, horarios) ? (
          <>
            Día <b>{fecha}</b> no laboral por horario de trabajo
          </>
        ) : metaDia?.bloqueado ? (
          <>
            Día <b>{fecha}</b> bloqueado{" "}
            {metaDia.motivo_bloqueo ? `: “${metaDia.motivo_bloqueo}”` : ""}
          </>
        ) : metaDia?.lleno ? (
          <>
            Día <b>{fecha}</b> lleno: no hay más disponibilidad.
          </>
        ) : (
          <>
            Día <b>{fecha}</b> con disponibilidad.
          </>
        )}
      </div>

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
                <th className="py-2 px-3 text-center">Consultorio</th>
                <th className="py-2 px-3 text-center">Estado Cita</th>
                <th className="py-2 px-3 text-center">Estado Pago</th>
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
                          rowSpan={lista.length}
                          className="py-2 px-3 font-medium align-top text-center"
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
                          {first.consultorio
                            ? `Cons. ${first.consultorio.numero}`
                            : "—"}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {estadoPill(first.estado)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {estadoPagoPill(first)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <AccionesCita cita={first} fecha={fecha} />
                        </td>
                      </tr>
                      {rest.map((cita, idx) => (
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
                            {cita.consultorio
                              ? `Cons. ${cita.consultorio.numero}`
                              : "—"}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {estadoPill(cita.estado)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {estadoPagoPill(cita)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <AccionesCita cita={cita} fecha={fecha} />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                }
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
        <div className="border-t bg-gray-50">
          <p className="text-xs text-gray-500 p-4 pt-3">
            * Agenda fija de 09:00 a 21:00 (intervalos de 1h). Las 13:00–15:00 no
            se muestran.
          </p>
        </div>
      </div>
    </div>
  );
}
