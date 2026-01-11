// src/pages/admin/Inicio.tsx
import { useEffect, useMemo, useState, Fragment } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/axios";
import { Eye } from "lucide-react";

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

/* ===== Helpers de fecha ===== */
const pad2 = (n: number) => String(n).padStart(2, "0");
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hhmm = (h: number) => `${pad2(h)}:00`;

function startOfWeek(d: Date) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const x = new Date(d);
  x.setDate(d.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfWeek(d: Date) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
}
const normalizeEstado = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/* ===== Componente de acciones por cita ===== */
function AccionesCita({ id }: { id: number }) {
  return (
    <div className="flex items-center justify-center">
      <Link
        to={`/admin/citas/${id}`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Ver detalles"
      >
        <Eye className="size-4" />
        Ver
      </Link>
    </div>
  );
}

export default function Inicio() {
  const hoyISO = useMemo(() => toISODate(new Date()), []);
  const [citasHoy, setCitasHoy] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(false);
  const [kpiSemana, setKpiSemana] = useState<number>(0);

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
    for (const c of citasHoy) {
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
  }, [citasHoy]);

  const odontologosHoy = useMemo(() => {
    const s = new Set<number>();
    citasHoy.forEach((c) => s.add(c.id_odontologo));
    return s.size;
  }, [citasHoy]);

  const pacientesHoy = useMemo(() => {
    const s = new Set<number>();
    citasHoy.forEach((c) => s.add(c.id_paciente));
    return s.size;
  }, [citasHoy]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.get("/citas/", {
          params: { fecha: hoyISO, ordering: "hora", page_size: 1000 },
        });
        setCitasHoy(res.data.results ?? res.data ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [hoyISO]);

  useEffect(() => {
    (async () => {
      try {
        const now = new Date();
        const from = toISODate(startOfWeek(now));
        const to = toISODate(endOfWeek(now));
        const res = await api.get("/citas/", {
          params: { from, to, page_size: 1000, ordering: "fecha,hora" },
        });
        const data = res.data.results ?? res.data ?? [];
        setKpiSemana(Array.isArray(data) ? data.length : 0);
      } catch {
        setKpiSemana(0);
      }
    })();
  }, []);

  const estadoPill = (estado: Cita["estado"]) => {
    const n = normalizeEstado(estado);

    const cls =
      n === "pendiente"
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : n === "confirmada"
        ? "bg-green-100 text-green-800 border-green-200"
        : n === "realizada"
        ? "bg-blue-100 text-blue-800 border-blue-200"
        : n === "mantenimiento"
        ? "bg-violet-100 text-violet-800 border-violet-200"
        : "bg-rose-100 text-rose-800 border-rose-200"; // cancelada u otros

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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold">📋 Panel general</h1>
        <p className="text-gray-600 mt-1">Resumen y agenda del día.</p>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "Odontólogos de hoy", value: odontologosHoy },
          { label: "Pacientes de hoy", value: pacientesHoy },
          { label: "Citas de esta semana", value: kpiSemana },
        ].map((k, i) => (
          <div key={i} className="rounded-xl bg-white shadow-md p-4">
            <p className="text-xs text-gray-500">{k.label}</p>
            <p className="text-4xl font-semibold mt-2">
              {loading && i < 2 ? "…" : k.value}
            </p>
          </div>
        ))}
      </section>

      {/* Agenda del día */}
      <section className="rounded-xl bg-white shadow-md overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2
            style={{ fontSize: "1.15rem" }}
            className="font-semibold flex items-center gap-2"
          >
            🗓️ Agenda del día — {hoyISO}
          </h2>
          <div className="text-sm text-gray-500">
            {loading ? "Cargando…" : `${citasHoy.length} cita(s)`}
          </div>
        </div>

        <div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100 text-black font-bold">
                <tr className="border-b border-black">
                  <th className="py-2 px-3 w-24 text-center">Hora</th>
                  <th className="py-2 px-3 text-center">Paciente</th>
                  <th className="py-2 px-3 text-center">Motivo</th>
                  <th className="py-2 px-3 text-center">Odontólogo</th>
                  <th className="py-2 px-3 text-center">Consultorio</th>
                  <th className="py-2 px-3 text-center">Estado Cita</th>
                  <th className="py-2 px-3 text-center">Estado Pago</th>
                  <th className="py-2 px-3 text-center w-24">Acción</th>
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
                            <div className="text-xs">
                              {first.paciente_cedula}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-center">
                            {first.motivo ?? "—"}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {first.odontologo_nombre ??
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
                            {estadoPagoPill(first)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <AccionesCita id={first.id_cita} />
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
                              {cita.odontologo_nombre ??
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
                              {estadoPagoPill(cita)}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <AccionesCita id={cita.id_cita} />
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
                      <td className="py-2 px-3 text-center">—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t bg-gray-50">
            <p className="text-xs text-gray-500 p-4 pt-3">
              * Agenda fija de 09:00 a 21:00 (intervalos de 1h). Las 13:00–15:00
              no se muestran.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
