// src/pages/paciente/VerCita.tsx
import { useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/axios";
import {
  CalendarDays,
  Clock,
  Stethoscope,
  Building2,
  FileText,
} from "lucide-react";

type Estado = "pendiente" | "confirmada" | "cancelada" | "realizada";

type Cita = {
  id_cita: number;
  fecha: string; // YYYY-MM-DD
  hora?: string | null;       // HH:MM:SS (legacy)
  hora_inicio?: string | null; // HH:MM (preferente)
  motivo?: string | null;
  estado: Estado;
  id_odontologo: number;
  odontologo_nombre?: string | null;
  consultorio?: { id_consultorio: number; numero?: string | null; nombre?: string | null } | null;
};

type FichaMedica = {
  id_ficha_medica: number;
  id_cita: number;
  observacion?: string | null;
  diagnostico?: string | null;
  tratamiento?: string | null;
  comentarios?: string | null;
  created_at: string;
  updated_at: string;
};

type ArchivoAdjunto = {
  id_archivo_adjunto: number;
  id_ficha_medica: number;
  archivo?: string | null; // URL
  mime_type?: string | null;
  nombre_original?: string | null;
  tamano_bytes?: number | null;
  created_at: string;
};

function isImage(mime?: string | null) {
  return !!mime && (mime.startsWith("image/") || /\b(jpe?g|png|webp)$/i.test(mime));
}
function hhmm(h?: string | null) {
  if (!h) return "—";
  const [H, M] = h.split(":");
  return `${(H ?? "").padStart(2, "0")}:${(M ?? "00").padStart(2, "0")}`;
}
function estadoClasses(estado: Estado) {
  switch (estado) {
    case "realizada":
      return "bg-blue-100 text-blue-700 border border-blue-200";
    case "confirmada":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "cancelada":
      return "bg-rose-100 text-rose-700 border-rose-200";
    default:
      return "bg-amber-100 text-amber-700 border-amber-200";
  }
}
function EstadoBadge({ estado }: { estado: Estado }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${estadoClasses(estado)}`}>
      {estado}
    </span>
  );
}

export default function VerCitaPaciente() {
  // Ruta sugerida: /paciente/mis-citas/ver/:id
  const { id } = useParams();
  const navigate = useNavigate();
  const idCita = useMemo(() => Number(id), [id]);

  const [loading, setLoading] = useState(true);
  const [cita, setCita] = useState<Cita | null>(null);
  const [ficha, setFicha] = useState<FichaMedica | null>(null);
  const [adjuntos, setAdjuntos] = useState<ArchivoAdjunto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1) Cita
        const c = await api.get(`/citas/${idCita}/`);
        if (!alive) return;
        const citaData: Cita = c.data;
        setCita(citaData);

        // 2) Ficha médica (si existe)
        const f = await api.get(`/fichas-medicas/`, { params: { id_cita: idCita, page_size: 1 } });
        if (!alive) return;
        const results: FichaMedica[] = f.data?.results ?? f.data ?? [];
        const fm = Array.isArray(results) ? results.find(x => Number(x.id_cita) === idCita) : null;
        setFicha(fm ?? null);

        // 3) Adjuntos
        if (fm) {
          const a = await api.get(`/archivos-adjuntos/`, {
            params: { id_ficha_medica: fm.id_ficha_medica, page_size: 1000 },
          });
          if (!alive) return;
          setAdjuntos(a.data?.results ?? a.data ?? []);
        } else {
          setAdjuntos([]);
        }
      } catch (e: any) {
        setError(e?.response?.data?.detail ?? "No se pudo cargar la información.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [idCita]);

  if (loading) {
    return <div className="p-4">Cargando…</div>;
  }

  if (error) {
    return (
      <div className="p-4 space-y-3">
        <div className="rounded-lg border bg-red-50 text-red-900 px-3 py-2 text-sm">{error}</div>
        <button
          className="border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
          onClick={() => navigate("/paciente/mis-citas/historial")}
        >
          Volver
        </button>
      </div>
    );
  }

  if (!cita) {
    return (
      <div className="p-4">
        <div className="rounded-lg border bg-amber-50 text-amber-900 px-3 py-2 text-sm">
          No se encontró la cita.
        </div>
        <div className="mt-3">
          <button
            className="border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
            onClick={() => navigate("/paciente/mis-citas/historial")}
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header simple (solo volver) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Cita #{cita.id_cita}</h1>
        <button
          onClick={() => navigate("/paciente/mis-citas/historial")}
          className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
        >
          Volver
        </button>
      </div>

      {/* ===== Datos de la Cita (solo lectura) ===== */}
      <div className="rounded-xl bg-white shadow-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Datos de la cita</h2>
          <EstadoBadge estado={cita.estado} />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <CalendarDays className="w-4 h-4" />
              Fecha
            </div>
            <div className="font-medium">{cita.fecha}</div>
          </div>

          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-4 h-4" />
              Hora
            </div>
            <div className="font-medium">{hhmm(cita.hora_inicio ?? cita.hora)}</div>
          </div>

          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Stethoscope className="w-4 h-4" />
              Odontólogo
            </div>
            <div className="font-medium">{cita.odontologo_nombre ?? `#${cita.id_odontologo}`}</div>
          </div>

          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Building2 className="w-4 h-4" />
              Consultorio
            </div>
            <div className="font-medium">
              {cita.consultorio?.numero
                ? `Consultorio ${cita.consultorio.numero}`
                : (cita.consultorio?.nombre ?? "—")}
            </div>
          </div>

          <div className="md:col-span-2 border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <FileText className="w-4 h-4" />
              Motivo
            </div>
            <div className="font-medium">{cita.motivo ?? "—"}</div>
          </div>
        </div>
      </div>

      {/* ===== Ficha médica (solo lectura) ===== */}
      <div className="rounded-xl bg-white shadow-md p-4 space-y-3">
        <h2 className="font-semibold">Ficha médica</h2>

        {!ficha ? (
          <div className="rounded-lg border bg-gray-50 text-gray-700 px-3 py-2 text-sm">
            Esta cita no tiene ficha médica registrada.
          </div>
        ) : (
          <Fragment>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Observación</div>
                <div className="whitespace-pre-wrap">{ficha.observacion || "—"}</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Diagnóstico</div>
                <div className="whitespace-pre-wrap">{ficha.diagnostico || "—"}</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Tratamiento</div>
                <div className="whitespace-pre-wrap">{ficha.tratamiento || "—"}</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Comentarios</div>
                <div className="whitespace-pre-wrap">{ficha.comentarios || "—"}</div>
              </div>
            </div>

            <div className="mt-2">
              <h3 className="font-medium mb-2">Adjuntos</h3>
              {adjuntos.length === 0 ? (
                <div className="text-sm text-gray-500">Sin archivos adjuntos.</div>
              ) : (
                <div className="grid md:grid-cols-3 gap-4">
                  {adjuntos.map((a) => (
                    <div key={a.id_archivo_adjunto} className="border rounded-lg p-3">
                      <div className="text-sm font-medium truncate" title={a.nombre_original ?? ""}>
                        {a.nombre_original ?? `Adjunto ${a.id_archivo_adjunto}`}
                      </div>
                      <div className="text-xs text-gray-500">
                        {a.mime_type || "—"} · {a.tamano_bytes ? `${a.tamano_bytes} bytes` : "—"}
                      </div>
                      {a.archivo && isImage(a.mime_type) ? (
                        <a href={a.archivo} target="_blank" rel="noreferrer">
                          <img
                            src={a.archivo}
                            alt={a.nombre_original ?? "adjunto"}
                            className="mt-2 w-full max-h-48 object-contain rounded"
                          />
                        </a>
                      ) : (
                        <a
                          className="inline-flex items-center gap-2 mt-2 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50 text-sm"
                          href={a.archivo ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir archivo
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Fragment>
        )}
      </div>
    </div>
  );
}
