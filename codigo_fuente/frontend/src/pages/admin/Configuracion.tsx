// src/pages/admin/Configuracion.tsx
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Settings,
  Building2,
  Stethoscope,
  FileText,
  CalendarX,
  Users,
  X,
  Pencil,
  PlusCircle,
  Check,
  Loader2,
  Trash2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { api } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";

/* ===================== Tipos genéricos ===================== */
type MaybePage<T> = T[] | { results?: T[] };
function unwrap<T>(data: MaybePage<T>): T[] {
  return Array.isArray(data) ? data : data?.results ?? [];
}

/* ===================== Toasts (simple y reutilizable) ===================== */
type ToastKind = "success" | "error" | "info" | "warning";
type ToastItem = { id: number; kind: ToastKind; msg: string };

function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = (kind: ToastKind, msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, msg }]);
    // autocierra
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  };
  const remove = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));
  return { toasts, show, remove };
}

function ToastContainer({
  toasts,
  onClose,
}: {
  toasts: ToastItem[];
  onClose: (id: number) => void;
}) {
  const kindStyle: Record<ToastKind, string> = {
    success:
      "border-green-200 bg-green-50 text-green-800 [&_svg]:text-green-600",
    error: "border-red-200 bg-red-50 text-red-800 [&_svg]:text-red-600",
    info: "border-blue-200 bg-blue-50 text-blue-800 [&_svg]:text-blue-600",
    warning:
      "border-amber-200 bg-amber-50 text-amber-900 [&_svg]:text-amber-600",
  };
  const kindIcon: Record<ToastKind, ReactNode> = {
    success: <Check className="size-4" />,
    error: <AlertTriangle className="size-4" />,
    info: <Info className="size-4" />,
    warning: <AlertTriangle className="size-4" />,
  };
  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 rounded-xl border px-3 py-2 shadow ${
            kindStyle[t.kind]
          }`}
        >
          <div className="mt-0.5">{kindIcon[t.kind]}</div>
          <div className="text-sm">{t.msg}</div>
          <button
            onClick={() => onClose(t.id)}
            className="ml-2 rounded-md border px-2 text-xs hover:bg-white/50"
            aria-label="Cerrar"
          >
            Cerrar
          </button>
        </div>
      ))}
    </div>
  );
}

/* ===================== ConfirmDialog (sin window.confirm) ===================== */
function ConfirmDialog({
  open,
  title = "Confirmar acción",
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-xl border overflow-hidden">
        <header className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            onClick={onCancel}
            className="rounded-xl border p-1 hover:bg-gray-50"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="p-4 text-sm text-gray-700">{message}</div>
        <footer className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            onClick={onCancel}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl bg-red-600 text-white px-3 py-2 text-sm hover:bg-red-700"
          >
            {confirmText}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ===================== Tipos de catálogo ===================== */
type Especialidad = {
  id_especialidad: number;
  nombre: string;
  created_at?: string;
  updated_at?: string;
  // variantes que el backend podría enviar
  en_uso?: boolean;
  enUso?: boolean;
  locked?: boolean;
  rel_count?: number;
  citas_count?: number;
};

type Consultorio = {
  id_consultorio: number;
  numero: string;
  created_at?: string;
  updated_at?: string;
  descripcion?: string;
  estado?: boolean;
  en_uso?: boolean;
  enUso?: boolean;
  locked?: boolean;
  rel_count?: number;
  citas_count?: number;
};

type Antecedente = {
  id_antecedente: number;
  nombre: string;
  created_at?: string;
  updated_at?: string;
  en_uso?: boolean;
  enUso?: boolean;
  locked?: boolean;
  rel_count?: number;
  pacientes_count?: number;
};

/* ===================== Página ===================== */
export default function Configuracion() {
  const navigate = useNavigate();

  // toasts globales en esta pantalla
  const { toasts, show, remove } = useToasts();

  // ⬇️ Traemos el usuario desde el AuthContext
  const { usuario } = useAuth();
  // Puede venir como número (1) o como objeto { id_rol: 1 }
  const roleId =
    typeof usuario?.id_rol === "number"
      ? usuario.id_rol
      : (usuario?.id_rol as any)?.id_rol;
  const isAdmin = roleId === 1; // ⬅️ solo admins (id_rol = 1)

  const [openEsp, setOpenEsp] = useState(false);
  const [openCon, setOpenCon] = useState(false);
  const [openAnt, setOpenAnt] = useState(false);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="size-6" /> Configuración
        </h1>
        <p className="text-sm text-gray-500">
          Accede a la gestión de catálogos y reglas del sistema.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-semibold">Catálogos y reglas</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <CatalogCard
            icon={<Stethoscope className="size-6" />}
            title="Especialidades"
            desc="Crear, editar o eliminar especialidades."
            onClick={() => setOpenEsp(true)}
            actionText="Gestionar"
          />
          <CatalogCard
            icon={<Building2 className="size-6" />}
            title="Consultorios"
            desc="Crear, editar o eliminar consultorios."
            onClick={() => setOpenCon(true)}
            actionText="Gestionar"
          />
          <CatalogCard
            icon={<FileText className="size-6" />}
            title="Antecedentes clínicos"
            desc="Crear, editar o eliminar antecedentes."
            onClick={() => setOpenAnt(true)}
            actionText="Gestionar"
          />
          <CatalogCard
            icon={<CalendarX className="size-6" />}
            title="Bloqueos de agenda"
            desc="Definir días/fechas no laborables globales o por odontólogo."
            onClick={() => navigate("/admin/bloqueos")}
            actionText="Configurar"
          />

          {/* ⬇️ SOLO para admin (id_rol = 1) */}
          {isAdmin && (
            <CatalogCard
              icon={<Users className="size-6" />}
              title="Administradores"
              desc="Añadir, editar o gestionar administradores del sistema."
              onClick={() => navigate("/admin/administradores")}
              actionText="Gestionar"
            />
          )}
        </div>
      </section>

      {openEsp && (
        <EspecialidadesModal
          onClose={() => setOpenEsp(false)}
          showToast={show}
        />
      )}
      {openCon && (
        <ConsultoriosModal onClose={() => setOpenCon(false)} showToast={show} />
      )}
      {openAnt && (
        <AntecedentesModal onClose={() => setOpenAnt(false)} showToast={show} />
      )}

      {/* Portal de toasts */}
      <ToastContainer toasts={toasts} onClose={remove} />
    </div>
  );
}

/* ===================== Subcomponentes ===================== */
function CatalogCard({
  icon,
  title,
  desc,
  onClick,
  actionText = "Abrir",
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  actionText?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2 text-gray-700">
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-sm text-gray-500 mb-3">{desc}</p>
      <button
        onClick={onClick}
        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
      >
        {actionText}
      </button>
    </div>
  );
}

/* ===================== Modal base reutilizable ===================== */
function ModalShell({
  titleIcon,
  title,
  onClose,
  children,
}: {
  titleIcon: ReactNode;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl bg-white shadow-xl border max-h-[85vh] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            {titleIcon} {title}
          </h3>
          <button
            onClick={onClose}
            className="rounded-xl border p-1 hover:bg-gray-50"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="p-4 space-y-4 overflow-y-auto">{children}</div>
        <footer className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            onClick={onClose}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ===================== Helper “en uso” ===================== */
const isInUse = (obj: any) =>
  Boolean(
    obj?.en_uso ||
      obj?.enUso ||
      obj?.locked ||
      (typeof obj?.rel_count === "number" && obj.rel_count > 0) ||
      (typeof obj?.citas_count === "number" && obj.citas_count > 0) ||
      (typeof obj?.pacientes_count === "number" && obj.pacientes_count > 0)
  );

/* ===================== Especialidades ===================== */
function EspecialidadesModal({
  onClose,
  showToast,
}: {
  onClose: () => void;
  showToast: (kind: ToastKind, msg: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Especialidad[]>([]);
  const [q, setQ] = useState("");

  const [newNombre, setNewNombre] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [confirmRow, setConfirmRow] = useState<Especialidad | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.get("/especialidades/");
        const data = unwrap<Especialidad>(res.data)
          .map((e: any) => ({
            id_especialidad: e.id_especialidad,
            nombre: (e.nombre ?? "").trim(),
            created_at: e.created_at,
            updated_at: e.updated_at,
            en_uso: isInUse(e),
          }))
          .sort((a, b) =>
            a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
          );
        if (alive) setItems(data);
      } catch {
        if (alive) setError("No se pudieron cargar las especialidades.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((it) => it.nombre.toLowerCase().includes(t));
  }, [items, q]);

  const cancelEdit = () => {
    setEditId(null);
    setEditNombre("");
  };

  const saveEdit = async (row: Especialidad) => {
    if (!editNombre.trim()) {
      setError("El nombre no puede estar vacío.");
      return;
    }
    const dup = items.some(
      (it) =>
        it.id_especialidad !== row.id_especialidad &&
        it.nombre.trim().toLowerCase() === editNombre.trim().toLowerCase()
    );
    if (dup) {
      setError("Ya existe una especialidad con ese nombre.");
      return;
    }
    try {
      setSavingId(row.id_especialidad);
      setError(null);
      await api.patch(`/especialidades/${row.id_especialidad}/`, {
        nombre: editNombre.trim(),
      });
      setItems((prev) =>
        prev
          .map((it) =>
            it.id_especialidad === row.id_especialidad
              ? { ...it, nombre: editNombre.trim() }
              : it
          )
          .sort((a, b) =>
            a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
          )
      );
      cancelEdit();
      showToast("success", "Especialidad actualizada.");
    } catch (e: any) {
      setError(
        e?.response?.data?.nombre?.[0] ||
          e?.response?.data?.detail ||
          "No se pudo guardar la edición."
      );
    } finally {
      setSavingId(null);
    }
  };

  const addNew = async () => {
    if (!newNombre.trim()) {
      setError("El nombre no puede estar vacío.");
      return;
    }
    const dup = items.some(
      (it) => it.nombre.trim().toLowerCase() === newNombre.trim().toLowerCase()
    );
    if (dup) {
      setError("Ya existe una especialidad con ese nombre.");
      return;
    }
    try {
      setSavingId("new");
      setError(null);
      const res = await api.post("/especialidades/", {
        nombre: newNombre.trim(),
      });
      const created: any = res.data;
      setItems((prev) =>
        [
          ...prev,
          {
            id_especialidad: created.id_especialidad,
            nombre: (created.nombre ?? "").trim(),
            en_uso: isInUse(created),
          },
        ].sort((a, b) =>
          a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
        )
      );
      setNewNombre("");
      showToast("success", "Especialidad creada.");
    } catch (e: any) {
      const msg =
        e?.response?.data?.nombre?.[0] ||
        e?.response?.data?.detail ||
        "No se pudo crear la especialidad.";
      setError(msg);
    } finally {
      setSavingId(null);
    }
  };

  const askDelete = (row: Especialidad) => {
    if (isInUse(row)) {
      showToast(
        "warning",
        `No se puede eliminar "${row.nombre}" porque está en uso.`
      );
      return;
    }
    setConfirmRow(row);
  };

  const doDelete = async () => {
    if (!confirmRow) return;
    const row = confirmRow;
    try {
      setDeletingId(row.id_especialidad);
      setError(null);
      await api.delete(`/especialidades/${row.id_especialidad}/`);
      setItems((prev) =>
        prev.filter((it) => it.id_especialidad !== row.id_especialidad)
      );
      showToast("success", "Especialidad eliminada.");
    } catch (e: any) {
      const status = e?.response?.status;
      const serverMsg =
        e?.response?.data?.detail ||
        e?.response?.data?.mensaje ||
        e?.response?.data;
      if (
        status === 400 ||
        status === 409 ||
        /asociad|cita|ocupad/i.test(String(serverMsg))
      ) {
        showToast(
          "warning",
          `No se puede borrar "${row.nombre}": está asociada a uno o más odontólogos.`
        );
      } else {
        showToast("error", "No se pudo eliminar la especialidad.");
      }
    } finally {
      setDeletingId(null);
      setConfirmRow(null);
    }
  };

  return (
    <ModalShell
      titleIcon={<Stethoscope className="size-5" />}
      title="Gestionar especialidades"
      onClose={onClose}
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Buscar */}
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre…"
          className="w-full rounded-xl border px-3 py-2"
        />
      </div>

      {/* Nueva */}
      <div className="rounded-xl border p-3">
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-center">
          <div className="sm:col-span-5">
            <label className="block text-xs text-gray-500">Nombre</label>
            <input
              value={newNombre}
              onChange={(e) => setNewNombre(e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              placeholder="Ej. Endodoncia"
            />
          </div>
          <div className="sm:col-span-1 flex justify-end mt-5">
            <button
              onClick={addNew}
              disabled={savingId === "new"}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {savingId === "new" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlusCircle className="size-4" />
              )}
              Añadir
            </button>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <TableList
        loading={loading}
        emptyText="No hay especialidades."
        headers={["Nombre", "Acciones"]}
        rows={filtered.map((row) => {
          const enUso = isInUse(row);
          return {
            key: row.id_especialidad,
            cells: [
              editId === row.id_especialidad ? (
                <input
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2"
                />
              ) : (
                <span>{row.nombre}</span>
              ),
              <div className="flex justify-end gap-2">
                {editId === row.id_especialidad ? (
                  <>
                    <button
                      onClick={() => saveEdit(row)}
                      disabled={savingId === row.id_especialidad}
                      className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50 text-xs"
                    >
                      {savingId === row.id_especialidad ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      Guardar
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50 text-xs"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditId(row.id_especialidad);
                        setEditNombre(row.nombre);
                      }}
                      className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50 text-xs"
                    >
                      <Pencil className="size-4" /> Editar
                    </button>
                    <button
                      onClick={() => askDelete(row)}
                      disabled={deletingId === row.id_especialidad || enUso}
                      title={
                        enUso
                          ? "No se puede eliminar: está en uso."
                          : "Eliminar"
                      }
                      className={`inline-flex items-center gap-1 rounded-xl border px-2 py-1 text-xs ${
                        enUso
                          ? "text-gray-400 cursor-not-allowed"
                          : "text-red-600 hover:bg-gray-50"
                      } disabled:opacity-50`}
                    >
                      {deletingId === row.id_especialidad ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Eliminar
                    </button>
                  </>
                )}
              </div>,
            ],
          };
        })}
      />

      <ConfirmDialog
        open={!!confirmRow}
        title="Eliminar especialidad"
        message={
          <>
            ¿Seguro que deseas eliminar la especialidad{" "}
            <b>{confirmRow?.nombre}</b>? Esta acción no se puede deshacer.
          </>
        }
        confirmText="Sí, eliminar"
        onCancel={() => setConfirmRow(null)}
        onConfirm={doDelete}
      />
    </ModalShell>
  );
}

type PreviewMantenimientoItem = {
  id_cita: number;
  fecha: string;
  hora: string; // "HH:MM"
  id_paciente__id_usuario__primer_nombre?: string | null;
  id_paciente__id_usuario__primer_apellido?: string | null;
  id_paciente__id_usuario__celular?: string | null;
  id_odontologo__id_usuario__primer_nombre?: string | null;
  id_odontologo__id_usuario__primer_apellido?: string | null;
};

type PreviewMantenimientoResp = {
  total_afectadas: number;
  por_estado: Record<string, number>;
  items: PreviewMantenimientoItem[];
};

type ApplyMantenimientoResp = {
  batch_id: string;
  total_mantenimiento: number;
  items: PreviewMantenimientoItem[];
  consultorio: { id_consultorio: number; numero: string; estado: boolean };
};

type ApplyReactivateResp = {
  total_pendientes: number;
  consultorio: { id_consultorio: number; numero: string; estado: boolean };
};

/* ===================== Consultorios ===================== */
function ConsultoriosModal({
  onClose,
  showToast,
}: {
  onClose: () => void;
  showToast: (kind: ToastKind, msg: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Consultorio[]>([]);
  const [q, setQ] = useState("");

  // Nuevo
  const [newNumero, setNewNumero] = useState("");
  const [newDescripcion, setNewDescripcion] = useState("");
  const [newEstado, setNewEstado] = useState(true);

  // Edición
  const [editId, setEditId] = useState<number | null>(null);
  const [editNumero, setEditNumero] = useState("");
  const [editDescripcion, setEditDescripcion] = useState("");
  const [editEstado, setEditEstado] = useState(true);

  const [confirmRow, setConfirmRow] = useState<Consultorio | null>(null);

  // Preview/confirmación al desactivar
  const [preview, setPreview] = useState<PreviewMantenimientoResp | null>(null);
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const [pendingDeactivateRow, setPendingDeactivateRow] =
    useState<Consultorio | null>(null);

  // Helper para descargar CSV del listado
  const downloadCSV = (rows: PreviewMantenimientoItem[], filename: string) => {
    const header = [
      "id_cita",
      "fecha",
      "hora",
      "paciente_nombre",
      "paciente_apellido",
      "celular",
      "odontologo_nombre",
      "odontologo_apellido",
    ];
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.id_cita,
          r.fecha,
          r.hora,
          r.id_paciente__id_usuario__primer_nombre ?? "",
          r.id_paciente__id_usuario__primer_apellido ?? "",
          r.id_paciente__id_usuario__celular ?? "",
          r.id_odontologo__id_usuario__primer_nombre ?? "",
          r.id_odontologo__id_usuario__primer_apellido ?? "",
        ]
          .map((v) => String(v).replaceAll('"', '""'))
          .map((v) => `"${v}"`)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 1) Llama preview y abre confirmación
  const startDeactivateFlow = async (row: Consultorio) => {
    try {
      setSavingId(row.id_consultorio);
      setError(null);

      const res = await api.post<PreviewMantenimientoResp>(
        `/consultorios/${row.id_consultorio}/preview-mantenimiento/`,
        {}
      );

      setPreview(res.data);
      setPendingDeactivateRow(row);
      setConfirmDeactivateOpen(true);
    } catch (e: any) {
      setError(
        e?.response?.data?.detail ||
          "No se pudo obtener el preview de mantenimiento."
      );
    } finally {
      setSavingId(null);
    }
  };

  // 2) Aplica reprogramación y desactiva
  const confirmDeactivate = async () => {
    if (!pendingDeactivateRow) return;
    const row = pendingDeactivateRow;
    try {
      setSavingId(row.id_consultorio);
      setError(null);

      const res = await api.post<ApplyMantenimientoResp>(
        `/consultorios/${row.id_consultorio}/apply-mantenimiento/`,
        { confirm: true, set_inactive: true }
      );

      if (res.data.items?.length) {
        downloadCSV(
          res.data.items,
          `citas_mantenimiento_batch_${res.data.batch_id}.csv`
        );
      }
      setItems((prev) =>
        prev.map((it) =>
          it.id_consultorio === row.id_consultorio
            ? { ...it, estado: false }
            : it
        )
      );
      cancelEdit();
      showToast(
        "success",
        `Consultorio desactivado. ${res.data.total_mantenimiento} citas puestas en mantenimiento.`
      );
    } catch (e: any) {
      setError(
        e?.response?.data?.detail || "No se pudo aplicar el mantenimiento."
      );
    } finally {
      setSavingId(null);
      setConfirmDeactivateOpen(false);
      setPendingDeactivateRow(null);
      setPreview(null);
    }
  };

  // 3) Reactivar: pasa reprogramación -> pendiente y activa consultorio
  const applyReactivate = async (row: Consultorio) => {
    try {
      setSavingId(row.id_consultorio);
      setError(null);

      const res = await api.post<ApplyReactivateResp>(
        `/consultorios/${row.id_consultorio}/apply-reactivate/`,
        { set_active: true }
      );

      setItems((prev) =>
        prev.map((it) =>
          it.id_consultorio === row.id_consultorio
            ? { ...it, estado: true }
            : it
        )
      );
      cancelEdit();
      showToast(
        "success",
        `Consultorio activado. ${res.data.total_pendientes} citas pasaron a pendientes.`
      );
    } catch (e: any) {
      setError(
        e?.response?.data?.detail || "No se pudo reactivar el consultorio."
      );
    } finally {
      setSavingId(null);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.get("/consultorios/");
        const data = unwrap<Consultorio>(res.data)
          .map((c: any) => ({
            id_consultorio: c.id_consultorio,
            numero: (c.numero ?? "").trim(),
            created_at: c.created_at,
            updated_at: c.updated_at,
            descripcion: c.descripcion ?? "",
            estado: Boolean(c.estado ?? true),
            en_uso: isInUse(c),
          }))
          .sort((a, b) =>
            a.numero.localeCompare(b.numero, "es", {
              sensitivity: "base",
              numeric: true,
            })
          );
        if (alive) setItems(data);
      } catch {
        if (alive) setError("No se pudieron cargar los consultorios.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter(
      (it) =>
        it.numero.toLowerCase().includes(t) ||
        (it.descripcion ?? "").toLowerCase().includes(t)
    );
  }, [items, q]);

  const normaliza = (s: string) => (s ?? "").trim();

  const existeNumero = (numero: string, omitId?: number | null) => {
    const n = normaliza(numero).toLowerCase();
    return items.some(
      (it) =>
        it.id_consultorio !== omitId && normaliza(it.numero).toLowerCase() === n
    );
  };

  const startEdit = (row: Consultorio) => {
    setEditId(row.id_consultorio);
    setEditNumero(row.numero);
    setEditDescripcion(row.descripcion ?? "");
    setEditEstado(Boolean(row.estado));
    setError(null);
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditNumero("");
    setEditDescripcion("");
    setEditEstado(true);
  };

  const saveEdit = async (row: Consultorio) => {
    const numeroOK = normaliza(editNumero);
    if (!numeroOK) {
      setError("El número no puede estar vacío.");
      return;
    }
    if (existeNumero(numeroOK, row.id_consultorio)) {
      setError("Ya existe un consultorio con ese número.");
      return;
    }

    // Detectar cambio de estado
    const estadoCambió = Boolean(row.estado) !== Boolean(editEstado);

    // Caso 1: Activo -> Inactivo  => flow preview + apply-reprogram
    if (estadoCambió && row.estado === true && editEstado === false) {
      // antes de tocar número/descripcion, ejecutamos el flujo de desactivación
      await startDeactivateFlow(row);
      // el cambio de número/descripcion lo guardamos SOLO si no cambiaste nada más:
      // si quieres que también se persista, podrías hacer PATCH después de confirmar.
      return;
    }

    // Caso 2: Inactivo -> Activo  => apply-reactivate
    if (estadoCambió && row.estado === false && editEstado === true) {
      await applyReactivate(row);
      // Igual que arriba, si además cambiaste número/descr., puedes hacer PATCH adicional:
      if (
        normaliza(row.numero) !== numeroOK ||
        normaliza(row.descripcion || "") !== normaliza(editDescripcion)
      ) {
        try {
          setSavingId(row.id_consultorio);
          await api.patch(`/consultorios/${row.id_consultorio}/`, {
            numero: numeroOK,
            descripcion: normaliza(editDescripcion),
            // estado ya lo actualizó el endpoint de reactivación
          });
          setItems((prev) =>
            prev.map((it) =>
              it.id_consultorio === row.id_consultorio
                ? {
                    ...it,
                    numero: numeroOK,
                    descripcion: normaliza(editDescripcion),
                  }
                : it
            )
          );
        } catch (e: any) {
          setError(
            e?.response?.data?.detail || "No se pudo guardar la edición."
          );
        } finally {
          setSavingId(null);
        }
      }
      return;
    }

    // Caso 3: Estado no cambió => PATCH normal
    try {
      setSavingId(row.id_consultorio);
      setError(null);
      await api.patch(`/consultorios/${row.id_consultorio}/`, {
        numero: numeroOK,
        descripcion: normaliza(editDescripcion),
        estado: Boolean(editEstado),
      });
      setItems((prev) =>
        prev
          .map((it) =>
            it.id_consultorio === row.id_consultorio
              ? {
                  ...it,
                  numero: numeroOK,
                  descripcion: normaliza(editDescripcion),
                  estado: Boolean(editEstado),
                }
              : it
          )
          .sort((a, b) =>
            a.numero.localeCompare(b.numero, "es", {
              sensitivity: "base",
              numeric: true,
            })
          )
      );
      cancelEdit();
      showToast("success", "Consultorio actualizado.");
    } catch (e: any) {
      setError(
        e?.response?.data?.numero?.[0] ||
          e?.response?.data?.detail ||
          "No se pudo guardar la edición."
      );
    } finally {
      setSavingId(null);
    }
  };

  const addNew = async () => {
    const numeroOK = normaliza(newNumero);
    if (!numeroOK) {
      setError("El número no puede estar vacío.");
      return;
    }
    if (existeNumero(numeroOK)) {
      setError("Ya existe un consultorio con ese número.");
      return;
    }
    try {
      setSavingId("new");
      setError(null);
      const res = await api.post("/consultorios/", {
        numero: numeroOK,
        descripcion: normaliza(newDescripcion),
        estado: Boolean(newEstado),
      });
      const created: any = res.data;
      setItems((prev) =>
        [
          ...prev,
          {
            id_consultorio: created.id_consultorio,
            numero: normaliza(created.numero),
            descripcion: created.descripcion ?? "",
            estado: Boolean(created.estado),
            en_uso: isInUse(created),
          },
        ].sort((a, b) =>
          a.numero.localeCompare(b.numero, "es", {
            sensitivity: "base",
            numeric: true,
          })
        )
      );
      setNewNumero("");
      setNewDescripcion("");
      setNewEstado(true);
      showToast("success", "Consultorio creado.");
    } catch (e: any) {
      const msg =
        e?.response?.data?.numero?.[0] ||
        e?.response?.data?.detail ||
        "No se pudo crear el consultorio.";
      setError(msg);
    } finally {
      setSavingId(null);
    }
  };

  const askDelete = (row: Consultorio) => {
    if (isInUse(row)) {
      showToast(
        "warning",
        `No se puede eliminar el consultorio "${row.numero}" porque está en uso.`
      );
      return;
    }
    setConfirmRow(row);
  };

  const doDelete = async () => {
    if (!confirmRow) return;
    const row = confirmRow;
    try {
      setDeletingId(row.id_consultorio);
      setError(null);
      await api.delete(`/consultorios/${row.id_consultorio}/`);
      setItems((prev) =>
        prev.filter((it) => it.id_consultorio !== row.id_consultorio)
      );
      showToast("success", "Consultorio eliminado.");
    } catch (e: any) {
      const status = e?.response?.status;
      const serverMsg =
        e?.response?.data?.detail ||
        e?.response?.data?.mensaje ||
        e?.response?.data;
      if (
        status === 400 ||
        status === 409 ||
        /asociad|cita|ocupad/i.test(String(serverMsg))
      ) {
        showToast(
          "warning",
          `No se puede borrar "${row.numero}": está asociado a citas u otros registros.`
        );
      } else {
        showToast("error", "No se pudo eliminar el consultorio.");
      }
    } finally {
      setDeletingId(null);
      setConfirmRow(null);
    }
  };

  return (
    <ModalShell
      titleIcon={<Building2 className="size-5" />}
      title="Gestionar consultorios"
      onClose={onClose}
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Buscar */}
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por número o descripción…"
          className="w-full rounded-xl border px-3 py-2"
        />
      </div>

      {/* Nuevo */}
      <div className="rounded-xl border p-3">
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-start">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500">Número</label>
            <input
              value={newNumero}
              onChange={(e) => setNewNumero(e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              placeholder="Ej. 1, 2, A-101"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="block text-xs text-gray-500">
              Descripción (opcional)
            </label>
            <input
              value={newDescripcion}
              onChange={(e) => setNewDescripcion(e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              placeholder="Ej. Box con RX, piso 2"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="block text-xs text-gray-500">Estado</label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="nuevo-estado"
                type="checkbox"
                checked={newEstado}
                onChange={(e) => setNewEstado(e.target.checked)}
              />
              <label htmlFor="nuevo-estado" className="text-sm">
                {newEstado ? "Activo" : "Inactivo"}
              </label>
            </div>
          </div>

          <div className="sm:col-span-6 flex justify-end">
            <button
              onClick={addNew}
              disabled={savingId === "new"}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {savingId === "new" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlusCircle className="size-4" />
              )}
              Añadir
            </button>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <TableList
        loading={loading}
        emptyText="No hay consultorios."
        headers={["Número", "Descripción", "Estado", "Acciones"]}
        rows={filtered.map((row) => {
          const enUso = isInUse(row);
          return {
            key: row.id_consultorio,
            cells: [
              editId === row.id_consultorio ? (
                <input
                  value={editNumero}
                  onChange={(e) => setEditNumero(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2"
                />
              ) : (
                <span className="font-medium">{row.numero}</span>
              ),
              editId === row.id_consultorio ? (
                <input
                  value={editDescripcion}
                  onChange={(e) => setEditDescripcion(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2"
                />
              ) : (
                <span className="text-gray-600">{row.descripcion || "—"}</span>
              ),
              editId === row.id_consultorio ? (
                <div className="flex items-center gap-2 justify-center">
                  <input
                    id={`estado-${row.id_consultorio}`}
                    type="checkbox"
                    checked={editEstado}
                    onChange={(e) => setEditEstado(e.target.checked)}
                  />
                  <label
                    htmlFor={`estado-${row.id_consultorio}`}
                    className="text-sm"
                  >
                    {editEstado ? "Activo" : "Inactivo"}
                  </label>
                </div>
              ) : (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
                    row.estado
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-gray-50 text-gray-600 border border-gray-200"
                  }`}
                >
                  {row.estado ? "Activo" : "Inactivo"}
                </span>
              ),
              <div className="flex justify-end gap-2">
                {editId === row.id_consultorio ? (
                  <>
                    <button
                      onClick={() => saveEdit(row)}
                      disabled={savingId === row.id_consultorio}
                      className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50 text-xs"
                    >
                      {savingId === row.id_consultorio ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      Guardar
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50 text-xs"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => startEdit(row)}
                      className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50 text-xs"
                    >
                      <Pencil className="size-4" /> Editar
                    </button>
                    <button
                      onClick={() => askDelete(row)}
                      disabled={deletingId === row.id_consultorio || enUso}
                      title={
                        enUso
                          ? "No se puede eliminar: está en uso."
                          : "Eliminar"
                      }
                      className={`inline-flex items-center gap-1 rounded-xl border px-2 py-1 text-xs ${
                        enUso
                          ? "text-gray-400 cursor-not-allowed"
                          : "text-red-600 hover:bg-gray-50"
                      } disabled:opacity-50`}
                    >
                      {deletingId === row.id_consultorio ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Eliminar
                    </button>
                  </>
                )}
              </div>,
            ],
          };
        })}
      />

      <ConfirmDialog
        open={!!confirmRow}
        title="Eliminar consultorio"
        message={
          <>
            ¿Seguro que deseas eliminar el consultorio{" "}
            <b>{confirmRow?.numero}</b>? Esta acción no se puede deshacer.
          </>
        }
        confirmText="Sí, eliminar"
        onCancel={() => setConfirmRow(null)}
        onConfirm={doDelete}
      />

      <ConfirmDialog
        open={confirmDeactivateOpen}
        title="Desactivar consultorio"
        message={
          <div className="space-y-3">
            <p>
              {preview ? (
                <>
                  Se encontraron <b>{preview.total_afectadas}</b> citas futuras
                  asociadas a este consultorio.
                </>
              ) : (
                "Cargando…"
              )}
            </p>

            {preview && (
              <>
                {/* Tabla de citas */}
                <div className="max-h-64 overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="p-2 text-left">Fecha</th>
                        <th className="p-2 text-left">Hora</th>
                        <th className="p-2 text-left">Paciente</th>
                        <th className="p-2 text-left">Odontólogo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items.map((c) => (
                        <tr key={c.id_cita} className="border-t">
                          <td className="p-2">{c.fecha}</td>
                          <td className="p-2">{c.hora}</td>
                          <td className="p-2">
                            {(c.id_paciente__id_usuario__primer_nombre || "") +
                              " " +
                              (c.id_paciente__id_usuario__primer_apellido ||
                                "")}
                            <div className="text-xs text-gray-500">
                              {c.id_paciente__id_usuario__celular || "—"}
                            </div>
                          </td>
                          <td className="p-2">
                            {(c.id_odontologo__id_usuario__primer_nombre ||
                              "") +
                              " " +
                              (c.id_odontologo__id_usuario__primer_apellido ||
                                "")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Resumen por estado */}
                <ul className="text-sm text-gray-700 list-disc pl-5">
                  {Object.entries(preview.por_estado).map(([est, n]) => (
                    <li key={est}>
                      {est}: {n}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="text-sm text-gray-700">
              Si confirmas, todas las citas (excepto las ya canceladas) pasarán
              al estado <b>Mantenimiento</b>. Se descargará un listado para
              contactar a los pacientes.
            </p>
          </div>
        }
        confirmText="Sí, desactivar y poner en mantenimiento"
        cancelText="Cancelar"
        onCancel={() => {
          setConfirmDeactivateOpen(false);
          setPreview(null);
          setPendingDeactivateRow(null);
        }}
        onConfirm={confirmDeactivate}
      />
    </ModalShell>
  );
}

/* ===================== Antecedentes ===================== */
function AntecedentesModal({
  onClose,
  showToast,
}: {
  onClose: () => void;
  showToast: (kind: ToastKind, msg: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Antecedente[]>([]);
  const [q, setQ] = useState("");

  const [newNombre, setNewNombre] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [confirmRow, setConfirmRow] = useState<Antecedente | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.get("/antecedentes/");
        const data = unwrap<Antecedente>(res.data)
          .map((a: any) => ({
            id_antecedente: a.id_antecedente,
            nombre: (a.nombre ?? "").trim(),
            created_at: a.created_at,
            updated_at: a.updated_at,
            en_uso: isInUse(a),
          }))
          .sort((x, y) =>
            x.nombre.localeCompare(y.nombre, "es", { sensitivity: "base" })
          );
        if (alive) setItems(data);
      } catch {
        if (alive) setError("No se pudieron cargar los antecedentes.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((it) => it.nombre.toLowerCase().includes(t));
  }, [items, q]);

  const startEdit = (row: Antecedente) => {
    setEditId(row.id_antecedente);
    setEditNombre(row.nombre);
    setError(null);
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditNombre("");
  };

  const saveEdit = async (row: Antecedente) => {
    if (!editNombre.trim()) {
      setError("El nombre no puede estar vacío.");
      return;
    }
    const dup = items.some(
      (it) =>
        it.id_antecedente !== row.id_antecedente &&
        it.nombre.trim().toLowerCase() === editNombre.trim().toLowerCase()
    );
    if (dup) {
      setError("Ya existe un antecedente con ese nombre.");
      return;
    }
    try {
      setSavingId(row.id_antecedente);
      setError(null);
      await api.patch(`/antecedentes/${row.id_antecedente}/`, {
        nombre: editNombre.trim(),
      });
      setItems((prev) =>
        prev
          .map((it) =>
            it.id_antecedente === row.id_antecedente
              ? { ...it, nombre: editNombre.trim() }
              : it
          )
          .sort((x, y) =>
            x.nombre.localeCompare(y.nombre, "es", { sensitivity: "base" })
          )
      );
      cancelEdit();
      showToast("success", "Antecedente actualizado.");
    } catch (e: any) {
      setError(
        e?.response?.data?.nombre?.[0] ||
          e?.response?.data?.detail ||
          "No se pudo guardar la edición."
      );
    } finally {
      setSavingId(null);
    }
  };

  const addNew = async () => {
    if (!newNombre.trim()) {
      setError("El nombre no puede estar vacío.");
      return;
    }
    const dup = items.some(
      (it) => it.nombre.trim().toLowerCase() === newNombre.trim().toLowerCase()
    );
    if (dup) {
      setError("Ya existe un antecedente con ese nombre.");
      return;
    }
    try {
      setSavingId("new");
      setError(null);
      const res = await api.post("/antecedentes/", {
        nombre: newNombre.trim(),
      });
      const created: any = res.data;
      setItems((prev) =>
        [
          ...prev,
          {
            id_antecedente: created.id_antecedente,
            nombre: (created.nombre ?? "").trim(),
            en_uso: isInUse(created),
          },
        ].sort((x, y) =>
          x.nombre.localeCompare(y.nombre, "es", { sensitivity: "base" })
        )
      );
      setNewNombre("");
      showToast("success", "Antecedente creado.");
    } catch (e: any) {
      const msg =
        e?.response?.data?.nombre?.[0] ||
        e?.response?.data?.detail ||
        "No se pudo crear el antecedente.";
      setError(msg);
    } finally {
      setSavingId(null);
    }
  };

  const askDelete = (row: Antecedente) => {
    if (isInUse(row)) {
      showToast(
        "warning",
        `No se puede eliminar el antecedente "${row.nombre}" porque está en uso.`
      );
    } else {
      setConfirmRow(row);
    }
  };

  const doDelete = async () => {
    if (!confirmRow) return;
    const row = confirmRow;
    try {
      setDeletingId(row.id_antecedente);
      setError(null);
      await api.delete(`/antecedentes/${row.id_antecedente}/`);
      setItems((prev) =>
        prev.filter((it) => it.id_antecedente !== row.id_antecedente)
      );
      showToast("success", "Antecedente eliminado.");
    } catch (e: any) {
      const status = e?.response?.status;
      const serverMsg =
        e?.response?.data?.detail ||
        e?.response?.data?.mensaje ||
        e?.response?.data;
      if (
        status === 400 ||
        status === 409 ||
        /asociad|paciente/i.test(String(serverMsg))
      ) {
        showToast(
          "warning",
          `No se puede borrar "${row.nombre}": está asociado a uno o más pacientes.`
        );
      } else {
        showToast("error", "No se pudo eliminar el antecedente.");
      }
    } finally {
      setDeletingId(null);
      setConfirmRow(null);
    }
  };

  return (
    <ModalShell
      titleIcon={<FileText className="size-5" />}
      title="Gestionar antecedentes clínicos"
      onClose={onClose}
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Buscar */}
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre…"
          className="w-full rounded-xl border px-3 py-2"
        />
      </div>

      {/* Nuevo */}
      <div className="rounded-xl border p-3">
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-center">
          <div className="sm:col-span-5">
            <label className="block text-xs text-gray-500">Nombre</label>
            <input
              value={newNombre}
              onChange={(e) => setNewNombre(e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              placeholder="Ej. Hipertensión"
            />
          </div>
          <div className="sm:col-span-1 flex justify-end mt-5">
            <button
              onClick={addNew}
              disabled={savingId === "new"}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {savingId === "new" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlusCircle className="size-4" />
              )}
              Añadir
            </button>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <TableList
        loading={loading}
        emptyText="No hay antecedentes."
        headers={["Nombre", "Acciones"]}
        rows={filtered.map((row) => {
          const enUso = isInUse(row);
          return {
            key: row.id_antecedente,
            cells: [
              editId === row.id_antecedente ? (
                <input
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2"
                />
              ) : (
                <span>{row.nombre}</span>
              ),
              <div className="flex justify-end gap-2">
                {editId === row.id_antecedente ? (
                  <>
                    <button
                      onClick={() => saveEdit(row)}
                      disabled={savingId === row.id_antecedente}
                      className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50 text-xs"
                    >
                      {savingId === row.id_antecedente ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      Guardar
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50 text-xs"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => startEdit(row)}
                      className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50 text-xs"
                    >
                      <Pencil className="size-4" /> Editar
                    </button>
                    <button
                      onClick={() => askDelete(row)}
                      disabled={deletingId === row.id_antecedente || enUso}
                      title={
                        enUso
                          ? "No se puede eliminar: está en uso."
                          : "Eliminar"
                      }
                      className={`inline-flex items-center gap-1 rounded-xl border px-2 py-1 text-xs ${
                        enUso
                          ? "text-gray-400 cursor-not-allowed"
                          : "text-red-600 hover:bg-gray-50"
                      } disabled:opacity-50`}
                    >
                      {deletingId === row.id_antecedente ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Eliminar
                    </button>
                  </>
                )}
              </div>,
            ],
          };
        })}
      />

      <ConfirmDialog
        open={!!confirmRow}
        title="Eliminar antecedente clínico"
        message={
          <>
            ¿Seguro que deseas eliminar el antecedente{" "}
            <b>{confirmRow?.nombre}</b>? Esta acción no se puede deshacer.
          </>
        }
        confirmText="Sí, eliminar"
        onCancel={() => setConfirmRow(null)}
        onConfirm={doDelete}
      />
    </ModalShell>
  );
}

/* ===================== Tabla simple reutilizable ===================== */
function TableList({
  loading,
  emptyText,
  headers,
  rows,
}: {
  loading: boolean;
  emptyText: string;
  headers: string[];
  rows: { key: string | number; cells: ReactNode[] }[];
}) {
  return (
    <div className="rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={
                  i === headers.length - 1
                    ? "text-right p-2 w-52"
                    : "text-left p-2"
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                className="p-4 text-center text-gray-500"
                colSpan={headers.length}
              >
                Cargando…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td
                className="p-4 text-center text-gray-500"
                colSpan={headers.length}
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="border-t">
                {r.cells.map((c, i) => (
                  <td key={i} className="p-2 align-middle">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
