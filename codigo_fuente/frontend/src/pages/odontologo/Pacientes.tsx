// src/pages/odontologo/Pacientes.tsx
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
import { useAuth } from "../../context/AuthContext";

/* ---------- Tipo que renderiza la tabla ---------- */
type PacienteFlat = {
  id_paciente: string;
  cedula: string;
  primer_nombre: string;
  segundo_nombre?: string | null;
  primer_apellido: string;
  segundo_apellido?: string | null;
  sexo: string;
  celular: string;
  email: string;
  activo: boolean;
};

const PAGE_SIZE = 10;

/* ---------- Helper DRF para paginación ---------- */
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
      next = null;
    } else {
      out.push(...((data?.results ?? []) as T[]));
      next = data?.next ?? null;
    }
    page++;
  }
  return out;
}

/* ===== Acciones ===== */
function AccionesPaciente({ id }: { id: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link
        to={`/odontologo/pacientes/${id}`}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-gray-50"
        title="Ver detalles"
      >
        <Eye className="size-4" />
        Ver
      </Link>

      <Link
        to={`/odontologo/pacientes/${id}/editar`}
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
  const { usuario } = useAuth();

  const odontologoId: number | null =
    (usuario as any)?.odontologo?.id_odontologo ??
    (usuario as any)?.id_odontologo ??
    null;

  const [pacientes, setPacientes] = useState<PacienteFlat[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [fNombre, setFNombre] = useState("");
  const [fCedula, setFCedula] = useState("");

  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!odontologoId) {
      setErr("No se pudo determinar el id_odontologo del usuario.");
      setPacientes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr("");
    try {
      // 1) Obtener citas del odontólogo
      const citas = await fetchAll<any>("/citas/", {
        id_odontologo: odontologoId,
        page_size: 200,
      });

      // 2) IDs únicos de pacientes
      const idsPacientes = Array.from(
        new Set(citas.map((c) => Number(c.id_paciente)).filter(Boolean))
      );

      if (idsPacientes.length === 0) {
        setPacientes([]);
        return;
      }

      // 3) Traer detalles de cada paciente
      const planos: PacienteFlat[] = await Promise.all(
        idsPacientes.map(async (idPac) => {
          let p: any = null;
          try {
            const { data } = await api.get(`/pacientes/${idPac}/`);
            p = data;
          } catch {
            return {
              id_paciente: String(idPac),
              cedula: "",
              primer_nombre: "",
              segundo_nombre: "",
              primer_apellido: "",
              segundo_apellido: "",
              sexo: "",
              celular: "",
              email: "",
              activo: false,
            };
          }

          const id_paciente = String(p.id_paciente ?? idPac);
          const idUsuario =
            p.id_usuario ?? p.usuario?.id_usuario ?? p.usuario_id ?? p.usuario;

          let uDet: any = null;
          const missingKeyFields =
            !p.cedula ||
            !p.sexo ||
            !(p.nombreCompleto || p.primer_nombre) ||
            !p.celular ||
            !p.usuario_email ||
            p.activo === undefined;

          if (idUsuario != null && missingKeyFields) {
            try {
              const { data: u } = await api.get(`/usuarios/${idUsuario}/`);
              uDet = u;
            } catch {
              uDet = null;
            }
          }

          const cedula = String(p.cedula ?? uDet?.cedula ?? "");
          const sexoRaw = p.sexo ?? uDet?.sexo ?? "";
          const sexo =
            String(sexoRaw).toUpperCase() === "M"
              ? "Masculino"
              : String(sexoRaw).toUpperCase() === "F"
              ? "Femenino"
              : String(sexoRaw || "");
          const celular = String(p.celular ?? uDet?.celular ?? "");
          const email =
            String(p.usuario_email ?? p.email ?? uDet?.email ?? "") || "";

          const primer_nombre = p.primer_nombre ?? uDet?.primer_nombre ?? "";
          const segundo_nombre = p.segundo_nombre ?? uDet?.segundo_nombre ?? "";
          const primer_apellido =
            p.primer_apellido ?? uDet?.primer_apellido ?? "";
          const segundo_apellido =
            p.segundo_apellido ?? uDet?.segundo_apellido ?? "";

          const activoRaw =
            p.activo ??
            p.estado ??
            p.is_active ??
            uDet?.activo ??
            uDet?.estado ??
            uDet?.is_active ??
            false;
          const activo =
            typeof activoRaw === "string"
              ? ["1", "true", "activo", "active", "act"].includes(
                  activoRaw.trim().toLowerCase()
                )
              : Boolean(activoRaw);

          return {
            id_paciente,
            cedula,
            primer_nombre,
            segundo_nombre,
            primer_apellido,
            segundo_apellido,
            sexo,
            celular,
            email,
            activo,
          };
        })
      );

      setPacientes(planos);
    } catch (e: any) {
      setErr(
        e?.response?.data?.detail ||
          "No se pudo cargar la lista de pacientes del odontólogo."
      );
      setPacientes([]);
    } finally {
      setLoading(false);
    }
  }, [odontologoId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtrados = useMemo(() => {
    const nom = fNombre.trim().toLowerCase();
    const ced = fCedula.trim();

    const base = pacientes.filter((p) => {
      const fullName = [
        p.primer_nombre,
        p.segundo_nombre,
        p.primer_apellido,
        p.segundo_apellido,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const okNom = !nom || fullName.includes(nom);
      const okCed = !ced || p.cedula.includes(ced);
      return okNom && okCed;
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
  }, [pacientes, fNombre, fCedula]);

  useEffect(() => {
    setPage(1);
  }, [fNombre, fCedula, pacientes.length]);

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
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          👤 Mis Pacientes
        </h1>
        <button
          onClick={() => navigate("nuevo")}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
        >
          <Plus className="w-4 h-4" />
          Agregar Paciente
        </button>
      </div>

      {/* Filtros */}
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
              const nombres = [p.primer_nombre, p.segundo_nombre]
                .filter(Boolean)
                .join(" ");
              const apellidos = [p.primer_apellido, p.segundo_apellido]
                .filter(Boolean)
                .join(" ");

              return (
                <tr key={p.id_paciente} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{p.cedula || "—"}</td>
                  <td className="px-4 py-3">{apellidos || "—"}</td>
                  <td className="px-4 py-3">{nombres || "—"}</td>
                  <td className="px-4 py-3">{p.sexo || "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.activo
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {p.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{p.celular || "—"}</td>
                  <td className="px-4 py-3">{p.email || "—"}</td>
                  <td className="px-4 py-3">
                    <AccionesPaciente id={p.id_paciente} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Paginación */}
        {!loading && total > 0 && (
          <div className="px-4 py-3 border-t bg-gray-100 flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Pacientes totales: <span className="font-semibold">{total}</span>
            </div>

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