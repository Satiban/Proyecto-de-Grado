import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { api } from "../../api/axios";
import {
  Banknote,
  Upload,
  FileText,
  User as UserIcon,
  CalendarDays,
  Clock,
  Stethoscope,
  Info,
  Building2,
} from "lucide-react";

type MetodoPago = "efectivo" | "transferencia";
type EstadoPago = "pendiente" | "pagado" | "reembolsado";

type Pago = {
  id_pago_cita: number;
  id_cita: number;
  monto: string;
  metodo_pago: MetodoPago;
  estado_pago: EstadoPago;
  comprobante?: string | null;
  observacion?: string | null;
  fecha_pago?: string | null;
  reembolsado_en?: string | null;
  motivo_reembolso?: string | null;
  cita_info?: {
    fecha?: string;
    hora?: string;
    estado_cita?: string;
    motivo?: string;
    paciente_nombre?: string;
    paciente_cedula?: string;
    odontologo_nombre?: string;
    odontologo_especialidades?: string[];
    consultorio_numero?: string;
  };
  paciente_nombre?: string;
  odontologo_nombre?: string;
};

/* ===== UI helpers ===== */
function hhmm(hora?: string | null) {
  if (!hora) return "—";
  const [h, m] = hora.split(":");
  return `${(h ?? "").padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
}

type EstadoCita =
  | "pendiente"
  | "confirmada"
  | "cancelada"
  | "realizada"
  | "mantenimiento";

function pillClasses(estado?: EstadoCita | null) {
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

function Pill({ estado }: { estado?: EstadoCita | null }) {
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

export default function EditarPago() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const idPago = Number(id);

  // Verificar si viene desde la vista de cita
  const from = (location.state as any)?.from;
  const citaId = (location.state as any)?.citaId;

  const [pago, setPago] = useState<Pago | null>(null);
  const [monto, setMonto] = useState("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("efectivo");
  const [estadoPago, setEstadoPago] = useState<EstadoPago>("pendiente");
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [comprobanteOriginal, setComprobanteOriginal] = useState<string | null>(null);
  const [comprobantePreview, setComprobantePreview] = useState<string | null>(
    null
  );
  const [observacion, setObservacion] = useState("");
  const [motivoReembolso, setMotivoReembolso] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [montoLimitWarning, setMontoLimitWarning] = useState(false);

  // Estado para errores de validación
  type Errors = Partial<
    Record<
      "monto" | "metodo_pago" | "comprobante" | "motivo_reembolso",
      string
    >
  >;
  const [errors, setErrors] = useState<Errors>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* ===== Cargar datos ===== */
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/pagos/${idPago}/`);
        const data = res.data;
        setPago(data);
        setMonto(data.monto);
        setMetodoPago(data.metodo_pago);
        setEstadoPago(data.estado_pago);
        setObservacion(data.observacion || "");
        setMotivoReembolso(data.motivo_reembolso || "");
        if (data.comprobante) {
          setComprobanteOriginal(data.comprobante);
          setComprobantePreview(data.comprobante);
        }
      } catch {
        setError("No se pudo cargar la información del pago");
      }
    })();
  }, [idPago]);

  /* ===== Handlers ===== */
  const handleMontoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    
    // Reemplazar coma por punto para normalizar
    value = value.replace(',', '.');
    
    // Permitir solo números y un punto decimal
    if (!/^\d*\.?\d*$/.test(value)) {
      return; // No actualizar si tiene caracteres inválidos
    }
    
    // Validar formato: máximo 8 dígitos enteros y 2 decimales
    const parts = value.split('.');
    
    // Si hay más de un punto, no permitir
    if (parts.length > 2) {
      return;
    }
    
    // Limitar parte entera a 8 dígitos
    if (parts[0] && parts[0].length > 8) {
      // Mostrar advertencia temporal
      setMontoLimitWarning(true);
      setTimeout(() => setMontoLimitWarning(false), 2000);
      return;
    }
    
    // Limitar decimales a 2 dígitos
    if (parts[1] && parts[1].length > 2) {
      // Mostrar advertencia temporal
      setMontoLimitWarning(true);
      setTimeout(() => setMontoLimitWarning(false), 2000);
      return;
    }
    
    // Actualizar el valor
    setMonto(value);
    setErrors((prev) => ({ ...prev, monto: "" }));
  };

  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setComprobante(file);
      setComprobantePreview(URL.createObjectURL(file));
      setErrors((prev) => ({ ...prev, comprobante: "" }));
    }
  };

  const handleClearPhoto = () => {
    setComprobante(null);
    setComprobantePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleMetodoPagoChange = (nuevoMetodo: MetodoPago) => {
    setMetodoPago(nuevoMetodo);
    setErrors((prev) => ({ ...prev, comprobante: "" }));
    
    // Si cambia a efectivo, limpiar comprobante temporal pero mantener el original si existe
    if (nuevoMetodo === "efectivo") {
      setComprobante(null);
      setComprobantePreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } else if (nuevoMetodo === "transferencia") {
      // Si vuelve a transferencia, restaurar el comprobante original si existe
      if (comprobanteOriginal && !comprobante) {
        setComprobantePreview(comprobanteOriginal);
      }
    }
  };

  const handleEstadoPagoChange = (nuevoEstado: EstadoPago) => {
    setEstadoPago(nuevoEstado);
    
    // Si cambia de "reembolsado" a otro estado, limpiar campos de reembolso
    if (estadoPago === "reembolsado" && nuevoEstado !== "reembolsado") {
      setMotivoReembolso("");
      setErrors((prev) => ({ ...prev, motivo_reembolso: "" }));
    }
  };

  /* ===== Validación antes de guardar ===== */
  const validateBeforeSave = (): boolean => {
    const newErrors: Errors = {};

    // Validar monto
    if (!monto || monto.trim() === "") {
      newErrors.monto = "El monto es obligatorio.";
    } else if (Number(monto) <= 0) {
      newErrors.monto = "El monto debe ser mayor a 0.";
    } else if (Number(monto) > 99999999.99) {
      newErrors.monto = "El monto no puede superar 99,999,999.99";
    } else if (isNaN(Number(monto))) {
      newErrors.monto = "El monto debe ser un número válido.";
    }

    // Validar comprobante si el método es transferencia
    if (metodoPago === "transferencia") {
      // Si no hay archivo nuevo ni archivo original, es obligatorio
      if (!comprobante && !comprobanteOriginal) {
        newErrors.comprobante = "El comprobante es obligatorio para transferencias.";
      }
    }

    // Validar motivo de reembolso si el estado es reembolsado
    if (estadoPago === "reembolsado") {
      if (!motivoReembolso || motivoReembolso.trim() === "") {
        newErrors.motivo_reembolso = "El motivo del reembolso es obligatorio.";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validar antes de enviar
    if (!validateBeforeSave()) {
      return;
    }

    setLoading(true);
    try {
      // Caso especial: si el estado cambió a "reembolsado"
      if (estadoPago === "reembolsado") {
        await api.patch(`/pagos/${idPago}/reembolsar/`, {
          motivo_reembolso:
            motivoReembolso || "Reembolso autorizado por administración",
        });
      } else {
        // Verificar si necesitamos limpiar campos de reembolso
        const necesitaLimpiarReembolso = pago && (pago.estado_pago as string) === "reembolsado";
        
        // Si necesitamos limpiar campos de reembolso, usar JSON en lugar de FormData
        if (necesitaLimpiarReembolso) {
          const payload: any = {
            monto: monto,
            metodo_pago: metodoPago,
            estado_pago: estadoPago,
            motivo_reembolso: null,
            reembolsado_en: null,
          };
          
          if (observacion) {
            payload.observacion = observacion;
          }
          
          // Para comprobante, si hay uno nuevo, necesitamos usar FormData
          if (comprobante) {
            const formData = new FormData();
            formData.append("monto", monto);
            formData.append("metodo_pago", metodoPago);
            formData.append("estado_pago", estadoPago);
            formData.append("motivo_reembolso", "");
            formData.append("reembolsado_en", "");
            if (observacion) formData.append("observacion", observacion);
            formData.append("comprobante", comprobante);
            
            await api.patch(`/pagos/${idPago}/`, formData, {
              headers: { "Content-Type": "multipart/form-data" },
            });
          } else {
            // Sin archivo nuevo, enviar JSON
            await api.patch(`/pagos/${idPago}/`, payload);
          }
        } else {
          // Comportamiento normal (sin limpiar campos de reembolso)
          const formData = new FormData();
          formData.append("monto", monto);
          formData.append("metodo_pago", metodoPago);
          formData.append("estado_pago", estadoPago);
          if (observacion) formData.append("observacion", observacion);
          
          // Manejo del comprobante según el método de pago
          if (metodoPago === "transferencia") {
            // Si hay un nuevo archivo seleccionado, enviarlo
            if (comprobante) {
              formData.append("comprobante", comprobante);
            }
            // Si no hay archivo nuevo pero sí había uno original, no hacer nada (mantener el original)
            // El backend mantendrá el archivo existente
          } else if (metodoPago === "efectivo") {
            // Si cambió a efectivo, el backend automáticamente eliminará el comprobante
            // No necesitamos enviar nada especial
          }
          
          await api.patch(`/pagos/${idPago}/`, formData, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        }
      }

      setShowSuccess(true);
      setTimeout(() => {
        // Si viene desde la vista de cita, regresar a ella
        if (from === "cita" && citaId) {
          navigate(`/odontologo/citas/${citaId}/ver`);
        } else {
          // Regresar a la vista de cita del pago
          navigate(`/odontologo/citas/${pago?.id_cita}/ver`);
        }
      }, 1000);
    } catch (err: any) {
      console.error("Error al actualizar pago:", err?.response?.data);
      setError(
        err?.response?.data?.detail ||
          "Error al actualizar el pago. Por favor, intenta nuevamente."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    // Si viene desde la vista de cita, regresar a ella
    if (from === "cita" && citaId) {
      navigate(`/odontologo/citas/${citaId}/ver`);
    } else {
      // Regresar a la vista de cita del pago
      navigate(`/odontologo/citas/${pago?.id_cita}/ver`);
    }
  };

  /* ===== Helper para clases CSS de inputs ===== */
  const inputClass = (field?: keyof Errors) =>
    `mt-1 w-full border rounded-lg px-3 py-2 focus:ring ${
      field && errors[field]
        ? "border-red-500 focus:ring-red-500"
        : "border-gray-300 focus:ring-blue-200"
    }`;

  return (
    <div className="space-y-6">
      {/* Toast éxito */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
            <div className="font-semibold">¡Pago actualizado correctamente!</div>
            <div className="text-sm text-white/90">Redirigiendo…</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Banknote className="w-6 h-6" />
          Editar Pago
        </h1>
        
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border bg-white px-4 py-2 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:bg-black/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>

      {/* ===== Card: Datos de la Cita ===== */}
      {pago && (
        <div className="rounded-xl bg-white shadow-md p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            {/* Título con ícono */}
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-gray-700" />
              <h2 className="font-semibold text-gray-800">Datos de la cita</h2>
              <Pill estado={(pago.cita_info?.estado_cita?.toLowerCase() ?? "pendiente") as EstadoCita} />
            </div>
          </div>

          {/* (Fecha | Hora), (Paciente | Odontólogo), (Consultorio | Motivo) */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Fecha */}
            <div className="border rounded-lg p-3">
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <CalendarDays className="w-4 h-4" />
                Fecha
              </div>
              <div className="font-medium">{pago.cita_info?.fecha ?? "—"}</div>
            </div>

            {/* Hora */}
            <div className="border rounded-lg p-3">
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <Clock className="w-4 h-4" />
                Hora
              </div>
              <div className="font-medium">
                {hhmm(pago.cita_info?.hora)}
              </div>
            </div>

            {/* Paciente */}
            <div className="border rounded-lg p-3">
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <UserIcon className="w-4 h-4" />
                Paciente
              </div>
              <div className="font-medium">
                {pago.cita_info?.paciente_nombre ?? pago.paciente_nombre ?? "—"}
              </div>
              {pago.cita_info?.paciente_cedula && (
                <div className="text-xs text-gray-500">
                  {pago.cita_info.paciente_cedula}
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
                {pago.cita_info?.odontologo_nombre ?? pago.odontologo_nombre ?? "—"}
              </div>

              {/* Especialidades del odontólogo */}
              {Array.isArray(pago.cita_info?.odontologo_especialidades) &&
                pago.cita_info.odontologo_especialidades.length > 0 && (
                  <div className="text-xs text-gray-500">
                    {pago.cita_info.odontologo_especialidades.join(", ")}
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
                {pago.cita_info?.consultorio_numero
                  ? `Consultorio ${pago.cita_info.consultorio_numero}`
                  : "—"}
              </div>
            </div>

            {/* Motivo */}
            <div className="border rounded-lg p-3">
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <FileText className="w-4 h-4" />
                Motivo
              </div>
              <div className="font-medium">{pago.cita_info?.motivo ?? "—"}</div>
            </div>
          </div>

          {/* Mostrar motivo de reembolso si el pago está reembolsado */}
          {pago.estado_pago === "reembolsado" && (
            <div className="border-t pt-3">
              <div className="border rounded-lg p-3 bg-amber-50 border-amber-200">
                <div className="text-xs text-amber-700 font-semibold flex items-center gap-1 mb-1">
                  <Info className="w-4 h-4" />
                  Motivo del Reembolso
                </div>
                <div className="text-sm text-amber-900">
                  {pago.motivo_reembolso || "No se registró un motivo"}
                </div>
                {pago.reembolsado_en && (
                  <div className="text-xs text-amber-600 mt-1">
                    Reembolsado el: {new Date(pago.reembolsado_en).toLocaleString("es-EC", {
                      dateStyle: "medium",
                      timeStyle: "short"
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Form */}
      <div className="bg-white shadow-md rounded-xl p-4 space-y-4">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-gray-700" /> Editar información
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Monto */}
            <div>
              <label className="text-sm font-medium text-gray-700">
                Monto (USD) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={monto}
                onChange={handleMontoChange}
                className={inputClass("monto")}
                placeholder="Ej. 50.00"
              />
              {montoLimitWarning ? (
                <p className="mt-1 text-xs text-orange-600 font-medium">
                  ⚠️ Límite alcanzado: máximo 8 enteros y 2 decimales
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">
                  Máximo: 99,999,999.99 (8 enteros, 2 decimales)
                </p>
              )}
              {errors.monto && (
                <p className="mt-1 text-xs text-red-600">{errors.monto}</p>
              )}
            </div>

            {/* Método */}
            <div>
              <label className="text-sm font-medium text-gray-700">
                Método de pago <span className="text-red-500">*</span>
              </label>
              <select
                value={metodoPago}
                onChange={(e) => handleMetodoPagoChange(e.target.value as MetodoPago)}
                className={inputClass("metodo_pago")}
              >
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
              </select>
              {errors.metodo_pago && (
                <p className="mt-1 text-xs text-red-600">{errors.metodo_pago}</p>
              )}
            </div>

            {/* Estado */}
            <div>
              <label className="text-sm font-medium text-gray-700">
                Estado del pago <span className="text-red-500">*</span>
              </label>
              <select
                value={estadoPago}
                onChange={(e) => handleEstadoPagoChange(e.target.value as EstadoPago)}
                className={inputClass()}
              >
                <option value="pagado">Pagado</option>
                <option value="reembolsado">Reembolsado</option>
              </select>
            </div>
          </div>

          {/* Motivo de reembolso */}
          {estadoPago === "reembolsado" && (
            <div>
              <label className="text-sm font-medium text-gray-700">
                Motivo del reembolso <span className="text-red-500">*</span>
              </label>
              <textarea
                value={motivoReembolso}
                onChange={(e) => {
                  setMotivoReembolso(e.target.value);
                  setErrors((prev) => ({ ...prev, motivo_reembolso: "" }));
                }}
                className={`mt-1 w-full border rounded-lg px-3 py-2 h-20 focus:ring ${
                  errors.motivo_reembolso
                    ? "border-red-500 focus:ring-red-500"
                    : "border-gray-300 focus:ring-blue-200"
                }`}
                placeholder="Ej. Devolución por cancelación o error de cobro"
              />
              {errors.motivo_reembolso && (
                <p className="mt-1 text-xs text-red-600">{errors.motivo_reembolso}</p>
              )}
            </div>
          )}

          {/* Comprobante */}
          {metodoPago === "transferencia" && (
            <div className={`rounded-lg border p-4 ${
              errors.comprobante 
                ? "bg-red-50 border-red-300" 
                : "bg-gray-50 border-gray-200"
            }`}>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Comprobante de transferencia <span className="text-red-500">*</span>
              </label>

              <div className="flex items-center gap-4 flex-wrap">
                <div className={`w-32 h-32 rounded-lg overflow-hidden border grid place-items-center ${
                  errors.comprobante 
                    ? "border-red-500 bg-red-50" 
                    : "border-gray-300 bg-white"
                }`}>
                  {comprobantePreview ? (
                    <img
                      src={comprobantePreview}
                      alt="Vista previa"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Upload className={`w-10 h-10 ${
                      errors.comprobante ? "text-red-400" : "text-gray-400"
                    }`} />
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      id="fileInput"
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleSelectFile}
                    />
                    <label
                      htmlFor="fileInput"
                      className="cursor-pointer rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
                    >
                      Seleccionar archivo
                    </label>
                    {(comprobante || comprobantePreview) && (
                      <button
                        type="button"
                        onClick={handleClearPhoto}
                        className="rounded-lg border bg-white px-4 py-2 hover:bg-gray-50"
                      >
                        Quitar selección
                      </button>
                    )}
                  </div>
                  {errors.comprobante && (
                    <p className="text-xs text-red-600 font-medium">{errors.comprobante}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Observación */}
          <div>
            <label className="text-sm font-medium text-gray-700">
              Observación (opcional)
            </label>
            <textarea
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 h-24 focus:ring focus:ring-blue-200"
              placeholder="Notas adicionales sobre el pago"
            />
          </div>
        </form>
      </div>

      {error && (
        <div className="rounded-lg border bg-red-50 text-red-900 px-3 py-2 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
