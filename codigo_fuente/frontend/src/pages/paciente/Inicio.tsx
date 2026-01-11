// src/pages/paciente/Inicio.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/axios";
import {
  CalendarDays,
  Clock,
  Building2,
  CheckCircle2,
  RotateCcw,
  XCircle,
  Loader2,
  Info,
  Stethoscope,
  MessageSquareText,
  Phone,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useConfig } from "../../hooks/useConfig";
import { e164ToLocal } from "../../utils/phoneFormat";

/* ===================== Tipos ===================== */
type ProximaCita = {
  id_cita: number;
  fecha: string; // "YYYY-MM-DD"
  hora_inicio: string; // "HH:MM"
  estado:
    | "pendiente"
    | "confirmada"
    | "cancelada"
    | "realizada"
    | "reprogramacion";
  motivo?: string | null;
  odontologo?: { id_odontologo: number; nombre: string } | null;
  consultorio?: {
    id_consultorio: number;
    nombre?: string;
    numero?: string;
  } | null;

  reprogramaciones?: number | null;
  ya_reprogramada?: boolean | null;

  reprogramada_veces?: number | null;
  reprogramada?: boolean | null;
};

type ResumenHistorial = {
  citas_completadas: number;
  ultima_visita?: string | null; // "YYYY-MM-DD"
  ultima_observacion?: string | null;
};

/* ===================== Config/Utils ===================== */
const BRAND = "#0070B7";

const capitalizeFirst = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

function fmtFechaLarga(iso: string) {
  try {
    const d = new Date(iso + "T00:00:00");
    const raw = d.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return capitalizeFirst(raw);
  } catch {
    return iso;
  }
}

function consultorioLabel(c?: ProximaCita["consultorio"]) {
  if (!c) return "Consultorio";
  const num = c?.numero ? `#${c.numero}` : "";
  const desc = c?.nombre ?? "";
  if (num && desc) return `Consultorio ${num}: ${desc}`;
  if (num) return `Consultorio ${num}`;
  if (desc) return `Consultorio: ${desc}`;
  return "Consultorio";
}

function parseDateTimeLocal(ymd: string, hhmm: string) {
  const [H, M] = (hhmm || "00:00").split(":").map((x) => parseInt(x, 10));
  const [Y, m, D] = ymd.split("-").map((x) => parseInt(x, 10));
  return new Date(Y, (m || 1) - 1, D, H || 0, M || 0, 0, 0);
}

function hoursUntil(d: Date) {
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  return ms / (1000 * 60 * 60);
}

/* ===================== Subcomponentes ===================== */
function EstadoBadge({ estado }: { estado: ProximaCita["estado"] }) {
  const styles =
    estado === "confirmada"
      ? "bg-green-100 text-green-800 border-green-200"
      : estado === "cancelada"
      ? "bg-red-100 text-red-800 border-red-200"
      : estado === "realizada"
      ? "bg-slate-100 text-slate-800 border-slate-200"
      : estado === "reprogramacion" // 👈 nuevo case
      ? "bg-purple-100 text-purple-800 border-purple-200"
      : "bg-amber-100 text-amber-800 border-amber-200"; // pendiente por defecto

  // 👇 si es reprogramacion, mostramos texto con tilde
  const label =
    estado === "reprogramacion"
      ? "Reprogramación"
      : estado.charAt(0).toUpperCase() + estado.slice(1);

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${styles}`}
    >
      {label}
    </span>
  );
}

/* Modal simple */
type ModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmText?: string;
  confirmKind?: "primary" | "danger";
  cancelText?: string;
  onConfirm: () => void;
  onClose: () => void;
  confirming?: boolean;
};

function Modal({
  open,
  title,
  children,
  confirmText = "Confirmar",
  confirmKind = "primary",
  cancelText = "Cerrar",
  onConfirm,
  onClose,
  confirming,
}: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-[61] w-[92%] max-w-lg rounded-xl bg-white shadow-xl">
        <div className="px-5 pt-4 pb-3 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
        <div className="px-5 py-4 text-sm text-gray-700">{children}</div>
        <div className="px-5 pb-4 pt-2 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
            disabled={!!confirming}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={!!confirming}
            className={`rounded-md px-3 py-2 text-sm font-medium text-white ${
              confirmKind === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[color:var(--brand)] hover:brightness-95"
            }`}
            style={{ ["--brand" as any]: BRAND }}
          >
            {confirming ? "Procesando…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Botones */
const ACTION_BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium text-white h-10 w-full sm:w-40";
const BTN_CONFIRM = "bg-green-600 hover:bg-green-700 disabled:opacity-70";
const BTN_REPROG =
  "bg-[color:var(--brand)] hover:brightness-90 disabled:opacity-70";
const BTN_CANCEL = "bg-red-600 hover:bg-red-700 disabled:opacity-70";

/* ===================== Componente ===================== */
const Inicio: React.FC = () => {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const { config } = useConfig();
  const celularLocal = e164ToLocal(config?.celular_contacto);

  const nombrePaciente = useMemo(() => {
    const n1 = usuario?.primer_nombre?.trim() ?? "";
    const a1 = usuario?.primer_apellido?.trim() ?? "";
    if (n1 || a1) return `${n1} ${a1}`.trim();
    return usuario?.email ?? "Paciente";
  }, [usuario]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<null | "confirmar" | "cancelar">(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const [proxima, setProxima] = useState<ProximaCita | null>(null);
  const [resumen, setResumen] = useState<ResumenHistorial | null>(null);

  // Modales
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [r1, r2] = await Promise.all([
          api.get("/citas/paciente/mis-citas/proxima/"),
          api.get("/citas/paciente/mis-citas/resumen/"),
        ]);
        if (!isMounted) return;
        setProxima(r1.data ?? null);
        setResumen(r2.data ?? null);
      } catch (e: any) {
        if (!isMounted) return;
        const msg =
          e?.response?.data?.detail ||
          "No se pudo cargar la información del inicio.";
        setError(msg);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Reglas de habilitación
  const hoursToAppt = useMemo(() => {
    if (!proxima?.fecha || !proxima?.hora_inicio) return null;
    return hoursUntil(parseDateTimeLocal(proxima.fecha, proxima.hora_inicio));
  }, [proxima?.fecha, proxima?.hora_inicio]);

  const confirmFrom = config?.horas_confirmar_desde ?? 24;
  const confirmUntil = config?.horas_confirmar_hasta ?? 12;

  // Confirmación dentro de ventana dinámica
  const isWithinConfirmWindow =
    proxima &&
    proxima.estado === "pendiente" &&
    hoursToAppt !== null &&
    hoursToAppt <= confirmFrom &&
    hoursToAppt >= confirmUntil;

  // Cancelar / Reprogramar solo hasta las horas configuradas
  const canManageBeforeLimit =
    hoursToAppt !== null && hoursToAppt >= confirmUntil;

  // Detectar si ya fue reprogramada al menos una vez (soporta campos nuevos y legacy)
  const alreadyRescheduled = useMemo(() => {
    if (!proxima) return false;

    // Preferir campos nuevos de la API
    if (proxima.ya_reprogramada === true) return true;
    const vecesAPI = proxima.reprogramaciones ?? 0;
    if (typeof vecesAPI === "number" && vecesAPI >= 1) return true;

    // Compatibilidad con nombres antiguos
    const legacyTimes = proxima.reprogramada_veces ?? 0;
    const legacyFlagA = proxima.reprogramada === true;
    return legacyFlagA || (typeof legacyTimes === "number" && legacyTimes > 0);
  }, [proxima]);

  const confirmDisabled =
    !proxima ||
    submitting !== null ||
    proxima.estado !== "pendiente" ||
    !isWithinConfirmWindow;

  const reprogramDisabled =
    !proxima ||
    submitting !== null ||
    proxima.estado === "confirmada" ||
    proxima.estado === "cancelada" ||
    proxima.estado === "realizada" ||
    !canManageBeforeLimit ||
    alreadyRescheduled;

  const cancelDisabled =
    !proxima ||
    submitting !== null ||
    proxima.estado === "confirmada" ||
    proxima.estado === "cancelada" ||
    proxima.estado === "realizada" ||
    !canManageBeforeLimit;

  // Acciones
  async function doConfirm() {
    if (!proxima) return;
    setSubmitting("confirmar");
    setError(null);
    try {
      await api.patch(`/citas/${proxima.id_cita}/confirmar/`);
      setProxima({ ...proxima, estado: "confirmada" });
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "No se pudo confirmar la cita.";
      setError(msg);
    } finally {
      setSubmitting(null);
      setConfirmModalOpen(false);
    }
  }

  function onConfirmar() {
    setConfirmModalOpen(true);
  }

  function onReprogramar() {
    if (!proxima || reprogramDisabled) return;
    navigate(`/paciente/mis-citas/reprogramar/${proxima.id_cita}`, {
      state: { from: "/paciente/inicio" },
    });
  }

  async function doCancel() {
    if (!proxima) return;
    setSubmitting("cancelar");
    setError(null);
    try {
      await api.patch(`/citas/${proxima.id_cita}/cancelar/`);
      setProxima({ ...proxima, estado: "cancelada" });
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "No se pudo cancelar la cita.";
      setError(msg);
    } finally {
      setSubmitting(null);
      setCancelModalOpen(false);
    }
  }

  function onCancelar() {
    setCancelModalOpen(true);
  }

  return (
    <div className="space-y-4" style={{ ["--brand" as any]: BRAND }}>
      {/* Saludo */}
      <div className="bg-white rounded-xl shadow-sm px-5 py-4 flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold">
          ¡
          {usuario?.sexo?.toLowerCase() === "m"
            ? "Bienvenido"
            : usuario?.sexo?.toLowerCase() === "f"
            ? "Bienvenida"
            : "Bienvenid@"}
          , <span style={{ color: BRAND }}>{nombrePaciente}</span>!{" "}
          <span className="ml-1">👋</span>
        </h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 flex items-start gap-2">
          <Info className="mt-0.5" size={18} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {loading ? (
        <div
          className="bg-white rounded-xl shadow-sm px-5 py-6 text-gray-600"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-40 bg-gray-200 rounded" />
            <div className="h-3 w-72 bg-gray-200 rounded" />
            <div className="h-3 w-64 bg-gray-200 rounded" />
          </div>
        </div>
      ) : (
        <>
          {/* 2 columnas: izquierda Próxima cita, derecha KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Próxima cita */}
            <section className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 pt-4 pb-3 flex items-start justify-between">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <span role="img" aria-label="diente">
                    🦷
                  </span>
                  Próxima cita
                </h2>
                {proxima && <EstadoBadge estado={proxima.estado} />}
              </div>

              {proxima ? (
                <div className="px-5 pb-5">
                  {/* Datos y botones */}
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="space-y-3 text-[15px] mt-1">
                      <div className="flex items-start gap-2">
                        <Building2 className="mt-0.5 text-gray-500" size={18} />
                        <div className="font-medium">
                          {consultorioLabel(proxima.consultorio)}
                        </div>
                      </div>

                      <div className="flex items-start gap-2 text-gray-700">
                        <Stethoscope
                          className="mt-0.5 text-gray-500"
                          size={18}
                        />
                        <span>
                          Odontólogo:{" "}
                          <span className="font-medium">
                            {proxima.odontologo?.nombre ?? "—"}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <CalendarDays className="text-gray-500" size={18} />
                        <span>Fecha: {fmtFechaLarga(proxima.fecha)}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Clock className="text-gray-500" size={18} />
                        <span>Hora: {proxima.hora_inicio}</span>
                      </div>

                      {proxima.motivo && (
                        <div className="flex items-start gap-2 text-gray-700">
                          <MessageSquareText
                            className="mt-0.5 text-gray-500"
                            size={18}
                          />
                          <span>
                            Motivo:{" "}
                            <span className="italic">{proxima.motivo}</span>
                          </span>
                        </div>
                      )}

                      {/* dinámico: ventana de confirmación */}
                      {proxima.estado === "pendiente" && (
                        <div className="text-xs text-gray-600">
                          {isWithinConfirmWindow ? (
                            <>
                              Puedes confirmar tu asistencia ahora. La
                              confirmación está disponible desde{" "}
                              <b>{confirmFrom} h</b> hasta{" "}
                              <b>{confirmUntil} h</b> antes de la cita.
                            </>
                          ) : hoursToAppt !== null &&
                            hoursToAppt > confirmFrom ? (
                            <>
                              La confirmación se habilitará{" "}
                              <b>{confirmFrom} h</b> antes de la cita.
                            </>
                          ) : hoursToAppt !== null &&
                            hoursToAppt < confirmUntil ? (
                            <>
                              La ventana de confirmación ha concluido. Para
                              gestionar la cita, comunícate con el consultorio
                              al <b>{celularLocal || "09XXXXXXX"}</b>.
                            </>
                          ) : null}
                        </div>
                      )}

                      {/* Nota tras confirmar */}
                      {proxima.estado === "confirmada" && (
                        <div className="flex items-start gap-2 text-xs text-green-800 bg-green-50 border border-green-200 rounded p-2">
                          <Phone size={20} className="mt-0.5 text-green-700" />
                          <span>
                            Esta cita está <b>confirmada</b>. Desde la
                            aplicación no puedes <b>reprogramar</b> ni{" "}
                            <b>cancelar</b>. Si surge una <b>emergencia</b> y
                            necesitas gestionar la cita, por favor{" "}
                            <b>
                              llama al consultorio al{" "}
                              {celularLocal || "09XXXXXXX"}
                            </b>
                            .
                          </span>
                        </div>
                      )}

                      {/* Nota cuando está en reprogramación */}
                      {proxima.estado === "reprogramacion" && (
                        <div className="flex items-start gap-2 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded p-2">
                          <Info size={14} className="mt-0.5" />
                          <span>
                            Esta cita se encuentra actualmente en{" "}
                            <b>reprogramación</b> por parte del consultorio.
                            Este estado es <b>temporal</b> mientras se ajusta la
                            agenda. Para más información, por favor{" "}
                            <b>
                              comunícate con el consultorio al{" "}
                              {celularLocal || "09XXXXXXX"}
                            </b>
                            .
                          </span>
                        </div>
                      )}

                      {/* Si ya no se puede reprogramar/cancelar por tiempo */}
                      {proxima.estado === "pendiente" &&
                        !canManageBeforeLimit && (
                          <div className="text-xs text-gray-600">
                            Reprogramar y cancelar están disponibles solo hasta{" "}
                            <b>{confirmUntil} h</b> antes de la cita.
                          </div>
                        )}

                      {/* Mensaje si ya fue reprogramada */}
                      {alreadyRescheduled && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                          Esta cita ya fue <b>reprogramada una vez</b>. Si
                          deseas reprogramarla nuevamente, por favor comunícate
                          al <b>{celularLocal || "09XXXXXXX"}</b>.
                        </div>
                      )}
                    </div>

                    {/* Botones */}
                    <div className="flex flex-col gap-2 lg:self-start">
                      <button
                        onClick={onConfirmar}
                        disabled={confirmDisabled}
                        className={`${ACTION_BTN_BASE} ${BTN_CONFIRM}`}
                        title="Confirmar asistencia"
                      >
                        {submitting === "confirmar" ? (
                          <>
                            <Loader2 className="animate-spin" size={16} />{" "}
                            Confirmando…
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={16} /> Confirmar
                          </>
                        )}
                      </button>

                      <button
                        onClick={onReprogramar}
                        disabled={reprogramDisabled}
                        className={`${ACTION_BTN_BASE} ${BTN_REPROG}`}
                        title={
                          alreadyRescheduled
                            ? "Ya no puedes reprogramar nuevamente"
                            : "Reprogramar cita"
                        }
                        style={{ ["--brand" as any]: BRAND }}
                      >
                        <RotateCcw size={16} /> Reprogramar
                      </button>

                      <button
                        onClick={onCancelar}
                        disabled={cancelDisabled}
                        className={`${ACTION_BTN_BASE} ${BTN_CANCEL}`}
                        title="Cancelar cita"
                      >
                        {submitting === "cancelar" ? (
                          <>
                            <Loader2 className="animate-spin" size={16} />{" "}
                            Cancelando…
                          </>
                        ) : (
                          <>
                            <XCircle size={16} /> Cancelar
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="px-5 pb-5 text-gray-600">
                  No tienes una próxima cita programada.{" "}
                  <button
                    onClick={() => navigate("/paciente/mis-citas")}
                    className="underline"
                    style={{ color: BRAND }}
                  >
                    Ver mis opciones
                  </button>
                  .
                </div>
              )}
            </section>

            {/* Resumen del historial */}
            <section className="bg-white rounded-xl shadow-sm flex flex-col">
              <div className="px-5 pt-4 pb-3 flex items-center gap-2">
                <span role="img" aria-label="portapapeles">
                  📋
                </span>
                <h2 className="text-lg font-bold">Resumen del historial</h2>
              </div>

              <div className="px-5 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                <div className="rounded-lg border bg-gray-50 px-4 py-3">
                  <div className="text-sm text-gray-600">Citas completadas</div>
                  <div className="text-2xl font-bold">
                    {resumen?.citas_completadas ?? 0}
                  </div>
                </div>

                <div className="rounded-lg border bg-gray-50 px-4 py-3">
                  <div className="text-sm text-gray-600">Última visita</div>
                  <div className="text-base font-medium">
                    {resumen?.ultima_visita
                      ? fmtFechaLarga(resumen.ultima_visita)
                      : "—"}
                  </div>
                </div>

                <div className="sm:col-span-2 rounded-lg border bg-gray-50 px-4 py-3">
                  <div className="text-sm text-gray-600">
                    Observación reciente
                  </div>
                  <div className="text-sm italic text-gray-800">
                    {resumen?.ultima_observacion
                      ? `“${resumen.ultima_observacion}”`
                      : "—"}
                  </div>
                </div>
              </div>

              <div className="px-5 pb-5 pt-0 mt-auto">
                <button
                  onClick={() => navigate("/paciente/mis-citas/historial")}
                  className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  Ver historial completo
                </button>
              </div>
            </section>
          </div>
        </>
      )}

      {/* Modal confirmar */}
      <Modal
        open={confirmModalOpen}
        title="Confirmar asistencia a la cita"
        confirmText="Sí, confirmar"
        onConfirm={doConfirm}
        onClose={() => setConfirmModalOpen(false)}
        confirming={submitting === "confirmar"}
      >
        <div className="space-y-2">
          <p>
            ¿Estás segura/o de <b>confirmar tu asistencia</b>? Esta acción{" "}
            <b>no se puede deshacer</b> desde la aplicación.
          </p>
          <p className="text-sm text-gray-700">
            Tras confirmar, <b>no podrás reprogramar ni cancelar</b> desde la
            app. Si confirmas y no asistes, tu cuenta podría ser{" "}
            <b>temporalmente bloqueada</b>.
          </p>
          <p className="text-sm text-gray-700">
            En caso de una emergencia, por favor <b>llama al consultorio</b>{" "}
            para notificar y solicitar cancelación o reprogramación.
          </p>
        </div>
      </Modal>

      {/* Modal cancelar */}
      <Modal
        open={cancelModalOpen}
        title="Cancelar cita"
        confirmText="Sí, cancelar"
        confirmKind="danger"
        onConfirm={doCancel}
        onClose={() => setCancelModalOpen(false)}
        confirming={submitting === "cancelar"}
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            ¿Estás seguro de que deseas <b>cancelar esta cita</b>?
          </p>

          <ul className="list-disc pl-5 space-y-1">
            <li>
              Te recomendamos <b>reprogramar</b> en lugar de cancelar. El
              sistema permite reprogramar hasta{" "}
              <b>{config?.max_reprogramaciones ?? 1} vez(es)</b>.
            </li>

            <li>
              Si cancelas, se aplicará una <b>penalización automática</b> y no
              podrás agendar nuevamente con este odontólogo durante{" "}
              <b>{config?.cooldown_dias ?? 7} día(s)</b>. Esta restricción{" "}
              <b>solo aplica con este odontólogo</b>; podrás agendar normalmente
              con otros especialistas.
            </li>

            <li>
              La penalización se levanta automáticamente después del periodo
              indicado.
            </li>

            <li>
              Si necesitas una <b>cita urgente</b> o gestión especial, llama al
              consultorio: <b>{celularLocal || "09XXXXXXX"}</b>.
            </li>
          </ul>

          <p className="text-xs text-gray-500">
            Esta acción no se puede deshacer desde la aplicación.
          </p>
        </div>
      </Modal>
    </div>
  );
};

export default Inicio;
