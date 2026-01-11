import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/axios";
import {
  Banknote,
  Upload,
  BanknoteArrowUpIcon,
  Info,
  CalendarDays,
  Clock,
  User as UserIcon,
  Stethoscope,
  Building2,
  FileText,
} from "lucide-react";

/* ===== Tipos ===== */
type MetodoPago = "efectivo" | "transferencia";
type Estado =
  | "pendiente"
  | "confirmada"
  | "cancelada"
  | "realizada"
  | "mantenimiento";

type PagoInfo = {
  id_pago_cita: number;
  monto: string;
  metodo_pago: string;
  estado_pago: "pendiente" | "pagado" | "reembolsado";
  comprobante?: string | null;
  observacion?: string | null;
  fecha_pago?: string | null;
};

type CitaResumen = {
  id_cita: number;
  fecha: string;
  hora?: string | null;
  hora_inicio?: string | null;
  motivo?: string | null;
  estado: Estado;
  id_paciente: number;
  paciente_nombre?: string;
  paciente_cedula?: string;
  id_odontologo: number;
  odontologo_nombre?: string;
  odontologo_especialidades?: string[];
  consultorio?: { id_consultorio: number; numero: string } | null;
  pago?: PagoInfo | null;
};

/* ===== Helpers ===== */
function hhmm(hora?: string | null) {
  if (!hora) return "—";
  const [h, m] = hora.split(":");
  return `${(h ?? "").padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
}
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
export default function RegistroPago() {
  const { id } = useParams();
  const navigate = useNavigate();
  const idCita = Number(id);

  const [cita, setCita] = useState<CitaResumen | null>(null);
  const [monto, setMonto] = useState("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("efectivo");
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [comprobantePreview, setComprobantePreview] = useState<string | null>(
    null
  );
  const [observacion, setObservacion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [montoLimitWarning, setMontoLimitWarning] = useState(false);

  // Estado para errores de validación
  type Errors = Partial<Record<"monto" | "comprobante", string>>;
  const [errors, setErrors] = useState<Errors>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const yaPagado = cita?.pago?.estado_pago === "pagado";

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/citas/${idCita}/`);
        setCita(res.data);
      } catch {
        setError("No se pudo cargar la información de la cita");
      }
    })();
  }, [idCita]);

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
    
    // Si cambia a efectivo, limpiar comprobante
    if (nuevoMetodo === "efectivo") {
      setComprobante(null);
      setComprobantePreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
    if (metodoPago === "transferencia" && !comprobante) {
      newErrors.comprobante = "El comprobante es obligatorio para transferencias.";
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

    if (!cita) {
      setError("No se encontró la información de la cita");
      return;
    }

    const formData = new FormData();
    formData.append("id_cita", cita.id_cita.toString());
    formData.append("id_paciente", cita.id_paciente.toString());
    formData.append("id_odontologo", cita.id_odontologo.toString());
    formData.append("monto", monto);
    formData.append("metodo_pago", metodoPago);
    if (observacion) formData.append("observacion", observacion);
    if (comprobante) formData.append("comprobante", comprobante);

    setLoading(true);
    try {
      await api.post("/pagos/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setShowSuccess(true);
      setTimeout(() => {
        navigate(`/admin/citas/${idCita}`);
      }, 1000);
    } catch (err: any) {
      console.error("Error al registrar pago:", err?.response?.data);
      alert("Error exacto:\n" + JSON.stringify(err?.response?.data, null, 2));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => navigate(`/admin/citas/${idCita}`);

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
            <div className="font-semibold">¡Pago registrado correctamente!</div>
            <div className="text-sm text-white/90">Redirigiendo…</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Banknote className="w-6 h-6" />
          Registro de Pago
        </h1>
      </div>

      {/* ===== Card: Datos de la Cita ===== */}
      {cita && (
        <div className="rounded-xl bg-white shadow-md p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-gray-700" />
              <h2 className="font-semibold text-gray-800">Datos de la cita</h2>
              <Pill estado={cita.estado} />
            </div>
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
              <div className="font-medium">
                {hhmm(cita.hora_inicio ?? cita.hora)}
              </div>
            </div>

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

            <div className="border rounded-lg p-3">
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <Stethoscope className="w-4 h-4" />
                Odontólogo
              </div>
              <div className="font-medium">
                {cita.odontologo_nombre ?? `#${cita.id_odontologo}`}
              </div>
              {/* Especialidades del odontólogo */}
              {Array.isArray(cita.odontologo_especialidades) &&
                cita.odontologo_especialidades.length > 0 && (
                  <div className="text-xs text-gray-500">
                    {cita.odontologo_especialidades.join(", ")}
                  </div>
                )}
            </div>

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

            <div className="border rounded-lg p-3">
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <FileText className="w-4 h-4" />
                Motivo
              </div>
              <div className="font-medium">{cita.motivo ?? "—"}</div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Card: Formulario de Pago ===== */}
      <div className="rounded-xl bg-white shadow-md p-4 space-y-4">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-gray-700" />
          Datos del pago
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
                className={inputClass()}
              >
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>
          </div>

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
                {/* Preview */}
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

                {/* Controles */}
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

                    {comprobante && (
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
              <p className="text-xs text-gray-500 mt-2">
                Formatos permitidos: JPG o PNG.
              </p>
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

          {/* Botones */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg border bg-white px-4 py-2 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>

            {yaPagado ? (
              <button
                type="button"
                onClick={() =>
                  navigate(`/admin/pagos/${cita?.pago?.id_pago_cita}/editar`)
                }
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow hover:bg-blue-700 transition"
              >
                <BanknoteArrowUpIcon className="w-4 h-4" />
                Editar pago
              </button>
            ) : (
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <BanknoteArrowUpIcon className="w-4 h-4" />
                {loading ? "Guardando..." : "Registrar pago"}
              </button>
            )}
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
