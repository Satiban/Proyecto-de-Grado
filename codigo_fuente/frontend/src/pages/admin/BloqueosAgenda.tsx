import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Pencil,
  X,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import { api } from "../../api/axios";

/* ===================== Config de endpoints especiales ===================== */
/** Si tus endpoints reales quedaron en otra ruta, ajusta aquí */
const PREVIEW_URL = (groupId: string) =>
  `/bloqueos-dias/${groupId}/preview-mantenimiento/`;
const APPLY_URL = (groupId: string) =>
  `/bloqueos-dias/${groupId}/apply-mantenimiento/`;
const REACTIVAR_URL = (groupId: string) =>
  `/bloqueos-dias/${groupId}/apply-reactivar/`;
const PREVIEW_COLLECTION_URL = `/bloqueos-dias/preview-mantenimiento/`;
const CREATE_AND_APPLY_URL = `/bloqueos-dias/create-and-apply/`;

/* ===================== Tipos ===================== */
type OdontologoOpt = { id: number; nombre: string };
type Bloqueo = {
  id: string; // UUID de grupo
  fecha_inicio: string; // "YYYY-MM-DD"
  fecha_fin: string; // "YYYY-MM-DD"
  motivo?: string | null;
  id_odontologo?: number | null; // null => global
  odontologo_nombre?: string | null;
  recurrente_anual?: boolean;
};

type PreviewItem = {
  id_cita: number | string;
  fecha: string; // "YYYY-MM-DD"
  hora?: string | null;
  id_paciente__id_usuario__primer_nombre?: string | null;
  id_paciente__id_usuario__primer_apellido?: string | null;
  id_paciente__id_usuario__celular?: string | null;
  id_odontologo__id_usuario__primer_nombre?: string | null;
  id_odontologo__id_usuario__primer_apellido?: string | null;
};

type PreviewResponse = {
  total_afectadas: number;
  por_estado: Record<string, number>;
  items: PreviewItem[];
};

type ApplyResponse = {
  batch_id: string;
  total_mantenimiento: number;
  items: PreviewItem[];
};

// === TOAST: tipos y ayudas
type Toast = { id: number; message: string };
let toastSeq = 1;

/* ===================== Utils de fechas (LOCAL, no UTC) ===================== */
const fmtYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function parseYMDLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1); // medianoche local
}

function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addMonths(d: Date, n: number) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function betweenInclusive(day: Date, start: Date, end: Date) {
  const ds = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const de = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const dd = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  return dd.getTime() >= ds.getTime() && dd.getTime() <= de.getTime();
}
function occursOnDate(b: Bloqueo, day: Date): boolean {
  const s = parseYMDLocal(b.fecha_inicio);
  const e = parseYMDLocal(b.fecha_fin);

  if (!b.recurrente_anual) {
    return betweenInclusive(day, s, e);
  }

  // Recurrente anual: comparar por MM-DD
  const toMMDD = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  const mmddDay = toMMDD(day);
  const mmddS = toMMDD(s);
  const mmddE = toMMDD(e);

  // Rango que no cruza año vs cruza año
  if (mmddS <= mmddE) {
    return mmddDay >= mmddS && mmddDay <= mmddE;
  } else {
    return mmddDay >= mmddS || mmddDay <= mmddE;
  }
}

// Construye 6 filas x 7 días (inicia en lunes)
function buildCalendarMatrix(baseMonth: Date) {
  const first = startOfMonth(baseMonth);
  const firstWeekDay = (first.getDay() + 6) % 7; // 0 = lunes ... 6 = domingo
  const start = new Date(first);
  start.setDate(first.getDate() - firstWeekDay);
  const weeks: Date[][] = [];
  let cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/* ===================== Helpers UI ===================== */
const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function truncate(txt: string, n = 14) {
  if (!txt) return "";
  return txt.length > n ? txt.slice(0, n - 1) + "…" : txt;
}

function shortPersonName(full?: string | null) {
  if (!full) return "";
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0]}.`;
}

function safeHora(h?: string | null) {
  return (h || "").slice(0, 5);
}

function nombrePersona(pn?: string | null, pa?: string | null) {
  return [pn, pa].filter(Boolean).join(" ");
}

function downloadCSV(filename: string, rows: PreviewItem[]) {
  const headers = [
    "id_cita",
    "fecha",
    "hora",
    "paciente",
    "celular",
    "odontologo",
  ];

  const lines = [headers.join(",")];
  for (const r of rows) {
    const paciente = nombrePersona(
      r.id_paciente__id_usuario__primer_nombre,
      r.id_paciente__id_usuario__primer_apellido
    );
    const odonto = nombrePersona(
      r.id_odontologo__id_usuario__primer_nombre,
      r.id_odontologo__id_usuario__primer_apellido
    );
    const vals = [
      r.id_cita,
      r.fecha,
      safeHora(r.hora),
      paciente,
      r.id_paciente__id_usuario__celular || "",
      odonto,
    ];
    const escaped = vals.map((v) => {
      const s = (v ?? "").toString();
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    lines.push(escaped.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===================== Component ===================== */
export default function BloqueosAgenda() {
  const navigate = useNavigate();

  // Mes base (mostramos base y base+1)
  const [baseMonth, setBaseMonth] = useState<Date>(() => {
    const now = new Date();
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
    return now;
  });

  const [odontologos, setOdontologos] = useState<OdontologoOpt[]>([]);
  const [selectedOdonto, setSelectedOdonto] = useState<number | "todos">(
    "todos"
  );

  const [loading, setLoading] = useState(false);
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Panel lateral (día seleccionado)
  const [openPanel, setOpenPanel] = useState(false);
  const [panelDate, setPanelDate] = useState<Date | null>(null);

  // === TOAST
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (message: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4500);
  };

  // Form de creación/edición
  const [editItem, setEditItem] = useState<Bloqueo | null>(null);
  const [form, setForm] = useState<{
    fecha_inicio: string;
    fecha_fin: string;
    motivo: string;
    tipo: "global" | "odontologo";
    id_odontologo?: number | null;
    recurrente_anual: boolean;
  }>({
    fecha_inicio: "",
    fecha_fin: "",
    motivo: "",
    tipo: "global",
    id_odontologo: undefined,
    recurrente_anual: false,
  });

  // Estado del modal de confirmación (preview/apply mantenimiento)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [pendingPayload, setPendingPayload] = useState<any | null>(null);

  // Controles Mes/Año
  const selYear = baseMonth.getFullYear();
  const selMonth = baseMonth.getMonth();
  const YEARS = useMemo(() => {
    const y0 = new Date().getFullYear();
    const arr: number[] = [];
    for (let y = y0 - 5; y <= y0 + 5; y++) arr.push(y);
    return arr;
  }, []);

  // Rango visible (desde el 1er día que se muestra en el primer mes, hasta el último día visible del segundo mes)
  const range = useMemo(() => {
    const m1 = startOfMonth(baseMonth);
    const m2 = startOfMonth(addMonths(baseMonth, 1));
    const start = new Date(buildCalendarMatrix(m1)[0][0]);
    const end = new Date(buildCalendarMatrix(m2)[5][6]);
    return { start, end };
  }, [baseMonth]);

  const [motivoErr, setMotivoErr] = useState<string | null>(null);
  // Cargar odontólogos
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get("/odontologos/", {
          params: { activo: true },
        });
        const data = (
          Array.isArray(res.data) ? res.data : res.data?.results || []
        ).map((o: any) => ({
          id: o.id_odontologo ?? o.id ?? 0,
          nombre:
            o.nombreCompleto ||
            [
              o.primer_nombre,
              o.segundo_nombre,
              o.primer_apellido,
              o.segundo_apellido,
            ]
              .filter(Boolean)
              .join(" ") ||
            `Odontólogo ${o.id_odontologo ?? o.id ?? ""}`,
        }));
        if (alive) setOdontologos(data);
      } catch {
        /* silencioso */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Cargar bloqueos del rango visible
  const reloadBloqueos = async () => {
    const res = await api.get("/bloqueos-dias/", {
      params: { start: fmtYMD(range.start), end: fmtYMD(range.end) },
    });
    const data: Bloqueo[] = (
      Array.isArray(res.data) ? res.data : res.data?.results || []
    ).map((b: any) => ({
      id: b.id_bloqueo ?? b.id, // soporta id_bloqueo o id
      fecha_inicio: b.fecha_inicio ?? b.fecha,
      fecha_fin: b.fecha_fin ?? b.fecha,
      motivo: b.motivo ?? null,
      id_odontologo: b.id_odontologo ?? null,
      odontologo_nombre: b.odontologo_nombre ?? null,
      recurrente_anual: Boolean(b.recurrente_anual),
    }));
    setBloqueos(data);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await reloadBloqueos();
      } catch (e: any) {
        if (alive)
          setError(
            e?.response?.data?.detail || "No se pudieron cargar los bloqueos."
          );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range.start, range.end]);

  // Índices por día para pintar el calendario (cálculo por DÍA VISIBLE con fechas locales)
  const byDay = useMemo(() => {
    const map = new Map<
      string,
      { globals: number; porOdonto: number; list: Bloqueo[] }
    >();

    const days: Date[] = [];
    let cur = new Date(range.start);
    while (cur <= range.end) {
      const key = fmtYMD(cur);
      map.set(key, { globals: 0, porOdonto: 0, list: [] });
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }

    for (const day of days) {
      const key = fmtYMD(day);
      let list = bloqueos.filter((b) => occursOnDate(b, day));

      if (selectedOdonto !== "todos") {
        list = list.filter(
          (b) => !b.id_odontologo || b.id_odontologo === selectedOdonto
        );
      }

      const globals = list.filter((b) => !b.id_odontologo).length;
      const porOdonto = list.filter((b) => !!b.id_odontologo).length;

      map.set(key, { globals, porOdonto, list });
    }

    return map;
  }, [bloqueos, range.start, range.end, selectedOdonto]);

  /* ===================== Handlers ===================== */
  const openDay = (d: Date) => {
    setPanelDate(d);
    setOpenPanel(true);
    const ymd = fmtYMD(d);
    setEditItem(null);
    setForm({
      fecha_inicio: ymd,
      fecha_fin: ymd,
      motivo: "",
      tipo: "global",
      id_odontologo: undefined,
      recurrente_anual: false,
    });
  };

  // Crear/editar bloqueo, luego preview → modal → apply (si confirmas)
  const handleCreateOrUpdate = async () => {
    try {
      setError(null);
      const motivoTrim = (form.motivo || "").trim();
      if (!motivoTrim) {
        setMotivoErr("Debes ingresar un motivo.");
        setError("Debes ingresar un motivo.");
        return;
      }
      setMotivoErr(null);

      const payload: any = {
        fecha_inicio: form.fecha_inicio,
        fecha_fin: form.fecha_fin,
        motivo: form.motivo?.trim() || null,
        recurrente_anual: !!form.recurrente_anual,
        id_odontologo:
          form.tipo === "odontologo" ? form.id_odontologo ?? null : null,
      };

      if (!payload.fecha_inicio || !payload.fecha_fin) {
        setError("Debes indicar fecha inicio y fin.");
        return;
      }
      if (
        parseYMDLocal(payload.fecha_inicio) > parseYMDLocal(payload.fecha_fin)
      ) {
        setError("El rango de fechas es inválido (inicio > fin).");
        return;
      }
      if (form.tipo === "odontologo" && !payload.id_odontologo) {
        setError("Selecciona un odontólogo para el bloqueo.");
        return;
      }

      // === MODO EDITAR (conserva flujo anterior con PATCH + preview de grupo) ===
      if (editItem) {
        // 1) actualizar grupo
        const resUpd = await api.patch(
          `/bloqueos-dias/${editItem.id}/`,
          payload
        );
        const updated = resUpd.data;

        // 2) preview por grupo (para confirmar aplicar mantenimiento)
        setConfirmLoading(true);
        let data: PreviewResponse;
        try {
          const r1 = await api.post<PreviewResponse>(
            PREVIEW_URL(updated.id || editItem.id),
            {}
          );
          data = r1.data;
        } catch (e: any) {
          const status = e?.response?.status;
          if (status === 404 || status === 405) {
            const r2 = await api.get<PreviewResponse>(
              PREVIEW_URL(updated.id || editItem.id)
            );
            data = r2.data;
          } else {
            throw e;
          }
        }
        setConfirmLoading(false);
        setPreview(data);
        setPendingPayload(null); // en edición, el confirm seguirá usando APPLY_URL(groupId)
        if (!data?.total_afectadas) {
          // sin afectadas: sólo avisar y refrescar
          pushToast("Bloqueo guardado.");
          await reloadBloqueos();
          setEditItem(null);
          setConfirmOpen(false);
          return;
        }
        setConfirmOpen(true);
        await reloadBloqueos();
        setEditItem(null);
        return;
      }

      // === MODO NUEVO (preview de colección: NO crea nada aún) ===
      setConfirmLoading(true);
      const rPrev = await api.post<PreviewResponse>(
        PREVIEW_COLLECTION_URL,
        payload
      );
      const data = rPrev.data;
      setConfirmLoading(false);

      // Si no hay afectadas: crea de una, sin modal
      if (!data?.total_afectadas) {
        await api.post("/bloqueos-dias/", payload);
        pushToast("Bloqueo guardado.");
        await reloadBloqueos();
        setEditItem(null);
        setConfirmOpen(false);
        return;
      }

      // Hay afectadas: abre modal y guarda el payload para confirmar
      setPreview(data);
      setPendingPayload(payload);
      setConfirmOpen(true);
    } catch (e: any) {
      setConfirmLoading(false);
      const data = e?.response?.data;
      const msg =
        data?.detail ||
        (typeof data === "object"
          ? JSON.stringify(data)
          : "No se pudo guardar el bloqueo.");
      setError(msg);
    }
  };

  const handleDelete = async (row: Bloqueo) => {
    if (
      !confirm(
        "¿Eliminar este bloqueo? Las citas en mantenimiento por este bloqueo volverán a 'pendiente'."
      )
    ) {
      return;
    }
    try {
      // 1) Reactivar (volver a PENDIENTE) citas futuras afectadas por este grupo
      try {
        await api.post(REACTIVAR_URL(row.id), {}); // backend no exige body especial
      } catch (e: any) {
        // Si no se puede reactivar (404 o permisos), continuamos con el borrado pero avisamos
        const msg = e?.response?.data?.detail || null;
        if (msg) pushToast(`Aviso: ${msg}`);
      }

      // 2) Borrar el grupo de bloqueo
      await api.delete(`/bloqueos-dias/${row.id}/`);

      // 3) Actualizar UI
      setBloqueos((prev) => prev.filter((x) => x.id !== row.id));
      pushToast("Bloqueo eliminado y citas reactivadas (si aplicaba).");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "No se pudo eliminar el bloqueo.");
    }
  };

  const monthA = baseMonth;
  const monthB = addMonths(baseMonth, 1);
  const matrixA = buildCalendarMatrix(monthA);
  const matrixB = buildCalendarMatrix(monthB);

  const onChangeMonth = (m: number) => {
    const next = new Date(baseMonth);
    next.setMonth(m, 1);
    next.setHours(0, 0, 0, 0);
    setBaseMonth(next);
  };
  const onChangeYear = (y: number) => {
    const next = new Date(baseMonth);
    next.setFullYear(y, next.getMonth(), 1);
    next.setHours(0, 0, 0, 0);
    setBaseMonth(next);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarX className="size-6 text-red-500" />
          <h1 className="text-2xl font-bold">Bloqueos de Agenda</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/admin/configuracion")}
            className="inline-flex items-center gap-2 rounded-lg border border-black bg-white text-black px-3 py-2 hover:bg-gray-100"
          >
            <ArrowLeft className="size-4" />
            Volver
          </button>
        </div>
      </header>

      <p className="text-gray-600">
        Configura días/fechas no laborables globales o por odontólogo. Da clic
        en un día para ver/gestionar sus bloqueos.
      </p>

      {/* Filtros + Mes/Año */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Flechas de mes */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBaseMonth(addMonths(baseMonth, -1))}
              className="rounded-xl border border-black bg-white p-2 hover:bg-gray-100"
              title="Mes anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => setBaseMonth(addMonths(baseMonth, 1))}
              className="rounded-xl border border-black bg-white p-2 hover:bg-gray-100"
              title="Mes siguiente"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Datepicker simple: Mes / Año */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Mes:</label>
            <select
              value={selMonth}
              onChange={(e) => onChangeMonth(Number(e.target.value))}
              className="rounded-xl border border-black bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MONTHS_ES.map((m, i) => (
                <option key={m} value={i}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>

            <label className="text-sm text-gray-600">Año:</label>
            <select
              value={selYear}
              onChange={(e) => onChangeYear(Number(e.target.value))}
              className="rounded-xl border border-black bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1" />

          {/* Odontólogo */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Odontólogo:</label>
            <select
              value={selectedOdonto}
              onChange={(e) => {
                const val =
                  e.target.value === "todos" ? "todos" : Number(e.target.value);
                setSelectedOdonto(val);
              }}
              className="rounded-xl border border-black bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="todos">Todos</option>
              {odontologos.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500"></span>{" "}
            Global
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500"></span>{" "}
            Por odontólogo
          </span>
        </div>
      </div>

      {/* Calendarios */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CalendarMonth
          title={monthA.toLocaleString("es-EC", {
            month: "long",
            year: "numeric",
          })}
          monthDate={monthA}
          matrix={matrixA}
          byDay={byDay}
          onDayClick={openDay}
        />
        <CalendarMonth
          title={monthB.toLocaleString("es-EC", {
            month: "long",
            year: "numeric",
          })}
          monthDate={monthB}
          matrix={matrixB}
          byDay={byDay}
          onDayClick={openDay}
        />
      </div>

      {/* Panel lateral (gestión por día) */}
      {openPanel && panelDate && (
        <SidePanel
          onClose={() => setOpenPanel(false)}
          title={`Gestión de ${panelDate.toLocaleDateString("es-EC")}`}
        >
          {error && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <DayBlockList
            day={panelDate}
            items={byDay.get(fmtYMD(panelDate))?.list || []}
            onEdit={(row) => {
              setEditItem(row);
              setForm({
                fecha_inicio: row.fecha_inicio,
                fecha_fin: row.fecha_fin,
                motivo: row.motivo || "",
                tipo: row.id_odontologo ? "odontologo" : "global",
                id_odontologo: row.id_odontologo ?? undefined,
                recurrente_anual: Boolean(row.recurrente_anual),
              });
            }}
            onDelete={handleDelete}
          />

          {/* Crear/Editar */}
          <div className="mt-4 rounded-xl border p-3 text-sm">
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <Plus className="size-4" />
              {editItem ? "Editar bloqueo" : "Nuevo bloqueo"}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500">Desde</label>
                <input
                  type="date"
                  value={form.fecha_inicio}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fecha_inicio: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500">Hasta</label>
                <input
                  type="date"
                  value={form.fecha_fin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fecha_fin: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Motivo</label>
                <input
                  value={form.motivo}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, motivo: e.target.value }));
                    if (motivoErr) setMotivoErr(null);
                  }}
                  placeholder="Ej. Feriado nacional"
                  aria-invalid={!!motivoErr}
                  className={
                    "mt-1 w-full rounded-xl border px-3 py-2 " +
                    (motivoErr
                      ? "border-red-500 focus:ring-2 focus:ring-red-500"
                      : "")
                  }
                />
                {motivoErr && (
                  <p className="mt-1 text-xs text-red-600">{motivoErr}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-500">Tipo</label>
                <select
                  value={form.tipo}
                  onChange={(e) => {
                    const nextTipo = e.target.value as "global" | "odontologo";
                    setForm((f) => ({
                      ...f,
                      tipo: nextTipo,
                      id_odontologo:
                        nextTipo === "global" ? undefined : f.id_odontologo,
                      recurrente_anual:
                        nextTipo === "odontologo" ? false : f.recurrente_anual,
                    }));
                  }}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                >
                  <option value="global">Global</option>
                  <option value="odontologo">Por odontólogo</option>
                </select>
              </div>

              {form.tipo === "odontologo" && (
                <div>
                  <label className="block text-xs text-gray-500">
                    Odontólogo
                  </label>
                  <select
                    value={form.id_odontologo ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        id_odontologo: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                  >
                    <option value="">— Seleccionar —</option>
                    {odontologos.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {form.tipo === "global" && (
                <div className="flex items-center gap-2 md:col-span-2">
                  <input
                    id="recurrente"
                    type="checkbox"
                    checked={form.recurrente_anual}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        recurrente_anual: e.target.checked,
                      }))
                    }
                    className="rounded border"
                  />
                  <label htmlFor="recurrente" className="text-sm text-gray-700">
                    Recurrente anual (se repetirá cada año en el mismo rango)
                  </label>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              {editItem && (
                <button
                  onClick={() => {
                    setEditItem(null);
                    if (panelDate) {
                      const ymd = fmtYMD(panelDate);
                      setForm({
                        fecha_inicio: ymd,
                        fecha_fin: ymd,
                        motivo: "",
                        tipo: "global",
                        id_odontologo: undefined,
                        recurrente_anual: false,
                      });
                    }
                  }}
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 inline-flex items-center gap-2"
                >
                  <X className="size-4" />
                  Cancelar
                </button>
              )}
              <button
                onClick={handleCreateOrUpdate}
                className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 inline-flex items-center gap-2"
              >
                <Plus className="size-4" />
                {editItem ? "Guardar cambios" : "Añadir bloqueo"}
              </button>
            </div>
          </div>
        </SidePanel>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-sm text-gray-500">
          Cargando bloqueos del periodo {fmtYMD(range.start)} a{" "}
          {fmtYMD(range.end)}…
        </div>
      )}

      {/* === Modal de confirmación (preview/apply mantenimiento) === */}
      {confirmOpen && (
        <ConfirmModal
          isOpen={confirmOpen}
          loading={confirmLoading}
          preview={preview}
          onClose={() => setConfirmOpen(false)}
          onConfirm={async () => {
            try {
              setConfirmLoading(true);

              if (pendingPayload) {
                // === NUEVO: crear + aplicar (atómico) ===
                const res = await api.post(CREATE_AND_APPLY_URL, {
                  ...pendingPayload,
                  confirm: true,
                });

                setConfirmLoading(false);
                setConfirmOpen(false);

                const total = res.data?.apply?.total_mantenimiento ?? 0;
                pushToast(`Se movieron ${total} cita(s) a mantenimiento.`);

                // CSV automático (si hay items)
                const csvRows =
                  res.data?.apply?.items || res.data?.preview?.items || [];
                if (csvRows.length > 0) {
                  downloadCSV(`citas_afectadas_${Date.now()}.csv`, csvRows);
                }

                await reloadBloqueos();
                setError(null);
                setPreview(null);
                setPendingPayload(null);
                setEditItem(null);
                return;
              }

              // === EDICIÓN: aplicar por grupo existente (usa APPLY_URL) ===
              if (editItem && !pendingPayload) {
                const res = await api.post<ApplyResponse>(
                  APPLY_URL(editItem.id),
                  {
                    confirm: true,
                  }
                );

                setConfirmLoading(false);
                setConfirmOpen(false);

                const total = res.data?.total_mantenimiento ?? 0;
                pushToast(`Se movieron ${total} cita(s) a mantenimiento.`);

                // CSV automático
                const csvRows = res.data?.items || [];
                if (csvRows.length > 0) {
                  downloadCSV(`citas_afectadas_${Date.now()}.csv`, csvRows);
                }

                await reloadBloqueos();
                setError(null);
                setPreview(null);
                setPendingPayload(null);
                setEditItem(null);
                return;
              }

              // Si llega aquí, no hay ni payload nuevo ni item en edición
              setConfirmLoading(false);
              setConfirmOpen(false);
            } catch (e: any) {
              setConfirmLoading(false);
              setError(
                e?.response?.data?.detail ||
                  "No se pudo aplicar el mantenimiento."
              );
            }
          }}
        />
      )}

      {/* === TOAST: contenedor */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3 shadow-lg"
          >
            <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            <div className="text-sm text-gray-900">{t.message}</div>
            <button
              onClick={() =>
                setToasts((prev) => prev.filter((x) => x.id !== t.id))
              }
              className="ml-2 rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
            >
              Cerrar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================== Subcomponentes ===================== */

function CalendarMonth({
  title,
  monthDate,
  matrix,
  byDay,
  onDayClick,
}: {
  title: string;
  monthDate: Date;
  matrix: Date[][];
  byDay: Map<string, { globals: number; porOdonto: number; list: Bloqueo[] }>;
  onDayClick: (d: Date) => void;
}) {
  const isSameMonth = (d: Date) =>
    d.getMonth() === monthDate.getMonth() &&
    d.getFullYear() === monthDate.getFullYear();
  const weekDays = ["L", "M", "X", "J", "V", "S", "D"];

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-2 text-center font-semibold capitalize">{title}</div>
      <div className="grid grid-cols-7 text-[11px] text-gray-500 mb-1">
        {weekDays.map((w) => (
          <div key={w} className="p-1 text-center">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[2px]">
        {matrix.flat().map((d, i) => {
          const ymd = fmtYMD(d);
          const slot = byDay.get(ymd);
          const items = slot?.list || [];
          const isCurrentMonth = isSameMonth(d);

          // Chips: hasta 2, globales primero
          const globals = items.filter((b) => !b.id_odontologo);
          const odontos = items.filter((b) => !!b.id_odontologo);
          const chips = [
            ...globals.map((b) => ({
              kind: "global" as const,
              text: truncate(b.motivo || "Bloqueo"),
            })),
            ...odontos.map((b) => ({
              kind: "odonto" as const,
              text: truncate(shortPersonName(b.odontologo_nombre) || "Odont."),
            })),
          ];
          const shown = chips.slice(0, 2);
          const extra = chips.length - shown.length;

          return (
            <button
              key={i}
              onClick={() => onDayClick(d)}
              className={[
                "h-20 rounded-lg border p-1.5 text-left hover:bg-gray-50 transition",
                isCurrentMonth ? "bg-white" : "bg-gray-50/60 text-gray-400",
              ].join(" ")}
              title={`${ymd}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium">{d.getDate()}</span>
                <div className="flex items-center gap-1">
                  {globals.length > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  )}
                  {odontos.length > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  )}
                </div>
              </div>

              {/* Chips con motivo/nombre */}
              <div className="mt-1 space-y-1">
                {shown.map((c, idx) => (
                  <span
                    key={idx}
                    className={
                      "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium " +
                      (c.kind === "global"
                        ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700")
                    }
                  >
                    {c.text}
                  </span>
                ))}
                {extra > 0 && (
                  <span className="ml-1 inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700">
                    +{extra}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-xl border p-1 hover:bg-gray-50"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DayBlockList({
  day,
  items,
  onEdit,
  onDelete,
}: {
  day: Date;
  items: Bloqueo[];
  onEdit: (b: Bloqueo) => void;
  onDelete: (b: Bloqueo) => void;
}) {
  const ymd = fmtYMD(day);
  if (!items.length) {
    return (
      <div className="rounded-xl border p-3 text-sm text-gray-600">
        No hay bloqueos en <span className="font-medium">{ymd}</span>.
      </div>
    );
  }
  return (
    <div className="rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left p-2">Tipo</th>
            <th className="text-left p-2">Rango</th>
            <th className="text-left p-2">Motivo / Odontólogo</th>
            <th className="text-right p-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((b) => {
            const tipo = b.id_odontologo ? "Odontólogo" : "Global";
            const quien = b.id_odontologo
              ? shortPersonName(b.odontologo_nombre) || "Odont."
              : b.motivo || "Bloqueo";
            return (
              <tr key={b.id} className="border-t">
                <td className="p-2">
                  <span
                    className={
                      "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium " +
                      (b.id_odontologo
                        ? "bg-blue-100 text-blue-700"
                        : "bg-red-100 text-red-700")
                    }
                  >
                    {tipo}
                  </span>
                  {!!b.recurrente_anual && (
                    <span className="ml-1 inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      anual
                    </span>
                  )}
                </td>
                <td className="p-2">
                  <div>{b.fecha_inicio}</div>
                  {b.fecha_fin !== b.fecha_inicio && (
                    <div className="text-xs text-gray-500">→ {b.fecha_fin}</div>
                  )}
                </td>
                <td className="p-2">{quien}</td>
                <td className="p-2 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      onClick={() => onEdit(b)}
                      className="rounded-xl border p-1.5 hover:bg-gray-50"
                      title="Editar"
                      aria-label="Editar"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => onDelete(b)}
                      className="rounded-xl border p-1.5 hover:bg-gray-50 text-red-600"
                      title="Eliminar"
                      aria-label="Eliminar"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ===================== Modal de Confirmación ===================== */
function ConfirmModal({
  isOpen,
  loading,
  preview,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  loading: boolean;
  preview: PreviewResponse | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const total = preview?.total_afectadas ?? 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-2xl">
        <div className="p-4 border-b flex items-center gap-2">
          <AlertTriangle className="text-amber-600" />
          <h3 className="text-lg font-semibold">
            Confirmar mantenimiento de citas
          </h3>
        </div>

        <div className="p-4 space-y-3">
          {loading ? (
            <div className="text-sm text-gray-500">Cargando preview…</div>
          ) : (
            <>
              <p className="text-sm text-gray-700">
                Se han detectado <b>{total}</b> cita(s) futura(s) afectada(s)
                por el bloqueo. Al confirmar, pasarán a estado{" "}
                <b>mantenimiento</b> y deberán ser reprogramadas.
              </p>

              {preview && preview.items.length > 0 ? (
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-2">ID</th>
                        <th className="text-left p-2">Fecha</th>
                        <th className="text-left p-2">Hora</th>
                        <th className="text-left p-2">Paciente</th>
                        <th className="text-left p-2">Celular</th>
                        <th className="text-left p-2">Odontólogo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items.slice(0, 10).map((c) => (
                        <tr key={String(c.id_cita)} className="border-t">
                          <td className="p-2">{c.id_cita}</td>
                          <td className="p-2">{c.fecha}</td>
                          <td className="p-2">{safeHora(c.hora)}</td>
                          <td className="p-2">
                            {nombrePersona(
                              c.id_paciente__id_usuario__primer_nombre,
                              c.id_paciente__id_usuario__primer_apellido
                            ) || "—"}
                          </td>
                          <td className="p-2">
                            {c.id_paciente__id_usuario__celular || "—"}
                          </td>
                          <td className="p-2">
                            {nombrePersona(
                              c.id_odontologo__id_usuario__primer_nombre,
                              c.id_odontologo__id_usuario__primer_apellido
                            ) || "—"}
                          </td>
                        </tr>
                      ))}
                      {preview.items.length > 10 && (
                        <tr className="border-t">
                          <td colSpan={6} className="p-2 text-xs text-gray-500">
                            … y {preview.items.length - 10} más
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  No se encontraron citas afectadas.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer sin botón de descarga */}
        <div className="p-4 border-t flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 inline-flex items-center gap-2"
          >
            <X className="size-4" />
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 inline-flex items-center gap-2 disabled:opacity-50"
          >
            Confirmar mantenimiento
          </button>
        </div>
      </div>
    </div>
  );
}