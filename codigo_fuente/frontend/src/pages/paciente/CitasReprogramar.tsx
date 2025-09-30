// src/pages/paciente/CitasReprogramar.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { api } from "../../api/axios";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  X as XIcon,
  Info,
  AlertTriangle,
  RotateCcw, // ← ícono para el título
} from "lucide-react";

/* ==================== Tipos ==================== */
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
  motivo?: string | null;
  estado: "pendiente" | "confirmada" | "realizada" | "cancelada";
  id_odontologo: number;
  id_consultorio?: number | null;
};

/* ============ Props ============ */
export type CitasReprogramarProps = {
  citaId: number;
  onCancel: () => void;
  onDone: (msg?: string) => void | Promise<void>;
};

/* ==================== Helpers ==================== */
const LUNCH_FROM = 13; // 13:00
const LUNCH_TO = 15; // 15:00 (exclusivo)
const MAX_MONTHS_AHEAD = 3;

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

/** foto absoluta */
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

function initialsFromName(n?: string) {
  if (!n) return "OD";
  const p = n.trim().split(/\s+/);
  const i1 = p[0]?.[0] ?? "";
  const i2 = p[1]?.[0] ?? "";
  return (i1 + i2).toUpperCase() || "OD";
}

const toDDMMYYYY = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/* ======================================================= */
export default function CitasReprogramar({
  citaId,
  onCancel,
  onDone,
}: CitasReprogramarProps) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [cita, setCita] = useState<Cita | null>(null);
  const [odoDet, setOdoDet] = useState<OdoDetalle | null>(null);
  const [horarios, setHorarios] = useState<HorarioVigente[]>([]);
  const [consultorios, setConsultorios] = useState<ConsultorioOpt[]>([]);

  // originales (para resaltar y “Hora agendada”)
  const originalFechaRef = useRef<string | null>(null); // "YYYY-MM-DD"
  const originalHoraRef = useRef<string | null>(null); // "HH:MM"
  const originalConsultorioRef = useRef<number | null>(null);

  // campos editables
  const hoyISO = toISODate(new Date());
  const maxISO = addMonthsISO(hoyISO, MAX_MONTHS_AHEAD);

  const [fecha, setFecha] = useState<string>(hoyISO);
  const [horaSel, setHoraSel] = useState<string>(""); // nueva hora seleccionada
  const [horaSelConsultorio, setHoraSelConsultorio] = useState<number | null>(
    null
  );
  const [motivo, setMotivo] = useState<string>("");

  // calendario view
  const [viewYM, setViewYM] = useState<{ y: number; m0: number }>(() => {
    const d = new Date();
    return { y: d.getFullYear(), m0: d.getMonth() };
  });

  // bloqueos
  const [bloqueosGlobalMap, setBloqueosGlobalMap] = useState<
    Record<string, BloqueoInfo>
  >({});
  const [bloqueosOdoMap, setBloqueosOdoMap] = useState<
    Record<string, BloqueoInfo>
  >({});
  const bloqueosMap: Record<string, BloqueoInfo> = useMemo(
    () => ({ ...bloqueosGlobalMap, ...bloqueosOdoMap }),
    [bloqueosGlobalMap, bloqueosOdoMap]
  );

  // horas
  const [horaOptions, setHoraOptions] = useState<
    Array<{
      t: string;
      consultorioId: number;
      consultorioLabel: string;
      isDefault: boolean;
    }>
  >([]);
  const [loadingHoras, setLoadingHoras] = useState(false);

  // modal
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showToast, setShowToast] = useState(false);

  /* ------- cargar cita + catálogos -------- */
  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      setErrorMsg("");
      setLoading(true);
      try {
        const { data: c } = await api.get(`/citas/${citaId}/`, {
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        setCita(c);

        const [det, hrs, co] = await Promise.all([
          api.get(`/odontologos/${c.id_odontologo}/`, { signal: ac.signal }),
          api.get(`/odontologos/${c.id_odontologo}/horarios_vigentes/`, {
            signal: ac.signal,
          }),
          api.get(`/consultorios/?page_size=1000`, { signal: ac.signal }),
        ]);
        if (ac.signal.aborted) return;

        setOdoDet(det.data);
        setHorarios(hrs.data ?? []);

        const coList: ConsultorioOpt[] = (co.data.results ?? co.data).map(
          (x: any) => ({
            id: Number(x.id_consultorio),
            nombre:
              x.nombre ??
              (x.numero
                ? `Consultorio ${x.numero}`
                : `Consultorio ${x.id_consultorio}`),
            numero: x.numero,
            estado: !!x.estado,
          })
        );
        setConsultorios(coList);

        // originales …
        const fechaISO = String(c.fecha).slice(0, 10);
        const hhmm = (c.hora || "").slice(0, 5);
        originalFechaRef.current = fechaISO;
        originalHoraRef.current = hhmm || null;
        originalConsultorioRef.current = c.id_consultorio ?? null;

        setFecha(fechaISO);
        setHoraSel("");
        setHoraSelConsultorio(null);
        setMotivo(c.motivo ?? "");
      } catch (e: any) {
        if (e?.code === "ERR_CANCELED") return;
        const m = e?.response?.data?.detail || "No se pudo cargar la cita.";
        setErrorMsg(m);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [citaId]);

  const odontologoId = cita?.id_odontologo ?? odoDet?.id_odontologo ?? null;

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

  /* ------- bloqueos del mes visible ------- */
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const y = viewYM.y,
          m = viewYM.m0 + 1;
        const lastDay = new Date(y, m, 0).getDate();
        const from = `${y}-${pad2(m)}-01`;
        const to = `${y}-${pad2(m)}-${pad2(lastDay)}`;

        const { data: bGlobal } = await api.get(`/bloqueos-dias/`, {
          params: { start: from, end: to, odontologo: "global" },
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;

        const mapG: Record<string, BloqueoInfo> = {};
        for (const g of bGlobal ?? []) {
          let d = fromISO(g.fecha_inicio),
            end = fromISO(g.fecha_fin);
          while (d <= end) {
            const iso = toISODate(d);
            if (iso >= from && iso <= to)
              mapG[iso] = { scope: "global", motivo: g.motivo || null };
            d.setDate(d.getDate() + 1);
          }
        }
        setBloqueosGlobalMap(mapG);

        if (odontologoId) {
          const { data: bOdo } = await api.get(
            `/odontologos/${odontologoId}/bloqueos/`,
            {
              params: { from, to },
              signal: ac.signal,
            }
          );
          if (ac.signal.aborted) return;
          const mapO: Record<string, BloqueoInfo> = {};
          for (const iso of bOdo ?? [])
            mapO[iso] = { scope: "odo", motivo: null };
          setBloqueosOdoMap(mapO);
        } else {
          setBloqueosOdoMap({});
        }
      } catch (e: any) {
        if (e?.code !== "ERR_CANCELED") {
          setBloqueosGlobalMap({});
          setBloqueosOdoMap({});
        }
      }
    })();
    return () => ac.abort();
  }, [viewYM, odontologoId]);

  /* ------- reglas de fecha ------- */
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

  /* ------- base de horas ------- */
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
      if (isToday(dateISO)) {
        const now = new Date();
        const cur = now.getHours() * 60 + (now.getMinutes() > 0 ? 60 : 0);
        for (const s of Array.from(base))
          if (timeToMinutes(s) < cur) base.delete(s);
      }
      return base;
    },
    [horarios]
  );

  const activos = useMemo(
    () => consultorios.filter((c) => c.estado),
    [consultorios]
  );
  const orderedConsultorios = useMemo(() => {
    const defId = consultorioDefaultId ?? null;
    const arr = [...activos];
    arr.sort((a, b) => {
      if (!defId) return a.id - b.id;
      if (a.id === defId) return -1;
      if (b.id === defId) return 1;
      return a.id - b.id;
    });
    return arr;
  }, [activos, consultorioDefaultId]);

  /* ------- disponibilidad ------- */
  const reqRef = useRef(0);

  useEffect(() => {
    const ac = new AbortController();
    const ver = ++reqRef.current;

    (async () => {
      setHoraOptions([]);
      if (!odontologoId || !fecha) return;
      if (
        fechaFueraDeRango(fecha) ||
        fechaBloqueada(fecha) ||
        !fechaHabilitadaPorHorarios(fecha)
      )
        return;

      const base = buildBaseSlots(fecha);
      if (!base.size) return;
      if (orderedConsultorios.length === 0) return;

      setLoadingHoras(true);
      try {
        const resp = await Promise.all(
          orderedConsultorios.map((c) =>
            api
              .get<DisponibilidadResp>("/citas/disponibilidad/", {
                params: {
                  fecha,
                  id_odontologo: odontologoId,
                  id_consultorio: c.id,
                  exclude_cita: citaId,
                },
                signal: ac.signal,
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
        if (ac.signal.aborted || reqRef.current !== ver) return;

        const defId = consultorioDefaultId ?? null;
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
          if (chosen)
            opts.push({
              t,
              consultorioId: chosen.id,
              consultorioLabel: chosen.label,
              isDefault: chosen.isDefault,
            });
        }

        setHoraOptions(opts);
      } catch (e: any) {
        if (e?.code !== "ERR_CANCELED") {
          // opcional: loggear o mostrar mensaje suave
        }
      } finally {
        if (!ac.signal.aborted && reqRef.current === ver)
          setLoadingHoras(false);
      }
    })();

    return () => ac.abort();
    // Nota: dependemos de orderedConsultorios (memo) y NO del array bruto consultorios
  }, [
    odontologoId,
    fecha,
    horarios,
    bloqueosMap,
    consultorioDefaultId,
    citaId,
    buildBaseSlots,
    orderedConsultorios,
  ]);

  const fotoURL = absolutize(odoDet?.foto || null);

  /* ------- hora/consultorio efectivos para submit ------- */
  const effectiveHora = useMemo(() => {
    if (!horaSel && fecha === originalFechaRef.current)
      return originalHoraRef.current || "";
    return horaSel;
  }, [horaSel, fecha]);

  const effectiveConsultorio = useMemo(() => {
    if (!horaSelConsultorio && fecha === originalFechaRef.current)
      return originalConsultorioRef.current;
    return horaSelConsultorio;
  }, [horaSelConsultorio, fecha]);

  /* ------- Submit (PATCH) ------- */
  const hardBlocked =
    !odontologoId ||
    !fecha ||
    fechaFueraDeRango(fecha) ||
    fechaBloqueada(fecha) ||
    !fechaHabilitadaPorHorarios(fecha) ||
    !effectiveHora ||
    !effectiveConsultorio ||
    !motivo.trim();

  async function doSubmit() {
    if (!cita || hardBlocked) return;

    setSubmitting(true);
    setErrorMsg("");
    try {
      await api.patch(`/citas/${cita.id_cita}/`, {
        fecha,
        hora: `${effectiveHora}:00`,
        id_consultorio: effectiveConsultorio,
        motivo: motivo.trim(),
        estado: cita.estado,
      });
      setShowConfirm(false);
      setShowToast(true);
      setTimeout(async () => {
        setShowToast(false);
        await onDone("¡Cita reprogramada correctamente!");
      }, 1200);
    } catch (err: any) {
      const data = err?.response?.data;
      const msg =
        (typeof data === "string" && data) ||
        data?.hora?.[0] ||
        data?.id_consultorio?.[0] ||
        data?.fecha?.[0] ||
        data?.detail ||
        "No se pudo reprogramar la cita.";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }

  /* ==================== Render ==================== */
  return (
    <div className="space-y-6">
      {showToast && (
        <div
          className="fixed bottom-4 right-4 z-50"
          role="status"
          aria-live="polite"
        >
          <div className="bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg">
            Cita reprogramada exitosamente
          </div>
        </div>
      )}

      {/* Header: título + botones */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <RotateCcw className="h-7 w-7" />
          Reprogramar cita
        </h1>

        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            className="px-3 py-2 rounded-lg border bg-black/80 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => setShowConfirm(true)}
            disabled={submitting || hardBlocked || loading}
            title={
              loading
                ? "Cargando…"
                : !odontologoId
                ? "Odontólogo no disponible"
                : !effectiveHora
                ? "Selecciona una hora (o conserva la original si no cambiaste la fecha)"
                : !motivo.trim()
                ? "Ingresa el motivo"
                : hardBlocked
                ? "No es posible reprogramar por las restricciones vigentes"
                : "Confirmar reprogramación"
            }
          >
            {submitting ? "Guardando…" : "Confirmar cambios"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* ===== Card Odontólogo ===== */}
      <div className="rounded-xl bg-white shadow p-4">
        <h2 className="font-semibold mb-3">Odontólogo asignado</h2>
        {loading ? (
          <div className="text-sm text-gray-500">Cargando…</div>
        ) : !odoDet ? (
          <div className="text-sm text-gray-500">
            No se pudo cargar el perfil del odontólogo.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* IZQ: foto + nombre + consultorio default + especialidades */}
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
                  {(detOrdenadas ?? []).length > 0 ? (
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

            {/* DER: avisos */}
            <div className="md:justify-self-end w-full md:pl-6 md:border-l md:border-gray-200 space-y-3">
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 flex gap-2">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  Si te equivocaste escogiendo el odontólogo, por favor{" "}
                  <b>llama al consultorio</b>. Aquí solo puedes cambiar{" "}
                  <b>fecha</b>, <b>hora</b> y <b>motivo</b>.
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  Recuerda: <b>solo puedes reprogramar una vez</b>. Si necesitas
                  reprogramar nuevamente, comunícate con el consultorio.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== Calendario + Horas ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calendario */}
        <div className="rounded-xl bg-white shadow p-4">
          <h2 className="font-semibold mb-3">1) Elige una fecha</h2>

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
                  {[
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
                  ].map((n, i) => (
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

            <div className="text-sm text-gray-700">
              Seleccionado: <b>{toDDMMYYYY(fecha)}</b>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-1">
            {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {buildGrid(viewYM.y, viewYM.m0)
              .flat()
              .map((d, idx) => {
                const iso = toISODate(d);
                const inCurMonth = d.getMonth() === viewYM.m0;

                const disabled =
                  !odontologoId ||
                  fechaFueraDeRango(iso) ||
                  !fechaHabilitadaPorHorarios(iso) ||
                  !!bloqueosMap[iso] ||
                  !inCurMonth;

                const selected = iso === fecha;
                const isOriginal = originalFechaRef.current === iso;
                const blocked = !!bloqueosMap[iso];

                const baseBg = inCurMonth
                  ? isOriginal
                    ? "bg-violet-100 text-violet-900"
                    : "bg-white text-gray-800"
                  : "bg-gray-50 text-gray-400";

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
                      baseBg,
                      selected
                        ? "border-2 border-blue-600 ring-2 ring-blue-200"
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
                    {blocked && (
                      <div className="absolute bottom-1 left-1 right-1 text-[10px] px-1 py-0.5 rounded border bg-gray-200 text-gray-700 border-gray-300">
                        {bloqueosMap[iso].motivo
                          ? bloqueosMap[iso].motivo
                          : "Bloqueado"}
                      </div>
                    )}
                  </button>
                );
              })}
          </div>

          <div className="mt-2 text-xs text-gray-600 italic">
            * Rango permitido hasta {maxISO}
          </div>

          {/* Leyenda (se mantiene para el calendario) */}
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-violet-200 border border-violet-300" />{" "}
              Fecha original
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded border-2 border-blue-600" />{" "}
              Selección actual
            </span>
          </div>
        </div>

        {/* Horas disponibles + motivo */}
        <div className="rounded-xl bg-white shadow p-4">
          <h2 className="font-semibold mb-3">2) Elige una hora</h2>

          {/* Hora agendada (solo si la fecha seleccionada es la original) */}
          {originalFechaRef.current === fecha && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900 mb-3 flex gap-2">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <b>Hora agendada original:</b>{" "}
                {originalHoraRef.current ? `${originalHoraRef.current}` : "—"}{" "}
                {originalConsultorioRef.current
                  ? `· ${
                      consultorios.find(
                        (c) => c.id === originalConsultorioRef.current
                      )?.nombre ??
                      `Consultorio ${originalConsultorioRef.current}`
                    }`
                  : ""}
              </div>
            </div>
          )}

          {!odontologoId ? (
            <div className="text-sm text-gray-500">
              Odontólogo no disponible.
            </div>
          ) : fechaFueraDeRango(fecha) ? (
            <div className="text-sm text-red-600">
              La fecha está fuera del rango permitido (próximos 3 meses).
            </div>
          ) : fechaBloqueada(fecha) ? (
            <div className="text-sm text-red-600">
              El día seleccionado está bloqueado.
            </div>
          ) : !fechaHabilitadaPorHorarios(fecha) ? (
            <div className="text-sm text-red-600">
              El odontólogo no atiende en el día seleccionado.
            </div>
          ) : loadingHoras ? (
            <div className="text-sm text-gray-500">
              Calculando disponibilidad…
            </div>
          ) : horaOptions.length === 0 ? (
            <div className="text-sm text-red-600">
              No hay horarios disponibles para {toDDMMYYYY(fecha)}.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Mañana */}
              <div>
                <div className="text-sm font-medium mb-1">En la mañana</div>
                <div className="flex flex-wrap gap-2">
                  {horaOptions.filter(
                    (h) => parseInt(h.t.slice(0, 2)) < LUNCH_FROM
                  ).length === 0 && (
                    <div className="text-xs text-gray-500">Sin horarios.</div>
                  )}
                  {horaOptions
                    .filter((h) => parseInt(h.t.slice(0, 2)) < LUNCH_FROM)
                    .map((h) => {
                      const active =
                        horaSel === h.t &&
                        horaSelConsultorio === h.consultorioId;
                      const original =
                        originalFechaRef.current === fecha &&
                        originalHoraRef.current === h.t &&
                        originalConsultorioRef.current === h.consultorioId;
                      const baseBtn = "px-2.5 py-1.5 rounded-lg border text-xs";
                      const cls = active
                        ? "bg-blue-600 text-white border-blue-600"
                        : original
                        ? "bg-violet-100 text-violet-900 border-violet-200"
                        : "bg-white hover:bg-gray-50";
                      return (
                        <button
                          key={`m-${h.t}-${h.consultorioId}`}
                          onClick={() => {
                            setHoraSel(h.t);
                            setHoraSelConsultorio(h.consultorioId);
                          }}
                          className={`${baseBtn} ${cls}`}
                          title={
                            original
                              ? "Hora original"
                              : h.isDefault
                              ? "Consultorio por defecto"
                              : "Consultorio alterno"
                          }
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
                  {horaOptions.filter(
                    (h) => parseInt(h.t.slice(0, 2)) >= LUNCH_TO
                  ).length === 0 && (
                    <div className="text-xs text-gray-500">Sin horarios.</div>
                  )}
                  {horaOptions
                    .filter((h) => parseInt(h.t.slice(0, 2)) >= LUNCH_TO)
                    .map((h) => {
                      const active =
                        horaSel === h.t &&
                        horaSelConsultorio === h.consultorioId;
                      const original =
                        originalFechaRef.current === fecha &&
                        originalHoraRef.current === h.t &&
                        originalConsultorioRef.current === h.consultorioId;
                      const baseBtn = "px-2.5 py-1.5 rounded-lg border text-xs";
                      const cls = active
                        ? "bg-blue-600 text-white border-blue-600"
                        : original
                        ? "bg-violet-100 text-violet-900 border-violet-200"
                        : "bg-white hover:bg-gray-50";
                      return (
                        <button
                          key={`t-${h.t}-${h.consultorioId}`}
                          onClick={() => {
                            setHoraSel(h.t);
                            setHoraSelConsultorio(h.consultorioId);
                          }}
                          className={`${baseBtn} ${cls}`}
                          title={
                            original
                              ? "Hora original"
                              : h.isDefault
                              ? "Consultorio por defecto"
                              : "Consultorio alterno"
                          }
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

              {/* (ELIMINADA) Leyenda arriba de Motivo: Hora original / Selección actual */}
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
              <h3 className="text-lg font-semibold">
                Confirmar reprogramación
              </h3>
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
                <b>{effectiveHora || "—"}</b>
              </div>
              <div>
                <span className="text-gray-600">Consultorio: </span>
                <b>
                  {effectiveConsultorio
                    ? consultorios.find((c) => c.id === effectiveConsultorio)
                        ?.nombre ?? `Consultorio ${effectiveConsultorio}`
                    : "—"}
                </b>
              </div>
              <div>
                <span className="text-gray-600">Motivo: </span>
                <b>{motivo || "—"}</b>
              </div>

              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  Estás por <b>reprogramar</b> esta cita a la fecha y hora
                  indicadas. Recuerda que{" "}
                  <b>solo se permite reprogramar una vez</b>.
                </div>
              </div>
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
                Volver
              </button>
              <button
                className="px-3 py-2 rounded-lg border bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={doSubmit}
                disabled={submitting || hardBlocked}
                title={
                  hardBlocked
                    ? "No es posible confirmar por las restricciones vigentes"
                    : "Confirmar reprogramación"
                }
              >
                {submitting ? "Guardando…" : "Sí, reprogramar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
