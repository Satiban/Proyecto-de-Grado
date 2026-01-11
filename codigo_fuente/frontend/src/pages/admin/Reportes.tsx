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
  Eraser,
  Banknote,
  TrendingUp,
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
import logoUrl from "../../assets/belladent-logo.png";
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
  kpis_pagos: {
    total_recaudado: number;
    total_reembolsado: number;
    ingreso_neto: number;
    pagos_completados: number;
    pagos_pendientes: number;
    cantidad_reembolsos: number;
    tasa_pago: number;
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
    ingresos_por_dia: { fecha: string; monto: number }[];
    por_metodo_pago: { metodo: string; total: number; monto: number }[];
    citas_vs_pagos: { fecha: string; citas_realizadas: number; pagadas: number; pendientes: number }[];
    ingresos_por_semana: { semana: string; monto: number }[];
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

  // Refs de CARDS (contenedor) - Citas
  const chartDiaRef = useRef<HTMLDivElement | null>(null);
  const chartSemanaRef = useRef<HTMLDivElement | null>(null);
  const chartEspecialidadRef = useRef<HTMLDivElement | null>(null);
  const chartHoraRef = useRef<HTMLDivElement | null>(null);

  // Refs SOLO del área del gráfico (lo que rasterizamos) - Citas
  const capDiaRef = useRef<HTMLDivElement | null>(null);
  const capSemanaRef = useRef<HTMLDivElement | null>(null);
  const capEspRef = useRef<HTMLDivElement | null>(null);
  const capHoraRef = useRef<HTMLDivElement | null>(null);

  // Refs para gráficos de Pagos (para PDF)
  const capIngresosDiaRef = useRef<HTMLDivElement | null>(null);
  const capMetodoPagoRef = useRef<HTMLDivElement | null>(null);
  const capCitasVsPagosRef = useRef<HTMLDivElement | null>(null);
  const capIngresosSemanaRef = useRef<HTMLDivElement | null>(null);

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

  // DOM, PNG con html2canvas (evita recortes usando scrollWidth/scrollHeight)
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
      onclone: (clonedDoc) => {
        // Forzar colores RGB en TODOS los elementos para evitar problemas con oklch()
        const allElements = clonedDoc.querySelectorAll('*');
        allElements.forEach((elem: any) => {
          const style = elem.style;
          if (style) {
            // Forzar colores básicos RGB/HEX
            if (style.color && style.color.includes('oklch')) {
              style.color = '#374151';
            }
            if (style.backgroundColor && style.backgroundColor.includes('oklch')) {
              style.backgroundColor = '#ffffff';
            }
            if (style.borderColor && style.borderColor.includes('oklch')) {
              style.borderColor = '#e5e7eb';
            }
            if (style.fill && style.fill.includes('oklch')) {
              style.fill = '#374151';
            }
            if (style.stroke && style.stroke.includes('oklch')) {
              style.stroke = '#374151';
            }
          }
        });
      },
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

      // ===== SECCIÓN: ANÁLISIS DE CITAS =====
      doc.setFont("helvetica", "bold").setFontSize(14);
      doc.text("ANALISIS DE CITAS", marginX, cursorY);
      cursorY += 20;

      // KPIs de Citas
      const k = data.kpis;
      autoTable(doc, {
        startY: cursorY,
        head: [["Estadísticas de Citas", "Valor"]],
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
      cursorY = (doc as any).lastAutoTable.finalY + 20;

      // ===== SECCIÓN: ANÁLISIS DE PAGOS =====
      if (data.kpis_pagos) {
        doc.setFont("helvetica", "bold").setFontSize(14);
        doc.text("ANALISIS DE PAGOS", marginX, cursorY);
        cursorY += 20;

        const kp = data.kpis_pagos;
        autoTable(doc, {
          startY: cursorY,
          head: [["Estadísticas de Pagos", "Valor"]],
          body: [
            ["Ingreso neto", `$${kp.ingreso_neto.toFixed(2)}`],
            ["Total recaudado", `$${kp.total_recaudado.toFixed(2)}`],
            ["Total reembolsado", `$${kp.total_reembolsado.toFixed(2)}`],
            ["Pagos completados", String(kp.pagos_completados)],
            ["Pagos pendientes", String(kp.pagos_pendientes)],
            ["Cantidad reembolsos", String(kp.cantidad_reembolsos)],
            ["Tasa de pago (%)", `${kp.tasa_pago.toFixed(1)} %`],
          ],
          styles: { fontSize: 10, cellPadding: 5 },
          headStyles: { fillColor: [16, 185, 129], textColor: 255 },
          theme: "grid",
          margin: { left: marginX, right: marginX },
        });
        cursorY = (doc as any).lastAutoTable.finalY + 20;
      }

      // Top pacientes (Top 10)
      doc.setFont("helvetica", "bold").setFontSize(12);
      doc.text("TOP 10 PACIENTES", marginX, cursorY);
      cursorY += 16;

      const top10 = (data.tablas.top_pacientes || []).slice(0, 10);
      autoTable(doc, {
        startY: cursorY,
        head: [["#", "Paciente", "Cédula", "Citas"]],
        body: top10.length
          ? top10.map((r, i) => [String(i + 1), r.paciente, r.cedula, String(r.citas)])
          : [["—", "Sin datos", "—", "—"]],
        styles: { fontSize: 10, cellPadding: 5 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255 },
        theme: "striped",
        margin: { left: marginX, right: marginX },
      });

      // ===== Página 2: Gráficos de Citas (2×2) =====
      doc.addPage();
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const usableW = pageW - marginX * 2;
      const usableH = pageH - marginY * 2;

      doc.setFont("helvetica", "bold").setFontSize(14);
      doc.text("GRAFICOS DE CITAS", marginX, marginY);

      const gutter = 12;
      const cols = 2,
        rows = 2;
      const cellW = (usableW - gutter) / cols;
      const cellH = (usableH - gutter - 18) / rows;

      const citasBlocks: Array<{
        title: string;
        ref: React.MutableRefObject<HTMLDivElement | null>;
      }> = [
        { title: "Citas por día", ref: capDiaRef },
        { title: "Citas por estado (por semana)", ref: capSemanaRef },
        { title: "Citas por especialidad", ref: capEspRef },
        { title: "Horas pico", ref: capHoraRef },
      ];

      await new Promise((r) => setTimeout(r, 100));

      for (let i = 0; i < citasBlocks.length; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const baseX = marginX + c * (cellW + gutter);
        const baseY = marginY + 18 + r * (cellH + gutter);

        doc.setFont("helvetica", "bold").setFontSize(11);
        doc.text(citasBlocks[i].title, baseX, baseY + 12);

        const el = citasBlocks[i].ref.current;
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

      // ===== Página 3: Gráficos de Pagos (2×2) =====
      if (data.kpis_pagos) {
        doc.addPage();

        doc.setFont("helvetica", "bold").setFontSize(14);
        doc.text("GRAFICOS DE PAGOS", marginX, marginY);

        const pagosBlocks: Array<{
          title: string;
          ref: React.MutableRefObject<HTMLDivElement | null>;
        }> = [
          { title: "Ingresos por día", ref: capIngresosDiaRef },
          { title: "Métodos de pago", ref: capMetodoPagoRef },
          { title: "Citas realizadas vs Pagadas", ref: capCitasVsPagosRef },
          { title: "Tendencia de ingresos (por semana)", ref: capIngresosSemanaRef },
        ];

        await new Promise((r) => setTimeout(r, 100));

        for (let i = 0; i < pagosBlocks.length; i++) {
          const c = i % cols;
          const r = Math.floor(i / cols);
          const baseX = marginX + c * (cellW + gutter);
          const baseY = marginY + 18 + r * (cellH + gutter);

          doc.setFont("helvetica", "bold").setFontSize(11);
          doc.text(pagosBlocks[i].title, baseX, baseY + 12);

          const el = pagosBlocks[i].ref.current;
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

          {/* Odontólogo */}
          <div className="flex flex-col justify-end">
            <label className="text-sm text-gray-600 leading-none mb-1">
              Odontólogo
            </label>
            <select
              value={filtros.odontologo ?? ""}
              onChange={(e) =>
                setFiltros((s) => ({
                  ...s,
                  odontologo: e.target.value ? Number(e.target.value) : "",
                }))
              }
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">Todos</option>
              {odontologos.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
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

          {/* Especialidad */}
          <div className="flex flex-col justify-end">
            <label className="text-sm text-gray-600 leading-none mb-1">
              Especialidad
            </label>
            <select
              value={filtros.especialidad ?? ""}
              onChange={(e) =>
                setFiltros((s) => ({
                  ...s,
                  especialidad: e.target.value ? Number(e.target.value) : "",
                }))
              }
              className="w-full border rounded-lg px-3 py-2"
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

        {/* Botones inferiores alineados a la derecha */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => {
              const hoyISO = toLocalISO(new Date());
              setFiltros({
                desde: hoyISO,
                hasta: hoyISO,
                odontologo: "",
                consultorio: "",
                estado: "",
                especialidad: "",
              });
            }}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors"
            title="Limpiar filtros"
          >
            <Eraser className="w-4 h-4" />
            Limpiar
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

      {/* ==================== SECCIÓN: ANÁLISIS DE CITAS ==================== */}
      <h2 className="text-xl font-bold mt-2 mb-2 flex items-center gap-2">
        <CalendarDays className="w-6 h-6" />
        Análisis de Citas
      </h2>

      {/* KPIs de Citas */}
      <div className="rounded-xl bg-white shadow-md p-4">
        <h3 className="text-lg font-bold mb-3 text-gray-800">📅 Estadísticas de Citas</h3>
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
      </div>

      {/* Gráficos de Citas */}
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
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '14px' }}>
                {pieWithPct.length ? (
                  pieWithPct.map((it, idx) => (
                    <li
                      key={idx}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between', 
                        gap: '12px',
                        marginBottom: idx < pieWithPct.length - 1 ? '8px' : '0'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span
                          style={{ 
                            display: 'inline-block', 
                            width: '12px', 
                            height: '12px', 
                            borderRadius: '2px',
                            backgroundColor: it.color 
                          }}
                        />
                        <span style={{ whiteSpace: 'normal', wordBreak: 'break-word', color: '#374151' }}>
                          {it.name}
                        </span>
                      </div>
                      <span style={{ flexShrink: 0, color: '#374151' }}>
                        {it.pct}% ({it.value})
                      </span>
                    </li>
                  ))
                ) : (
                  <li style={{ color: '#6B7280' }}>Sin datos</li>
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

      {/* ==================== SECCIÓN: ANÁLISIS DE PAGOS ==================== */}
      <h2 className="text-xl font-bold mt-6 mb-2 flex items-center gap-2">
        <Banknote className="w-6 h-6" />
        Análisis de Pagos
      </h2>

      {/* KPIs de Pagos */}
      <div className="rounded-xl bg-white shadow-md p-4">
        <h3 className="text-lg font-bold mb-3 text-gray-800">💰 Estadísticas de Pagos</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard 
            label="Ingreso neto" 
            value={data?.kpis_pagos ? `$${(data.kpis_pagos.ingreso_neto ?? 0).toFixed(2)}` : "$0.00"} 
          />
          <KpiCard 
            label="Total recaudado" 
            value={data?.kpis_pagos ? `$${(data.kpis_pagos.total_recaudado ?? 0).toFixed(2)}` : "$0.00"} 
          />
          <KpiCard 
            label="Pagos completados" 
            value={data?.kpis_pagos?.pagos_completados ?? 0} 
          />
          <KpiCard 
            label="Pagos pendientes" 
            value={data?.kpis_pagos?.pagos_pendientes ?? 0} 
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <KpiCard 
            label="Tasa de pago (%)" 
            value={data?.kpis_pagos ? `${(data.kpis_pagos.tasa_pago ?? 0).toFixed(1)} %` : "0.0 %"} 
          />
          <KpiCard 
            label="Reembolsados" 
            value={data?.kpis_pagos?.cantidad_reembolsos ?? 0} 
          />
          <KpiCard 
            label="Monto reembolsado" 
            value={data?.kpis_pagos ? `$${(data.kpis_pagos.total_reembolsado ?? 0).toFixed(2)}` : "$0.00"} 
          />
        </div>
      </div>

      {/* Gráficos de Pagos */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
        {/* Ingresos por día */}
        <ChartCard
          title="Ingresos por día"
          icon={<TrendingUp size={16} />}
          captureRef={capIngresosDiaRef}
        >
          {data?.series.ingresos_por_dia && data.series.ingresos_por_dia.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <RLineChart
                data={data.series.ingresos_por_dia}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: any) => `$${Number(value).toFixed(2)}`}
                />
                <Line
                  type="monotone"
                  dataKey="monto"
                  stroke="#10B981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="Ingresos"
                />
              </RLineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px]" style={{ color: '#9CA3AF' }}>
              Sin datos de ingresos
            </div>
          )}
        </ChartCard>

        {/* Distribución por método de pago */}
        <ChartCard
          title="Métodos de pago"
          icon={<PieChart size={16} />}
          captureRef={capMetodoPagoRef}
        >
          {data?.series.por_metodo_pago && data.series.por_metodo_pago.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="60%" height={240}>
                <RPieChart>
                  <Tooltip
                    formatter={(value: any) => `$${Number(value).toFixed(2)}`}
                  />
                  <Pie
                    data={data.series.por_metodo_pago}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="monto"
                    label={false}
                  >
                    {data.series.por_metodo_pago.map((_, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={idx === 0 ? "#10B981" : "#3B82F6"}
                      />
                    ))}
                  </Pie>
                </RPieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {data.series.por_metodo_pago.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        backgroundColor: idx === 0 ? "#10B981" : "#3B82F6",
                      }}
                    />
                    <div style={{ fontSize: '14px', flex: 1 }}>
                      <div style={{ fontWeight: 500, color: '#374151' }}>{item.metodo}</div>
                      <div style={{ color: '#4B5563' }}>
                        {item.total} pagos • ${item.monto.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[240px]" style={{ color: '#9CA3AF' }}>
              Sin datos de métodos de pago
            </div>
          )}
        </ChartCard>

        {/* Citas vs Pagos */}
        <ChartCard
          title="Citas realizadas vs Pagadas"
          icon={<BarChart3 size={16} />}
          captureRef={capCitasVsPagosRef}
        >
          {data?.series.citas_vs_pagos && data.series.citas_vs_pagos.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <RBarChart
                data={data.series.citas_vs_pagos}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="citas_realizadas"
                  fill="#3B82F6"
                  name="Realizadas"
                />
                <Bar dataKey="pagadas" fill="#10B981" name="Pagadas" />
                <Bar dataKey="pendientes" fill="#F59E0B" name="Pendientes" />
              </RBarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px]" style={{ color: '#9CA3AF' }}>
              Sin datos de comparación
            </div>
          )}
        </ChartCard>

        {/* Ingresos por semana */}
        <ChartCard
          title="Tendencia de ingresos (por semana)"
          icon={<TrendingUp size={16} />}
          captureRef={capIngresosSemanaRef}
        >
          {data?.series.ingresos_por_semana && data.series.ingresos_por_semana.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <RBarChart
                data={data.series.ingresos_por_semana}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                <XAxis dataKey="semana" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: any) => `$${Number(value).toFixed(2)}`}
                />
                <Bar dataKey="monto" fill="#10B981" name="Ingresos" radius={[8, 8, 0, 0]} />
              </RBarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px]" style={{ color: '#9CA3AF' }}>
              Sin datos de ingresos semanales
            </div>
          )}
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
    {/* SOLO el área del gráfico a rasterizar - Forzar colores RGB para html2canvas */}
    <div 
      ref={captureRef} 
      className="w-full"
      style={{ 
        backgroundColor: '#ffffff',
        color: '#374151'
      }}
    >
      {children}
    </div>
  </div>
);

export default Reportes;
