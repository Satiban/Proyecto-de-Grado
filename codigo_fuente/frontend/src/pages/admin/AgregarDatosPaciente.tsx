// src/pages/admin/AgregarDatosPaciente.tsx
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { UserPlus, Loader2 } from "lucide-react";
import { api } from "../../api/axios";
import { e164ToLocal, localToE164 } from "../../utils/phoneFormat";

const PRIMARY = "#0070B7";

type Usuario = {
  id_usuario: number;
  email: string;
  primer_nombre: string;
  segundo_nombre?: string;
  primer_apellido: string;
  segundo_apellido: string;
  cedula: string;
  celular: string;
  id_rol: number;
  rol_nombre: string;
};

type AntecedenteOpt = {
  id_antecedente: number;
  nombre: string;
};

type FamiliarRel = "padres" | "hermanos" | "abuelos" | "propio";
type PersonalRow = { id: string; sel: number | "" | "__other__" };
type FamiliarRow = {
  id: string;
  sel: number | "" | "__other__";
  relacion: Exclude<FamiliarRel, "propio">;
};

const OTHER = "__other__" as const;

const makeId = (() => {
  let c = 0;
  return () => `antecedente_${++c}_${Date.now()}`;
})();

const PARENTESCO_CHOICES = [
  { value: "hijos", label: "Hijos" },
  { value: "padres", label: "Padres" },
  { value: "hermanos", label: "Hermanos" },
  { value: "abuelos", label: "Abuelos" },
  { value: "esposos", label: "Esposos" },
  { value: "otros", label: "Otros" },
];

/* Modal para agregar antecedente */
function AddAntecedenteModal({
  open,
  initialValue = "",
  onCancel,
  onConfirmName,
  busy = false,
}: {
  open: boolean;
  initialValue?: string;
  onCancel: () => void;
  onConfirmName: (name: string) => Promise<void>;
  busy?: boolean;
}) {
  const [name, setName] = useState(initialValue);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(initialValue);
    setErr(null);
  }, [initialValue, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-xl border overflow-hidden">
        <header className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">Agregar antecedente</h3>
          <button
            onClick={onCancel}
            className="rounded-xl border px-2 py-1 hover:bg-gray-50"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>
        <div className="p-4 space-y-2">
          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {err}
            </div>
          )}
          <label className="block text-sm text-gray-600">
            Nombre del antecedente
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            placeholder="Ej. Artritis reumatoide"
          />
          <p className="text-xs text-gray-500">
            Se validará que no exista duplicado en la base de datos.
          </p>
        </div>
        <footer className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            onClick={onCancel}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              try {
                setErr(null);
                await onConfirmName(name);
              } catch (e: any) {
                setErr(
                  e?.message ||
                    "No se pudo agregar. Verifica que no exista duplicado."
                );
              }
            }}
            className="rounded-xl bg-blue-600 text-white px-3 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Crear"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function AgregarDatosPaciente() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [antecedentesOpts, setAntecedentesOpts] = useState<AntecedenteOpt[]>([]);
  const [loadingAnt, setLoadingAnt] = useState(true);
  const [errorAnt, setErrorAnt] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const [form, setForm] = useState({
    contacto_emergencia_nom: "",
    contacto_emergencia_cel: "",
    contacto_emergencia_par: "",
  });

  // Antecedentes propios y familiares
  const [propias, setPropias] = useState<PersonalRow[]>([]);
  const [familiares, setFamiliares] = useState<FamiliarRow[]>([]);
  const [errorPropias, setErrorPropias] = useState<string | null>(null);
  const [errorFamiliares, setErrorFamiliares] = useState<string | null>(null);

  // Modal para agregar antecedente
  const [addAntOpen, setAddAntOpen] = useState(false);
  const [addAntBusy, setAddAntBusy] = useState(false);
  const [addAntPrefill, setAddAntPrefill] = useState("");
  const [triggerRow, setTriggerRow] = useState<{
    kind: "propio" | "familiar";
    id: string;
  } | null>(null);

  const [errors, setErrors] = useState<{
    contacto_emergencia_nom?: string;
    contacto_emergencia_cel?: string;
    contacto_emergencia_par?: string;
  }>({});

  // Cargar datos del usuario y antecedentes disponibles
  useEffect(() => {
    if (!userId) {
      setError("ID de usuario no proporcionado");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setLoadingAnt(true);
        
        // Cargar usuario
        const { data } = await api.get(`/usuarios/${userId}/`);
        // Convertir celular de E.164 a formato local para mostrar
        if (data.celular) {
          data.celular = e164ToLocal(data.celular);
        }
        setUsuario(data);

        // Cargar antecedentes disponibles
        const res = await api.get("/antecedentes/");
        const antecedentesData = (Array.isArray(res.data) ? res.data : res.data?.results ?? [])
          .map((a: any) => ({
            id_antecedente: a.id_antecedente,
            nombre: String(a.nombre ?? "").trim(),
          }))
          .filter((a: AntecedenteOpt) => {
            if (!a.nombre) return false;
            // Excluir "Otros" u "Otro" de la lista (solo mostrar "Otro (especificar...)")
            const lower = a.nombre.toLowerCase();
            return lower !== "otros" && lower !== "otro";
          })
          .sort((a: AntecedenteOpt, b: AntecedenteOpt) =>
            a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
          );
        setAntecedentesOpts(antecedentesData);
        setErrorAnt(null);

        // Verificar si ya tiene datos de paciente
        try {
          const verifyRes = await api.get(`/usuarios/${userId}/verificar-rol-paciente/`);
          // Ahora el backend siempre retorna 200, verificamos el campo "existe"
          if (verifyRes.data?.existe === true) {
            setError("Este usuario ya tiene datos de paciente registrados.");
          }
          // Si existe === false, podemos continuar normalmente
        } catch (err: any) {
          // Si hay error de red u otro, lo mostramos
          console.error("Error al verificar rol paciente:", err);
        }
      } catch (err: any) {
        console.error(err);
        setError("Error al cargar datos del usuario.");
        setErrorAnt("No se pudieron cargar los antecedentes.");
      } finally {
        setLoading(false);
        setLoadingAnt(false);
      }
    })();
  }, [userId]);

  // Helper: crear antecedente si no existe
  async function ensureAntecedenteByName(rawName: string): Promise<number> {
    const name = rawName.trim();
    if (!name) throw new Error("El nombre no puede estar vacío.");

    const lower = name.toLowerCase();
    if (lower === "otros" || lower === "otro") {
      throw new Error('Escribe el nombre real del antecedente (no "Otros").');
    }

    const exist = antecedentesOpts.find((a) => a.nombre.toLowerCase() === lower);
    if (exist) return exist.id_antecedente;

    const res = await api.post("/antecedentes/", { nombre: name });
    const created: AntecedenteOpt = {
      id_antecedente: res.data.id_antecedente,
      nombre: String(res.data.nombre ?? "").trim(),
    };
    setAntecedentesOpts((prev) =>
      [...prev, created].sort((x, y) =>
        x.nombre.localeCompare(y.nombre, "es", { sensitivity: "base" })
      )
    );
    return created.id_antecedente;
  }

  function openAddModal(kind: "propio" | "familiar", rowId: string, prefill = "") {
    setTriggerRow({ kind, id: rowId });
    setAddAntPrefill(prefill);
    setAddAntOpen(true);
  }

  async function handleCreateAntecedente(name: string) {
    setAddAntBusy(true);
    try {
      const newId = await ensureAntecedenteByName(name);
      if (triggerRow) {
        if (triggerRow.kind === "propio") {
          setPropias((arr) =>
            arr.map((r) => (r.id === triggerRow.id ? { ...r, sel: newId } : r))
          );
        } else {
          setFamiliares((arr) =>
            arr.map((r) => (r.id === triggerRow.id ? { ...r, sel: newId } : r))
          );
        }
      }
      setAddAntOpen(false);
    } finally {
      setAddAntBusy(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validaciones
    const newErrors: typeof errors = {};

    if (!form.contacto_emergencia_nom.trim()) {
      newErrors.contacto_emergencia_nom = "El nombre del contacto es obligatorio.";
    }

    if (!form.contacto_emergencia_cel.trim()) {
      newErrors.contacto_emergencia_cel = "El celular del contacto es obligatorio.";
    } else if (!/^09\d{8}$/.test(form.contacto_emergencia_cel)) {
      newErrors.contacto_emergencia_cel = "Formato inválido. Debe ser 09xxxxxxxx.";
    }

    if (!form.contacto_emergencia_par) {
      newErrors.contacto_emergencia_par = "Selecciona el parentesco.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // 1) Crear registro de paciente
      // Convertir celular de emergencia a formato E.164 antes de enviar
      const celularEmergenciaE164 = localToE164(form.contacto_emergencia_cel.trim());
      
      const pacRes = await api.post("/pacientes/", {
        id_usuario: Number(userId),
        contacto_emergencia_nom: form.contacto_emergencia_nom.trim(),
        contacto_emergencia_cel: celularEmergenciaE164,
        contacto_emergencia_par: form.contacto_emergencia_par,
      });

      const id_paciente = pacRes.data.id_paciente ?? pacRes.data.id;

      // 2) Registrar enfermedades propias
      for (const row of propias) {
        if (id_paciente && row.sel && typeof row.sel === "number") {
          await api.post(`/paciente-antecedentes/`, {
            id_paciente,
            id_antecedente: row.sel,
            relacion_familiar: "propio",
          });
        }
      }

      // 3) Registrar antecedentes familiares
      for (const row of familiares) {
        if (id_paciente && row.sel && typeof row.sel === "number") {
          await api.post(`/paciente-antecedentes/`, {
            id_paciente,
            id_antecedente: row.sel,
            relacion_familiar: row.relacion,
          });
        }
      }

      // Mostrar toast de éxito
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        navigate(-1);
      }, 1500);
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.detail || err.response?.data?.id_usuario?.[0] || "Error al guardar datos de paciente.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toast de éxito */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
            <div className="font-semibold">¡Datos registrados correctamente!</div>
            <div className="text-sm text-white/90">Redirigiendo…</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UserPlus className="h-6 w-6" />
          Agregar datos de paciente
        </h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded-lg border hover:bg-gray-50"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="agregar-paciente-form"
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80 disabled:opacity-50"
            disabled={saving || loading}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Guardar datos de paciente
              </>
            )}
          </button>
        </div>
      </div>

      {error && usuario && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      {/* Información del usuario (solo lectura) */}
      <div className="rounded-xl bg-white p-4 shadow-md">
        <h3 className="text-lg font-bold text-gray-900 mb-4">
          📋 Información del usuario
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600">Nombre completo</label>
            <p className="mt-1 text-gray-900">
              {usuario?.primer_nombre} {usuario?.segundo_nombre || ""} {usuario?.primer_apellido} {usuario?.segundo_apellido}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600">Cédula</label>
            <p className="mt-1 text-gray-900">{usuario?.cedula}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600">Email</label>
            <p className="mt-1 text-gray-900">{usuario?.email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600">Celular</label>
            <p className="mt-1 text-gray-900">{usuario?.celular}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600">Rol principal</label>
            <p className="mt-1 text-gray-900 capitalize">{usuario?.rol_nombre}</p>
          </div>
        </div>
      </div>

      {/* Formulario de datos de paciente */}
      <form id="agregar-paciente-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Cards lado a lado */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Card 1: Contacto de emergencia */}
          <div className="rounded-xl bg-white shadow-md p-4">
          <h3 className="text-lg font-bold text-gray-900 mb-4">
            🚨 Contacto de emergencia
          </h3>

          <div className="space-y-4">
          {/* Nombre del contacto */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre del contacto de emergencia <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.contacto_emergencia_nom}
              onChange={(e) => {
                setForm({ ...form, contacto_emergencia_nom: e.target.value });
                setErrors({ ...errors, contacto_emergencia_nom: undefined });
              }}
              className={`w-full rounded-lg border px-3 py-2 ${
                errors.contacto_emergencia_nom
                  ? "border-red-500 focus:ring-2 focus:ring-red-500"
                  : "border-gray-300"
              }`}
              placeholder="Ej: María López"
            />
            {errors.contacto_emergencia_nom && (
              <p className="mt-1 text-xs text-red-600">{errors.contacto_emergencia_nom}</p>
            )}
          </div>

          {/* Celular del contacto */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Celular del contacto de emergencia <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={form.contacto_emergencia_cel}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                setForm({ ...form, contacto_emergencia_cel: value });
                setErrors({ ...errors, contacto_emergencia_cel: undefined });
              }}
              className={`w-full rounded-lg border px-3 py-2 ${
                errors.contacto_emergencia_cel
                  ? "border-red-500 focus:ring-2 focus:ring-red-500"
                  : "border-gray-300"
              }`}
              placeholder="09xxxxxxxx"
              maxLength={10}
            />
            {errors.contacto_emergencia_cel && (
              <p className="mt-1 text-xs text-red-600">{errors.contacto_emergencia_cel}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">Formato: 09xxxxxxxx (10 dígitos)</p>
          </div>

          {/* Parentesco */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Parentesco <span className="text-red-500">*</span>
            </label>
            <select
              value={form.contacto_emergencia_par}
              onChange={(e) => {
                setForm({ ...form, contacto_emergencia_par: e.target.value });
                setErrors({ ...errors, contacto_emergencia_par: undefined });
              }}
              className={`w-full rounded-lg border px-3 py-2 ${
                errors.contacto_emergencia_par
                  ? "border-red-500 focus:ring-2 focus:ring-red-500"
                  : "border-gray-300"
              }`}
            >
              <option value="">-- Selecciona --</option>
              {PARENTESCO_CHOICES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {errors.contacto_emergencia_par && (
              <p className="mt-1 text-xs text-red-600">{errors.contacto_emergencia_par}</p>
            )}
          </div>
        </div>
          </div>

          {/* Card 2: Antecedentes médicos */}
          <div className="rounded-xl bg-white shadow-md p-4">
          <h3 className="text-lg font-bold text-gray-900 mb-4">
            🩺 Antecedentes médicos
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Opcional: Agrega enfermedades propias y antecedentes familiares del paciente.
          </p>

          {loadingAnt && (
            <div className="rounded-md border bg-gray-50 p-2 text-sm text-gray-600 mb-2">
              Cargando antecedentes…
            </div>
          )}
          {errorAnt && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 mb-2">
              {errorAnt}
            </div>
          )}

          {!loadingAnt && (
            <div className="space-y-6">
              {/* Enfermedades propias */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">
                  Enfermedades propias (opcional)
                </h4>
                {propias.length === 0 && (
                  <p className="text-sm text-gray-500 mb-2">
                    No has añadido ninguna.
                  </p>
                )}

                <div className="space-y-3">
                  {propias.map((row) => (
                    <div key={row.id} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <select
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 flex-1"
                          value={row.sel === OTHER ? "" : row.sel}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === OTHER) {
                              openAddModal("propio", row.id);
                              return;
                            }
                            setPropias((arr) =>
                              arr.map((r) =>
                                r.id === row.id
                                  ? { ...r, sel: val === "" ? "" : Number(val) }
                                  : r
                              )
                            );
                            setErrorPropias(null);
                          }}
                        >
                          <option value="">Selecciona antecedente…</option>
                          {antecedentesOpts.map((opt) => (
                            <option key={opt.id_antecedente} value={opt.id_antecedente}>
                              {opt.nombre}
                            </option>
                          ))}
                          <option value={OTHER}>Otro (especificar…)</option>
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setPropias((arr) => arr.filter((r) => r.id !== row.id))
                          }
                          className="self-start sm:ml-auto rounded-md border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={loadingAnt}
                  onClick={() => {
                    if (propias.some((p) => !p.sel)) {
                      setErrorPropias(
                        "Debes completar la enfermedad anterior antes de añadir otra."
                      );
                      return;
                    }
                    setErrorPropias(null);
                    setPropias((arr) => [...arr, { id: makeId(), sel: "" }]);
                  }}
                  className="mt-3 rounded-lg px-4 py-2 text-white disabled:opacity-50"
                  style={{ backgroundColor: PRIMARY }}
                >
                  Añadir enfermedad propia
                </button>
                {errorPropias && (
                  <p className="mt-1 text-sm text-red-600">{errorPropias}</p>
                )}
              </div>

              {/* Antecedentes familiares */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">
                  Antecedentes familiares (opcional)
                </h4>
                {familiares.length === 0 && (
                  <p className="text-sm text-gray-500 mb-2">
                    No has añadido ninguno.
                  </p>
                )}

                <div className="space-y-3">
                  {familiares.map((row) => (
                    <div key={row.id} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                          <select
                            className="w-full rounded-lg border border-gray-300 px-3 py-2"
                            value={row.sel === OTHER ? "" : row.sel}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === OTHER) {
                                openAddModal("familiar", row.id);
                                return;
                              }
                              setFamiliares((arr) =>
                                arr.map((r) =>
                                  r.id === row.id
                                    ? { ...r, sel: val === "" ? "" : Number(val) }
                                    : r
                                )
                              );
                              setErrorFamiliares(null);
                            }}
                          >
                            <option value="">Selecciona antecedente…</option>
                            {antecedentesOpts.map((opt) => (
                              <option key={opt.id_antecedente} value={opt.id_antecedente}>
                                {opt.nombre}
                              </option>
                            ))}
                            <option value={OTHER}>Otro (especificar…)</option>
                          </select>
                          <select
                            className="w-full rounded-lg border border-gray-300 px-3 py-2"
                            value={row.relacion}
                            onChange={(e) =>
                              setFamiliares((arr) =>
                                arr.map((r) =>
                                  r.id === row.id
                                    ? { ...r, relacion: e.target.value as Exclude<FamiliarRel, "propio"> }
                                    : r
                                )
                              )
                            }
                          >
                            <option value="padres">Padres</option>
                            <option value="hermanos">Hermanos</option>
                            <option value="abuelos">Abuelos</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setFamiliares((arr) => arr.filter((r) => r.id !== row.id))
                          }
                          className="self-start sm:ml-auto rounded-md border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={loadingAnt}
                  onClick={() => {
                    if (familiares.some((f) => !f.sel)) {
                      setErrorFamiliares(
                        "Debes completar el antecedente anterior antes de añadir otro."
                      );
                      return;
                    }
                    setErrorFamiliares(null);
                    setFamiliares((arr) => [
                      ...arr,
                      { id: makeId(), sel: "", relacion: "padres" },
                    ]);
                  }}
                  className="mt-3 rounded-lg px-4 py-2 text-white disabled:opacity-50"
                  style={{ backgroundColor: PRIMARY }}
                >
                  Añadir antecedente familiar
                </button>
                {errorFamiliares && (
                  <p className="mt-1 text-sm text-red-600">{errorFamiliares}</p>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      </form>

      {/* Modal agregar antecedente */}
      <AddAntecedenteModal
        open={addAntOpen}
        initialValue={addAntPrefill}
        busy={addAntBusy}
        onCancel={() => setAddAntOpen(false)}
        onConfirmName={handleCreateAntecedente}
      />
    </div>
  );
}
