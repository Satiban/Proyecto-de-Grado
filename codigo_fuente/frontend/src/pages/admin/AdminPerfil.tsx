// src/pages/admin/AdminPerfil.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/axios";
import { Pencil, Loader2, UserCircle2, ArrowLeft } from "lucide-react";
import { e164ToLocal } from "../../utils/phoneFormat";

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
  sexo: string | null; // "M" | "F"
  tipo_sangre: string | null; // "O+", etc.
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
      : id_rol === 4
      ? "Administrador clínico"
      : `Rol #${id_rol}`;
  }
  if (typeof id_rol === "object") {
    const anyRol = id_rol as any;
    if (anyRol?.rol) return anyRol.rol as string;
    if (typeof anyRol?.id_rol === "number")
      return rolTexto(anyRol.id_rol, null);
  }
  return "—";
}

export default function AdminPerfil() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [u, setU] = useState<UsuarioView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Estado para verificar si tiene datos de paciente
  const [tieneDatosPaciente, setTieneDatosPaciente] = useState<boolean | null>(null);
  const [checkingPaciente, setCheckingPaciente] = useState(false);

  const nombreCompleto = useMemo(() => {
    if (!u) return "";
    return [
      u.primer_nombre,
      u.segundo_nombre,
      u.primer_apellido,
      u.segundo_apellido,
    ]
      .filter(Boolean)
      .join(" ");
  }, [u]);

  useEffect(() => {
    const fetchOne = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get(`/usuarios/${id}/`);
        setU(data);
        
        // Verificar si tiene datos de paciente
        setCheckingPaciente(true);
        try {
          const verifyRes = await api.get(`/usuarios/${id}/verificar-rol-paciente/`);
          setTieneDatosPaciente(verifyRes.data?.existe === true);
        } catch (err) {
          console.error("Error al verificar rol paciente:", err);
          setTieneDatosPaciente(null);
        } finally {
          setCheckingPaciente(false);
        }
      } catch (err: any) {
        const detail =
          err?.response?.data?.detail ||
          "No se pudo cargar el perfil del usuario.";
        setError(detail);
      } finally {
        setLoading(false);
      }
    };
    if (id) fetchOne();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-600">
        <Loader2 className="animate-spin" />
        Cargando perfil…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
        <Link
          to="/admin/configuracion"
          className="inline-block rounded-lg border px-4 py-2 hover:bg-gray-50"
        >
          Volver
        </Link>
      </div>
    );
  }

  if (!u) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <UserCircle2 className="size-6 text-blue-600" />
            Perfil del Administrador
          </h1>
          {/* Indicador de datos de paciente */}
          {checkingPaciente && (
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Verificando datos de paciente...
            </p>
          )}
          {tieneDatosPaciente === true && (
            <p className="text-xs text-green-600 mt-1">
              ✓ Ya tiene datos de paciente registrados
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/admin/administradores")}
            className="inline-flex items-center gap-2 rounded-lg border border-black bg-white text-black px-3 py-2 hover:bg-gray-100"
          >
            <ArrowLeft className="size-4" />
            Volver
          </button>

          <button
            onClick={() => navigate(`/admin/usuarios/${u.id_usuario}/editar`)}
            className="px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-black/80 inline-flex items-center gap-2"
          >
            <Pencil className="h-4 w-4" />
            Editar
          </button>
        </div>
      </div>

      {/* Identidad principal */}
      <div className="bg-white rounded-xl shadow p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <div className="w-28 h-28 rounded-full bg-gray-200 overflow-hidden">
            {u.foto ? (
              <img
                src={u.foto}
                alt="Foto de perfil"
                className="w-full h-full object-cover"
              />
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
            <p className="font-medium">
              {rolTexto(u.id_rol, u.rol_nombre ?? null)}
            </p>
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
          <p className="font-medium">{e164ToLocal(u.celular) || "—"}</p>
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
          <p className="font-medium">{u.is_staff ? "Sí" : "No"}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Superusuario (is_superuser)</p>
          <p className="font-medium">{u.is_superuser ? "Sí" : "No"}</p>
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
