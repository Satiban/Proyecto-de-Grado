// src/pages/admin/Reportes.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/axios";
import {
  CalendarDays,
  Filter,
  BarChart3,
  LineChart,
  PieChart,
  Printer,
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
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import logoUrl from "../../assets/oralflow-logo.png";
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
const PIE_COLORS = [
  "#2563EB",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#A855F7",
  "#14B8A6",
  "#F97316",
  "#22C55E",
  "#3B82F6",
  "#D946EF",
  "#06B6D4",
  "#84CC16",
];

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
    por_especialidad: { especialidad: string; total: number }[];
    por_hora: { hora: string; total: number }[];
  };
  tablas: {
    top_pacientes: { paciente: string; cedula: string; citas: number }[];
  };
};

type Filtros = {
  desde: string;
  hasta: string;
  odontologo?: number | "";
  consultorio?: number | "";
  estado?: "pendiente" | "confirmada" | "cancelada" | "realizada" | "";
  especialidad?: number | "";
};

/* ===================== Utils ===================== */
const toLocalISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const fmt = (v: any) =>
  v === undefined || v === null || v === "" ? "—" : String(v);

/* ===================== Componente ===================== */
const Reportes = () => {
  const { usuario } = (useAuth?.() as any) ?? { usuario: null };
  const nombreUsuario = useMemo(() => {
    if (!usuario) return "Usuario";
    return (
      usuario?.nombreCompleto ||
      [
        usuario?.primer_nombre,
        usuario?.segundo_nombre,
        usuario?.primer_apellido,
        usuario?.segundo_apellido,
      ]
        .filter(Boolean)
        .join(" ") ||
      usuario?.email ||
      "Usuario"
    );
  }, [usuario]);

  const [filtros, setFiltros] = useState<Filtros>(() => {
    const hoyISO = toLocalISO(new Date());
    return {
      desde: hoyISO,
      hasta: hoyISO,
      odontologo: "",
      consultorio: "",
      estado: "",
      especialidad: "",
    };
  });
  const [odontologos, setOdontologos] = useState<SelectOpt[]>([]);
  const [consultorios, setConsultorios] = useState<SelectOpt[]>([]);
  const [especialidades, setEspecialidades] = useState<SelectOpt[]>([]);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Refs de CARDS (contenedor)
  const chartDiaRef = useRef<HTMLDivElement | null>(null);
  const chartSemanaRef = useRef<HTMLDivElement | null>(null);
  const chartEspecialidadRef = useRef<HTMLDivElement | null>(null);
  const chartHoraRef = useRef<HTMLDivElement | null>(null);

  // Refs SOLO del área del gráfico (lo que rasterizamos)
  const capDiaRef = useRef<HTMLDivElement | null>(null);
  const capSemanaRef = useRef<HTMLDivElement | null>(null);
  const capEspRef = useRef<HTMLDivElement | null>(null);
  const capHoraRef = useRef<HTMLDivElement | null>(null);

  const fetchFiltros = async () => {
    const [od, co, es] = await Promise.all([
      api.get("/odontologos/?simple=1"),
      api.get("/consultorios/?simple=1"),
      api.get("/especialidades/?simple=1"),
    ]);
    setOdontologos(
      (od.data.results ?? od.data).map((x: any) => ({
        id: x.id_odontologo ?? x.id,
        nombre: x.nombre ?? x.nombreCompleto,
      }))
    );
    setConsultorios(
      (co.data.results ?? co.data).map((x: any) => ({
        id: x.id_consultorio ?? x.id,
        nombre: x.numero ?? x.nombre,
      }))
    );
    setEspecialidades(
      (es.data.results ?? es.data).map((x: any) => ({
        id: x.id_especialidad ?? x.id,
        nombre: x.nombre,
      }))
    );
  };

  const fetchData = async () => {
    setLoading(true);
    setErr(null);
    try {
      const params: any = { desde: filtros.desde, hasta: filtros.hasta };
      if (filtros.odontologo) params.odontologo = filtros.odontologo;
      if (filtros.consultorio) params.consultorio = filtros.consultorio;
      if (filtros.estado) params.estado = filtros.estado;
      if (filtros.especialidad) params.especialidad = filtros.especialidad;

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
      else setErr(e?.response?.data?.detail || "Error cargando reportes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiltros().then(fetchData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===================== Helpers PDF ===================== */
  const addFooterPagination = (doc: jsPDF) => {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(
        `OralFlow • Reporte generado el ${new Date().toLocaleString()} • Página ${i} de ${pageCount}`,
        pageW / 2,
        pageH - 18,
        { align: "center" }
      );
    }
  };

  // DOM → PNG con html2canvas (evita recortes usando scrollWidth/scrollHeight)
  const elementToPNG = async (el: HTMLElement, scale = 2): Promise<string> => {
    const width = Math.max(el.scrollWidth, el.clientWidth);
    const height = Math.max(el.scrollHeight, el.clientHeight);
    const canvas = await html2canvas(el, {
      backgroundColor: "#ffffff",
      scale,
      useCORS: true,
      logging: false,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
    });
    return canvas.toDataURL("image/png");
  };

  // Dibuja manteniendo proporción dentro de un rect
  const drawImageInRect = async (
    doc: jsPDF,
    dataUrl: string,
    x: number,
    y: number,
    rectW: number,
    rectH: number
  ) => {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    const ratio = img.width / img.height;
    let w = rectW;
    let h = w / ratio;
    if (h > rectH) {
      h = rectH;
      w = h * ratio;
    }
    const cx = x + (rectW - w) / 2;
    const cy = y + (rectH - h) / 2;
    doc.addImage(dataUrl, "PNG", cx, cy, w, h);
  };

  /* ===================== Exportar PDF ===================== */
  const exportPDF = async () => {
    if (!data) return;
    try {
      setLoading(true);

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const marginX = 40;
      const marginY = 36;
      let cursorY = marginY;

      // Header
      try {
        doc.addImage(logoUrl, "PNG", marginX, cursorY, 120, 40);
      } catch {}

      // Usuario a la derecha
      doc.setFont("helvetica", "normal").setFontSize(10);
      const rightX = doc.internal.pageSize.getWidth() - marginX;
      const hoyStr = new Date().toLocaleString();
      const userLines = [
        `Generado por: ${fmt(nombreUsuario)}`,
        usuario?.email ? `Correo: ${usuario.email}` : "",
        `Fecha: ${hoyStr}`,
      ].filter(Boolean);
      userLines.forEach((line, i) => {
        const w = doc.getTextWidth(line);
        doc.text(line, rightX - w, cursorY + 12 + i * 12);
      });
      cursorY += 56;

      // Título y rango
      doc.setFont("helvetica", "bold").setFontSize(16);
      doc.text("Reporte de Citas", marginX, cursorY);
      cursorY += 18;
      doc.setFont("helvetica", "normal").setFontSize(11);
      doc.text(`Rango: ${filtros.desde} a ${filtros.hasta}`, marginX, cursorY);
      cursorY += 18;

      // Filtros
      const findNombre = (arr: SelectOpt[], id?: number | "") =>
        id ? arr.find((a) => a.id === id)?.nombre || `ID ${id}` : "Todos";

      autoTable(doc, {
        startY: cursorY,
        head: [["Filtro", "Valor"]],
        body: [
          ["Odontólogo", findNombre(odontologos, filtros.odontologo)],
          ["Consultorio", findNombre(consultorios, filtros.consultorio)],
          ["Estado", filtros.estado ? filtros.estado : "Todos"],
          ["Especialidad", findNombre(especialidades, filtros.especialidad)],
        ],
        styles: { fontSize: 10, cellPadding: 5 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255 },
        theme: "striped",
        margin: { left: marginX, right: marginX },
      });
      cursorY = (doc as any).lastAutoTable.finalY + 16;

      // KPIs
      const k = data.kpis;
      autoTable(doc, {
        startY: cursorY,
        head: [["Métrica", "Valor"]],
        body: [
          ["Citas totales", String(k.citas_totales)],
          ["Realizadas", String(k.realizadas)],
          ["Confirmadas", String(k.confirmadas)],
          ["Canceladas", String(k.canceladas)],
          ["Asistencia (%)", `${k.asistencia_pct.toFixed(1)} %`],
        ],
        styles: { fontSize: 10, cellPadding: 5 },
        headStyles: { fillColor: [16, 185, 129], textColor: 255 },
        theme: "grid",
        margin: { left: marginX, right: marginX },
      });
      cursorY = (doc as any).lastAutoTable.finalY + 16;

      // Top pacientes (Top 10) en la PRIMERA página
      const top10 = (data.tablas.top_pacientes || []).slice(0, 10);
      autoTable(doc, {
        startY: cursorY,
        head: [["Top 10 pacientes", "Cédula", "Citas"]],
        body: top10.length
          ? top10.map((r) => [r.paciente, r.cedula, String(r.citas)])
          : [["Sin datos", "—", "—"]],
        styles: { fontSize: 10, cellPadding: 5 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255 },
        theme: "striped",
        margin: { left: marginX, right: marginX },
      });

      // ===== Página 2: 4 gráficos (2×2) =====
      doc.addPage();
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const usableW = pageW - marginX * 2;
      const usableH = pageH - marginY * 2;

      doc.setFont("helvetica", "bold").setFontSize(14);
      doc.text("Gráficos", marginX, marginY);

      const gutter = 12;
      const cols = 2,
        rows = 2;
      const cellW = (usableW - gutter) / cols;
      const cellH = (usableH - gutter - 18) / rows;

      const blocks: Array<{
        title: string;
        ref: React.MutableRefObject<HTMLDivElement | null>;
      }> = [
        { title: "Citas por día", ref: capDiaRef },
        { title: "Citas por estado (por semana)", ref: capSemanaRef },
        { title: "Citas por especialidad", ref: capEspRef },
        { title: "Horas pico", ref: capHoraRef },
      ];

      await new Promise((r) => setTimeout(r, 100));

      for (let i = 0; i < blocks.length; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const baseX = marginX + c * (cellW + gutter);
        const baseY = marginY + 18 + r * (cellH + gutter);

        doc.setFont("helvetica", "bold").setFontSize(11);
        doc.text(blocks[i].title, baseX, baseY + 12);

        const el = blocks[i].ref.current;
        if (el) {
          const dataUrl = await elementToPNG(el, 2);
          await drawImageInRect(
            doc,
            dataUrl,
            baseX,
            baseY + 20,
            cellW,
            cellH - 24
          );
        } else {
          doc.setFont("helvetica", "normal").setFontSize(10);
          doc.text("No se pudo capturar el gráfico.", baseX, baseY + 36);
        }
      }

      addFooterPagination(doc);
      doc.save(`reporte_${filtros.desde}_${filtros.hasta}.pdf`);
    } catch (e) {
      console.error("Error generando PDF:", e);
      alert("No se pudo generar el PDF. Revisa la consola para más detalles.");
    } finally {
      setLoading(false);
    }
  };

  // ======== Derivados ========
  const dataDiaOrdenado = useMemo(
    () =>
      [...(data?.series.por_dia ?? [])].sort((a, b) =>
        a.fecha.localeCompare(b.fecha)
      ),
    [data?.series.por_dia]
  );

  // Datos para leyenda lateral del pie
  const pieData = data?.series.por_especialidad ?? [];
  const pieTotal = pieData.reduce((acc, d) => acc + (d.total ?? 0), 0);
  const pieWithPct = pieData.map((d, i) => ({
    name: d.especialidad,
    value: d.total,
    color: PIE_COLORS[i % PIE_COLORS.length],
    pct: pieTotal ? Math.round((d.total / pieTotal) * 100) : 0,
  }));

  return (
    <div className="space-y-6 print:bg-white">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📊 Reportes</h1>
        <div className="flex gap-2 print:hidden">
          <button
            disabled={loading || !data}
            onClick={exportPDF}
            className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2"
          >
            <Printer size={16} /> PDF
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-xl bg-white shadow-md p-4 print:hidden">
        <div className="flex items-center gap-2 mb-4 text-gray-600">
          <Filter size={16} /> Filtros
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div>
            <label className="text-sm text-gray-600 flex items-center gap-1">
              <CalendarDays size={14} /> Desde
            </label>
            <input
              type="date"
              value={filtros.desde}
              onChange={(e) =>
                setFiltros((s) => ({ ...s, desde: e.target.value }))
              }
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600">Hasta</label>
            <input
              type="date"
              value={filtros.hasta}
              onChange={(e) =>
                setFiltros((s) => ({ ...s, hasta: e.target.value }))
              }
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600">Odontólogo</label>
            <select
              value={filtros.odontologo ?? ""}
              onChange={(e) =>
                setFiltros((s) => ({
                  ...s,
                  odontologo: e.target.value ? Number(e.target.value) : "",
                }))
              }
              className="mt-1 w-full border rounded-lg px-3 py-2"
            >
              <option value="">Todos</option>
              {odontologos.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600">Consultorio</label>
            <select
              value={filtros.consultorio ?? ""}
              onChange={(e) =>
                setFiltros((s) => ({
                  ...s,
                  consultorio: e.target.value ? Number(e.target.value) : "",
                }))
              }
              className="mt-1 w-full border rounded-lg px-3 py-2"
            >
              <option value="">Todos</option>
              {consultorios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600">Estado</label>
            <select
              value={filtros.estado ?? ""}
              onChange={(e) =>
                setFiltros((s) => ({ ...s, estado: e.target.value as any }))
              }
              className="mt-1 w-full border rounded-lg px-3 py-2"
            >
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="confirmada">Confirmada</option>
              <option value="cancelada">Cancelada</option>
              <option value="realizada">Realizada</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600">Especialidad</label>
            <select
              value={filtros.especialidad ?? ""}
              onChange={(e) =>
                setFiltros((s) => ({
                  ...s,
                  especialidad: e.target.value ? Number(e.target.value) : "",
                }))
              }
              className="mt-1 w-full border rounded-lg px-3 py-2"
            >
              <option value="">Todas</option>
              {especialidades.map((es) => (
                <option key={es.id} value={es.id}>
                  {es.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        {err && <p className="text-red-600 mt-3">{err}</p>}
        <div className="mt-4">
          <button
            onClick={fetchData}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            Aplicar filtros
          </button>
        </div>
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
        <ChartCard
          innerRef={chartDiaRef}
          captureRef={capDiaRef}
          title="Citas por día"
          icon={<LineChart size={16} />}
        >
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
          innerRef={chartSemanaRef}
          captureRef={capSemanaRef}
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

        {/* Pie con leyenda lateral izquierda (sin labels en el pastel) */}
        <ChartCard
          innerRef={chartEspecialidadRef}
          captureRef={capEspRef}
          title="Citas por especialidad"
          icon={<PieChart size={16} />}
        >
          <div
            className="flex items-start gap-6 w-full"
            style={{ minHeight: 260 }}
          >
            {/* Leyenda lateral: ancho fijo para evitar recortes */}
            <div style={{ width: 220, overflow: "visible" }}>
              <ul className="space-y-2 text-sm">
                {pieWithPct.length ? (
                  pieWithPct.map((it, idx) => (
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
                        {it.pct}% ({it.value})
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="text-gray-500">Sin datos</li>
                )}
              </ul>
            </div>
            {/* Pastel a la derecha */}
            <div className="flex-1">
              <ResponsiveContainer width="100%" height={240}>
                <RPieChart>
                  <Tooltip />
                  <Pie
                    data={pieData}
                    dataKey="total"
                    nameKey="especialidad"
                    outerRadius={95}
                    label={false}
                    labelLine={false}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </RPieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </ChartCard>

        <ChartCard
          innerRef={chartHoraRef}
          captureRef={capHoraRef}
          title="Horas pico"
          icon={<BarChart3 size={16} />}
        >
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

      {/* Top pacientes (Top 10) en la vista */}
      <div className="rounded-xl bg-white shadow-md p-4">
        <h3 className="font-semibold mb-3">Top pacientes (Top 10)</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Paciente</th>
                <th className="py-2">Cédula</th>
                <th className="py-2">Citas</th>
              </tr>
            </thead>
            <tbody>
              {(data?.tablas.top_pacientes ?? []).slice(0, 10).map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2">{r.paciente}</td>
                  <td className="py-2">{r.cedula}</td>
                  <td className="py-2">{r.citas}</td>
                </tr>
              ))}
              {!(data?.tablas.top_pacientes ?? []).length && (
                <tr>
                  <td className="py-2 text-gray-500" colSpan={3}>
                    Sin datos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
  innerRef,
  captureRef,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  innerRef?: React.MutableRefObject<HTMLDivElement | null>;
  captureRef?: React.MutableRefObject<HTMLDivElement | null>;
}) => (
  <div ref={innerRef} className="rounded-xl bg-white shadow-md p-4">
    <div className="flex items-center gap-2 mb-3 text-gray-700 font-medium">
      {icon}
      {title}
    </div>
    {/* SOLO el área del gráfico a rasterizar */}
    <div ref={captureRef} className="w-full">
      {children}
    </div>
  </div>
);

export default Reportes;
