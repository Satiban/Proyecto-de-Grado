// src/pages/odontologo/VerCita.tsx
import { useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import {
  Pencil,
  Stethoscope,
  CalendarDays,
  Clock,
  User as UserIcon,
  Building2,
  FileText,
  ArrowLeft,
  Info,
  ClipboardList,
  Banknote,
  Download,
  DollarSign,
} from "lucide-react";
import { useLocation } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

function buildMediaURL(pathOrUrl?: string | null): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  // quitar /api/v1 de la base para apuntar al host del backend
  const base = API_BASE.endsWith("/api/v1")
    ? API_BASE.replace(/\/api\/v1\/?$/, "")
    : API_BASE;

  return `${base}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

function filenameFromUrl(u: string): string {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").filter(Boolean).pop() || "comprobante";
    return decodeURIComponent(last);
  } catch {
    const last = (u || "").split("/").filter(Boolean).pop() || "comprobante";
    return decodeURIComponent(last);
  }
}

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
  hora?: string | null; // HH:MM:SS
  hora_inicio?: string | null; // HH:MM
  motivo?: string | null;
  estado: Estado;
  id_odontologo: number;
  id_paciente: number;
  paciente_nombre?: string | null;
  paciente_cedula?: string | null;
  odontologo_nombre?: string | null;
  consultorio?: { id_consultorio: number; numero?: string | null } | null;
  pago?: {
    id_pago_cita: number;
    monto: string;
    metodo_pago: string;
    fecha_pago: string;
    observacion?: string | null;
    comprobante?: string | null;
    estado_pago: "pendiente" | "pagado" | "reembolsado";
    motivo_reembolso?: string | null;
    reembolsado_en?: string | null;
  } | null;
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

function hhmm(h?: string | null) {
  if (!h) return "—";
  const [H, M] = h.split(":");
  return `${(H ?? "").padStart(2, "0")}:${(M ?? "00").padStart(2, "0")}`;
}

/* ===== Badge de estado ===== */
function estadoClasses(estado: Estado) {
  switch (estado) {
    case "realizada":
      return "bg-blue-100 text-blue-700 border border-blue-200";
    case "confirmada":
      return "bg-emerald-100 text-emerald-700 border border-emerald-200";
    case "cancelada":
      return "bg-rose-100 text-rose-700 border border-rose-200";
    case "mantenimiento":
      return "bg-purple-100 text-purple-800 border border-purple-200";
    case "pendiente":
    default:
      return "bg-amber-100 text-amber-700 border border-amber-200";
  }
}

function EstadoBadge({ estado }: { estado: Estado }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${estadoClasses(
        estado
      )}`}
      title={`Estado: ${estadoLabel(estado)}`}
    >
      {estadoLabel(estado)}
    </span>
  );
}

const estadoLabel = (s: Estado) => {
  switch (s) {
    case "confirmada":
      return "Confirmada";
    case "realizada":
      return "Realizada";
    case "cancelada":
      return "Cancelada";
    case "mantenimiento":
      return "Mantenimiento";
    default:
      return "Pendiente";
  }
};

/* ===== Page ===== */
export default function VerCita() {
  const location = useLocation();
  const fechaAnterior = (location.state as any)?.fecha;

  // Ruta sugerida: /odontologo/citas/:id/ver
  const { id } = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();

  const idCita = useMemo(() => Number(id), [id]);

  // Helper para verificar si el usuario es administrador (rol 1 o 4)
  const esAdministrador = useMemo(() => {
    if (!usuario) return false;
    const rolId = typeof usuario.id_rol === 'object' 
      ? usuario.id_rol?.id_rol 
      : usuario.id_rol;
    return rolId === 1 || rolId === 4;
  }, [usuario]);

  const [loading, setLoading] = useState(true);
  const [cita, setCita] = useState<Cita | null>(null);
  const [ficha, setFicha] = useState<FichaMedica | null>(null);
  const [adjuntos, setAdjuntos] = useState<ArchivoAdjunto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pago, setPago] = useState<any | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1) Traer cita
        const c = await api.get(`/citas/${idCita}/`);
        if (!alive) return;
        const citaData: Cita = c.data;
        setCita(citaData);

        // Extraer pago directamente de la cita
        setPago((citaData as any).pago ?? null);

        // 2) Ficha por id_cita
        const f = await api.get(`/fichas-medicas/`, {
          params: { id_cita: idCita, page_size: 1 },
        });
        if (!alive) return;
        const results: FichaMedica[] = f.data?.results ?? f.data ?? [];
        const fm = Array.isArray(results)
          ? results.find((x) => Number(x.id_cita) === idCita)
          : null;
        setFicha(fm ?? null);

        // 3) Adjuntos si hay ficha
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

  const puedeAtender = cita?.estado === "confirmada";

  if (loading) {
    return <div className="p-4">Cargando…</div>;
  }

  if (error) {
    return (
      <div className="p-4 space-y-3">
        <div className="rounded-lg border bg-red-50 text-red-900 px-3 py-2 text-sm">
          {error}
        </div>
        <div>
          <button
            className="border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
            onClick={() => navigate("/odontologo/agenda")}
          >
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
      {/* Header de acciones */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Cita #{cita.id_cita}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (fechaAnterior) {
                navigate(`/odontologo/agenda`, {
                  state: { fecha: fechaAnterior },
                });
              } else {
                navigate(-1);
              }
            }}
            className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>
        </div>
      </div>

      {/* ===== Card: Datos de la Cita ===== */}
      <div className="rounded-xl bg-white shadow-md p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Título con ícono */}
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-gray-700" />
            <h2 className="font-semibold text-gray-800">Datos de la cita</h2>
            <EstadoBadge estado={cita.estado} />
          </div>

          {/* Botón Editar dentro de la card */}
          <Link
            to={`/odontologo/citas/${cita.id_cita}/editar`}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-2 text-xs shadow hover:bg-black/80 transition"
            title="Editar cita"
          >
            <Pencil className="w-4 h-4" />
            Editar
          </Link>
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

            {/* Especialidades del odontólogo */}
            {Array.isArray((cita as any).odontologo_especialidades) &&
              (cita as any).odontologo_especialidades.length > 0 && (
                <div className="text-xs text-gray-500">
                  {(cita as any).odontologo_especialidades.join(", ")}
                </div>
              )}
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

          {/* Motivo */}
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
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-gray-700" />
            <h2 className="font-semibold text-gray-800">Ficha médica</h2>
          </div>

          {/* Botón Atender dentro de la card */}
          <Link
            to={`/odontologo/citas/${cita.id_cita}/atencion`}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs shadow ${
              puedeAtender
                ? "bg-emerald-600 text-white hover:bg-emerald-700 transition"
                : "bg-gray-200 text-gray-500 cursor-not-allowed"
            }`}
            aria-disabled={!puedeAtender}
            onClick={(e) => {
              if (!puedeAtender) e.preventDefault();
            }}
            title={
              puedeAtender
                ? "Atender esta cita"
                : "Solo se puede atender si la cita está en estado 'Confirmada'"
            }
          >
            <Stethoscope className="w-4 h-4" />
            Atender
          </Link>
        </div>

        {!ficha ? (
          <div className="rounded-lg border bg-amber-50 text-amber-900 px-3 py-2 text-sm">
            Esta cita aún no tiene ficha médica. Puedes crearla desde{" "}
            <b>Atender</b>, siempre y cuando la cita esté en estado 'Confirmada'
          </div>
        ) : (
          <Fragment>
            {/* (Observación | Diagnóstico), (Tratamiento | Comentarios) */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Observación</div>
                <div className="whitespace-pre-wrap">
                  {ficha.observacion || "—"}
                </div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Diagnóstico</div>
                <div className="whitespace-pre-wrap">
                  {ficha.diagnostico || "—"}
                </div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Tratamiento</div>
                <div className="whitespace-pre-wrap">
                  {ficha.tratamiento || "—"}
                </div>
              </div>
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

      {/* ===== Card: Pago de la Cita ===== */}
      {cita.estado?.toLowerCase() !== "cancelada" && (
        <div className="rounded-xl bg-white shadow-md p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-gray-700" />
              <h2 className="font-semibold">Pago de la cita</h2>
              <span
                className={`text-xs px-2 py-1 rounded-full border ${
                  pago?.estado_pago === "pagado"
                    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                    : pago?.estado_pago === "reembolsado"
                    ? "bg-rose-100 text-rose-800 border-rose-200"
                    : "bg-amber-100 text-amber-800 border-amber-200"
                }`}
              >
                {pago?.estado_pago
                  ? pago.estado_pago.charAt(0).toUpperCase() +
                    pago.estado_pago.slice(1).toLowerCase()
                  : "Pendiente"}
              </span>
            </div>

            {/* Botón de registrar/editar pago*/}
            {cita.estado?.toLowerCase() === "realizada" ? (
              pago?.estado_pago === "pagado" || pago?.estado_pago === "reembolsado" ? (
                <div className="flex flex-col items-end gap-1">
                  {esAdministrador ? (
                    <Link
                      to={`/odontologo/pagos/${pago.id_pago_cita}/editar`}
                      state={{ from: "cita", citaId: cita.id_cita }}
                      className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-2 text-xs shadow hover:bg-black/80 transition"
                    >
                      <Pencil className="w-4 h-4" />
                      Editar pago
                    </Link>
                  ) : (
                    <>
                      <button
                        disabled
                        className="inline-flex items-center gap-2 rounded-lg bg-gray-200 text-gray-500 px-3 py-2 text-xs cursor-not-allowed"
                        title="Solo los administradores pueden editar el pago"
                      >
                        <Pencil className="w-4 h-4" />
                        Editar pago
                      </button>
                      <span className="text-xs text-amber-600">
                        Solo administradores pueden editar
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <Link
                  to={`/odontologo/citas/${cita.id_cita}/registrar-pago`}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs shadow hover:bg-emerald-700 transition"
                >
                  <DollarSign className="w-4 h-4" />
                  Registrar pago
                </Link>
              )
            ) : ["pendiente", "confirmada", "mantenimiento"].includes(
                cita.estado?.toLowerCase() ?? ""
              ) ? (
              <button
                disabled
                className="inline-flex items-center gap-2 rounded-lg bg-gray-200 text-gray-500 px-3 py-2 text-xs cursor-not-allowed"
              >
                <DollarSign className="w-4 h-4" />
                Registrar pago
              </button>
            ) : null}
          </div>

          {/* Contenido interno de la card */}
          {!pago || !pago.id_pago_cita ? (
            <div className="rounded-lg border bg-amber-50 text-amber-900 px-3 py-2 text-sm">
              Aún no se ha registrado el pago de esta cita.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Monto</div>
                <div className="font-medium">${pago.monto ?? "—"}</div>
              </div>

              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Método</div>
                <div className="font-medium capitalize">
                  {pago.metodo_pago ?? "—"}
                </div>
              </div>

              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Fecha de pago</div>
                <div className="font-medium">
                  {pago.fecha_pago
                    ? new Date(pago.fecha_pago).toLocaleString("es-EC")
                    : "—"}
                </div>
              </div>

              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">Observación</div>
                <div className="whitespace-pre-wrap">
                  {pago.observacion || "—"}
                </div>
              </div>

              {/* Motivo de reembolso - solo si está reembolsado */}
              {pago.estado_pago === "reembolsado" && (
                <>
                  {pago.motivo_reembolso && (
                    <div className="border rounded-lg p-3 md:col-span-2 bg-amber-50 border-amber-200">
                      <div className="text-xs text-amber-700 font-semibold flex items-center gap-1 mb-1">
                        <Info className="w-4 h-4" />
                        Motivo del Reembolso
                      </div>
                      <div className="text-sm text-amber-900 whitespace-pre-wrap">
                        {pago.motivo_reembolso}
                      </div>
                      {pago.reembolsado_en && (
                        <div className="text-xs text-amber-600 mt-2">
                          Reembolsado el: {new Date(pago.reembolsado_en).toLocaleString("es-EC", {
                            dateStyle: "medium",
                            timeStyle: "short"
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {pago.comprobante &&
                (() => {
                  const comprobanteURL = buildMediaURL(pago.comprobante);
                  if (!comprobanteURL) return null;
                  const downloadName = filenameFromUrl(comprobanteURL);

                  const handleDownload = async (e: React.MouseEvent) => {
                    e.preventDefault();
                    try {
                      const response = await fetch(comprobanteURL);
                      const blob = await response.blob();
                      const url = window.URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = downloadName;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      window.URL.revokeObjectURL(url);
                    } catch (error) {
                      console.error('Error al descargar:', error);
                      // Fallback: abrir en nueva pestaña
                      window.open(comprobanteURL, '_blank');
                    }
                  };

                  return (
                    <div className="border rounded-lg p-3 md:col-span-2">
                      {/* Título + botón negro a la derecha */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-gray-500">Comprobante</div>

                        <button
                          onClick={handleDownload}
                          className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-2 text-xs shadow hover:bg-black/80 transition"
                          title="Descargar comprobante"
                        >
                          <Download className="w-4 h-4" />
                          Descargar comprobante
                        </button>
                      </div>

                      {/* Vista previa: intentamos mostrar como imagen */}
                      <img
                        src={comprobanteURL}
                        alt="Comprobante"
                        className="max-h-64 w-full rounded-lg object-contain"
                        onError={(e) => {
                          // Si no es imagen (p.ej. PDF), ocultamos la vista previa
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    </div>
                  );
                })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
