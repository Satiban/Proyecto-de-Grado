// src/pages/admin/Odontologos.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  Eye,
  Pencil,
  Eraser,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { AxiosResponse } from "axios";
import { api } from "../../api/axios";

// ---------- Tipos planos que renderiza la tabla ----------
type OdontoFlat = {
  id_odontologo: number;
  nombreCompleto: string;
  cedula: string | null;
  sexo: string | null;
  is_active: boolean; // Estado del Usuario
  odontologo_activo: boolean; // Estado del Odontólogo
  especialidades: string[];
};

// DRF: helper para traer todas las páginas
async function fetchAll<T = any>(
  url: string,
  params?: Record<string, any>
): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  let page = 1;

  while (next) {
    const res: AxiosResponse<any> = await api.get(next, {
      params: page === 1 ? params : undefined,
    });
    const data = res.data;
    if (Array.isArray(data)) {
      out.push(...(data as T[]));
      next = null; // sin paginación
    } else {
      out.push(...((data?.results ?? []) as T[]));
      next = data?.next ?? null;
    }
    page++;
  }
  return out;
}

/* ===== Componente de Acciones (estandarizado) ===== */
function AccionesOdontologo({ id }: { id: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link
        to={`/admin/odontologos/${id}`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Ver detalles"
      >
        <Eye className="size-4" />
        Ver
      </Link>

      <Link
        to={`/admin/odontologos/${id}/editar`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Editar"
      >
        <Pencil className="size-4" />
        Editar
      </Link>
    </div>
  );
}

const PAGE_SIZE = 10;

// ---------- Componente ----------
const Odontologos = () => {
  const navigate = useNavigate();

  const [odontologos, setOdontologos] = useState<OdontoFlat[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // filtros
  const [fNombre, setFNombre] = useState("");
  const [fCedula, setFCedula] = useState("");
  const [fEsp, setFEsp] = useState("");

  // paginación
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const base = await fetchAll<OdontoFlat>("/odontologos/");
      setOdontologos(base);
    } catch (e: any) {
      console.error("Error cargando odontólogos:", e);
      setErr(
        e?.response?.data?.detail ||
          "No se pudo cargar la lista de odontólogos."
      );
      setOdontologos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const especialidades = useMemo(() => {
    const s = new Set<string>();
    odontologos.forEach((o) => o.especialidades.forEach((e) => e && s.add(e)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [odontologos]);

  const filtrados = useMemo(() => {
    const list = odontologos.filter((o) => {
      const fullName = (o.nombreCompleto || "").toLowerCase();

      const okNom = !fNombre || fullName.includes(fNombre.toLowerCase());
      const okCed = !fCedula || (o.cedula ?? "").includes(fCedula);
      const okEsp = !fEsp || o.especialidades.includes(fEsp);

      return okNom && okCed && okEsp;
    });

    // ordenar por apellido → usamos nombreCompleto y tomamos últimas dos palabras como apellidos
    return list.sort((a, b) => {
      const apA = a.nombreCompleto.split(" ").slice(-2).join(" ").toLowerCase();
      const apB = b.nombreCompleto.split(" ").slice(-2).join(" ").toLowerCase();
      return apA.localeCompare(apB);
    });
  }, [odontologos, fNombre, fCedula, fEsp]);

  // Reset de página cuando cambian filtros o el total
  useEffect(() => {
    setPage(1);
  }, [fNombre, fCedula, fEsp, odontologos.length]);

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

  const limpiarFiltros = () => {
    setFNombre("");
    setFCedula("");
    setFEsp("");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          👨‍⚕️ Odontólogos
        </h1>
        <button
          onClick={() => navigate("nuevo")}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
        >
          <Plus className="w-4 h-4" />
          Agregar Odontólogo
        </button>
      </div>

      {/* Filtros + Limpiar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
        <div className="relative sm:col-span-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
          <input
            value={fNombre}
            onChange={(e) => setFNombre(e.target.value)}
            placeholder="Ingrese el nombre"
            className="w-full pl-9 pr-3 py-2 border rounded-lg bg-white"
          />
        </div>
        <div className="relative sm:col-span-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
          <input
            value={fCedula}
            onChange={(e) => setFCedula(e.target.value.replace(/\D/g, ""))}
            placeholder="Ingrese la cédula"
            className="w-full pl-9 pr-3 py-2 border rounded-lg bg-white"
            inputMode="numeric"
            maxLength={10}
          />
        </div>
        <div className="sm:col-span-1">
          <select
            value={fEsp}
            onChange={(e) => setFEsp(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg bg-white"
          >
            <option value="">Especialidades</option>
            {especialidades.map((esp) => (
              <option key={esp} value={esp}>
                {esp}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-1 flex justify-end">
          <button
            onClick={limpiarFiltros}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-white hover:bg-gray-50"
            title="Limpiar"
          >
            <Eraser className="w-4 h-4" />
            Limpiar
          </button>
        </div>
      </div>

      {/* Mensaje de error */}
      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* Tabla */}
      <div className="rounded-xl bg-white shadow-md overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-black font-bold border-b border-black">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Cédula</th>
              <th className="px-4 py-3 text-left font-medium">Apellidos</th>
              <th className="px-4 py-3 text-left font-medium">Nombres</th>
              <th className="px-4 py-3 text-left font-medium">Sexo</th>
              <th className="px-4 py-3 text-left font-medium">Estado</th>
              <th className="px-4 py-3 text-left font-medium">
                Especialidades
              </th>
              <th className="px-4 py-3 text-left font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {currentRows.map((o) => (
              <tr key={o.id_odontologo} className="hover:bg-gray-50">
                <td className="px-4 py-3">{o.cedula || "—"}</td>
                <td className="px-4 py-3">
                  {/* Apellidos: toma del nombre completo */}
                  {o.nombreCompleto.split(" ").slice(-2).join(" ") || "—"}
                </td>
                <td className="px-4 py-3">
                  {/* Nombres: toma del nombre completo */}
                  {o.nombreCompleto.split(" ").slice(0, 2).join(" ") || "—"}
                </td>
                <td className="px-4 py-3">
                  {o.sexo === "M"
                    ? "Masculino"
                    : o.sexo === "F"
                    ? "Femenino"
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      o.odontologo_activo
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {o.odontologo_activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {o.especialidades.length ? o.especialidades.join(", ") : "—"}
                </td>
                <td className="px-4 py-3">
                  <AccionesOdontologo id={String(o.id_odontologo)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Paginación */}
        {!loading && total > 0 && (
          <div className="px-4 py-3 border-t bg-gray-100 flex items-center justify-between">
            {/* Izquierda: total */}
            <div className="text-sm text-gray-700">
              Odontólogos totales:{" "}
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
};

export default Odontologos;
