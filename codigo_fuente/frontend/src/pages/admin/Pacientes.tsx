// src/pages/admin/Pacientes.tsx
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
import { e164ToLocal } from "../../utils/phoneFormat";

/* ---------- Tipo que renderiza la tabla ---------- */
type PacienteFlat = {
  id_paciente: number;
  nombreCompleto: string;
  cedula: string | null;
  sexo: string | null;
  celular: string | null;
  usuario_email: string | null;
  is_active: boolean;
  contacto_emergencia_cel: string | null;
  contacto_emergencia_email: string | null;
  fecha_nacimiento: string | null;
};

const PAGE_SIZE = 10;

/* ---------- DRF helper para traer todas las páginas ---------- */
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
function AccionesPaciente({ id }: { id: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link
        to={`/admin/pacientes/${id}`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Ver detalles"
      >
        <Eye className="size-4" />
        Ver
      </Link>

      <Link
        to={`/admin/pacientes/${id}/editar`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Editar"
      >
        <Pencil className="size-4" />
        Editar
      </Link>
    </div>
  );
}

/* ---------- Componente ---------- */
const Pacientes = () => {
  const navigate = useNavigate();

  const [pacientes, setPacientes] = useState<PacienteFlat[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // filtros
  const [fNombre, setFNombre] = useState("");
  const [fCedula, setFCedula] = useState("");

  // paginación
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const base = await fetchAll<PacienteFlat>("/pacientes/");
      setPacientes(base);
    } catch (e: any) {
      console.error("Error cargando pacientes:", e);
      setErr(
        e?.response?.data?.detail || "No se pudo cargar la lista de pacientes."
      );
      setPacientes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtrados = useMemo(() => {
    const nom = fNombre.trim().toLowerCase();
    const ced = fCedula.trim();

    const base = pacientes.filter((p) => {
      const fullName = (p.nombreCompleto || "").toLowerCase();
      const okNom = !nom || fullName.includes(nom);
      const okCed = !ced || (p.cedula ?? "").includes(ced);
      return okNom && okCed;
    });

    return base.sort((a, b) => {
      const apA = a.nombreCompleto.split(" ").slice(-2).join(" ").toLowerCase();
      const apB = b.nombreCompleto.split(" ").slice(-2).join(" ").toLowerCase();
      return apA.localeCompare(apB);
    });
  }, [pacientes, fNombre, fCedula]);

  // Reset de página cuando cambian filtros o el total
  useEffect(() => {
    setPage(1);
  }, [fNombre, fCedula, pacientes.length]);

  // Derivados de paginación
  const total = filtrados.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, total);

  const currentRows = useMemo(
    () => filtrados.slice(startIndex, endIndex),
    [filtrados, startIndex, endIndex]
  );

  // Handlers
  const goFirst = () => setPage(1);
  const goPrev = () => setPage((p) => Math.max(1, p - 1));
  const goNext = () => setPage((p) => Math.min(totalPages, p + 1));
  const goLast = () => setPage(totalPages);

  const limpiarFiltros = () => {
    setFNombre("");
    setFCedula("");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          👤 Pacientes
        </h1>
        <button
          onClick={() => navigate("nuevo")}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
        >
          <Plus className="w-4 h-4" />
          Agregar Paciente
        </button>
      </div>

      {/* Filtros + Limpiar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
          <input
            value={fNombre}
            onChange={(e) => setFNombre(e.target.value)}
            placeholder="Ingrese el nombre"
            className="w-full pl-9 pr-3 py-2 border rounded-lg bg-white"
          />
        </div>

        <div className="relative">
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

        <div className="flex sm:justify-end">
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
              <th className="px-4 py-3 text-left font-medium">Celular</th>
              <th className="px-4 py-3 text-left font-medium">Correo</th>
              <th className="px-4 py-3 text-left font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {currentRows.map((p) => {
              const nombres = p.nombreCompleto.split(" ").slice(0, 2).join(" ");
              const apellidos = p.nombreCompleto.split(" ").slice(-2).join(" ");
              
              // Mostrar celular de emergencia si no tiene propio
              const celularMostrar = e164ToLocal(p.celular || p.contacto_emergencia_cel || "") || "—";
              
              // Filtrar emails del sistema (formato: cedula###...@oralflow.system)
              const esEmailSistema = p.usuario_email?.includes("@oralflow.system");
              let emailMostrar = "—";
              if (p.usuario_email && !esEmailSistema) {
                emailMostrar = p.usuario_email;
              } else if (p.contacto_emergencia_email) {
                emailMostrar = p.contacto_emergencia_email;
              }
              
              // Calcular si es menor de edad (< 18 años)
              const esMenor = p.fecha_nacimiento 
                ? new Date().getFullYear() - new Date(p.fecha_nacimiento).getFullYear() < 18
                : false;

              return (
                <tr key={p.id_paciente} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{p.cedula || "—"}</td>
                  <td className="px-4 py-3">{apellidos || "—"}</td>
                  <td className="px-4 py-3">{nombres || "—"}</td>
                  <td className="px-4 py-3">
                    {p.sexo === "M"
                      ? "Masculino"
                      : p.sexo === "F"
                      ? "Femenino"
                      : "—"}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium w-fit ${
                          p.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {p.is_active ? "Activo" : "Inactivo"}
                      </span>
                      {esMenor && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 w-fit">
                          Menor
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">{celularMostrar}</td>
                  <td className="px-4 py-3">{emailMostrar}</td>
                  <td className="px-4 py-3">
                    <AccionesPaciente id={String(p.id_paciente)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Paginación (franja gris, centrada, solo flechas + “Página X de Y”) */}
        {!loading && total > 0 && (
          <div className="px-4 py-3 border-t bg-gray-100 flex items-center justify-between">
            {/* Izquierda: total */}
            <div className="text-sm text-gray-700">
              Pacientes totales: <span className="font-semibold">{total}</span>
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

export default Pacientes;
