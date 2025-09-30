// src/pages/odontologo/Inicio.tsx
import { useEffect, useMemo, useState, Fragment } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/axios";
import { Eye, Pencil } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

/* ===== Tipos ===== */
type Cita = {
  id_cita: number;
  fecha: string; // YYYY-MM-DD
  hora?: string | null; // HH:MM:SS
  hora_inicio?: string | null; // HH:MM
  motivo?: string | null;
  estado:
    | "pendiente"
    | "confirmada"
    | "cancelada"
    | "realizada"
    | "mantenimiento";
  id_odontologo: number;
  id_paciente: number;
  paciente_nombre?: string | null;
  paciente_cedula?: string | null;
  consultorio?: { id_consultorio: number; numero?: string | null } | null;
};

/* ===== Helpers de fecha ===== */
const pad2 = (n: number) => String(n).padStart(2, "0");
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hhmm = (h: number) => `${pad2(h)}:00`;

function startOfWeek(d: Date) {
  const day = d.getDay(); // 0=Dom
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
  e.setHours(23, 59, 59, 999);
  return e;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 999);
}
const normalizeEstado = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const estadoLabel = (s: string) => {
  switch (normalizeEstado(s)) {
    case "mantenimiento":
      return "Mantenimiento";
    case "confirmada":
      return "Confirmada";
    case "realizada":
      return "Realizada";
    case "cancelada":
      return "Cancelada";
    case "pendiente":
      return "Pendiente";
    default:
      return "—";
  }
};

/* ===== Nombre visible del odontólogo ===== */
function firstNameLastNameFromUser(u: any): string {
  const pn =
    u?.primer_nombre ??
    u?.first_name ??
    u?.nombres ??
    u?.nombre ??
    u?.nombreCompleto ??
    u?.display_name ??
    u?.full_name ??
    "";
  const pa =
    u?.primer_apellido ?? u?.last_name ?? u?.apellidos ?? u?.apellido ?? "";
  const raw = (pn || "").toString().trim() + " " + (pa || "").toString().trim();
  const limp = raw.replace(/\s+/g, " ").trim();
  if (limp) return limp;

  const anyDisplay = (
    u?.nombre ??
    u?.nombres ??
    u?.nombreCompleto ??
    u?.display_name ??
    u?.full_name ??
    ""
  ).toString();
  const parts = anyDisplay
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!parts.length) return "";
  const primerNombre = parts[0];
  const primerApellido = parts.length > 1 ? parts[parts.length - 1] : "";
  return `${primerNombre} ${primerApellido}`.trim();
}

/* ===== Acciones por cita ===== */
function AccionesCita({ id }: { id: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {/* Ver → ahora apunta a /ver */}
      <Link
        to={`/odontologo/citas/${id}/ver`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Ver detalles"
      >
        <Eye className="size-4" />
        Ver
      </Link>

      {/* Editar (ya estaba bien) */}
      <Link
        to={`/odontologo/citas/${id}/editar`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Editar"
      >
        <Pencil className="size-4" />
        Editar
      </Link>
    </div>
  );
}

export default function OdoInicio() {
  const { usuario } = useAuth();

  // Resuelve ID del odontólogo desde el usuario autenticado
  const idOdontologo = useMemo<number | null>(() => {
    if (typeof (usuario as any)?.id_odontologo === "number")
      return (usuario as any).id_odontologo;
    if (typeof (usuario as any)?.odontologo?.id_odontologo === "number")
      return (usuario as any).odontologo.id_odontologo;
    if (
      typeof (usuario as any)?.id_usuario?.odontologo?.id_odontologo ===
      "number"
    )
      return (usuario as any).id_usuario.odontologo.id_odontologo;
    return null;
  }, [usuario]);

  // Objeto de usuario real (evitar pasar un número si id_usuario es una PK)
  const baseUser = useMemo(() => {
    const u: any = usuario;
    if (!u) return {};
    if (typeof u === "object" && ("primer_nombre" in u || "sexo" in u))
      return u;
    if (u && typeof u.id_usuario === "object") return u.id_usuario;
    return u;
  }, [usuario]);

  // Saludo + título + nombre corto
  const { saludo, titulo, nombreCorto } = useMemo(() => {
    const s = String(baseUser?.sexo ?? "")
      .trim()
      .toUpperCase(); // 'M' | 'F'
    const isMujer = s === "F";
    const titulo = isMujer ? "Dra." : "Dr.";
    const saludo = isMujer ? "Bienvenida" : "Bienvenido";
    const nombreCorto = firstNameLastNameFromUser(baseUser) || "";
    return { saludo, titulo, nombreCorto };
  }, [baseUser]);

  const hoyISO = useMemo(() => toISODate(new Date()), []);

  const [citasHoy, setCitasHoy] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(false);

  const [kpiHoy, setKpiHoy] = useState<number>(0);
  const [kpiSemana, setKpiSemana] = useState<number>(0);
  const [kpiMes, setKpiMes] = useState<number>(0);

  // Agenda (horas visibles) — ahora hasta 21:00
  const horas = useMemo(() => {
    const arr: string[] = [];
    for (let h = 9; h <= 21; h++) {
      if (h === 13 || h === 14) continue;
      arr.push(hhmm(h));
    }
    return arr;
  }, []);

  // Citas por hora
  const citasByHora = useMemo(() => {
    const map = new Map<string, Cita[]>();
    for (const c of citasHoy) {
      const key = c.hora_inicio ?? (c.hora ? c.hora.slice(0, 5) : "");
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) =>
        String(a.consultorio?.numero ?? "").localeCompare(
          String(b.consultorio?.numero ?? "")
        )
      );
      map.set(k, arr);
    }
    return map;
  }, [citasHoy]);

  /* ===== Fetch citas del día (solo del odontólogo) ===== */
  useEffect(() => {
    if (!idOdontologo) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get("/citas/", {
          params: {
            fecha: hoyISO,
            id_odontologo: idOdontologo,
            ordering: "hora",
            page_size: 1000,
          },
        });
        const data: Cita[] = res.data?.results ?? res.data ?? [];
        setCitasHoy(data);
        setKpiHoy(Array.isArray(data) ? data.length : 0);
      } finally {
        setLoading(false);
      }
    })();
  }, [hoyISO, idOdontologo]);

  /* ===== Fetch KPIs (semana y mes) del odontólogo) ===== */
  useEffect(() => {
    if (!idOdontologo) return;
    (async () => {
      try {
        const now = new Date();

        // Semana
        const fromW = toISODate(startOfWeek(now));
        const toW = toISODate(endOfWeek(now));
        const rW = await api.get("/citas/", {
          params: {
            start: fromW,
            end: toW,
            id_odontologo: idOdontologo,
            page_size: 1000,
            ordering: "fecha,hora",
          },
        });
        const dW: Cita[] = rW.data?.results ?? rW.data ?? [];
        setKpiSemana(Array.isArray(dW) ? dW.length : 0);

        // Mes
        const fromM = toISODate(startOfMonth(now));
        const toM = toISODate(endOfMonth(now));
        const rM = await api.get("/citas/", {
          params: {
            start: fromM,
            end: toM,
            id_odontologo: idOdontologo,
            page_size: 2000,
            ordering: "fecha,hora",
          },
        });
        const dM: Cita[] = rM.data?.results ?? rM.data ?? [];
        setKpiMes(Array.isArray(dM) ? dM.length : 0);
      } catch {
        setKpiSemana(0);
        setKpiMes(0);
      }
    })();
  }, [idOdontologo]);

  const estadoPill = (estado: Cita["estado"]) => {
    const norm = normalizeEstado(estado);
    const cls =
      norm === "pendiente"
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : norm === "confirmada"
        ? "bg-green-100 text-green-800 border-green-200"
        : norm === "realizada"
        ? "bg-blue-100 text-blue-800 border-blue-200"
        : norm === "mantenimiento"
        ? "bg-violet-100 text-violet-800 border-violet-200" // 👈 aquí
        : "bg-red-100 text-red-800 border-red-200";

    return (
      <span
        className={`inline-block text-xs px-2 py-1 rounded-full border ${cls}`}
      >
        {estadoLabel(estado)}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold">
          👋 {saludo}, {titulo} {nombreCorto || "Doctor/a"}
        </h1>
        <p className="text-gray-600 mt-1">Resumen y agenda del día.</p>
      </header>

      {!idOdontologo ? (
        <div className="rounded-xl border bg-amber-50 text-amber-800 p-4">
          No se pudo identificar el odontólogo asociado a este usuario. Verifica
          que el usuario tenga relación con un <b>id_odontologo</b>.
        </div>
      ) : null}

      {/* KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Citas de hoy", value: kpiHoy },
          { label: "Citas de esta semana", value: kpiSemana },
          { label: "Citas de este mes", value: kpiMes },
        ].map((k, i) => (
          <div key={i} className="rounded-xl bg-white shadow-md p-4">
            <p className="text-xs text-gray-500">{k.label}</p>
            <p className="text-4xl font-semibold mt-2">
              {loading && k.label === "Citas de hoy" ? "…" : k.value}
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
                  <th className="py-2 px-3 text-center">Consultorio</th>
                  <th className="py-2 px-3 text-center">Estado</th>
                  <th className="py-2 px-3 text-center w-40">Acciones</th>
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
                            {first.consultorio?.numero
                              ? `Cons. ${first.consultorio.numero}`
                              : "—"}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {estadoPill(first.estado)}
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
                              {cita.consultorio?.numero
                                ? `Cons. ${cita.consultorio.numero}`
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {estadoPill(cita.estado)}
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 mt-3 px-2 pb-4">
            * Agenda fija de 09:00 a 21:00 (intervalos de 1h). Las 13:00–15:00
            no se muestran.
          </p>
        </div>
      </section>
    </div>
  );
}
