// src/pages/odontologo/AtencionCita.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/axios";
import {
  CalendarDays,
  Clock,
  FileText,
  FilePlus2,
  Loader2,
  Paperclip,
  Trash2,
  User,
  CheckCircle2,
  AlertTriangle,
  Stethoscope,
} from "lucide-react";

/* ====================== Tipos ====================== */

type AntecedentePaciente = {
  id_antecedente?: number | { nombre?: string };
  antecedente?: { nombre?: string };
  antecedente_nombre?: string | null;
  nombre?: string;
  descripcion?: string | null;
  relacion?: "propio" | "padres" | "hermanos" | "abuelos" | null;
  relacion_familiar?: "propio" | "padres" | "hermanos" | "abuelos" | null;
  observacion?: string | null;
};

type PacienteBasic = {
  id_paciente: number;
  nombreCompleto?: string | null;
  cedula?: string | null;
};

type Estado =
  | "pendiente"
  | "confirmada"
  | "cancelada"
  | "realizada"
  | "mantenimiento";

type CitaDetalle = {
  id_cita: number;
  fecha: string;
  hora?: string | null;
  hora_inicio?: string | null;
  hora_fin?: string | null;
  motivo?: string | null;
  estado: Estado;
  id_paciente: number;
  id_odontologo: number;
  paciente?: PacienteBasic | null;
  paciente_nombre?: string | null;
  paciente_cedula?: string | null;
  consultorio?: { id_consultorio: number; numero?: string | null } | null;
};

type FichaMedica = {
  id_ficha_medica: number;
  id_cita: number;
  observacion: string | null;
  diagnostico: string | null;
  tratamiento: string | null;
  comentarios: string | null;
  created_at?: string;
  updated_at?: string;
};

type ArchivoAdjunto = {
  id_archivo_adjunto: number;
  id_ficha_medica: number;
  archivo: string; // URL
  mime_type?: string;
  nombre_original?: string;
  tamano_bytes?: number | null;
  checksum_sha256?: string;
  created_at?: string;
};

/* ====================== Helpers ====================== */

const fmtFecha = (iso: string) => {
  try {
    const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
};

const fmtHora = (hhmm?: string | null, fallback?: string | null) => {
  const raw = hhmm || fallback || "";
  if (!raw) return "";
  const [h, m] = raw.split(":");
  if (!h || !m) return raw;
  const dt = new Date();
  dt.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
  return dt.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const KB = 1024;
const MB = 1024 * KB;
const MAX_SIZE = 10 * MB;
const ALLOWED_EXT = new Set(["pdf", "jpg", "jpeg", "png", "webp", "zip", "rar"]);

/* ====================== Componente ====================== */

const AtencionCita: React.FC = () => {
  const { id } = useParams(); // id de la cita
  const idCita = useMemo(() => Number(id), [id]);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [cita, setCita] = useState<CitaDetalle | null>(null);
  const [antecedentes, setAntecedentes] = useState<AntecedentePaciente[]>([]);

  const [ficha, setFicha] = useState<FichaMedica | null>(null);
  const [form, setForm] = useState({
    observacion: "",
    diagnostico: "",
    tratamiento: "",
    comentarios: "",
  });

  const [adjuntos, setAdjuntos] = useState<ArchivoAdjunto[]>([]);
  const [errors, setErrors] = useState<string | null>(null);
  const [showToast, setShowToast] = useState<boolean>(false);
  const [estadoCita, setEstadoCita] = useState<Estado>("pendiente");

  const inputRef = useRef<HTMLInputElement | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const marcarAusentismo = async () => {
    setConfirming(true);
    setErrors(null);
    try {
      await api.patch(`/citas/${idCita}/`, {
        estado: "cancelada",
        cancelada_por_rol: 3,
        ausentismo: true,
        cancelada_en: new Date().toISOString(),
      });

      setShowModal(false);
      setShowToast(true);
      setTimeout(() => {
        setShowToast(false);
        navigate(`/odontologo/citas/${idCita}/ver`, { replace: true });
      }, 1200);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        "No se pudo marcar la cita como ausentismo.";
      setErrors(msg);
    } finally {
      setConfirming(false);
    }
  };
  const requiredFilled =
    form.observacion.trim().length > 0 &&
    form.diagnostico.trim().length > 0 &&
    form.tratamiento.trim().length > 0;

  // Normaliza fila de antecedentes venida del backend a {nombre, relacion, observacion}
  const normalizeAntecedente = (a: AntecedentePaciente) => {
    const nombre =
      (a.antecedente_nombre ?? "").trim() ||
      (a.nombre ?? "").trim() ||
      (typeof a.id_antecedente === "object"
        ? (a.id_antecedente?.nombre ?? "").trim()
        : "") ||
      (a.antecedente?.nombre ?? "").trim();

    const relacion =
      (a.relacion as any) ?? (a.relacion_familiar as any) ?? null;

    return {
      nombre: nombre || "Antecedente",
      relacion,
      observacion: a.observacion ?? a.descripcion ?? null,
    } as {
      nombre: string;
      relacion: "propio" | "padres" | "hermanos" | "abuelos" | null;
      observacion: string | null;
    };
  };

  // Carga cita, ficha (o la crea si no existe) y adjuntos
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setErrors(null);
      try {
        // 1) Detalle de la cita
        const respCita = await api.get<CitaDetalle>(`/citas/${idCita}/`);
        if (!mounted) return;
        const c = respCita.data;
        setCita(c);
        setEstadoCita(c.estado);

        // 2) Intentar obtener ficha por id_cita
        const respFichaList = await api.get<
          { results?: FichaMedica[] } | FichaMedica[]
        >(`/fichas-medicas/?id_cita=${idCita}&page_size=1`);
        const list = Array.isArray(respFichaList.data)
          ? respFichaList.data
          : respFichaList.data.results ?? [];

        let f: FichaMedica | null = list[0] || null;

        // 3) Crear si no existe (manejo de carrera)
        if (!f) {
          try {
            const respCreate = await api.post<FichaMedica>(`/fichas-medicas/`, {
              id_cita: idCita,
            });
            f = respCreate.data;
          } catch (err: any) {
            const again = await api.get<
              { results?: FichaMedica[] } | FichaMedica[]
            >(`/fichas-medicas/?id_cita=${idCita}&page_size=1`);
            const list2 = Array.isArray(again.data)
              ? again.data
              : again.data.results ?? [];
            f = list2[0] || null;
            if (!f) throw err;
          }
        }
        if (!mounted) return;

        setFicha(f);
        setForm({
          observacion: f?.observacion ?? "",
          diagnostico: f?.diagnostico ?? "",
          tratamiento: f?.tratamiento ?? "",
          comentarios: f?.comentarios ?? "",
        });

        // 4) Adjuntos
        if (f?.id_ficha_medica) {
          const respAdj = await api.get<
            { results?: ArchivoAdjunto[] } | ArchivoAdjunto[]
          >(`/archivos-adjuntos/?id_ficha_medica=${f.id_ficha_medica}`);
          const listAdj = Array.isArray(respAdj.data)
            ? respAdj.data
            : respAdj.data.results ?? [];
          setAdjuntos(listAdj);
        }

        // 5) Antecedentes
        if (c?.id_paciente) {
          try {
            const resp = await api.get<
              { results?: AntecedentePaciente[] } | AntecedentePaciente[]
            >(`/paciente-antecedentes/?id_paciente=${c.id_paciente}`);
            const ants = Array.isArray(resp.data)
              ? resp.data
              : resp.data.results ?? [];

            // Normalizar
            setAntecedentes(ants.map(normalizeAntecedente));
          } catch {
            setAntecedentes([]);
          }
        }
      } catch (err: any) {
        setErrors(
          err?.response?.data?.detail || "No se pudo cargar la atención."
        );
      } finally {
        if (mounted) setLoading(false);
      }
    };

    if (idCita > 0) load();
    return () => {
      mounted = false;
    };
  }, [idCita]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  };

  const validar = () => {
    if (!form.observacion.trim()) return "La observación es obligatoria.";
    if (!form.diagnostico.trim()) return "El diagnóstico es obligatorio.";
    if (!form.tratamiento.trim()) return "El tratamiento es obligatorio.";
    return null;
  };

  const guardar = async () => {
    setErrors(null);
    const v = validar();
    if (v) {
      setErrors(v);
      return;
    }
    if (!ficha) {
      setErrors("No hay ficha médica cargada.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        observacion: form.observacion.trim(),
        diagnostico: form.diagnostico.trim(),
        tratamiento: form.tratamiento.trim(),
        comentarios: form.comentarios.trim() || null,
      };
      await api.patch<FichaMedica>(
        `/fichas-medicas/${ficha.id_ficha_medica}/`,
        payload
      );
      await api.patch(`/citas/${idCita}/`, { estado: "realizada" });

      setShowToast(true);
      setTimeout(() => {
        setShowToast(false);
        navigate(`/odontologo/citas/${idCita}/ver`, { replace: true });
      }, 1200);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        "No se pudo guardar la ficha médica. Revisa los campos.";
      setErrors(msg);
    } finally {
      setSaving(false);
    }
  };

  const onPickFiles = () => inputRef.current?.click();

  const validarArchivo = (file: File): string | null => {
    const sizeOk = file.size <= MAX_SIZE;
    if (!sizeOk) return `“${file.name}” supera 10MB.`;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return `“${file.name}” tiene extensión no permitida. Usa pdf/jpg/jpeg/png/webp/zip/rar.`;
    }
    return null;
  };

  const subirAdjuntos = async (files: FileList | null) => {
    if (!files || !ficha) return;
    setErrors(null);

    const errores: string[] = [];
    const lote: File[] = [];
    Array.from(files).forEach((f) => {
      const v = validarArchivo(f);
      if (v) errores.push(v);
      else lote.push(f);
    });
    if (errores.length) {
      setErrors(errores.join(" "));
      return;
    }

    setUploading(true);
    try {
      const nuevos: ArchivoAdjunto[] = [];
      for (const f of lote) {
        const formData = new FormData();
        formData.append("id_ficha_medica", String(ficha.id_ficha_medica));
        formData.append("archivo_file", f);
        const resp = await api.post<ArchivoAdjunto>(
          `/archivos-adjuntos/`,
          formData,
          {
            headers: { "Content-Type": "multipart/form-data" },
          }
        );
        nuevos.push(resp.data);
      }
      setAdjuntos((prev) => [...nuevos, ...prev]);
    } catch (err: any) {
      const backendErr =
        err?.response?.data?.archivo_file?.[0] ||
        err?.response?.data?.detail ||
        "Error subiendo adjuntos.";
      setErrors(String(backendErr));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const eliminarAdjunto = async (adj: ArchivoAdjunto) => {
    setErrors(null);
    try {
      await api.delete(`/archivos-adjuntos/${adj.id_archivo_adjunto}/`);
      setAdjuntos((prev) =>
        prev.filter((a) => a.id_archivo_adjunto !== adj.id_archivo_adjunto)
      );
    } catch (err: any) {
      setErrors("No se pudo eliminar el adjunto.");
    }
  };

  const pacienteNombre = useMemo(() => {
    if (!cita) return "";
    return cita.paciente?.nombreCompleto || cita.paciente_nombre || "Paciente";
  }, [cita]);

  const horaBonita = useMemo(
    () => fmtHora(cita?.hora_inicio, cita?.hora),
    [cita?.hora_inicio, cita?.hora]
  );

  const antecedentesPropios = useMemo(
    () => antecedentes.filter((a) => (a.relacion ?? "propio") === "propio"),
    [antecedentes]
  );
  const antecedentesFamilia = useMemo(
    () =>
      antecedentes.filter(
        (a) => (a.relacion ?? a.relacion_familiar ?? "") !== "propio"
      ),
    [antecedentes]
  );

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          Cargando atención de la cita…
        </div>
      </div>
    );
  }

  if (!cita || !ficha) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-red-50 p-4 text-red-700 shadow flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>
            <p className="font-medium">No se pudo cargar la cita o la ficha.</p>
            <p className="text-sm">Verifica el ID o vuelve a intentarlo.</p>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-white shadow hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {showToast && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
            <div className="font-semibold">
              ¡Atención registrada correctamente!
            </div>
            <div className="text-sm text-white/90">Redirigiendo…</div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Header + acciones */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Stethoscope className="w-6 h-6" />
            Atención de Cita
          </h1>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-white shadow hover:bg-slate-50"
              title="Volver"
            >
              Cancelar
            </button>

            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 border rounded-lg bg-rose-600 text-white px-4 py-2 shadow hover:bg-rose-700 disabled:opacity-50"
              title="Marcar como ausentismo"
            >
              <AlertTriangle className="w-4 h-4" />
              Ausentismo
            </button>

            <button
              onClick={guardar}
              disabled={saving || !requiredFilled}
              className="inline-flex items-center gap-2 border rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80 disabled:opacity-50"
              title={
                !requiredFilled
                  ? "Completa los campos obligatorios"
                  : "Guardar ficha"
              }
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Guardar ficha
            </button>
          </div>
        </div>

        {/* Mensajes de error */}
        {errors && (
          <div className="rounded-lg bg-red-50 p-3 text-red-700 shadow flex gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">{errors}</div>
          </div>
        )}

        {/* Card: datos de la cita / paciente */}
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 rounded-2xl bg-white p-5 shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-slate-600" />
                <h2 className="text-lg font-semibold">Paciente</h2>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                    estadoCita === "confirmada"
                      ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                      : estadoCita === "realizada"
                      ? "bg-blue-100 text-blue-700 border border-blue-200"
                      : estadoCita === "cancelada"
                      ? "bg-rose-100 text-rose-700 border border-rose-200"
                      : estadoCita === "mantenimiento"
                      ? "bg-purple-100 text-purple-800 border border-purple-200"
                      : "bg-amber-100 text-amber-700 border border-amber-200"
                  }`}
                >
                  {estadoCita.charAt(0).toUpperCase() + estadoCita.slice(1)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div>
                <div className="text-slate-500">Nombre</div>
                <div className="font-medium">{pacienteNombre}</div>
              </div>
              <div>
                <div className="text-slate-500">Cédula</div>
                <div className="font-medium">
                  {cita.paciente?.cedula || cita.paciente_cedula || "—"}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-6 text-sm">
              <div className="inline-flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-slate-600" />
                <span className="text-slate-500">Fecha:</span>
                <span className="font-medium">{fmtFecha(cita.fecha)}</span>
              </div>
              <div className="inline-flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-600" />
                <span className="text-slate-500">Hora:</span>
                <span className="font-medium">{horaBonita || "—"}</span>
              </div>
              <div className="inline-flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-600" />
                <span className="text-slate-500">Motivo:</span>
                <span className="font-medium">{cita.motivo || "—"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-md">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-semibold">Antecedentes</h2>
            </div>

            {antecedentes.length === 0 ? (
              <div className="text-sm text-slate-500">
                Sin antecedentes registrados.
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="font-medium mb-2">Antecedentes propios</div>
                  {antecedentesPropios.length === 0 ? (
                    <div className="text-slate-500">—</div>
                  ) : (
                    <ul className="space-y-1">
                      {antecedentesPropios.map((a, idx) => (
                        <li key={`prop-${idx}`} className="truncate">
                          {a.nombre || "Antecedente"}
                          {a.observacion ? (
                            <span className="text-slate-600">
                              {" "}
                              — {a.observacion}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="font-medium mb-2">
                    Antecedentes familiares
                  </div>
                  {antecedentesFamilia.length === 0 ? (
                    <div className="text-slate-500">—</div>
                  ) : (
                    <ul className="space-y-1">
                      {antecedentesFamilia.map((a, idx) => (
                        <li key={`fam-${idx}`} className="truncate">
                          {a.nombre || "Antecedente"}
                          {a.relacion ? (
                            <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                              {a.relacion}
                            </span>
                          ) : null}
                          {a.observacion ? (
                            <span className="text-slate-600">
                              {" "}
                              — {a.observacion}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Formulario ficha (2x2) */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-white p-5 shadow-md">
            <h3 className="text-base font-semibold mb-3">Observación *</h3>
            <textarea
              name="observacion"
              value={form.observacion}
              onChange={handleChange}
              rows={6}
              className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-black/50"
              placeholder="Hallazgos, signos, síntomas, notas de exploración…"
            />
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-md">
            <h3 className="text-base font-semibold mb-3">Diagnóstico *</h3>
            <textarea
              name="diagnostico"
              value={form.diagnostico}
              onChange={handleChange}
              rows={6}
              className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-black/50"
              placeholder="Diagnóstico (puedes incluir códigos CIE-10 si aplica)…"
            />
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-md">
            <h3 className="text-base font-semibold mb-3">Tratamiento *</h3>
            <textarea
              name="tratamiento"
              value={form.tratamiento}
              onChange={handleChange}
              rows={6}
              className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-black/50"
              placeholder="Plan terapéutico, medicación, procedimientos programados…"
            />
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-md">
            <h3 className="text-base font-semibold mb-3">
              Comentarios (opcional)
            </h3>
            <textarea
              name="comentarios"
              value={form.comentarios}
              onChange={handleChange}
              rows={6}
              className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-black/50"
              placeholder="Notas adicionales internas…"
            />
          </div>
        </section>

        {/* Adjuntos */}
        <section>
          <div className="rounded-2xl bg-white p-5 shadow-md">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Paperclip className="w-5 h-5 text-slate-600" />
                <h3 className="text-base font-semibold">Adjuntos (opcional)</h3>
              </div>
              <button
                onClick={onPickFiles}
                disabled={uploading}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-white shadow hover:bg-slate-50 disabled:opacity-50"
                title="Subir archivos"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FilePlus2 className="w-4 h-4" />
                )}
                Agregar
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.zip,.rar"
                className="hidden"
                onChange={(e) => subirAdjuntos(e.target.files)}
              />
            </div>

            {adjuntos.length === 0 ? (
              <div className="text-sm text-slate-500">
                No hay archivos adjuntos.
              </div>
            ) : (
              <ul className="divide-y">
                {adjuntos.map((a) => (
                  <li
                    key={a.id_archivo_adjunto}
                    className="py-3 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {a.nombre_original || "Archivo"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {a.mime_type || "—"}{" "}
                        {typeof a.tamano_bytes === "number"
                          ? `· ${(a.tamano_bytes / MB).toFixed(2)} MB`
                          : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={a.archivo}
                        target="_blank"
                        rel="noreferrer"
                        className="text-black hover:underline text-sm"
                      >
                        Ver
                      </a>
                      <button
                        onClick={() => eliminarAdjunto(a)}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-white shadow hover:bg-red-50 text-red-600"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-lg animate-in fade-in duration-150">
            <h2 className="text-lg font-semibold mb-2 flex items-center gap-2 text-rose-600">
              <AlertTriangle className="w-5 h-5" />
              Confirmar Ausentismo
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              Esta cita se marcará como <b>cancelada</b> y con{" "}
              <b>ausentismo confirmado</b>, por lo que se aplicará una
              penalización al paciente. ¿Desea continuar?
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                disabled={confirming}
                className="px-4 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={marcarAusentismo}
                disabled={confirming}
                className="px-4 py-2 rounded-md bg-rose-600 text-white hover:bg-rose-700 shadow disabled:opacity-50"
              >
                {confirming ? (
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                ) : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AtencionCita;
