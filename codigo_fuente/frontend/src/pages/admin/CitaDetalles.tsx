// src/pages/admin/CitaDetalles.tsx
import { useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../../api/axios";
import {
  Pencil,
  CalendarDays,
  Clock,
  User as UserIcon,
  Stethoscope,
  Building2,
  FileText,
  ArrowLeft,
} from "lucide-react";

/* ===== Tipos ===== */
type Estado =
  | "pendiente"
  | "confirmada"
  | "cancelada"
  | "realizada"
  | "mantenimiento";

type Cita = {
  id_cita: number;
  fecha: string; // YYYY-MM-DD
  hora?: string | null; // HH:MM:SS (puede venir null)
  hora_inicio?: string | null; // HH:MM
  motivo?: string | null;
  estado: Estado;
  id_odontologo: number;
  id_paciente: number;
  paciente_nombre?: string;
  paciente_cedula?: string;
  odontologo_nombre?: string;
  consultorio?: { id_consultorio: number; numero: string } | null;
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
  archivo?: string | null; // URL del archivo
  mime_type?: string | null;
  nombre_original?: string | null;
  tamano_bytes?: number | null;
  checksum_sha256?: string | null;
  created_at: string;
};

/* ===== UI helpers ===== */
function isImage(mime?: string | null) {
  return (
    !!mime && (mime.startsWith("image/") || /\b(jpe?g|png|webp)$/i.test(mime))
  );
}
function hhmm(hora?: string | null) {
  if (!hora) return "—";
  const [h, m] = hora.split(":");
  return `${(h ?? "").padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
}

/* ===== Pill de estado (seguro) ===== */
function pillClasses(estado?: Estado | null) {
  switch (estado) {
    case "realizada":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "confirmada":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "cancelada":
      return "bg-rose-100 text-rose-800 border-rose-200";
    case "mantenimiento":
      return "bg-purple-100 text-purple-800 border-purple-200";
    case "pendiente":
      return "bg-amber-100 text-amber-800 border-amber-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function Pill({ estado }: { estado?: Estado | null }) {
  const safe = estado ?? "pendiente";
  const label = safe.charAt(0).toUpperCase() + safe.slice(1).toLowerCase();
  return (
    <span
      className={`inline-block text-xs px-2 py-1 rounded-full border ${pillClasses(
        estado
      )}`}
    >
      {label}
    </span>
  );
}

/* ===== Página ===== */
export default function CitaDetalles() {
  const { id } = useParams(); // /admin/citas/:id
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [cita, setCita] = useState<Cita | null>(null);
  const [ficha, setFicha] = useState<FichaMedica | null>(null);
  const [adjuntos, setAdjuntos] = useState<ArchivoAdjunto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const idCita = useMemo(() => Number(id), [id]);

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

        // 2) Ficha por id_cita
        const f = await api.get(`/fichas-medicas/`, {
          params: { id_cita: idCita, page_size: 1 },
        });
        if (!alive) return;
        const fichas: FichaMedica[] = f.data?.results ?? f.data ?? [];
        const byCita = Array.isArray(fichas)
          ? fichas.find((x) => Number(x.id_cita) === idCita)
          : null;
        setFicha(byCita ?? null);

        // 3) Adjuntos (si hay ficha)
        if (byCita) {
          const a = await api.get(`/archivos-adjuntos/`, {
            params: {
              id_ficha_medica: byCita.id_ficha_medica,
              page_size: 1000,
            },
          });
          if (!alive) return;
          setAdjuntos(a.data?.results ?? a.data ?? []);
        } else {
          setAdjuntos([]);
        }
      } catch (e: any) {
        setError(
          e?.response?.data?.detail ?? "No se pudo cargar la información."
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [idCita]);

  if (loading) {
    return <div className="p-4">Cargando…</div>;
  }
  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-lg border bg-red-50 text-red-900 px-3 py-2 text-sm">
          {error}
        </div>
        <div className="mt-3">
          <button
            className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
            onClick={() => navigate("/admin/agenda")}
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>
        </div>
      </div>
    );
  }
  if (!cita) {
    return (
      <div className="p-4">
        <div className="rounded-lg border bg-amber-50 text-amber-900 px-3 py-2 text-sm">
          No se encontró la cita.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Detalle de Cita #{cita.id_cita}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/admin/agenda")}
            className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>

          <Link
            to={`/admin/citas/${cita.id_cita}/editar`}
            className="inline-flex items-center gap-2 border rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
            title="Editar cita"
          >
            <Pencil className="size-4" />
            Editar
          </Link>
        </div>
      </div>

      {/* ===== Card: Datos de la Cita ===== */}
      <div className="rounded-xl bg-white shadow-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Datos de la cita</h2>
          <Pill estado={cita.estado} />
        </div>

        {/* (Fecha | Hora), (Paciente | Odontólogo), (Consultorio | Motivo) */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Fecha */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <CalendarDays className="w-4 h-4" />
              Fecha
            </div>
            <div className="font-medium">{cita.fecha}</div>
          </div>

          {/* Hora */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-4 h-4" />
              Hora
            </div>
            <div className="font-medium">
              {hhmm(cita.hora_inicio ?? cita.hora)}
            </div>
          </div>

          {/* Paciente */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <UserIcon className="w-4 h-4" />
              Paciente
            </div>
            <div className="font-medium">
              {cita.paciente_nombre ?? `#${cita.id_paciente}`}
            </div>
            {cita.paciente_cedula && (
              <div className="text-xs text-gray-500">
                {cita.paciente_cedula}
              </div>
            )}
          </div>

          {/* Odontólogo */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Stethoscope className="w-4 h-4" />
              Odontólogo
            </div>
            <div className="font-medium">
              {cita.odontologo_nombre ?? `#${cita.id_odontologo}`}
            </div>
          </div>

          {/* Consultorio */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Building2 className="w-4 h-4" />
              Consultorio
            </div>
            <div className="font-medium">
              {cita.consultorio?.numero
                ? `Consultorio ${cita.consultorio.numero}`
                : "—"}
            </div>
          </div>

          {/* Motivo (a la derecha de Consultorio) */}
          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <FileText className="w-4 h-4" />
              Motivo
            </div>
            <div className="font-medium">{cita.motivo ?? "—"}</div>
          </div>
        </div>
      </div>

      {/* ===== Card: Ficha médica ===== */}
      <div className="rounded-xl bg-white shadow-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Ficha médica</h2>
          {/* ⛔️ Sin estado en admin */}
        </div>

        {!ficha ? (
          <div className="rounded-lg border bg-amber-50 text-amber-900 px-3 py-2 text-sm">
            Esta cita aún no tiene ficha médica.
          </div>
        ) : (
          <Fragment>
            {/* (Observación | Diagnóstico), (Tratamiento | Comentarios) */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Observación */}
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Observación</div>
                <div className="whitespace-pre-wrap">
                  {ficha.observacion || "—"}
                </div>
              </div>

              {/* Diagnóstico */}
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Diagnóstico</div>
                <div className="whitespace-pre-wrap">
                  {ficha.diagnostico || "—"}
                </div>
              </div>

              {/* Tratamiento */}
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Tratamiento</div>
                <div className="whitespace-pre-wrap">
                  {ficha.tratamiento || "—"}
                </div>
              </div>

              {/* Comentarios */}
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Comentarios</div>
                <div className="whitespace-pre-wrap">
                  {ficha.comentarios || "—"}
                </div>
              </div>
            </div>

            {/* Adjuntos */}
            <div className="mt-2">
              <h3 className="font-medium mb-2">Adjuntos</h3>
              {adjuntos.length === 0 ? (
                <div className="text-sm text-gray-500">
                  Sin archivos adjuntos.
                </div>
              ) : (
                <div className="grid md:grid-cols-3 gap-4">
                  {adjuntos.map((a) => (
                    <div
                      key={a.id_archivo_adjunto}
                      className="border rounded-lg p-3"
                    >
                      <div
                        className="text-sm font-medium truncate"
                        title={a.nombre_original ?? ""}
                      >
                        {a.nombre_original ?? `Adjunto ${a.id_archivo_adjunto}`}
                      </div>
                      <div className="text-xs text-gray-500">
                        {a.mime_type || "—"} ·{" "}
                        {a.tamano_bytes ? `${a.tamano_bytes} bytes` : "—"}
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
