// src/pages/paciente/GestionarCitas.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { AxiosResponse } from "axios";
import { api } from "../../api/axios";
import {
  CalendarDays,
  CalendarSearch,
  CalendarCog,
  Clock,
  Building2,
  CheckCircle2,
  RotateCcw,
  XCircle,
  Loader2,
  Stethoscope,
  Eraser,
  Search,
  Info,
  AlertTriangle,
  Phone,
} from "lucide-react";
import { e164ToLocal } from "../../utils/phoneFormat";

/* ========================= Tipos ========================= */
type Estado = "pendiente" | "confirmada" | "cancelada" | "realizada";

type Cita = {
  id_cita: number;
  fecha: string; // "YYYY-MM-DD"
  hora_inicio?: string | null;
  hora_fin?: string | null;
  motivo?: string | null;
  estado: Estado;

  odontologo?: { id_odontologo: number; nombre: string } | null;
  odontologo_nombre?: string | null;

  odontologo_especialidades?: string[] | null;
  especialidad?: { id_especialidad: number; nombre: string } | null;
  especialidad_nombre?: string | null;

  consultorio?: { id_consultorio: number; numero?: string } | null;

  // Ventanas calculadas en backend (opcionales)
  confirmable_hasta?: string | null;
  reprogramable_hasta?: string | null;
  cancelable_hasta?: string | null;

  // Para bloqueo de reprogramación por contador
  reprogramaciones?: number | null;
  ya_reprogramada?: boolean | null;

  // Compatibilidad legacy
  reprogramada_veces?: number | null;
  reprogramada?: boolean | null;
};

type OdoOption = {
  value: string;
  label: string;
  especialidades?: string[];
  especialidades_detalle?: { nombre: string | null; estado?: boolean }[];
};

/* ========================= Config UI ========================= */
const BRAND = "#0070B7";
const ACTION_BTN_BASE =
  "inline-flex items-center justify-center gap-1 rounded-md text-xs font-medium text-white h-8 px-2 whitespace-nowrap";
const BTN_CONFIRM = "bg-green-600 hover:bg-green-700 disabled:opacity-70";
const BTN_REPROG =
  "bg-[color:var(--brand)] hover:brightness-90 disabled:opacity-70";
const BTN_CANCEL = "bg-red-600 hover:bg-red-700 disabled:opacity-70";

/* ========================= Helpers ========================= */
function isBeforeOrEqualNow(iso?: string | null) {
  if (!iso) return false;
  const t = new Date(iso);
  if (Number.isNaN(+t)) return false;
  return t.getTime() < Date.now();
}

function formatFechaLargo(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "full",
    timeZone: "America/Guayaquil",
  }).format(dt);
}

function formatHora(h?: string | null) {
  if (!h) return "";
  const m = /^(\d{2}:\d{2})(:\d{2})?$/.exec(h);
  return m ? m[1] : h;
}

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
      next = null;
    } else {
      out.push(...((data?.results ?? []) as T[]));
      next = data?.next ?? null;
    }
    page++;
  }
  return out;
}

// === Helpers para ventana de confirmación (horas) ===
function parseDateTimeLocal(ymd: string, hhmm?: string | null) {
  const [H, M] = (hhmm || "00:00").split(":").map((x) => parseInt(x, 10));
  const [Y, m, D] = ymd.split("-").map((x) => parseInt(x, 10));
  return new Date(Y, (m || 1) - 1, D, H || 0, M || 0, 0, 0);
}
function hoursUntil(d: Date) {
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  return ms / (1000 * 60 * 60);
}

/* ========================= Toasts mínimos ========================= */
type ToastKind = "success" | "error" | "info" | "warning";
type ToastItem = { id: number; kind: ToastKind; msg: string };

function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = (kind: ToastKind, msg: string, ms = 3500) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, kind, msg }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, ms);
  };
  const remove = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  return { toasts, show, remove };
}

/* ========================= Modal ========================= */
type ModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmText?: string;
  confirmKind?: "primary" | "danger";
  cancelText?: string;
  onConfirm: () => void;
  onClose: () => void;
  confirming?: boolean;
};
function Modal({
  open,
  title,
  children,
  confirmText = "Confirmar",
  confirmKind = "primary",
  cancelText = "Cerrar",
  onConfirm,
  onClose,
  confirming,
}: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-[61] w-[92%] max-w-lg rounded-xl bg-white shadow-xl">
        <div className="px-5 pt-4 pb-3 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
        <div className="px-5 py-4 text-sm text-gray-700">{children}</div>
        <div className="px-5 pb-4 pt-2 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
            disabled={!!confirming}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={!!confirming}
            className={`rounded-md px-3 py-2 text-sm font-medium text-white ${
              confirmKind === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[color:var(--brand)] hover:brightness-95"
            }`}
            style={{ ["--brand" as any]: BRAND }}
          >
            {confirming ? "Procesando…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========================= Componente ========================= */
export default function GestionarCitas() {
  const navigate = useNavigate();
  const location = useLocation() as any;

  // Toasts
  const { toasts, show, remove } = useToasts();

  // Modales (con target de cita)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Cita | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Cita | null>(null);
  const [submitting, setSubmitting] = useState<null | "confirmar" | "cancelar">(
    null
  );

  // Configuración dinámica del backend
  const [config, setConfig] = useState<any | null>(null);

  const celularLocal = e164ToLocal(config?.celular_contacto);

  useEffect(() => {
    api
      .get("/configuracion/")
      .then((res) => setConfig(res.data))
      .catch(() => setConfig(null));
  }, []);

  // Valores dinámicos con fallback
  const confirmFromHours: number =
    typeof config?.horas_confirmar_desde === "number"
      ? config.horas_confirmar_desde
      : 24;
  const confirmUntilHours: number =
    typeof config?.horas_confirmar_hasta === "number"
      ? config.horas_confirmar_hasta
      : 12;
  const maxReprogramaciones: number =
    typeof config?.max_reprogramaciones === "number"
      ? config.max_reprogramaciones
      : 1;

  // Lee state.toast si se navegó aquí con un mensaje
  useEffect(() => {
    const incoming = location?.state?.toast;
    if (incoming?.msg) {
      show(incoming.kind ?? "success", String(incoming.msg));
      navigate(".", { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- filtros mínimos ---------- */
  const [fFecha, setFFecha] = useState(""); // YYYY-MM-DD
  const [fOdonto, setFOdonto] = useState(""); // id_odontologo
  const [fTexto, setFTexto] = useState(""); // motivo/doctor/consultorio

  const [odOptions, setOdOptions] = useState<OdoOption[]>([]);
  const [loadingFiltros, setLoadingFiltros] = useState(true);

  /* ---------- datos ---------- */
  const [citas, setCitas] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setErrorMsg] = useState<string | null>(null);

  /* ---------- catálogos (CON especialidades) ---------- */
  useEffect(() => {
    (async () => {
      try {
        setLoadingFiltros(true);
        const odos = await fetchAll<any>("/odontologos/");
        setOdOptions(
          odos.map((o) => ({
            value: String(o.id_odontologo ?? o.id ?? o.pk),
            label:
              o.nombreCompleto ??
              (
                `${o.nombres ?? ""} ${o.apellidos ?? ""}`.replace(
                  /\s+/g,
                  " "
                ) || "Sin nombre"
              ).trim(),
            especialidades: Array.isArray(o.especialidades)
              ? o.especialidades.filter(Boolean)
              : [],
            especialidades_detalle: Array.isArray(o.especialidades_detalle)
              ? o.especialidades_detalle
              : [],
          }))
        );
      } finally {
        setLoadingFiltros(false);
      }
    })();
  }, []);

  /* ---------- mapa id_odontologo → especialidades activas ---------- */
  const odEspMap = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const o of odOptions) {
      const id = Number(o.value);
      const activas = (o.especialidades_detalle ?? [])
        .filter((e) => e && e.estado !== false && e.nombre)
        .map((e) => String(e.nombre))
        .filter(Boolean);
      let list = activas;
      if (
        !list.length &&
        Array.isArray(o.especialidades) &&
        o.especialidades.length
      ) {
        list = o.especialidades.filter(Boolean) as string[];
      }
      map.set(id, list);
    }
    return map;
  }, [odOptions]);

  /* ---------- loader de citas pendientes y confirmadas (con filtros) ---------- */
  const mapRow = (c: any): Cita => {
    const odo = c.odontologo
      ? {
          id_odontologo: c.odontologo.id_odontologo ?? c.odontologo.id,
          nombre:
            c.odontologo.nombreCompleto ??
            `${c.odontologo.nombres ?? ""} ${
              c.odontologo.apellidos ?? ""
            }`.trim(),
        }
      : c.odontologo_nombre
      ? { id_odontologo: c.id_odontologo ?? 0, nombre: c.odontologo_nombre }
      : null;

    const especialidadesSet = new Set<string>();
    if (c.especialidad?.nombre)
      especialidadesSet.add(String(c.especialidad.nombre));
    if (c.especialidad_nombre)
      especialidadesSet.add(String(c.especialidad_nombre));
    if (Array.isArray(c?.odontologo_especialidades))
      c.odontologo_especialidades.forEach(
        (n: any) => n && especialidadesSet.add(String(n))
      );

    const oid = odo?.id_odontologo ?? c.id_odontologo;
    if (Number.isFinite(oid)) {
      const fromCatalog = odEspMap.get(Number(oid)) ?? [];
      fromCatalog.forEach((n) => especialidadesSet.add(n));
    }

    const esps = Array.from(especialidadesSet);

    return {
      id_cita: Number(c.id_cita ?? c.id),
      fecha: String(c.fecha),
      hora_inicio: c.hora_inicio ?? c.hora ?? null,
      hora_fin: c.hora_fin ?? null,
      motivo: c.motivo ?? null,
      estado: c.estado,
      odontologo: odo,
      odontologo_nombre: c.odontologo_nombre ?? undefined,
      odontologo_especialidades: esps.length ? esps : null,
      especialidad: c.especialidad ?? null,
      especialidad_nombre: c.especialidad_nombre ?? null,
      consultorio: c.consultorio
        ? {
            id_consultorio: c.consultorio.id_consultorio ?? c.consultorio.id,
            numero: c.consultorio.numero,
          }
        : c.id_consultorio
        ? {
            id_consultorio: c.id_consultorio,
            numero: c.consultorio_numero ?? "-",
          }
        : null,
      confirmable_hasta: c.confirmable_hasta ?? null,
      reprogramable_hasta: c.reprogramable_hasta ?? null,
      cancelable_hasta: c.cancelable_hasta ?? null,
      reprogramaciones: c.reprogramaciones ?? null,
      ya_reprogramada: c.ya_reprogramada ?? null,
      reprogramada_veces: c.reprogramada_veces ?? null,
      reprogramada: c.reprogramada ?? null,
    } as Cita;
  };

  const fetchListado = async (signal?: AbortSignal) => {
    const baseParams = {
      mine: 1,
      ordering: "fecha,hora_inicio",
      page_size: 500,
      ...(fFecha ? { fecha: fFecha } : {}),
      ...(fOdonto ? { id_odontologo: fOdonto } : {}),
    };

    // Hacemos 2 requests: pendientes y confirmadas
    const [resPend, resConf] = await Promise.all([
      api.get("/citas/", {
        params: { ...baseParams, estado: "pendiente" },
        signal: signal as any,
      }),
      api.get("/citas/", {
        params: { ...baseParams, estado: "confirmada" },
        signal: signal as any,
      }),
    ]);

    const rowsP: any[] = Array.isArray(resPend.data)
      ? resPend.data
      : resPend.data?.results ?? [];
    const rowsC: any[] = Array.isArray(resConf.data)
      ? resConf.data
      : resConf.data?.results ?? [];

    // Unimos y mapeamos
    const merged = [...rowsP, ...rowsC].map(mapRow);

    // Orden por fecha/hora (por si vienen mezcladas)
    merged.sort((a, b) => {
      const ka = `${a.fecha} ${a.hora_inicio ?? "00:00"}`;
      const kb = `${b.fecha} ${b.hora_inicio ?? "00:00"}`;
      return ka.localeCompare(kb);
    });

    return merged;
  };

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setErrorMsg(null);
        const mapped = await fetchListado(ctrl.signal);
        setCitas(mapped);
      } catch (e: any) {
        if (e?.name !== "CanceledError") {
          console.error(e);
          setErrorMsg("No se pudieron cargar tus citas.");
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fFecha, fOdonto, odEspMap]);

  /* ---------- filtrado local por texto ---------- */
  const filas = useMemo(() => {
    if (!fTexto.trim()) return citas;
    const q = fTexto.trim().toLowerCase();
    return citas.filter((c) => {
      const t1 = (c.motivo ?? "").toLowerCase();
      const t2 = (
        c.odontologo?.nombre ??
        c.odontologo_nombre ??
        ""
      ).toLowerCase();
      const t3 = (c.consultorio?.numero ?? "").toLowerCase();
      return t1.includes(q) || t2.includes(q) || t3.includes(q);
    });
  }, [citas, fTexto]);

  /* ---------- helpers de UI/acciones ---------- */
  const isAlreadyRescheduled = (c: Cita) => {
    // Si el backend ya marcó bandera explícita, respetamos
    if (c.ya_reprogramada === true) return true;
    if (c.reprogramada === true) return true;

    const countNew =
      typeof c.reprogramaciones === "number" ? c.reprogramaciones : 0;
    const countLegacy =
      typeof c.reprogramada_veces === "number" ? c.reprogramada_veces : 0;
    const total = Math.max(countNew, countLegacy, 0);

    return total >= maxReprogramaciones;
  };

  // Abre modal de confirmar con validación de ventana dinámica + backend
  function abrirConfirmar(c: Cita) {
    if (c.estado !== "pendiente") {
      alert("Esta cita ya está confirmada.");
      return;
    }

    const hrs = hoursUntil(parseDateTimeLocal(c.fecha, c.hora_inicio));
    const backendLimitOk =
      !c.confirmable_hasta || !isBeforeOrEqualNow(c.confirmable_hasta);

    const enVentana =
      hrs !== null &&
      hrs <= confirmFromHours &&
      hrs >= confirmUntilHours &&
      backendLimitOk;

    if (!enVentana) {
      if (!backendLimitOk) {
        alert(
          "La ventana de confirmación ha concluido. Para gestionar la cita, comunícate con el consultorio."
        );
      } else if (hrs !== null && hrs > confirmFromHours) {
        alert(
          `La confirmación se habilitará ${confirmFromHours} h antes de la cita.`
        );
      } else {
        alert(
          "La ventana de confirmación ha concluido. Para gestionar la cita, comunícate con el consultorio."
        );
      }
      return;
    }

    setConfirmTarget(c);
    setConfirmModalOpen(true);
  }

  async function doConfirm() {
    if (!confirmTarget) return;
    setSubmitting("confirmar");
    try {
      await api.patch(`/citas/${confirmTarget.id_cita}/confirmar/`);
      // Actualizamos estado localmente
      setCitas((prev) =>
        prev.map((x) =>
          x.id_cita === confirmTarget.id_cita
            ? { ...x, estado: "confirmada" }
            : x
        )
      );
      show("success", "Cita confirmada.");
    } catch (e: any) {
      show("error", e?.response?.data?.detail ?? "No se pudo confirmar.");
    } finally {
      setSubmitting(null);
      setConfirmModalOpen(false);
      setConfirmTarget(null);
    }
  }

  // Abre modal de cancelar
  function abrirCancelar(c: Cita) {
    setCancelTarget(c);
    setCancelModalOpen(true);
  }

  async function doCancel() {
    if (!cancelTarget) return;
    setSubmitting("cancelar");
    try {
      await api.patch(`/citas/${cancelTarget.id_cita}/cancelar/`);
      // Si cancela, la quitamos del listado de pendientes/confirmadas
      setCitas((prev) =>
        prev.filter((x) => x.id_cita !== cancelTarget.id_cita)
      );
      show("success", "Cita cancelada.");
    } catch (e: any) {
      show("error", e?.response?.data?.detail ?? "No se pudo cancelar.");
    } finally {
      setSubmitting(null);
      setCancelModalOpen(false);
      setCancelTarget(null);
    }
  }

  function irAReprogramar(c: Cita) {
    if (c.estado === "confirmada") {
      // Bloqueado por regla de negocio
      return;
    }
    if (isAlreadyRescheduled(c)) {
      return;
    }
    if (c.reprogramable_hasta && isBeforeOrEqualNow(c.reprogramable_hasta)) {
      return alert("El tiempo para reprogramar ya pasó.");
    }
    navigate(`/paciente/mis-citas/reprogramar/${c.id_cita}`, {
      state: { from: "/paciente/mis-citas/gestionar" },
    });
  }

  /* ---------- UI ---------- */
  const badgeByEstado: Record<Estado, string> = {
    pendiente:
      "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-amber-100 text-amber-800 border-amber-200",
    confirmada:
      "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-green-100 text-green-800 border-green-200",
    realizada:
      "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-blue-100 text-blue-800 border-blue-200",
    cancelada:
      "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-red-100 text-red-800 border-red-200",
  };

  return (
    <div className="space-y-6" style={{ ["--brand" as any]: BRAND }}>
      {/* Toasts (stack superior derecha) */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              "flex items-start gap-2 rounded-lg border px-3 py-2 shadow-md bg-white",
              t.kind === "success" && "border-green-200",
              t.kind === "error" && "border-red-200",
              t.kind === "info" && "border-blue-200",
              t.kind === "warning" && "border-amber-200",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="mt-0.5">
              {t.kind === "success" && (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              )}
              {t.kind === "error" && (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
              {t.kind === "info" && <Info className="w-4 h-4 text-blue-600" />}
              {t.kind === "warning" && (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
            </div>
            <div className="text-sm">{t.msg}</div>
            <button
              className="ml-2 text-gray-400 hover:text-gray-600"
              onClick={() => remove(t.id)}
              aria-label="Cerrar"
              title="Cerrar"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarCog className="h-7 w-7" />
          Gestionar citas
        </h1>
      </div>

      {/* Filtros */}
      <section className="rounded-2xl p-4 shadow bg-white">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <CalendarSearch className="h-5 w-5" />
            Filtrar
          </h3>
          <button
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm bg-white hover:bg-gray-50"
            onClick={() => {
              setFFecha("");
              setFOdonto("");
              setFTexto("");
            }}
          >
            <Eraser className="w-4 h-4" />
            Limpiar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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

          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Buscar</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  value={fTexto}
                  onChange={(e) => setFTexto(e.target.value)}
                  placeholder="Motivo, doctor o consultorio…"
                  className="w-full rounded-lg border pl-8 pr-3 py-2 bg-white"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Conteo / estado */}
      <div className="text-sm text-gray-500">
        {loading
          ? "Cargando citas…"
          : `${filas.length} cita(s) pendiente(s) o confirmada(s)`}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="p-10 flex items-center justify-center text-gray-500 gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando…
        </div>
      ) : filas.length === 0 ? (
        <div className="p-8 text-center text-gray-600">
          <p className="font-medium">
            No tienes citas pendientes o confirmadas.
          </p>
          <p className="text-sm mt-1">
            Agenda una nueva desde <b>Agendar Citas</b>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filas.map((c) => {
            const alreadyRes = isAlreadyRescheduled(c);

            // Confirmación: dinámica según config + backend
            const hrsToAppt = hoursUntil(
              parseDateTimeLocal(c.fecha, c.hora_inicio)
            );
            const backendConfirmLimitOk =
              !c.confirmable_hasta || !isBeforeOrEqualNow(c.confirmable_hasta);

            const confirmWindowPassed =
              !backendConfirmLimitOk ||
              (hrsToAppt !== null && hrsToAppt < confirmUntilHours);

            const confirmWindowOk =
              hrsToAppt !== null &&
              hrsToAppt <= confirmFromHours &&
              hrsToAppt >= confirmUntilHours &&
              backendConfirmLimitOk;
            const disableConfirm = c.estado !== "pendiente" || !confirmWindowOk;

            // Reprogramación: si está confirmada, siempre bloqueada
            // También bloqueada si pasó la ventana de confirmación (seguridad)
            const disableReprogByTime =
              confirmWindowPassed ||
              (!!c.reprogramable_hasta &&
                isBeforeOrEqualNow(c.reprogramable_hasta));
            const reprogramDisabled =
              c.estado === "confirmada" || alreadyRes || disableReprogByTime;

            // Cancelación: si está confirmada, bloquear desde la app
            // También bloqueada si pasó la ventana de confirmación (seguridad)
            const disableCancelByTime =
              c.estado === "confirmada" ||
              confirmWindowPassed ||
              (!!c.cancelable_hasta && isBeforeOrEqualNow(c.cancelable_hasta));

            return (
              <div
                key={c.id_cita}
                className="rounded-2xl shadow-md bg-white overflow-hidden flex flex-col transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:bg-gradient-to-br hover:from-white hover:to-blue-50/30 cursor-pointer"
              >
                <div className="p-4 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold">
                      {c.motivo ?? "Cita odontológica"}
                    </h3>
                    <div className="mt-1 text-sm text-gray-700 flex items-center gap-2">
                      <Stethoscope className="h-4 w-4" />
                      <span>
                        {c.odontologo?.nombre ?? c.odontologo_nombre ?? "—"}
                      </span>
                    </div>
                    {(() => {
                      const explicit = Array.isArray(
                        c.odontologo_especialidades
                      )
                        ? c.odontologo_especialidades
                        : null;
                      const oid = c.odontologo?.id_odontologo as
                        | number
                        | undefined;
                      const fromCatalog = oid ? odEspMap.get(oid) : undefined;
                      const list =
                        (explicit && explicit.length
                          ? explicit
                          : fromCatalog) ?? [];
                      return list.length ? (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {list.join(", ")}
                        </div>
                      ) : null;
                    })()}
                  </div>

                  <span className={badgeByEstado[c.estado]}>
                    {c.estado.charAt(0).toUpperCase() + c.estado.slice(1)}
                  </span>
                </div>

                <div className="px-4 pb-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-gray-500" />
                    <span>{formatFechaLargo(c.fecha)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-500" />
                    <span className="tabular-nums">
                      {formatHora(c.hora_inicio) || "—"}
                      {c.hora_fin ? ` – ${formatHora(c.hora_fin)}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-gray-500" />
                    <span>Consultorio {c.consultorio?.numero ?? "—"}</span>
                  </div>

                  {/* Nota si ya fue reprogramada */}
                  {alreadyRes && c.estado !== "confirmada" && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                      <Phone size={20} className="mt-0.5 text-amber-700" />
                      <span>
                        Esta cita ya fue{" "}
                        <b>
                          reprogramada{" "}
                          {maxReprogramaciones > 1
                            ? `${maxReprogramaciones} veces`
                            : "una vez"}
                        </b>
                        . Si necesitas reprogramarla nuevamente, por favor{" "}
                        <b>
                          comunícate con el consultorio al{" "}
                          {celularLocal || "09XXXXXXX"}
                        </b>
                        .
                      </span>
                    </div>
                  )}

                  {/* Mensaje especial para confirmadas */}
                  {c.estado === "confirmada" && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-green-800 bg-green-50 border border-green-200 rounded p-2">
                      <Info size={20} className="mt-0.5 text-green-700" />
                      <span>
                        Esta cita está <b>confirmada</b>. Desde la aplicación no
                        puedes <b>reprogramar</b> ni <b>cancelar</b>. Si te
                        surge una <b>emergencia</b> y necesitas gestionar la
                        cita, por favor{" "}
                        <b>
                          llama al consultorio al {celularLocal || "09XXXXXXX"}
                        </b>
                        .
                      </span>
                    </div>
                  )}

                  {/* Ayuda de confirmación (solo si está pendiente) */}
                  {c.estado === "pendiente" && (
                    <div className="text-xs text-gray-600">
                      {hrsToAppt == null ? null : confirmWindowPassed ? (
                        <>
                          La ventana de confirmación ha concluido. Para
                          gestionar la cita, comunícate con el consultorio al{" "}
                          <b>{celularLocal || "09XXXXXXX"}</b>.
                        </>
                      ) : confirmWindowOk ? (
                        <>
                          Puedes confirmar tu asistencia ahora. La confirmación
                          está disponible desde <b>{confirmFromHours} h</b>{" "}
                          hasta <b>{confirmUntilHours} h</b> antes de la cita.
                        </>
                      ) : hrsToAppt > confirmFromHours ? (
                        <>
                          La confirmación se habilitará{" "}
                          <b>{confirmFromHours} h</b> antes de la cita.
                        </>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="mt-auto border-t px-4 py-3 flex items-center justify-between gap-1 flex-wrap md:flex-nowrap">
                  <button
                    onClick={() => irAReprogramar(c)}
                    className={`${ACTION_BTN_BASE} ${BTN_REPROG}`}
                    disabled={reprogramDisabled}
                    title={
                      c.estado === "confirmada"
                        ? "No puedes reprogramar una cita confirmada desde la app"
                        : alreadyRes
                        ? "Ya no puedes reprogramar nuevamente desde la app"
                        : confirmWindowPassed
                        ? "La ventana de confirmación pasó. Todas las opciones están bloqueadas por seguridad"
                        : disableReprogByTime
                        ? "El tiempo para reprogramar ya pasó"
                        : "Reprogramar / Editar"
                    }
                    style={{ ["--brand" as any]: BRAND }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reprogramar
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => abrirCancelar(c)}
                      className={`${ACTION_BTN_BASE} ${BTN_CANCEL}`}
                      disabled={disableCancelByTime}
                      title={
                        c.estado === "confirmada"
                          ? "No puedes cancelar una cita confirmada desde la app"
                          : confirmWindowPassed
                          ? "La ventana de confirmación pasó. Todas las opciones están bloqueadas por seguridad"
                          : disableCancelByTime
                          ? "El tiempo para cancelar ya pasó"
                          : "Cancelar"
                      }
                    >
                      <XCircle className="h-4 w-4" />
                      Cancelar
                    </button>

                    <button
                      onClick={() => abrirConfirmar(c)}
                      className={`${ACTION_BTN_BASE} ${BTN_CONFIRM}`}
                      disabled={disableConfirm}
                      title={
                        c.estado !== "pendiente"
                          ? "Ya está confirmada"
                          : !confirmWindowOk
                          ? `Solo puedes confirmar entre ${confirmFromHours} h y ${confirmUntilHours} h antes`
                          : "Confirmar"
                      }
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Confirmar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal confirmar */}
      <Modal
        open={confirmModalOpen}
        title="Confirmar asistencia a la cita"
        confirmText="Sí, confirmar"
        onConfirm={doConfirm}
        onClose={() => {
          setConfirmModalOpen(false);
          setConfirmTarget(null);
        }}
        confirming={submitting === "confirmar"}
      >
        <div className="space-y-2">
          <p>
            ¿Estás segura/o de <b>confirmar tu asistencia</b>? Esta acción{" "}
            <b>no se puede deshacer</b> desde la aplicación.
          </p>
          <p className="text-sm text-gray-700">
            Tras confirmar, <b>no podrás reprogramar ni cancelar</b> desde la
            app. Si confirmas y no asistes, tu cuenta podría ser{" "}
            <b>temporalmente bloqueada</b>.
          </p>
          <p className="text-sm text-gray-700">
            En caso de una emergencia, por favor <b>llama al consultorio</b>{" "}
            para notificar y solicitar cancelación o reprogramación.
          </p>
        </div>
      </Modal>

      {/* Modal cancelar */}
      <Modal
        open={cancelModalOpen}
        title="Cancelar cita"
        confirmText="Sí, cancelar"
        confirmKind="danger"
        onConfirm={doCancel}
        onClose={() => {
          setCancelModalOpen(false);
          setCancelTarget(null);
        }}
        confirming={submitting === "cancelar"}
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            ¿Estás seguro de que deseas <b>cancelar esta cita</b>?
          </p>

          <ul className="list-disc pl-5 space-y-1">
            <li>
              Te recomendamos <b>reprogramar</b> en lugar de cancelar. El
              sistema permite reprogramar hasta{" "}
              <b>{config?.max_reprogramaciones ?? 1} vez(es)</b>.
            </li>

            <li>
              Si cancelas, se aplicará una <b>penalización automática</b> y no
              podrás agendar nuevamente con este odontólogo durante{" "}
              <b>{config?.cooldown_dias ?? 7} día(s)</b>. Esta restricción{" "}
              <b>solo aplica para este odontólogo</b> — podrás agendar con otros
              especialistas sin problemas.
            </li>

            <li>
              La penalización se levanta automáticamente una vez cumplido el
              tiempo indicado.
            </li>

            <li>
              Si necesitas una <b>cita de emergencia</b> o gestión especial,
              comunícate al consultorio: <b>{celularLocal || "09XXXXXXX"}</b>.
            </li>
          </ul>

          <p className="text-xs text-gray-500">
            Esta acción no se puede deshacer desde la aplicación.
          </p>
        </div>
      </Modal>
    </div>
  );
}
