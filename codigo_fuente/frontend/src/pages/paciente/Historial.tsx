// src/pages/paciente/Historial.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AxiosResponse } from "axios";
import { api } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import {
  CalendarDays,
  Eraser,
  ChevronLeft,
  ChevronRight,
  Eye,
  ClipboardList,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

/* ========================= Tipos ========================= */
type Estado = "pendiente" | "confirmada" | "cancelada" | "realizada";

const ESTADOS: readonly Estado[] = [
  "pendiente",
  "confirmada",
  "cancelada",
  "realizada",
] as const;

const COLOR_ESTADOS: Record<Estado, string> = {
  pendiente: "#f59e0b",
  confirmada: "#16a34a",
  realizada: "#2563eb",
  cancelada: "#dc2626",
};

export type Cita = {
  id_cita: number;
  fecha: string;
  hora?: string | null;
  motivo?: string | null;
  estado: Estado;
  id_odontologo?: number | null;
  odontologo_nombre?: string | null;
  odontologo_nombre_corto?: string | null;
  odontologo_especialidades?: string[] | null;
  odontologo_especialidades_activas?: string[] | null;
  consultorio?: { id_consultorio: number; numero: string } | null;
  pago?: {
    id_pago_cita: number;
    estado_pago: "pendiente" | "pagado" | "reembolsado";
    monto?: string;
  } | null;
};

type Opcion = { value: string; label: string };
type OpcionOdon = Opcion & { especialidades?: string[] };

/* ========================= Helpers ========================= */
function formatFechaLocalYMD(iso?: string | null) {
  if (!iso) return "—";
  const ymd = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return iso ?? "—";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
  }).format(dt);
}

function formatHora(h?: string | null) {
  if (!h) return "";
  const m = /^(\d{2}:\d{2})(:\d{2})?$/.exec(h);
  return m ? m[1] : h;
}

function inferPNombrePApellido(full?: string | null) {
  if (!full) return "—";
  const parts = full.trim().split(/\s+/);
  if (parts.length >= 3) {
    const firstName = parts[0];
    const firstSurname = parts[parts.length - 2];
    return `${firstName} ${firstSurname}`.trim();
  }
  if (parts.length === 2) {
    const [firstName, maybeSurname] = parts;
    return `${firstName} ${maybeSurname}`.trim();
  }
  return parts[0];
}

/* DRF: helper para traer todas las páginas */
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
    const data: any = res.data;
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

/* Pill de estado */
function EstadoPill({ estado }: { estado: Estado }) {
  const cls =
    estado === "pendiente"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : estado === "confirmada"
      ? "bg-green-100 text-green-800 border-green-200"
      : estado === "realizada"
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : "bg-red-100 text-red-800 border-red-200";
  const label = estado.charAt(0).toUpperCase() + estado.slice(1).toLowerCase();
  return (
    <span
      className={`inline-block text-xs px-2 py-1 rounded-full border ${cls}`}
    >
      {label}
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

/* ========================= Componente ========================= */
export default function Historial() {
  const navigate = useNavigate();
  const { usuario } = useAuth();

  const [pacienteId, setPacienteId] = useState<number | null>(null);
  const [resolviendoPaciente, setResolviendoPaciente] = useState(true);
  const [errPaciente, setErrPaciente] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setResolviendoPaciente(true);
        setErrPaciente(null);

        const directo =
          usuario?.id_paciente ??
          usuario?.paciente?.id_paciente ??
          usuario?.paciente_id ??
          null;
        if (directo && !Number.isNaN(Number(directo))) {
          if (!cancel) setPacienteId(Number(directo));
          return;
        }

        const idUsuario = usuario?.id_usuario ?? usuario?.id ?? null;
        if (idUsuario == null)
          throw new Error("No se pudo resolver el usuario actual.");

        const { data } = await api.get("/pacientes/", {
          params: { id_usuario: idUsuario, page_size: 1 },
        });
        const lista: any[] = Array.isArray(data) ? data : data?.results ?? [];
        const primero = lista[0];
        const pid = primero?.id_paciente ?? primero?.id ?? null;
        if (!pid)
          throw new Error("No se encontró el paciente asociado al usuario.");
        if (!cancel) setPacienteId(Number(pid));
      } catch (e: any) {
        console.error(e);
        if (!cancel)
          setErrPaciente(e?.message || "No se pudo resolver el paciente.");
      } finally {
        if (!cancel) setResolviendoPaciente(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [usuario]);

  /* ========= Estado: datos, filtros, catálogos ========= */
  const [citas, setCitas] = useState<Cita[]>([]);
  const [loadingCitas, setLoadingCitas] = useState(true);
  const [errorCitas, setErrorCitas] = useState<string | null>(null);

  const [odOptions, setOdOptions] = useState<OpcionOdon[]>([]);
  const [consOptions, setConsOptions] = useState<Opcion[]>([]);
  const [loadingFiltros, setLoadingFiltros] = useState(true);

  const [fFecha, setFFecha] = useState("");
  const [fEstado, setFEstado] = useState<string>("");
  const [fOdonto, setFOdonto] = useState<string>("");
  const [fCons, setFCons] = useState<string>("");

  const limpiarFiltros = useCallback(() => {
    setFFecha("");
    setFEstado("");
    setFOdonto("");
    setFCons("");
    setCurrentPage(1);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoadingFiltros(true);
        const [odosRaw, consRaw] = await Promise.all([
          fetchAll<any>("/odontologos/"),
          fetchAll<any>("/consultorios/"),
        ]);

        setOdOptions(
          odosRaw.map((o: any) => {
            const nombre =
              (o.nombreCompleto ??
                `${o.nombres ?? o.primer_nombre ?? ""} ${
                  o.apellidos ?? o.primer_apellido ?? ""
                }`
                  .replace(/\s+/g, " ")
                  .trim()) ||
              "Sin nombre";
            const espList: string[] =
              o.especialidades ??
              (Array.isArray(o.especialidades_detalle)
                ? o.especialidades_detalle
                    .map((e: any) => e?.nombre)
                    .filter(Boolean)
                : []);
            return {
              value: String(o.id_odontologo ?? o.id ?? o.pk),
              label: nombre,
              especialidades: espList,
            };
          })
        );

        setConsOptions(
          consRaw.map((c: any) => ({
            value: String(c.id_consultorio ?? c.id ?? c.pk),
            label: `Cons. ${c.numero ?? "-"}`,
          }))
        );
      } catch (e) {
        console.error("Error cargando catálogos:", e);
      } finally {
        setLoadingFiltros(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!pacienteId) return;

    const ctrl = new AbortController();
    (async () => {
      try {
        setErrorCitas(null);
        setLoadingCitas(true);

        const params: Record<string, any> = {
          mine: 1,
          ordering: "-fecha,hora",
          page_size: 1000,
        };
        if (fFecha) params.fecha = fFecha;
        if (fEstado) params.estado = fEstado;
        if (fOdonto) params.id_odontologo = fOdonto;
        if (fCons) params.id_consultorio = fCons;

        const { data } = await api.get("/citas/", {
          params,
          signal: ctrl.signal as any,
        });
        const itemsRaw: any[] = Array.isArray(data)
          ? data
          : data?.results ?? [];

        const mapped: Cita[] = itemsRaw.map((c: any) => {
          const odName =
            c?.odontologo_nombre ??
            c?.odontologo?.nombreCompleto ??
            (c?.odontologo
              ? `${c.odontologo.primer_nombre ?? c.odontologo.nombres ?? ""} ${
                  c.odontologo.primer_apellido ?? c.odontologo.apellidos ?? ""
                }`
                  .replace(/\s+/g, " ")
                  .trim()
              : null);

          const pn =
            c?.odontologo?.primer_nombre ?? c?.odontologo?.nombres ?? null;
          const pa =
            c?.odontologo?.primer_apellido ??
            (c?.odontologo?.apellidos
              ? String(c.odontologo.apellidos).trim().split(/\s+/)[0]
              : null);
          const odShort =
            pn || pa
              ? `${pn ?? ""} ${pa ?? ""}`.trim()
              : inferPNombrePApellido(odName ?? undefined);

          const det = Array.isArray(c?.odontologo?.especialidades_detalle)
            ? c.odontologo.especialidades_detalle
            : [];
          const activas: string[] = det
            .filter((e: any) => e && e.estado !== false)
            .map((e: any) => (e?.nombre ?? "").trim())
            .filter(Boolean);
          const fallback = Array.isArray(c?.odontologo?.especialidades)
            ? c.odontologo.especialidades.filter(Boolean)
            : Array.isArray(c?.odontologo_especialidades)
            ? c.odontologo_especialidades
            : [];
          const odEspsAct = (activas.length ? activas : fallback) as string[];

          const cons =
            c?.consultorio ??
            (c?.id_consultorio || c?.consultorio_id
              ? {
                  id_consultorio: Number(
                    c?.id_consultorio ?? c?.consultorio_id
                  ),
                  numero: String(
                    c?.consultorio_numero ?? c?.consultorio?.numero ?? "-"
                  ),
                }
              : null);

          return {
            id_cita: Number(c.id_cita ?? c.id),
            fecha: String(c.fecha),
            hora: c.hora_inicio ?? c.hora ?? null,
            motivo: c.motivo ?? null,
            estado: c.estado,
            id_odontologo:
              c.id_odontologo ?? c?.odontologo?.id_odontologo ?? null,
            odontologo_nombre: odName ?? null,
            odontologo_nombre_corto: odShort ?? null,
            odontologo_especialidades: Array.isArray(
              c?.odontologo_especialidades
            )
              ? c.odontologo_especialidades
              : null,
            odontologo_especialidades_activas: odEspsAct ?? null,
            consultorio: cons,
          } as Cita;
        });

        const ordenadas = mapped.slice().sort((a, b) => {
          if (a.fecha !== b.fecha) return b.fecha.localeCompare(a.fecha);
          return (a.hora ?? "").localeCompare(b.hora ?? "");
        });

        const visibles = ordenadas.filter(
          (c) => c.estado === "realizada" || c.estado === "cancelada"
        );

        setCitas(visibles);
        setCurrentPage(1);
      } catch (e: any) {
        if (e?.name === "CanceledError") return;
        console.error(e);
        setErrorCitas("No se pudo cargar el historial de citas.");
      } finally {
        setLoadingCitas(false);
      }
    })();

    return () => ctrl.abort();
  }, [pacienteId, fFecha, fEstado, fOdonto, fCons]);

  /* ========= Paginación ========= */
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(citas.length / PAGE_SIZE));

  const currentSlice = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return citas.slice(start, start + PAGE_SIZE);
  }, [citas, currentPage]);

  const gotoPage = (p: number) =>
    setCurrentPage(Math.min(Math.max(1, p), totalPages));

  /* ========= Estadísticas ========= */
  const kpis = useMemo(() => {
    const realizadas = citas.filter((c) => c.estado === "realizada").length;
    const canceladas = citas.filter((c) => c.estado === "cancelada").length;
    const tot = realizadas + canceladas;
    return { realizadas, canceladas, tot };
  }, [citas]);

  const pieData = useMemo(() => {
    const realizadas = citas.filter((c) => c.estado === "realizada").length;
    const canceladas = citas.filter((c) => c.estado === "cancelada").length;
    return [
      { name: "Realizadas", key: "realizada", value: realizadas },
      { name: "Canceladas", key: "cancelada", value: canceladas },
    ];
  }, [citas]);

  const barData = useMemo(() => {
    const map: Record<string, { realizadas: number; canceladas: number }> = {};
    for (const c of citas) {
      const name = (
        c.odontologo_nombre_corto ??
        c.odontologo_nombre ??
        "—"
      ).trim();
      if (!map[name]) map[name] = { realizadas: 0, canceladas: 0 };
      if (c.estado === "realizada") map[name].realizadas += 1;
      if (c.estado === "cancelada") map[name].canceladas += 1;
    }
    return Object.entries(map).map(([name, v]) => ({ name, ...v }));
  }, [citas]);

  /* ======= Guardas ======= */
  if (resolviendoPaciente) {
    return (
      <div className="p-6">
        <p className="text-gray-600">Resolviendo paciente…</p>
      </div>
    );
  }
  if (!pacienteId) {
    return (
      <div className="p-6">
        <p className="text-red-600">
          {errPaciente ?? "No se pudo resolver el paciente."}
        </p>
        <button
          onClick={() => navigate("/paciente")}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-1.5 text-sm shadow hover:bg-black/80"
        >
          Volver
        </button>
      </div>
    );
  }

  /* ======= UI ======= */
  return (
    <div className="space-y-4">
      {/* Título general */}
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <ClipboardList className="h-7 w-7" />
        Historial de citas
      </h1>

      {/* ======= Card única: Filtros + Tabla (todo blanco, sin separador) ======= */}
      <section className="rounded-2xl bg-white shadow-md overflow-hidden">
        {/* Header del card */}
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Citas del paciente</h2>
          <div className="text-sm text-gray-500">
            {loadingCitas ? "Cargando…" : `${citas.length} cita(s)`}
          </div>
        </div>

        {/* Contenido del card (todo en blanco) */}
        <div className="px-4 pb-4 pt-3">
          {/* Filtros (sin fondo gris, sin bordes, pegados a la tabla) */}
          <div className="">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <CalendarDays className="h-5 w-5" />
                Filtros
              </h3>
              <button
                onClick={limpiarFiltros}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm bg-white hover:bg-gray-50"
                title="Limpiar"
              >
                <Eraser className="w-4 h-4" />
                Limpiar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                  <option value="">Todos</option>
                  {ESTADOS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <OdontologoFilter
                value={fOdonto}
                onChange={setFOdonto}
                options={odOptions}
                disabled={loadingFiltros}
              />

              <div>
                <label className="block text-sm mb-1">Consultorio</label>
                <select
                  value={fCons}
                  onChange={(e) => setFCons(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 bg-white"
                  disabled={loadingFiltros}
                >
                  <option value="">
                    {loadingFiltros ? "Cargando..." : "Todos"}
                  </option>
                  {consOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Tabla inmediatamente debajo de los filtros */}
          <div className="mt-3 overflow-x-auto">
            {errorCitas && (
              <div className="px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg mb-3">
                {errorCitas}
              </div>
            )}

            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100 text-black font-bold">
                <tr className="border-b border-black">
                  <th className="py-2 px-3 text-center">Fecha</th>
                  <th className="py-2 px-3 text-center">Hora</th>
                  <th className="py-2 px-3 text-center">Motivo</th>
                  <th className="py-2 px-3 text-center">Odontólogo</th>
                  <th className="py-2 px-3 text-center">Consultorio</th>
                  <th className="py-2 px-3 text-center">Estado Cita</th>
                  <th className="py-2 px-3 text-center">Estado Pago</th>
                  <th className="py-2 px-3 text-center w-36">Acción</th>
                </tr>
              </thead>
              <tbody>
                {loadingCitas ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center">
                      Cargando…
                    </td>
                  </tr>
                ) : currentSlice.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-gray-500">
                      Sin resultados
                    </td>
                  </tr>
                ) : (
                  currentSlice.map((c) => (
                    <tr
                      key={`${c.id_cita}-${c.fecha}-${c.hora ?? ""}`}
                      className="border-b border-gray-200 align-top"
                    >
                      <td className="py-2 px-3 text-center">
                        {formatFechaLocalYMD(c.fecha)}
                      </td>
                      <td className="py-2 px-3 text-center tabular-nums">
                        {formatHora(c.hora) || "—"}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {c.motivo ?? "—"}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex flex-col items-center">
                          <div className="font-medium">
                            {c.odontologo_nombre ?? "—"}
                          </div>
                          {Array.isArray(c.odontologo_especialidades_activas) &&
                          c.odontologo_especialidades_activas.length > 0 ? (
                            <div className="mt-0.5 text-[11px] text-gray-500">
                              {c.odontologo_especialidades_activas.join(", ")}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {c.consultorio ? `Cons. ${c.consultorio.numero}` : "—"}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <EstadoPill estado={c.estado} />
                      </td>
                      <td className="py-2 px-3 text-center">
                        {estadoPagoPill(c)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center">
                          <Link
                            to={`/paciente/mis-citas/ver/${c.id_cita}`}
                            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
                            title="Ver detalles"
                          >
                            <Eye className="size-4" />
                            Ver
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Paginación */}
            <div className="px-4 py-3 border-t flex items-center justify-between gap-2">
              <button
                onClick={() => gotoPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm bg-white disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" /> Anterior
              </button>

              <div className="text-sm">
                Página <span className="font-semibold">{currentPage}</span> de{" "}
                {totalPages}
              </div>

              <button
                onClick={() => gotoPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm bg-white disabled:opacity-50"
              >
                Siguiente <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ======= Estadísticas ======= */}
      <div className="pt-2 space-y-3">
        <h3 className="text-lg font-semibold">📊 Estadísticas</h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white shadow p-4">
            <div className="text-sm text-gray-500">
              Citas totales (realizadas + canceladas)
            </div>
            <div className="text-2xl font-bold mt-1">{kpis.tot}</div>
          </div>
          <div className="rounded-2xl bg-white shadow p-4">
            <div className="text-sm text-gray-500">Citas realizadas</div>
            <div className="text-2xl font-bold mt-1 text-blue-600">
              {kpis.realizadas}
            </div>
          </div>
          <div className="rounded-2xl bg-white shadow p-4">
            <div className="text-sm text-gray-500">Citas canceladas</div>
            <div className="text-2xl font-bold mt-1 text-red-600">
              {kpis.canceladas}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white shadow p-4">
            <div className="text-sm font-medium mb-2">
              Distribución por estado
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={95}
                    label
                  >
                    {pieData.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={
                          entry.key === "realizada"
                            ? COLOR_ESTADOS.realizada
                            : COLOR_ESTADOS.cancelada
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => String(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl bg-white shadow p-4">
            <div className="text-sm font-medium mb-2">
              Citas por odontólogo (realizadas vs canceladas)
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <XAxis
                    dataKey="name"
                    interval={0}
                    height={30}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(v: any) => String(v)} />
                  <Bar
                    dataKey="realizadas"
                    stackId="a"
                    fill={COLOR_ESTADOS.realizada}
                  />
                  <Bar
                    dataKey="canceladas"
                    stackId="a"
                    fill={COLOR_ESTADOS.cancelada}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================= Subcomponentes ========================= */
function OdontologoFilter({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: OpcionOdon[];
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm mb-1">Odontólogo</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 bg-white"
        disabled={disabled}
      >
        <option value="">{disabled ? "Cargando..." : "Todos"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
