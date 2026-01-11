// src/pages/odontologo/Estadisticas.tsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/axios";
import {
  CalendarDays,
  Filter,
  BarChart3,
  LineChart,
  PieChart,
  Eraser
} from "lucide-react";
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  BarChart as RBarChart,
  Bar,
  Legend,
  PieChart as RPieChart,
  Pie,
  Cell,
} from "recharts";
import { useAuth } from "../../context/AuthContext";

/* ===================== Colores ===================== */
const COLORS = {
  pendiente: "#F59E0B",
  confirmada: "#10B981",
  cancelada: "#EF4444",
  realizada: "#3B82F6",
  linePrimary: "#0EA5E9",
  barPrimary: "#3B82F6",
  grid: "#E5E7EB",
};
const PIE_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#A855F7"];

/* ===================== Tipos ===================== */
type SelectOpt = { id: number; nombre: string };

type OverviewResponse = {
  kpis: {
    citas_totales: number;
    realizadas: number;
    confirmadas: number;
    canceladas: number;
    asistencia_pct: number;
  };
  series: {
    por_dia: { fecha: string; total: number }[];
    por_semana_estado: {
      semana: string;
      pendiente: number;
      confirmada: number;
      cancelada: number;
      realizada: number;
    }[];
    por_hora: { hora: string; total: number }[];
  };
  tablas: {
    top_pacientes: { paciente: string; cedula: string; citas: number }[];
  };
};

type Filtros = {
  desde: string;
  hasta: string;
  consultorio?: number | "";
  estado?: "pendiente" | "confirmada" | "cancelada" | "realizada" | "";
};

/* ===================== Utils ===================== */
const toLocalISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/* ===================== Componente ===================== */
const Estadisticas = () => {
  const { usuario } = (useAuth?.() as any) ?? { usuario: null };

  // Id del odontólogo autenticado (obligatorio en este módulo)
  const odontologoId: number | null =
    (usuario as any)?.odontologo?.id_odontologo ??
    (usuario as any)?.id_odontologo ??
    null;

  const [filtros, setFiltros] = useState<Filtros>(() => {
    const hoyISO = toLocalISO(new Date());
    return {
      desde: hoyISO,
      hasta: hoyISO,
      consultorio: "",
      estado: "",
    };
  });
  const [consultorios, setConsultorios] = useState<SelectOpt[]>([]);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchConsultorios = async () => {
    const co = await api.get("/consultorios/?simple=1");
    setConsultorios(
      (co.data.results ?? co.data).map((x: any) => ({
        id: x.id_consultorio ?? x.id,
        nombre: x.numero ?? x.nombre,
      }))
    );
  };

  const fetchData = async () => {
    if (!odontologoId) {
      setErr(
        "No se pudo determinar el odontólogo autenticado. Verifique el AuthContext."
      );
      setData(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const params: any = {
        desde: filtros.desde,
        hasta: filtros.hasta,
        odontologo: odontologoId,
      };
      if (filtros.consultorio) params.consultorio = filtros.consultorio;
      if (filtros.estado) params.estado = filtros.estado;

      const r = await api.get<OverviewResponse>("/reportes/overview/", {
        params,
      });
      setData(r.data);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404)
        setErr(
          "El módulo de reportes no está disponible en el backend (ruta /reportes/overview/)."
        );
      else setErr(e?.response?.data?.detail || "Error cargando estadísticas");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConsultorios();
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [odontologoId]);

  /* ======== Derivados ======== */
  const dataDiaOrdenado = useMemo(
    () =>
      [...(data?.series.por_dia ?? [])].sort((a, b) =>
        a.fecha.localeCompare(b.fecha)
      ),
    [data?.series.por_dia]
  );

  // Pie de ESTADOS a partir de KPIs
  const pieEstadosData = useMemo(() => {
    const k = data?.kpis;
    if (!k) return [];
    const pendiente = Math.max(
      0,
      (k.citas_totales ?? 0) -
        (k.confirmadas ?? 0) -
        (k.canceladas ?? 0) -
        (k.realizadas ?? 0)
    );
    const arr = [
      { name: "Realizada", value: k.realizadas ?? 0, color: COLORS.realizada },
      {
        name: "Confirmada",
        value: k.confirmadas ?? 0,
        color: COLORS.confirmada,
      },
      { name: "Pendiente", value: pendiente, color: COLORS.pendiente },
      { name: "Cancelada", value: k.canceladas ?? 0, color: COLORS.cancelada },
    ];
    return arr.filter((x) => x.value > 0);
  }, [data?.kpis]);

  const pieEstadosTotal = useMemo(
    () => pieEstadosData.reduce((acc, d) => acc + d.value, 0),
    [pieEstadosData]
  );

  return (
    <div className="space-y-6 print:bg-white">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📊 Estadísticas</h1>
        {/* Se removió el botón de PDF */}
        <div className="flex gap-2 print:hidden" />
      </div>

      {/* Filtros */}
      <div className="rounded-xl bg-white shadow-md p-4 print:hidden">
        <div className="flex items-center gap-2 mb-4 text-gray-600">
          <Filter size={16} /> Filtros
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {/* Desde */}
          <div className="flex flex-col justify-end">
            <label className="text-sm text-gray-600 flex items-center gap-1 leading-none mb-1">
              <CalendarDays size={14} className="shrink-0" />
              <span>Desde</span>
            </label>
            <input
              type="date"
              value={filtros.desde}
              onChange={(e) =>
                setFiltros((s) => ({ ...s, desde: e.target.value }))
              }
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          {/* Hasta */}
          <div className="flex flex-col justify-end">
            <label className="text-sm text-gray-600 flex items-center gap-1 leading-none mb-1">
              <CalendarDays size={14} className="shrink-0" />
              <span>Hasta</span>
            </label>
            <input
              type="date"
              value={filtros.hasta}
              onChange={(e) =>
                setFiltros((s) => ({ ...s, hasta: e.target.value }))
              }
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          {/* Consultorio */}
          <div className="flex flex-col justify-end">
            <label className="text-sm text-gray-600 leading-none mb-1">
              Consultorio
            </label>
            <select
              value={filtros.consultorio ?? ""}
              onChange={(e) =>
                setFiltros((s) => ({
                  ...s,
                  consultorio: e.target.value ? Number(e.target.value) : "",
                }))
              }
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">Todos</option>
              {consultorios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Estado */}
          <div className="flex flex-col justify-end">
            <label className="text-sm text-gray-600 leading-none mb-1">
              Estado
            </label>
            <select
              value={filtros.estado ?? ""}
              onChange={(e) =>
                setFiltros((s) => ({ ...s, estado: e.target.value as any }))
              }
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="confirmada">Confirmada</option>
              <option value="cancelada">Cancelada</option>
              <option value="realizada">Realizada</option>
            </select>
          </div>

          {/* Botones */}
          <div className="flex items-end justify-end gap-2">
            <button
              onClick={() => {
                const hoyISO = toLocalISO(new Date());
                setFiltros({
                  desde: hoyISO,
                  hasta: hoyISO,
                  consultorio: "",
                  estado: "",
                });
              }}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors"
              title="Limpiar filtros"
            >
              <Filter className="hidden" />
              <span className="flex items-center gap-2">
                <Eraser className="w-4 h-4" />
                Limpiar
              </span>
            </button>

            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              title="Aplicar filtros"
            >
              <Filter className="w-4 h-4" />
              Aplicar filtros
            </button>
          </div>
        </div>

        {err && <p className="text-red-600 mt-3">{err}</p>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <KpiCard label="Citas totales" value={data?.kpis.citas_totales ?? 0} />
        <KpiCard label="Confirmadas" value={data?.kpis.confirmadas ?? 0} />
        <KpiCard label="Canceladas" value={data?.kpis.canceladas ?? 0} />
        <KpiCard label="Realizadas" value={data?.kpis.realizadas ?? 0} />
        <KpiCard
          label="Asistencia (%)"
          value={`${data?.kpis.asistencia_pct?.toFixed(1) ?? "0.0"} %`}
        />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard title="Citas por día" icon={<LineChart size={16} />}>
          <ResponsiveContainer width="100%" height={260}>
            <RLineChart
              data={dataDiaOrdenado}
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="fecha" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="total"
                stroke={COLORS.linePrimary}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 3 }}
                activeDot={{ r: 4 }}
                connectNulls
              />
            </RLineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Citas por estado (por semana)"
          icon={<BarChart3 size={16} />}
        >
          <ResponsiveContainer width="100%" height={260}>
            <RBarChart
              data={data?.series.por_semana_estado ?? []}
              margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="semana" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="pendiente" stackId="a" fill={COLORS.pendiente} />
              <Bar dataKey="confirmada" stackId="a" fill={COLORS.confirmada} />
              <Bar dataKey="cancelada" stackId="a" fill={COLORS.cancelada} />
              <Bar dataKey="realizada" stackId="a" fill={COLORS.realizada} />
            </RBarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Pie de ESTADOS */}
        <ChartCard
          title="Distribución por estado"
          icon={<PieChart size={16} />}
        >
          <div
            className="flex items-start gap-6 w-full"
            style={{ minHeight: 260 }}
          >
            <div style={{ width: 220, overflow: "visible" }}>
              <ul className="space-y-2 text-sm">
                {pieEstadosData.length ? (
                  pieEstadosData.map((it, idx) => {
                    const pct = pieEstadosTotal
                      ? Math.round((it.value / pieEstadosTotal) * 100)
                      : 0;
                    return (
                      <li
                        key={idx}
                        className="flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block w-3 h-3 rounded-sm"
                            style={{ backgroundColor: it.color }}
                          />
                          <span className="whitespace-normal break-words">
                            {it.name}
                          </span>
                        </div>
                        <span className="tabular-nums shrink-0">
                          {pct}% ({it.value})
                        </span>
                      </li>
                    );
                  })
                ) : (
                  <li className="text-gray-500">Sin datos</li>
                )}
              </ul>
            </div>
            <div className="flex-1">
              <ResponsiveContainer width="100%" height={240}>
                <RPieChart>
                  <Tooltip />
                  <Pie
                    data={pieEstadosData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={95}
                    label={false}
                    labelLine={false}
                  >
                    {pieEstadosData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={d.color ?? PIE_COLORS[i % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                </RPieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </ChartCard>

        <ChartCard title="Horas pico" icon={<BarChart3 size={16} />}>
          <ResponsiveContainer width="100%" height={260}>
            <RBarChart
              data={data?.series.por_hora ?? []}
              margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="hora" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="total" fill={COLORS.barPrimary} />
            </RBarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Top pacientes (Top 10) */}
      <div className="rounded-xl bg-white shadow-md overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-black font-bold border-b border-black">
            <tr>
              <th className="px-4 py-3 text-left font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">Paciente</th>
              <th className="px-4 py-3 text-left font-medium">Cédula</th>
              <th className="px-4 py-3 text-left font-medium">Citas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {(data?.tablas.top_pacientes ?? []).slice(0, 10).map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-700">{i + 1}</td>
                <td className="px-4 py-3">{r.paciente || "—"}</td>
                <td className="px-4 py-3">{r.cedula || "—"}</td>
                <td className="px-4 py-3">{r.citas ?? "—"}</td>
              </tr>
            ))}
            {!(data?.tablas.top_pacientes ?? []).length && (
              <tr>
                <td className="px-4 py-3 text-gray-500 text-center" colSpan={4}>
                  Sin datos disponibles
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/10 flex items-center justify-center print:hidden">
          <div className="rounded-xl bg-white px-6 py-4 shadow">
            Procesando…
          </div>
        </div>
      )}
    </div>
  );
};

const KpiCard = ({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) => (
  <div className="rounded-xl bg-white shadow-md p-4">
    <div className="text-sm text-gray-500">{label}</div>
    <div className="text-2xl font-semibold mt-1">{value}</div>
  </div>
);

const ChartCard = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="rounded-xl bg-white shadow-md p-4">
    <div className="flex items-center gap-2 mb-3 text-gray-700 font-medium">
      {icon}
      {title}
    </div>
    <div className="w-full">{children}</div>
  </div>
);

export default Estadisticas;
