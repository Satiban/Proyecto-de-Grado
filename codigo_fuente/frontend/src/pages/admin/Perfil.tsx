// src/pages/admin/Perfil.tsx
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Pencil } from "lucide-react";

type RolLite = { id_rol: number; rol?: string } | number | null | undefined;

type UsuarioView = {
  id_usuario: number;
  email: string | null;
  usuario_email?: string | null;
  primer_nombre: string | null;
  segundo_nombre: string | null;
  primer_apellido: string | null;
  segundo_apellido: string | null;
  cedula: string | null;
  fecha_nacimiento: string | null; // "YYYY-MM-DD"
  sexo: string | null;             // "M" | "F" | "O"
  tipo_sangre: string | null;      // "O+", etc.
  celular: string | null;
  foto?: string | null;

  id_rol?: RolLite;
  rol_nombre?: string | null;

  is_active?: boolean | null;
  is_staff?: boolean | null;
  is_superuser?: boolean | null;

  created_at?: string | null;
  updated_at?: string | null;
};

function sexoLabel(sexo?: string | null) {
  if (sexo === "M") return "Masculino";
  if (sexo === "F") return "Femenino";
  if (sexo === "O") return "Otro";
  return "—";
}

function safeDate(d?: string | null) {
  if (!d) return "—";
  const asDate = new Date(d);
  if (Number.isNaN(asDate.getTime())) return d;
  return asDate.toLocaleString();
}

function safeYMD(d?: string | null) {
  if (!d) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const asDate = new Date(d);
  if (Number.isNaN(asDate.getTime())) return d;
  return asDate.toLocaleDateString();
}

function rolTexto(id_rol?: RolLite, rol_nombre?: string | null) {
  if (rol_nombre) return rol_nombre;
  if (!id_rol && id_rol !== 0) return "—";
  if (typeof id_rol === "number") {
    return id_rol === 1
      ? "Administrador"
      : id_rol === 2
      ? "Paciente"
      : id_rol === 3
      ? "Odontólogo"
      : `Rol #${id_rol}`;
  }
  if (typeof id_rol === "object") {
    const anyRol = id_rol as any;
    if (anyRol?.rol) return anyRol.rol as string;
    if (typeof anyRol?.id_rol === "number") return rolTexto(anyRol.id_rol, null);
  }
  return "—";
}

export default function Perfil() {
  const navigate = useNavigate();
  const { usuario: usuarioCtx } = useAuth();

  // fallback por si el contexto aún no está poblado
  const usuarioStorage = (() => {
    try {
      const raw = localStorage.getItem("usuario");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const u = (usuarioCtx || usuarioStorage || {}) as Partial<UsuarioView>;

  const nombreCompleto = useMemo(() => {
    return [u.primer_nombre, u.segundo_nombre, u.primer_apellido, u.segundo_apellido]
      .filter(Boolean)
      .join(" ");
  }, [u.primer_nombre, u.segundo_nombre, u.primer_apellido, u.segundo_apellido]);

  // Fallback: inferir flags si no vienen del backend
  const staff =
    typeof u.is_staff === "boolean"
      ? u.is_staff
      : (typeof u.id_rol === "number"
          ? u.id_rol === 1
          : typeof (u.id_rol as any)?.id_rol === "number"
          ? (u.id_rol as any).id_rol === 1
          : false);

  const superuser =
    typeof u.is_superuser === "boolean" ? u.is_superuser : staff; // tu regla: admin => superusuario

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Perfil del Administrador</h1>
        <button
          onClick={() => navigate("/admin/perfil/editar")}
          className="px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-black/80 inline-flex items-center gap-2"
        >
          <Pencil className="h-4 w-4" />
          Editar
        </button>
      </div>

      {/* Identidad principal */}
      <div className="bg-white rounded-xl shadow p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <div className="w-28 h-28 rounded-full bg-gray-200 overflow-hidden">
            {u.foto ? (
              <img src={u.foto} alt="Foto de perfil" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500">
                Sin foto
              </div>
            )}
          </div>

          <div className="mt-4 space-y-1">
            <p className="text-sm text-gray-500">ID de usuario</p>
            <p className="font-medium">{u.id_usuario ?? "—"}</p>
          </div>

          <div className="mt-4 space-y-1">
            <p className="text-sm text-gray-500">Rol</p>
            <p className="font-medium">{rolTexto(u.id_rol, u.rol_nombre ?? null)}</p>
          </div>
        </div>

        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Nombre completo</p>
            <p className="font-medium">{nombreCompleto || "—"}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Cédula</p>
            <p className="font-medium">{u.cedula || "—"}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Sexo</p>
            <p className="font-medium">{sexoLabel(u.sexo)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Fecha de nacimiento</p>
            <p className="font-medium">{safeYMD(u.fecha_nacimiento)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Tipo de sangre</p>
            <p className="font-medium">{u.tipo_sangre || "—"}</p>
          </div>
        </div>
      </div>

      {/* Contacto */}
      <div className="bg-white rounded-xl shadow p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-gray-500">Email</p>
          <p className="font-medium">{u.email || u.usuario_email || "—"}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Celular</p>
          <p className="font-medium">{u.celular || "—"}</p>
        </div>
      </div>

      {/* Flags de acceso Django */}
      <div className="bg-white rounded-xl shadow p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <p className="text-sm text-gray-500">Estado (is_active)</p>
          <p className="font-medium">{u.is_active ? "Activo" : "Inactivo"}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Staff (is_staff)</p>
          <p className="font-medium">{staff ? "Sí" : "No"}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Superusuario (is_superuser)</p>
          <p className="font-medium">{superuser ? "Sí" : "No"}</p>
        </div>
      </div>

      {/* Auditoría */}
      <div className="bg-white rounded-xl shadow p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-gray-500">Creado</p>
          <p className="font-medium">{safeDate(u.created_at)}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Actualizado</p>
          <p className="font-medium">{safeDate(u.updated_at)}</p>
        </div>
      </div>
    </div>
  );
}
