// src/pages/paciente/AgendarCita.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/axios";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  Stethoscope,
  X as XIcon,
  AlertTriangle,
  Info,
  CalendarPlus,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

/* ==================== Tipos ==================== */
type Opcion = { id: number; nombre: string };
type OdontologoOpt = Opcion & {
  especialidades?: string[];
  especialidades_detalle?: {
    nombre: string | null;
    universidad?: string | null;
    estado?: boolean;
  }[];
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
  primer_nombre?: string;
  segundo_nombre?: string;
  primer_apellido?: string;
  segundo_apellido?: string;
  foto?: string | null;
  especialidades?: string[];
  especialidades_detalle?: {
    nombre: string | null;
    universidad?: string | null;
    estado?: boolean;
  }[];
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
  activo?: boolean;
  estado?: boolean;
  usuario_activo?: boolean;
  is_active?: boolean;
};

type Cita = {
  id_cita: number;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM:SS
  estado: "pendiente" | "confirmada" | "realizada" | "cancelada";
  cancelada_en?: string | null;
  cancelada_por_rol?: number | null;
  id_odontologo?: number;
};

/* ==================== Constantes / helpers ==================== */
const LUNCH_FROM = 13; // 13:00
const LUNCH_TO = 15; // 15:00 (exclusivo)
const MAX_MONTHS_AHEAD = 3;
const COOLDOWN_DIAS = 7;
const MAX_CITAS_SEMANA = 5;
/* NUEVO: anticipación mínima (minutos) para el mismo día */
const SAME_DAY_LEAD_MIN = 120;

const pad2 = (n: number) => String(n).padStart(2, "0");
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromISO = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};
const addMonthsISO = (iso: string, months: number) => {
  const d = fromISO(iso);
  d.setMonth(d.getMonth() + months);
  return toISODate(d);
};
const addDaysISO = (iso: string, days: number) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};
const timeToMinutes = (t: string) => {
  const [H, M] = t.split(":").map(Number);
  return (H ?? 0) * 60 + (M ?? 0);
};
const minutesToHHMM = (m: number) =>
  `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const isToday = (iso: string) => {
  const a = fromISO(iso),
    b = new Date();
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};
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

function initialsFromName(n?: string) {
  if (!n) return "OD";
  const p = n.trim().split(/\s+/);
  const i1 = p[0]?.[0] ?? "";
  const i2 = p[1]?.[0] ?? "";
  return (i1 + i2).toUpperCase() || "OD";
}

/** Convierte foto relativa a absoluta si hace falta (usa solo el origin) */
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

/** Formatos para UI */
const toDDMMYYYY = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const toDDMMYYYY_dash = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
};

/* =======================================================
   Página PACIENTE: Agendar Cita
   ======================================================= */
export default function AgendarCita() {
  const navigate = useNavigate();
  const { usuario } = useAuth() as any;

  /* ------- paciente id (del logueado) ------- */
  const [pacienteId, setPacienteId] = useState<number | null>(null);
  const [pacienteErr, setPacienteErr] = useState("");

  const resolvePacienteId = useCallback(async () => {
    setPacienteErr("");
    const fromCtx = Number(
      usuario?.id_paciente ??
        usuario?.paciente?.id_paciente ??
        usuario?.paciente_id ??
        usuario?.idPaciente
    );
    if (Number.isFinite(fromCtx) && fromCtx > 0) {
      setPacienteId(fromCtx);
      return;
    }
    try {
      const { data: me } = await api.get("/usuarios/me/");
      const maybePid = Number(
        me?.id_paciente ?? me?.paciente?.id_paciente ?? me?.paciente_id
      );
      if (Number.isFinite(maybePid) && maybePid > 0) {
        setPacienteId(maybePid);
        return;
      }
      const uid = Number(me?.id_usuario ?? me?.id ?? me?.pk);
      if (Number.isFinite(uid) && uid > 0) {
        const { data: plist } = await api.get(`/pacientes/`, {
          params: { id_usuario: uid, page_size: 1 },
        });
        const arr = plist?.results ?? plist ?? [];
        const pid = Number(arr?.[0]?.id_paciente);
        if (Number.isFinite(pid) && pid > 0) {
          setPacienteId(pid);
          return;
        }
      }
      setPacienteErr("No se pudo identificar al paciente.");
    } catch {
      setPacienteErr("No se pudo identificar al paciente.");
    }
  }, [usuario]);

  useEffect(() => {
    resolvePacienteId();
  }, [resolvePacienteId]);

  /* ------- catálogos ------- */
  const [odontologos, setOdontologos] = useState<OdontologoOpt[]>([]);
  const [consultorios, setConsultorios] = useState<ConsultorioOpt[]>([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  useEffect(() => {
    (async () => {
      setLoadingCatalogs(true);
      try {
        const [od, co] = await Promise.all([
          api.get("/odontologos/?page_size=1000"),
          api.get("/consultorios/?page_size=1000"),
        ]);

        const odList: OdontologoOpt[] = (od.data.results ?? od.data)
          .filter((o: any) => {
            const ok =
              !(o.activo === false || o.estado === false) &&
              !(o.usuario_activo === false || o.is_active === false);
            return ok;
          })
          .map((o: any) => ({
            id: Number(o.id_odontologo),
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
            especialidades_detalle: Array.isArray(o.especialidades_detalle)
              ? o.especialidades_detalle
              : [],
          }));

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

        setOdontologos(odList);
        setConsultorios(coList);
      } finally {
        setLoadingCatalogs(false);
      }
    })();
  }, []);

  /* ------- filtros y selección de odontólogo ------- */
  const [fNombre, setFNombre] = useState("");
  const [fEsp, setFEsp] = useState("");

  const especialidadesOpc = useMemo(() => {
    const set = new Set<string>();
    odontologos.forEach((o) =>
      (o.especialidades ?? []).forEach((e) => set.add(e))
    );
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, "es", { sensitivity: "base" })
    );
  }, [odontologos]);

  const listaFiltrada = useMemo(() => {
    const nom = fNombre.trim().toLowerCase();
    const esp = fEsp.trim().toLowerCase();
    return odontologos.filter((o) => {
      const okNom = !nom || o.nombre.toLowerCase().includes(nom);
      const okEsp =
        !esp ||
        (o.especialidades ?? []).some((e) => e.toLowerCase().includes(esp));
      return okNom && okEsp;
    });
  }, [odontologos, fNombre, fEsp]);

  const [odoId, setOdoId] = useState<number | null>(null);

  /* ------- detalle + horarios del odontólogo seleccionado ------- */
  const [odoDet, setOdoDet] = useState<OdoDetalle | null>(null);
  const [horarios, setHorarios] = useState<HorarioVigente[]>([]);
  const [loadingOdo, setLoadingOdo] = useState(false);

  useEffect(() => {
    (async () => {
      setOdoDet(null);
      setHorarios([]);
      if (!odoId) return;
      setLoadingOdo(true);
      try {
        const [{ data: det }, { data: hrs }] = await Promise.all([
          api.get(`/odontologos/${odoId}/`),
          api.get(`/odontologos/${odoId}/horarios_vigentes/`),
        ]);
        setOdoDet(det);
        setHorarios(hrs ?? []);
      } finally {
        setLoadingOdo(false);
      }
    })();
  }, [odoId]);

  const odoNombre = useMemo(() => {
    if (!odoDet) return "";
    return (
      odoDet.nombreCompleto ??
      [
        odoDet.primer_nombre,
        odoDet.segundo_nombre,
        odoDet.primer_apellido,
        odoDet.segundo_apellido,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }, [odoDet]);

  const consultorioDefaultId = useMemo(() => {
    if (!odoDet) return null;
    return (
      odoDet.consultorio_default?.id_consultorio ??
      odoDet.consultorio_defecto?.id_consultorio ??
      odoDet.id_consultorio_default ??
      odoDet.id_consultorio_defecto ??
      null
    );
  }, [odoDet]);

  const consultorioDefaultLabel = useMemo(() => {
    if (!consultorioDefaultId) return null;
    const c = consultorios.find((x) => x.id === consultorioDefaultId);
    if (!c) return `Consultorio ${consultorioDefaultId}`;
    return (
      c.nombre ?? (c.numero ? `Consultorio ${c.numero}` : `Consultorio ${c.id}`)
    );
  }, [consultorioDefaultId, consultorios]);

  const detOrdenadas = useMemo(() => {
    const base = Array.isArray(odoDet?.especialidades_detalle)
      ? [...odoDet!.especialidades_detalle!]
      : [];
    return base.sort((a, b) =>
      (a?.nombre ?? "").localeCompare(b?.nombre ?? "", "es", {
        sensitivity: "base",
      })
    );
  }, [odoDet?.especialidades_detalle]);

  /* ------- calendario + bloqueos ------- */
  const hoyISO = toISODate(new Date());
  const maxISO = addMonthsISO(hoyISO, MAX_MONTHS_AHEAD);

  const [fecha, setFecha] = useState<string>(hoyISO);
  const [viewYM, setViewYM] = useState<{ y: number; m0: number }>(() => {
    const d = new Date();
    return { y: d.getFullYear(), m0: d.getMonth() };
  });

  // Bloqueos globales del mes visible
  const [bloqueosGlobalMap, setBloqueosGlobalMap] = useState<
    Record<string, BloqueoInfo>
  >({});
  // Bloqueos del odontólogo seleccionado (solo si hay)
  const [bloqueosOdoMap, setBloqueosOdoMap] = useState<
    Record<string, BloqueoInfo>
  >({});
  const [, setBloqsLoading] = useState(false);

  // Citas del paciente por día del mes visible (para etiquetas)
  const [citasByDate, setCitasByDate] = useState<Record<string, Cita[]>>({});

  // ---- 1) BLOQUEOS GLOBALES (siempre) ----
  useEffect(() => {
    (async () => {
      setBloqsLoading(true);
      try {
        const y = viewYM.y,
          m = viewYM.m0 + 1;
        const lastDay = new Date(y, m, 0).getDate();
        const from = `${y}-${pad2(m)}-01`;
        const to = `${y}-${pad2(m)}-${pad2(lastDay)}`;

        const { data: bGlobal } = await api.get(`/bloqueos-dias/`, {
          params: { start: from, end: to, odontologo: "global" },
        });

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

        const map: Record<string, BloqueoInfo> = {};
        for (const g of bGlobal ?? []) {
          const motivo = g.motivo || null;
          if (g.recurrente_anual) {
            const fi = String(g.fecha_inicio),
              ff = String(g.fecha_fin);
            for (const iso of monthDays) {
              if (occursOnAnnualRange(iso, fi, ff)) {
                map[iso] = map[iso] ?? { scope: "global", motivo };
                if (!map[iso].motivo) map[iso].motivo = motivo;
              }
            }
          } else {
            let d = fromISO(g.fecha_inicio),
              end = fromISO(g.fecha_fin);
            while (d <= end) {
              const iso = toISODate(d);
              if (iso >= from && iso <= to) {
                map[iso] = map[iso] ?? { scope: "global", motivo };
                if (!map[iso].motivo) map[iso].motivo = motivo;
              }
              d.setDate(d.getDate() + 1);
            }
          }
        }
        setBloqueosGlobalMap(map);
      } finally {
        setBloqsLoading(false);
      }
    })();
  }, [viewYM]);

  // ---- 2) BLOQUEOS DEL ODONTÓLOGO (solo si hay odontólogo) ----
  useEffect(() => {
    (async () => {
      if (!odoId) {
        setBloqueosOdoMap({});
        return;
      }
      setBloqsLoading(true);
      try {
        const y = viewYM.y,
          m = viewYM.m0 + 1;
        const lastDay = new Date(y, m, 0).getDate();
        const from = `${y}-${pad2(m)}-01`;
        const to = `${y}-${pad2(m)}-${pad2(lastDay)}`;

        const { data: bOdo } = await api.get(
          `/odontologos/${odoId}/bloqueos/`,
          { params: { from, to } }
        );

        const map: Record<string, BloqueoInfo> = {};
        for (const iso of bOdo ?? []) map[iso] = { scope: "odo", motivo: null };
        setBloqueosOdoMap(map);
      } finally {
        setBloqsLoading(false);
      }
    })();
  }, [odoId, viewYM]);

  // ---- 3) CITAS DEL PACIENTE (mes visible) ----
  useEffect(() => {
    (async () => {
      if (!pacienteId) {
        setCitasByDate({});
        return;
      }
      try {
        const y = viewYM.y,
          m = viewYM.m0 + 1;
        const lastDay = new Date(y, m, 0).getDate();
        const from = `${y}-${pad2(m)}-01`;
        const to = `${y}-${pad2(m)}-${pad2(lastDay)}`;

        const { data } = await api.get("/citas/", {
          params: { start: from, end: to, page_size: 1000 },
        });

        const arr: Cita[] = (data?.results ?? data ?? []) as Cita[];
        const byDate: Record<string, Cita[]> = {};
        for (const c of arr) {
          const iso = c.fecha?.slice(0, 10);
          if (!iso) continue;
          (byDate[iso] = byDate[iso] || []).push(c);
        }
        setCitasByDate(byDate);
      } catch {
        setCitasByDate({});
      }
    })();
  }, [pacienteId, viewYM]);

  // ---- Mapa de bloqueos combinado: global + odontólogo ----
  const bloqueosMap: Record<string, BloqueoInfo> = useMemo(() => {
    return { ...bloqueosGlobalMap, ...bloqueosOdoMap };
  }, [bloqueosGlobalMap, bloqueosOdoMap]);

  /* ------- Reglas del backend aplicadas en UI ------- */

  // Cooldown (últimos 7 días) con el mismo odontólogo
  const [cooldownInfo, setCooldownInfo] = useState<{
    citaFecha: string; // fecha de la cita cancelada (agenda original)
    citaHora: string | null; // hora de la cita cancelada
    cancelDate: string; // día en que se canceló (cancelada_en)
    until: string; // día desde el cual puede volver a agendar (cancelDate + 7)
  } | null>(null);

  // Ya tiene cita activa con ese odontólogo
  const [tieneActivaConOdo, setTieneActivaConOdo] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      setCooldownInfo(null);
      setTieneActivaConOdo(false);
      if (!pacienteId || !odoId) return;

      try {
        // 1) Canceladas recientes por el paciente con ese odontólogo (últimos 7 días)
        const cancelResp = await api.get("/citas/", {
          params: {
            estado: "cancelada",
            id_odontologo: odoId,
            page_size: 1000,
          },
        });
        const cancels: Cita[] = (cancelResp.data?.results ??
          cancelResp.data ??
          []) as Cita[];

        const now = new Date();
        const ms7d = 7 * 24 * 60 * 60 * 1000;
        const mineRecent = cancels
          .filter((c) => c.cancelada_por_rol === 2 && c.cancelada_en)
          .filter(
            (c) =>
              now.getTime() - new Date(String(c.cancelada_en)).getTime() < ms7d
          )
          .sort(
            (a, b) =>
              new Date(String(b.cancelada_en)).getTime() -
              new Date(String(a.cancelada_en)).getTime()
          );

        if (mineRecent.length > 0) {
          const last = mineRecent[0];

          const citaFecha = last.fecha?.slice(0, 10) || toISODate(new Date());
          const citaHora =
            (last.hora && last.hora.slice(0, 5)) ||
            (last as any).hora_inicio ||
            null;

          const cancelDateISO = new Date(String(last.cancelada_en))
            .toISOString()
            .slice(0, 10);

          const until = addDaysISO(cancelDateISO, COOLDOWN_DIAS);

          if (fromISO(until) > fromISO(toISODate(new Date()))) {
            setCooldownInfo({
              citaFecha,
              citaHora,
              cancelDate: cancelDateISO,
              until,
            });
          }
        }

        // 2) Cita activa con el mismo odontólogo
        const allWithOdoResp = await api.get("/citas/", {
          params: { id_odontologo: odoId, page_size: 1000 },
        });
        const withOdoAll: Cita[] = (allWithOdoResp.data?.results ??
          allWithOdoResp.data ??
          []) as Cita[];
        const activa = withOdoAll.some((c) =>
          ["pendiente", "confirmada"].includes(c.estado)
        );
        setTieneActivaConOdo(activa);
      } catch {
        // si falla, la API igualmente validará server-side
      }
    })();
  }, [pacienteId, odoId]);

  // Límite por día (1) y por semana (5) respecto a la fecha elegida
  const [countDiaActivas, setCountDiaActivas] = useState<number>(0);
  const [countSemanaActivas, setCountSemanaActivas] = useState<number>(0);

  useEffect(() => {
    (async () => {
      setCountDiaActivas(0);
      setCountSemanaActivas(0);
      if (!pacienteId || !fecha) return;

      try {
        // semana de la fecha: lunes–domingo
        const d = fromISO(fecha);
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const start = toISODate(monday);
        const end = toISODate(sunday);

        const { data } = await api.get("/citas/", {
          params: { start, end, page_size: 1000 },
        });
        const arr: Cita[] = (data?.results ?? data ?? []) as Cita[];

        const dayCount = arr.filter(
          (c) => c.fecha?.slice(0, 10) === fecha && c.estado !== "cancelada"
        ).length;
        setCountDiaActivas(dayCount);

        const weekCount = arr.filter((c) => c.estado !== "cancelada").length;
        setCountSemanaActivas(weekCount);
      } catch {
        // si falla, los límites se aplican en backend de todas formas
      }
    })();
  }, [pacienteId, fecha]);

  const dayLimitReached = countDiaActivas >= 1;
  const weekLimitReached = countSemanaActivas >= MAX_CITAS_SEMANA;

  // Bloqueo de la card 3 por odontólogo (cooldown o cita activa)
  const blockHoursForOdo = !!cooldownInfo || tieneActivaConOdo;

  /* ------- horas disponibles (con fallback de consultorio) ------- */
  const [horaSel, setHoraSel] = useState<string>("");
  const [horaSelConsultorio, setHoraSelConsultorio] = useState<number | null>(
    null
  );
  const [horaOptions, setHoraOptions] = useState<
    Array<{
      t: string;
      consultorioId: number;
      consultorioLabel: string;
      isDefault: boolean;
    }>
  >([]);
  const [loadingHoras, setLoadingHoras] = useState(false);

  /* NUEVO: ticker para refrescar horarios cada minuto SOLO si la fecha seleccionada es hoy */
  const [nowTick, setNowTick] = useState<number>(0);
  useEffect(() => {
    if (!isToday(fecha)) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [fecha]);

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
          if (H >= LUNCH_FROM && H < LUNCH_TO) continue;
          base.add(minutesToHHMM(t));
        }
      }

      /* ======= NUEVO: si la fecha es hoy, aplicar lead time de 2 horas ======= */
      if (isToday(dateISO)) {
        const now = new Date();
        const minutesNow = now.getHours() * 60 + now.getMinutes();
        // cutoff = ahora + 120 minutos, redondeado hacia arriba al inicio de la siguiente hora
        const cutoffAligned =
          Math.ceil((minutesNow + SAME_DAY_LEAD_MIN) / 60) * 60;
        for (const s of Array.from(base)) {
          if (timeToMinutes(s) < cutoffAligned) base.delete(s);
        }
      }

      return base;
    },
    [horarios]
  );

  const fechaFueraDeRango = (iso: string) =>
    fromISO(iso) < fromISO(hoyISO) || fromISO(iso) > fromISO(maxISO);
  const fechaBloqueada = (iso: string) => !!bloqueosMap[iso];
  const fechaHabilitadaPorHorarios = (iso: string) => {
    if (!horarios?.length) return false;
    const dow = dowMonday0(iso);
    const dias = new Set(
      horarios
        .filter((h) => h.vigente !== false)
        .map((h) => ((Number(h.dia_semana) % 7) + 7) % 7)
    );
    return dias.has(dow);
  };

  useEffect(() => {
    (async () => {
      // si está bloqueada la card 3 por odontólogo, no cargamos horas
      setHoraOptions([]);
      setHoraSel("");
      setHoraSelConsultorio(null);
      if (!odoId || !fecha || blockHoursForOdo) return;

      if (
        fechaFueraDeRango(fecha) ||
        fechaBloqueada(fecha) ||
        !fechaHabilitadaPorHorarios(fecha) ||
        dayLimitReached ||
        weekLimitReached
      ) {
        return;
      }

      const base = buildBaseSlots(fecha);
      if (!base.size) return;

      const activos = consultorios.filter((c) => c.estado);
      if (!activos.length) return;

      const defId = consultorioDefaultId ?? null;
      const ordered = [...activos].sort((a, b) => {
        if (!defId) return a.id - b.id;
        if (a.id === defId) return -1;
        if (b.id === defId) return 1;
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

          if (defId) {
            const d = resp.find((x) => x.id === defId);
            if (d && d.set.has(t))
              chosen = { id: d.id, label: d.label, isDefault: true };
          }
          if (!chosen) {
            const alt = resp.find((x) => x.id !== defId && x.set.has(t));
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
        setHoraOptions(opts);
      } finally {
        setLoadingHoras(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    odoId,
    fecha,
    consultorios,
    horarios,
    bloqueosMap,
    consultorioDefaultId,
    blockHoursForOdo,
    dayLimitReached,
    weekLimitReached,
    nowTick, // NUEVO: fuerza recalcular horarios cada minuto si la fecha es hoy
  ]);

  /* ------- motivo & confirm modal ------- */
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Cálculo informativo: horas hasta la cita seleccionada (para avisar si auto–confirmará)
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

  // Botón "Confirmar" deshabilitado si se infringe cualquier regla
  const hardBlocked =
    !!(!!cooldownInfo || tieneActivaConOdo) ||
    dayLimitReached ||
    weekLimitReached ||
    fechaFueraDeRango(fecha) ||
    fechaBloqueada(fecha) ||
    !fechaHabilitadaPorHorarios(fecha);

  async function doSubmit() {
    if (
      !pacienteId ||
      !odoId ||
      !fecha ||
      !horaSel ||
      !horaSelConsultorio ||
      !motivo.trim() ||
      hardBlocked
    ) {
      return; // no dejamos enviar
    }

    setSubmitting(true);
    setErrorMsg("");
    try {
      await api.post("/citas/", {
        id_paciente: pacienteId,
        id_odontologo: odoId,
        id_consultorio: horaSelConsultorio,
        fecha,
        hora: `${horaSel}:00`,
        motivo: motivo.trim(),
      });
      setShowConfirm(false);
      setShowToast(true);
      setTimeout(() => {
        setShowToast(false);
        navigate("/paciente/mis-citas/gestionar");
      }, 1200);
    } catch (err: any) {
      const data = err?.response?.data;
      const msg =
        (typeof data === "string" && data) ||
        data?.hora?.[0] ||
        data?.id_consultorio?.[0] ||
        data?.id_paciente?.[0] ||
        data?.id_odontologo?.[0] ||
        data?.fecha?.[0] ||
        data?.detail ||
        "No se pudo crear la cita.";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }

  /* ==================== Render ==================== */
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
  const grid = buildGrid(viewYM.y, viewYM.m0);

  const morning = horaOptions.filter(
    (h) => parseInt(h.t.slice(0, 2)) < LUNCH_FROM
  );
  const afternoon = horaOptions.filter(
    (h) => parseInt(h.t.slice(0, 2)) >= LUNCH_TO
  );

  const fotoURL = absolutize(odoDet?.foto || null);

  const estadoColor: Record<Cita["estado"], string> = {
    pendiente: "bg-amber-100 text-amber-800 border-amber-200",
    confirmada: "bg-green-100 text-green-800 border-green-200",
    realizada: "bg-blue-100 text-blue-800 border-blue-200",
    cancelada: "bg-red-100 text-red-800 border-red-200",
  };

  return (
    <div className="space-y-6">
      {showToast && (
        <div
          className="fixed bottom-4 right-4 z-50"
          role="status"
          aria-live="polite"
        >
          <div className="bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg">
            Cita agendada exitosamente
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">
          <CalendarPlus className="inline w-7 h-7 mr-2 -mt-1 text-black" />
          Agendar cita
        </h1>
        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded-lg border bg-black/80 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => setShowConfirm(true)}
            disabled={
              !pacienteId ||
              !odoId ||
              !fecha ||
              !horaSel ||
              !horaSelConsultorio ||
              !motivo.trim() ||
              submitting ||
              hardBlocked
            }
            title={
              !pacienteId
                ? "No se identificó al paciente"
                : !odoId
                ? "Selecciona un odontólogo"
                : !horaSel
                ? "Selecciona una hora disponible"
                : !motivo.trim()
                ? "Ingresa el motivo"
                : hardBlocked
                ? "No es posible agendar por las restricciones vigentes"
                : "Crear cita"
            }
          >
            {submitting ? "Creando…" : "Confirmar cita"}
          </button>
        </div>
      </div>

      {pacienteErr && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {pacienteErr}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* ====== Selección de odontólogo + Perfil (50/50) ====== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lista + filtros */}
        <div className="rounded-xl bg-white shadow p-4">
          <h2 className="font-semibold mb-3">1) Selecciona un odontólogo</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="relative md:col-span-2">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
              <input
                value={fNombre}
                onChange={(e) => setFNombre(e.target.value)}
                placeholder="Filtrar por nombre"
                className="w-full pl-9 pr-3 py-2 border rounded-lg"
              />
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <select
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={fEsp}
                  onChange={(e) => setFEsp(e.target.value)}
                >
                  <option value="">Todas las especialidades…</option>
                  {especialidadesOpc.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                onClick={() => {
                  setFNombre("");
                  setFEsp("");
                }}
              >
                Limpiar
              </button>
            </div>
          </div>

          <div className="rounded-xl border overflow-hidden">
            <ul className="divide-y max-h-[360px] overflow-auto">
              {!loadingCatalogs &&
                listaFiltrada.map((o) => {
                  const active = odoId === o.id;

                  const det = Array.isArray(o.especialidades_detalle)
                    ? o.especialidades_detalle
                    : [];

                  const activas = det
                    .filter((e) => e && e.estado !== false)
                    .map((e) => (e?.nombre ?? "").trim())
                    .filter(Boolean)
                    .sort((a, b) =>
                      a.localeCompare(b, "es", { sensitivity: "base" })
                    );

                  const fallbackAll = Array.isArray(o.especialidades)
                    ? o.especialidades
                        .filter(Boolean)
                        .sort((a, b) =>
                          a.localeCompare(b, "es", { sensitivity: "base" })
                        )
                    : [];

                  const espLabel =
                    activas.length > 0
                      ? activas.join(", ")
                      : fallbackAll.length > 0
                      ? fallbackAll.join(", ")
                      : "—";

                  return (
                    <li
                      key={o.id}
                      className={`px-4 py-3 ${
                        active ? "bg-blue-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <button
                        className="w-full flex items-center justify-between"
                        onClick={() => setOdoId(o.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-10 w-10 rounded-full flex items-center justify-center ${
                              active
                                ? "bg-blue-600 text-white"
                                : "bg-gray-200 text-gray-700"
                            }`}
                          >
                            <Stethoscope className="w-5 h-5" />
                          </div>
                          <div className="text-left">
                            <div className="font-medium">{o.nombre}</div>
                            <div className="text-sm text-gray-500 line-clamp-2">
                              {espLabel}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>

          {/* Avisos por odontólogo (cooldown / activa) */}
          {odoId && (
            <div className="mt-3 space-y-2">
              {tieneActivaConOdo && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex gap-2">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    Ya tienes una cita activa (pendiente/confirmada) con este
                    odontólogo. No puedes crear otra.
                  </div>
                </div>
              )}
              {cooldownInfo && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    Cancelaste una cita para el{" "}
                    <b>{toDDMMYYYY(cooldownInfo.citaFecha)}</b>
                    {cooldownInfo.citaHora
                      ? ` a las ${cooldownInfo.citaHora}`
                      : ""}{" "}
                    con este odontólogo el día{" "}
                    <b>{toDDMMYYYY(cooldownInfo.cancelDate)}</b>. Podrás volver
                    a agendar una cita con este odontólogo después de 7 días
                    (desde el <b>{toDDMMYYYY(cooldownInfo.until)}</b>). Para
                    emergencias, llama al consultorio.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Perfil */}
        <div className="rounded-xl bg-white shadow p-4">
          <h2 className="text-sm font-semibold mb-3">Perfil</h2>
          {!odoId ? (
            <div className="text-sm text-gray-500">
              Selecciona un odontólogo para ver su perfil.
            </div>
          ) : loadingOdo ? (
            <div className="text-sm text-gray-500">Cargando perfil…</div>
          ) : !odoDet ? (
            <div className="text-sm text-gray-500">
              No se pudo cargar el perfil.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* IZQUIERDA */}
              <div className="space-y-3 md:text-center md:items-center">
                <div className="flex flex-col items-center gap-3">
                  {fotoURL ? (
                    <img
                      src={fotoURL}
                      alt={odoNombre}
                      className="h-28 w-28 rounded-full object-cover border shadow-sm"
                    />
                  ) : (
                    <div className="h-28 w-28 rounded-full bg-gray-200 flex items-center justify-center text-lg font-semibold">
                      {initialsFromName(odoNombre)}
                    </div>
                  )}
                </div>

                <div className="font-semibold text-lg">
                  {odoNombre || "Odontólogo"}
                </div>

                {consultorioDefaultLabel && (
                  <div className="text-xs text-gray-600 -mt-1">
                    Consultorio por defecto: <b>{consultorioDefaultLabel}</b>
                  </div>
                )}

                <div className="md:text-left">
                  <div className="text-sm font-medium mb-1">Especialidades</div>
                  <ul className="space-y-1">
                    {(odoDet.especialidades_detalle ?? []).length > 0 ? (
                      detOrdenadas.map((e, idx) => {
                        const nombreEsp = e?.nombre || "Odontología general";
                        const atiende = e?.estado !== false;
                        return (
                          <li key={idx} className="text-sm text-gray-700">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                • {nombreEsp}
                                <div className="text-xs text-gray-500 ml-4">
                                  {e?.universidad ? e.universidad : "—"}
                                </div>
                              </div>
                              <span
                                className={[
                                  "shrink-0 px-2 py-0.5 rounded border text-[11px] mt-0.5",
                                  atiende
                                    ? "bg-green-100 text-green-800 border-green-200"
                                    : "bg-gray-200 text-gray-700 border-gray-300",
                                ].join(" ")}
                              >
                                {atiende ? "Atiende" : "No atiende"}
                              </span>
                            </div>
                          </li>
                        );
                      })
                    ) : (
                      <li className="text-sm text-gray-700">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            • Odontología general
                            <div className="text-xs text-gray-500 ml-4">—</div>
                          </div>
                          <span className="shrink-0 px-2 py-0.5 rounded border text-[11px] mt-0.5 bg-green-100 text-green-800 border-green-200">
                            Atiende
                          </span>
                        </div>
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              {/* DERECHA: horarios */}
              <div className="md:justify-self-end w-full md:pl-6 md:border-l md:border-gray-200">
                <div className="text-sm font-medium mb-2">
                  Horarios de atención
                </div>
                <div className="text-sm text-gray-700">
                  {(() => {
                    const dias = [
                      "Lun",
                      "Mar",
                      "Mié",
                      "Jue",
                      "Vie",
                      "Sáb",
                      "Dom",
                    ];
                    const map: Record<
                      number,
                      Array<{ i: string; f: string }>
                    > = {};
                    (horarios ?? [])
                      .filter((h) => h.vigente !== false)
                      .forEach((h) => {
                        const d = ((Number(h.dia_semana) % 7) + 7) % 7;
                        (map[d] = map[d] || []).push({
                          i: h.hora_inicio,
                          f: h.hora_fin,
                        });
                      });

                    return (
                      <ul className="space-y-1">
                        {Array.from({ length: 7 }, (_, d) => {
                          const slots = map[d] ?? [];
                          const ints = slots
                            .map((x) => `${x.i}–${x.f}`)
                            .join(", ");
                          return (
                            <li key={d} className="flex items-start gap-2">
                              <span className="min-w-[42px] font-medium">
                                {dias[d]}:
                              </span>
                              {slots.length ? (
                                <span>{ints}</span>
                              ) : (
                                <span className="text-gray-500">
                                  No atiende
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ====== Calendario + Horas (50/50) ====== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calendario */}
        <div className="rounded-xl bg-white shadow p-4">
          <h2 className="font-semibold mb-3">2) Elige una fecha</h2>

          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setViewYM((p) => {
                    const d = new Date(p.y, p.m0 - 1, 1);
                    return { y: d.getFullYear(), m0: d.getMonth() };
                  })
                }
                className="px-2 py-1 rounded-lg hover:bg-gray-100"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2">
                <select
                  className="border rounded-lg px-2 py-1"
                  value={viewYM.m0}
                  onChange={(e) =>
                    setViewYM((p) => ({ ...p, m0: Number(e.target.value) }))
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
                  value={viewYM.y}
                  onChange={(e) =>
                    setViewYM((p) => ({ ...p, y: Number(e.target.value) }))
                  }
                >
                  {Array.from(
                    { length: 21 },
                    (_, i) => new Date().getFullYear() - 10 + i
                  ).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() =>
                  setViewYM((p) => {
                    const d = new Date(p.y, p.m0 + 1, 1);
                    return { y: d.getFullYear(), m0: d.getMonth() };
                  })
                }
                className="px-2 py-1 rounded-lg hover:bg-gray-100"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Encabezado: solo la fecha seleccionada */}
            <div className="text-sm text-gray-700">
              Seleccionado: <b>{toDDMMYYYY(fecha)}</b>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-1">
            {dowShort.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.flat().map((d, idx) => {
              const iso = toISODate(d);
              const inCurMonth = d.getMonth() === viewYM.m0;

              const disabled =
                !odoId ||
                fechaFueraDeRango(iso) ||
                !fechaHabilitadaPorHorarios(iso) ||
                !!bloqueosMap[iso] ||
                !inCurMonth;

              const selected = iso === fecha;
              const blocked = !!bloqueosMap[iso];
              const citas = citasByDate[iso] || [];

              return (
                <button
                  key={idx}
                  onClick={() => {
                    if (!disabled) {
                      setFecha(iso);
                      setHoraSel("");
                      setHoraSelConsultorio(null);
                    }
                  }}
                  className={[
                    "relative aspect-square rounded-lg text-sm border p-1 flex flex-col items-center justify-start",
                    inCurMonth
                      ? "text-gray-800 bg-white"
                      : "text-gray-400 bg-gray-50",
                    selected
                      ? "bg-blue-50 text-blue-800 border-blue-600 ring-2 ring-blue-200"
                      : "",
                    disabled
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-gray-50",
                  ].join(" ")}
                  title={
                    blocked
                      ? bloqueosMap[iso].motivo
                        ? `Bloqueado: ${bloqueosMap[iso].motivo}`
                        : "Bloqueado"
                      : iso
                  }
                  disabled={disabled}
                >
                  <div className="mt-0.5">{d.getDate()}</div>

                  {/* Nota/etiqueta de bloqueo con motivo */}
                  {blocked && (
                    <div className="absolute bottom-1 left-1 right-1 text-[10px] px-1 py-0.5 rounded border bg-gray-200 text-gray-700 border-gray-300">
                      {bloqueosMap[iso].motivo
                        ? bloqueosMap[iso].motivo
                        : "Bloqueado"}
                    </div>
                  )}

                  {/* Etiquetas con estados de citas del paciente para ese día */}
                  {!blocked && citas.length > 0 && (
                    <div className="absolute bottom-1 left-1 right-1 flex flex-col gap-0.5">
                      {citas.slice(0, 2).map((c) => (
                        <div
                          key={c.id_cita}
                          className={`text-[10px] px-1 py-0.5 rounded border truncate ${
                            estadoColor[c.estado]
                          }`}
                          title={`Cita ${c.estado}`}
                        >
                          {c.estado}
                        </div>
                      ))}
                      {citas.length > 2 && (
                        <div className="text-[10px] px-1 py-0.5 rounded border bg-gray-100 text-gray-700 border-gray-200 text-center">
                          +{citas.length - 2} más
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-3 text-xs text-gray-600">
            <div className="px-2 py-0.5 rounded border bg-gray-200 text-gray-700 border-gray-300">
              Bloqueado
            </div>
            <div className="px-2 py-0.5 rounded border bg-amber-100 text-amber-800 border-amber-200">
              Pendiente
            </div>
            <div className="px-2 py-0.5 rounded border bg-green-100 text-green-800 border-green-200">
              Confirmada
            </div>
            <div className="px-2 py-0.5 rounded border bg-blue-100 text-blue-800 border-blue-200">
              Realizada
            </div>
            <div className="px-2 py-0.5 rounded border bg-red-100 text-red-800 border-red-200">
              Cancelada
            </div>
            <div className="ml-auto italic">
              * Rango permitido hasta {toDDMMYYYY_dash(maxISO)}.
            </div>
          </div>
        </div>

        {/* Horas disponibles */}
        <div className="rounded-xl bg-white shadow p-4">
          <h2 className="font-semibold mb-3">3) Elige una hora</h2>

          {/* Si hay cooldown o cita activa con el odonto, no mostramos horarios */}
          {blockHoursForOdo ? (
            <div className="text-sm text-red-600">
              {cooldownInfo ? (
                <>
                  Cancelaste una cita el{" "}
                  <b>{toDDMMYYYY(cooldownInfo.citaFecha)}</b>
                  {cooldownInfo.citaHora
                    ? ` a las ${cooldownInfo.citaHora}`
                    : ""}{" "}
                  con este odontólogo el día{" "}
                  <b>{toDDMMYYYY(cooldownInfo.cancelDate)}</b>.<br />
                  Podrás volver a agendar una cita con este odontólogo después
                  de 7 días (desde el <b>{toDDMMYYYY(cooldownInfo.until)}</b>).
                  Si necesitas una cita de emergencia, llama al consultorio.
                </>
              ) : (
                <>Ya tienes una cita activa con este odontólogo.</>
              )}
            </div>
          ) : !odoId ? (
            <div className="text-sm text-gray-500">
              Selecciona un odontólogo para ver horarios.
            </div>
          ) : fechaFueraDeRango(fecha) ? (
            <div className="text-sm text-red-600">
              La fecha está fuera del rango permitido (próximos 3 meses).
            </div>
          ) : fechaBloqueada(fecha) ? (
            <div className="text-sm text-red-600">
              El día seleccionado está bloqueado.
            </div>
          ) : dayLimitReached ? (
            <div className="text-sm text-red-600">
              Ya tienes una cita activa este día. Solo puedes agendar 1 por día.
            </div>
          ) : weekLimitReached ? (
            <div className="text-sm text-red-600">
              Alcanzaste el máximo de {MAX_CITAS_SEMANA} citas para esta semana
              (Lun–Dom). Intenta en una semana diferente.
            </div>
          ) : loadingHoras ? (
            <div className="text-sm text-gray-500">
              Calculando disponibilidad…
            </div>
          ) : horaOptions.length === 0 ? (
            <div className="text-sm text-red-600">
              No hay horarios disponibles para {fecha}.
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
                      horaSel === h.t && horaSelConsultorio === h.consultorioId;
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
                        title={
                          h.isDefault
                            ? "Consultorio por defecto"
                            : "Consultorio alterno"
                        }
                      >
                        {h.t} ·{" "}
                        <span className="opacity-80">{h.consultorioLabel}</span>
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
                      horaSel === h.t && horaSelConsultorio === h.consultorioId;
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
                        title={
                          h.isDefault
                            ? "Consultorio por defecto"
                            : "Consultorio alterno"
                        }
                      >
                        {h.t} ·{" "}
                        <span className="opacity-80">{h.consultorioLabel}</span>
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

              {/* Nota informativa de auto-confirmación si faltan < 24 h */}
              {hoursUntil !== null && hoursUntil < 24 && hoursUntil > 0 && (
                <div className="text-xs mt-1 rounded-md border border-green-200 bg-green-50 text-green-800 px-2 py-1">
                  Esta cita se <b>confirmará automáticamente</b> al crearla
                  porque faltan menos de 24 horas.
                </div>
              )}
            </div>
          )}

          {/* Motivo */}
          <div className="mt-4 grid gap-2">
            <label className="text-sm font-medium">
              Motivo de la cita <span className="text-red-600">*</span>
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

      {/* ===== Modal de confirmación ===== */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowConfirm(false)}
          />
          <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Confirmar agendamiento</h3>
              <button
                className="p-1 rounded hover:bg-gray-100"
                onClick={() => setShowConfirm(false)}
                aria-label="Cerrar"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-600">Odontólogo: </span>
                <b>{odoNombre || "—"}</b>
              </div>
              <div>
                <span className="text-gray-600">Fecha: </span>
                <b>{fecha || "—"}</b>
              </div>
              <div>
                <span className="text-gray-600">Hora: </span>
                <b>{horaSel || "—"}</b>
              </div>
              <div>
                <span className="text-gray-600">Consultorio: </span>
                <b>
                  {horaSelConsultorio
                    ? consultorios.find((c) => c.id === horaSelConsultorio)
                        ?.nombre ?? `Consultorio ${horaSelConsultorio}`
                    : "—"}
                </b>
              </div>
              <div>
                <span className="text-gray-600">Motivo: </span>
                <b>{motivo || "—"}</b>
              </div>

              {/* Aviso en el modal si será auto–confirmada */}
              {hoursUntil !== null && hoursUntil < 24 && hoursUntil > 0 && (
                <div className="mt-2 rounded-md border border-green-200 bg-green-50 text-green-800 px-2 py-1 text-xs">
                  Esta cita se confirmará automáticamente al crearla (faltan
                  menos de 24 h).
                </div>
              )}
            </div>

            {hardBlocked && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                No es posible confirmar por las restricciones vigentes.
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                onClick={() => setShowConfirm(false)}
              >
                Cancelar
              </button>
              <button
                className="px-3 py-2 rounded-lg border bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={doSubmit}
                disabled={submitting || hardBlocked}
                title={
                  hardBlocked
                    ? "No es posible confirmar por las restricciones vigentes"
                    : "Confirmar"
                }
              >
                {submitting ? "Agendando…" : "Sí, agendar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
