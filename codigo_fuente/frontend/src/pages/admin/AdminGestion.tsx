// src/pages/admin/AdminGestion.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/axios";
import { e164ToLocal } from "../../utils/phoneFormat";
import {
  Plus,
  Search,
  Eye,
  Pencil,
  Eraser,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Shield,
} from "lucide-react";

type RolLite = { id_rol: number; rol?: string } | number | null | undefined;

type UsuarioLite = {
  id_usuario: number;
  email: string | null;
  usuario_email?: string | null;
  primer_nombre?: string | null;
  segundo_nombre?: string | null;
  primer_apellido?: string | null;
  segundo_apellido?: string | null;
  cedula?: string | null;
  sexo?: string | null;
  celular?: string | null;
  id_rol?: RolLite;
  rol_nombre?: string | null;
  is_active?: boolean | null;
  is_staff?: boolean | null;
  is_superuser?: boolean | null;
};

type MaybePage<T> = T[] | { results?: T[] };

function unwrap<T>(data: MaybePage<T>): T[] {
  return Array.isArray(data) ? data : data?.results ?? [];
}

function sexoLabel(code?: string | null) {
  if (code === "M") return "Masculino";
  if (code === "F") return "Femenino";
  return "—";
}

function getEmail(u: UsuarioLite) {
  return u.email || u.usuario_email || "—";
}

function isAdminClinicoRole(rol?: RolLite) {
  if (typeof rol === "number") return rol === 4;
  if (typeof rol === "object" && rol !== null) {
    const anyRol = rol as any;
    if (typeof anyRol?.id_rol === "number") return anyRol.id_rol === 4;
  }
  return false;
}

export default function AdminGestion() {
  const navigate = useNavigate();
  const [lista, setLista] = useState<UsuarioLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<"todos" | "activos" | "inactivos">(
    "todos"
  );

  const cargar = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/usuarios/");
      const all = unwrap<UsuarioLite>(data);
      const adminsClinicos = all.filter(
        (u) => isAdminClinicoRole(u.id_rol) && !u.is_superuser
      );
      setLista(adminsClinicos);
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          "No se pudo cargar la lista de administradores."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const limpiarFiltros = () => {
    setQ("");
    setEstado("todos");
  };

  const filtrados = useMemo(() => {
    const term = q.trim().toLowerCase();

    const base = lista.filter((u) => {
      const fullName = [
        u.primer_nombre,
        u.segundo_nombre,
        u.primer_apellido,
        u.segundo_apellido,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchTexto =
        term.length === 0 ||
        fullName.includes(term) ||
        (u.cedula || "").toLowerCase().includes(term);

      const matchEstado =
        estado === "todos" ||
        (estado === "activos" && !!u.is_active) ||
        (estado === "inactivos" && !u.is_active);

      return matchTexto && matchEstado;
    });

    return base.sort((a, b) => {
      const apA = [a.primer_apellido, a.segundo_apellido]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const apB = [b.primer_apellido, b.segundo_apellido]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return apA.localeCompare(apB);
    });
  }, [q, estado, lista]);

  const total = filtrados.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, total);

  const currentRows = useMemo(
    () => filtrados.slice(startIndex, endIndex),
    [filtrados, startIndex, endIndex]
  );

  const goFirst = () => setPage(1);
  const goPrev = () => setPage((p) => Math.max(1, p - 1));
  const goNext = () => setPage((p) => Math.min(totalPages, p + 1));
  const goLast = () => setPage(totalPages);

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex items-center gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="size-6" />
          Gestión de Administradores
        </h1>

        <div className="ml-auto flex items-center gap-2">
          {/* Botón volver */}
          <button
            type="button"
            onClick={() => navigate("/admin/configuracion")}
            className="inline-flex items-center gap-2 rounded-lg border border-black bg-white text-black px-3 py-2 hover:bg-gray-100"
          >
            <ArrowLeft className="size-4" />
            Volver
          </button>

          <Link
            to="/admin/usuarios/nuevo?rol=admin"
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-2 shadow hover:bg-black/80"
          >
            <Plus className="size-4" />
            Agregar administrador
          </Link>
        </div>
      </header>

      <p className="text-gray-600">
        Lista de administradores de la clínica (excluye el superusuario).
      </p>

      {/* Filtros */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        {/* Buscar */}
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre o cédula…"
            className="w-full rounded-lg border border-black bg-white pl-9 pr-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Estado */}
        <select
          value={estado}
          onChange={(e) =>
            setEstado(e.target.value as "todos" | "activos" | "inactivos")
          }
          className="rounded-lg border border-black bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="todos">Estado: Todos</option>
          <option value="activos">Estado: Activos</option>
          <option value="inactivos">Estado: Inactivos</option>
        </select>

        {/* Limpiar */}
        <button
          onClick={limpiarFiltros}
          className="inline-flex items-center gap-2 rounded-lg border border-black bg-white text-black px-3 py-2 hover:bg-gray-100"
          title="Limpiar filtros"
        >
          <Eraser className="size-4" />
          Limpiar
        </button>
      </div>

      {/* Tabla */}
      <div className="rounded-xl bg-white shadow-md overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-black font-bold border-b border-black">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Cédula</th>
              <th className="px-4 py-3 text-left font-medium">Apellidos</th>
              <th className="px-4 py-3 text-left font-medium">Nombres</th>
              <th className="px-4 py-3 text-left font-medium">Sexo</th>
              <th className="px-4 py-3 text-left font-medium">Celular</th>
              <th className="px-4 py-3 text-left font-medium">Correo</th>
              <th className="px-4 py-3 text-left font-medium">Estado</th>
              <th className="px-4 py-3 text-left font-medium">Permisos Admin</th>
              <th className="px-4 py-3 text-left font-medium">Acción</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-200">
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center">
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && currentRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-gray-500">
                  No se encontraron administradores con esos filtros.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              currentRows.map((u) => {
                const nombres = [u.primer_nombre, u.segundo_nombre]
                  .filter(Boolean)
                  .join(" ");
                const apellidos = [u.primer_apellido, u.segundo_apellido]
                  .filter(Boolean)
                  .join(" ");
                
                // Convertir celular de E.164 a formato local para mostrar
                const celularMostrar = e164ToLocal(u.celular);

                return (
                  <tr key={u.id_usuario} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{u.cedula || "—"}</td>
                    <td className="px-4 py-3">{apellidos || "—"}</td>
                    <td className="px-4 py-3">{nombres || "—"}</td>
                    <td className="px-4 py-3">{sexoLabel(u.sexo)}</td>
                    <td className="px-4 py-3">{celularMostrar || "—"}</td>
                    <td className="px-4 py-3">{getEmail(u)}</td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200">
                          Activo
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.is_staff ? (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                          ✓ Activos
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-orange-200">
                          ✕ Desactivados
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/admin/usuarios/${u.id_usuario}`}
                          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
                        >
                          <Eye className="size-4" />
                          Ver
                        </Link>
                        <Link
                          to={`/admin/usuarios/${u.id_usuario}/editar`}
                          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
                        >
                          <Pencil className="size-4" />
                          Editar
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        {/* Paginación */}
        {!loading && !error && total > 0 && (
          <div className="px-4 py-3 border-t bg-gray-100 flex items-center justify-between">
            {/* Izquierda: total */}
            <div className="text-sm text-gray-700">
              Administradores totales:{" "}
              <span className="font-semibold">{total}</span>
            </div>

            {/* Centro: controles */}
            <div className="flex items-center gap-1">
              <button
                onClick={goFirst}
                disabled={safePage === 1}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                title="Primera página"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                onClick={goPrev}
                disabled={safePage === 1}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                title="Anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 text-sm">
                Página <span className="font-semibold">{safePage}</span> de{" "}
                <span className="font-semibold">{totalPages}</span>
              </span>
              <button
                onClick={goNext}
                disabled={safePage === totalPages}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                title="Siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={goLast}
                disabled={safePage === totalPages}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                title="Última página"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>

            {/* Derecha: conteo en la página */}
            <div className="text-sm text-gray-700 font-medium">
              Mostrando {currentRows.length} de {PAGE_SIZE}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}