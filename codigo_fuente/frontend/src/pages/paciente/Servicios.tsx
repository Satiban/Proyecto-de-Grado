// src/pages/paciente/Servicios.tsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api/axios";
import {
  BookOpen,
  Users,
  Search,
  Filter,
  Loader2,
  Building2,
  Info,
  Phone,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import TiltedCard from "../../components/TiltedCard";
import { e164ToLocal } from "../../utils/phoneFormat";

/* ====================== Tipos ====================== */
type Especialidad = {
  id_especialidad: number;
  nombre: string;
  estado?: boolean;
};

type EspecialidadDet = {
  id_especialidad?: number | null;
  nombre: string | null;
  universidad?: string | null;
  estado?: boolean | null;
};

type ProfesionalAPI = {
  id_odontologo: number;
  nombreCompleto?: string | null;
  nombre?: string | null;
  primer_nombre?: string | null;
  segundo_nombre?: string | null;
  primer_apellido?: string | null;
  segundo_apellido?: string | null;
  foto?: string | null;
  especialidades?: string[];
  especialidades_detalle?: EspecialidadDet[];
  consultorio?: { nombre?: string | null; numero?: string | null } | null;
  activo?: boolean;
  odontologo_activo?: boolean;
  is_active?: boolean;
};

/* ====================== Utils ====================== */
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

function buildFotoURL(foto?: string | null): string | null {
  if (!foto) return null;
  if (/^https?:\/\//i.test(foto)) return foto;
  const base = API_BASE.endsWith("/api/v1")
    ? API_BASE.replace(/\/api\/v1\/?$/, "")
    : API_BASE;
  return `${base}${foto.startsWith("/") ? foto : `/${foto}`}`;
}

function nombreProfesional(p: ProfesionalAPI): string {
  if (p.nombreCompleto && p.nombreCompleto.trim())
    return p.nombreCompleto.trim();
  if (p.nombre && p.nombre.trim()) return p.nombre.trim();
  const partes = [p.primer_nombre, p.primer_apellido].filter(Boolean);
  const fallback = partes.join(" ").trim();
  return fallback || "Odontólogo/a";
}

function iniciales(p: ProfesionalAPI): string {
  const n = nombreProfesional(p).split(/\s+/);
  const letras = (n[0]?.[0] || "") + (n[1]?.[0] || "");
  return (letras || "OD").toUpperCase();
}

function uniqStrings(arr: (string | null | undefined)[]): string[] {
  return Array.from(new Set(arr.filter(Boolean) as string[]));
}

/* ====================== Componente ====================== */
const Servicios: React.FC = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profesionales, setProfesionales] = useState<ProfesionalAPI[]>([]);
  const [especialidades, setEspecialidades] = useState<Especialidad[]>([]);

  const [q, setQ] = useState("");
  const [espSel, setEspSel] = useState<number | "todas">("todas");

  const [config, setConfig] = useState<any | null>(null);

  useEffect(() => {
    api
      .get("/configuracion/")
      .then((res) => setConfig(res.data))
      .catch(() => setConfig(null));
  }, []);

  const celularLocal = e164ToLocal(config?.celular_contacto);

  useEffect(() => {
    let isMounted = true;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [rPro, rEsp] = await Promise.all([
          api.get("/odontologos/", {
            params: { estado: true, page_size: 1000 },
          }),
          api.get("/especialidades/", {
            params: { estado: true, page_size: 1000 },
          }),
        ]);

        if (!isMounted) return;

        const pros = Array.isArray(rPro.data)
          ? rPro.data
          : rPro.data?.results || [];
        const esps = Array.isArray(rEsp.data)
          ? rEsp.data
          : rEsp.data?.results || [];

        const prosActivos = pros.filter((p: ProfesionalAPI) => {
          const odontActivo =
            p.odontologo_activo !== undefined
              ? p.odontologo_activo
              : p.activo !== false;
          const usuarioActivo = p.is_active !== false;
          return odontActivo && usuarioActivo;
        });

        setProfesionales(prosActivos);
        setEspecialidades(esps);
      } catch {
        setError("No se pudo cargar el catálogo de servicios.");
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    fetchData();
    return () => {
      isMounted = false;
    };
  }, []);

  /* ======= Especialidades (solo para filtro) ======= */
  const opcionesEspecialidad = useMemo(() => {
    if (especialidades.length > 0) return especialidades;

    const nombres = uniqStrings(
      profesionales.flatMap((p) => {
        if (p.especialidades?.length) return p.especialidades;
        if (p.especialidades_detalle?.length)
          return p.especialidades_detalle
            .map((d) => d.nombre || "")
            .filter(Boolean);
        return [];
      })
    );
    return nombres.map((nombre, i) => ({
      id_especialidad: 100000 + i,
      nombre,
    }));
  }, [especialidades, profesionales]);

  /* ======= Filtrado de profesionales ======= */
  const listaFiltrada = useMemo(() => {
    const qNorm = q.trim().toLowerCase();
    return profesionales.filter((p) => {
      const n = nombreProfesional(p).toLowerCase();
      const pasaNombre = qNorm ? n.includes(qNorm) : true;

      if (espSel !== "todas") {
        const target = opcionesEspecialidad.find(
          (e) => e.id_especialidad === espSel
        )?.nombre;
        if (target) {
          const plano = (p.especialidades || []).map((x) =>
            (x || "").toLowerCase()
          );
          const det = (p.especialidades_detalle || [])
            .map((d) => (d.nombre || "").toLowerCase())
            .filter(Boolean);
          const todas = new Set([...plano, ...det]);
          if (!todas.has(target.toLowerCase())) return false;
        }
      }
      return pasaNombre;
    });
  }, [profesionales, q, espSel, opcionesEspecialidad]);

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <BookOpen className="h-7 w-7" /> Servicios
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Conoce el equipo profesional con el que cuenta la clínica.
          </p>
        </div>

        {/* KPI simple */}
        <div className="rounded-xl bg-white shadow px-4 py-2">
          <div className="text-xs text-gray-500">Profesionales</div>
          <div className="text-lg font-semibold text-gray-800">
            {profesionales.length}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-xl bg-white shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-gray-600 mb-1 block">
              Buscar por nombre
            </label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2"
                size={18}
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ej. Juan Pérez"
                className="w-full rounded-lg border pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">
              Filtrar por especialidad
            </label>
            <div className="relative">
              <Filter
                className="absolute left-3 top-1/2 -translate-y-1/2"
                size={18}
              />
              <select
                className="w-full rounded-lg border pl-9 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                value={espSel}
                onChange={(e) =>
                  setEspSel(
                    e.target.value === "todas"
                      ? "todas"
                      : Number(e.target.value)
                  )
                }
              >
                <option value="todas">Todas</option>
                {opcionesEspecialidad.map((e) => (
                  <option key={e.id_especialidad} value={e.id_especialidad}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-600">
          <Loader2 className="animate-spin" /> Cargando servicios…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 p-3 rounded-lg">
          <Info /> {error}
        </div>
      ) : listaFiltrada.length === 0 ? (
        <div className="rounded-xl bg-white shadow p-6 text-center text-gray-600">
          No se encontraron profesionales con los filtros aplicados.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 px-2 py-4 overflow-hidden">
          {listaFiltrada.map((p) => {
            const foto = buildFotoURL(p.foto);
            const detOrdenadas = [...(p.especialidades_detalle ?? [])].sort(
              (a, b) =>
                (a?.nombre ?? "").localeCompare(b?.nombre ?? "", "es", {
                  sensitivity: "base",
                })
            );

            return (
              <TiltedCard
                key={p.id_odontologo}
                captionText={nombreProfesional(p)}
                scaleOnHover={1.0}
                rotateAmplitude={12}
                showTooltip={true}
                displayOverlayContent={true}
                overlayContent={
                  <div className="rounded-2xl p-2 transition-all duration-300 hover:bg-blue-50/95 hover:border-blue-200/40">
                    <div className="flex items-center gap-3">
                    <div className="pl-3 pt-2">
                        {foto ? (
                          <img
                            src={foto}
                            alt={nombreProfesional(p)}
                            className="h-35 w-35 rounded-full object-cover border-2 border-white flex-shrink-0 transition-all duration-300 hover:border-blue-300"
                          />
                        ) : (
                          <div className="h-35 w-35 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0 transition-all duration-300 hover:from-blue-500 hover:to-blue-700">
                            {iniciales(p)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-base text-gray-900 truncate transition-colors duration-300 hover:text-blue-700">
                          {nombreProfesional(p)}
                        </h3>
                        <div className="text-sm text-gray-700 flex items-center gap-1 font-medium transition-colors duration-300 hover:text-blue-600">
                          <Users size={14} />
                          Profesional de la clínica
                        </div>
                      </div>
                    </div>
                  </div>
                }
              >
                <article className="rounded-2xl bg-white shadow transition-all duration-300 hover:shadow-xl hover:shadow-blue-100/50 hover:ring-2 hover:ring-blue-200/60 p-4 flex flex-col h-full">
                  {/* Placeholder invisible para reservar espacio del overlay */}
                  <div className="flex items-center gap-3 mb-4 opacity-0 pointer-events-none">
                    <div className="h-12 w-12 rounded-full flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="h-4 w-full mb-1" />
                      <div className="h-3 w-3/4" />
                    </div>
                  </div>
                  {/* Especialidades (detalle con "Atiende/No atiende", como en Perfil) */}
                  <div className="mt-22">
                    <div className="text-sm font-medium mb-1">
                      Especialidades
                    </div>
                    <ul className="space-y-1">
                      {detOrdenadas.length > 0 ? (
                        detOrdenadas.map((e, idx) => {
                          const nombreEsp = e?.nombre || "Odontología general";
                          const atiende = e?.estado !== false;
                          return (
                            <li key={idx} className="text-base text-gray-700">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  • {nombreEsp}
                                  <div className="text-sm text-gray-500 ml-4">
                                    {e?.universidad ? e.universidad : "—"}
                                  </div>
                                </div>
                                <span
                                  className={[
                                    "shrink-0 px-3 py-1 rounded border text-[15px] mt-0.5 font-semibold",
                                    atiende
                                      ? "bg-green-100 text-green-800 border-green-200"
                                      : "bg-gray-200 text-gray-700 border-gray-300",
                                  ].join(" ")}
                                >
                                  {atiende ? "Atiende" : "No atiende"}
                                </span>
                              </div>
                            </li>
                          );
                        })
                      ) : (
                        // Fallback si no viene especialidades_detalle: muestra genérico
                        <li className="text-base text-gray-700">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              • Odontología general
                              <div className="text-sm text-gray-500 ml-4">
                                —
                              </div>
                            </div>
                            <span className="shrink-0 px-3 py-1 rounded border text-[15px] mt-0.5 font-semibold bg-green-100 text-green-800 border-green-200">
                              Atiende
                            </span>
                          </div>
                        </li>
                      )}
                    </ul>
                  </div>

                  {/* Consultorio (si viene) */}
                  {p.consultorio &&
                    (p.consultorio.nombre || p.consultorio.numero) && (
                      <div className="mt-2 text-sm text-gray-700 flex items-center gap-2">
                        <Building2 size={16} />
                        <span className="truncate">
                          {p.consultorio.nombre || "Consultorio"}{" "}
                          {p.consultorio.numero
                            ? `• Nº ${p.consultorio.numero}`
                            : ""}
                        </span>
                      </div>
                    )}

                  {/* Pie informativo */}
                  <div className="mt-4 pt-3 border-t text-xs text-gray-500 flex items-center gap-2">
                    <BookOpen size={14} /> Sección informativa
                  </div>
                </article>
              </TiltedCard>
            );
          })}
        </div>
      )}

      {/* Nota informativa */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 text-blue-900 p-4 flex items-start gap-3">
        <Info className="mt-0.5 shrink-0" />
        <div className="text-sm space-y-2">
          <p>
            Esta sección es solo informativa. Para reservar un turno, ve a{" "}
            <button
              className="underline font-medium hover:opacity-80"
              onClick={() => navigate("/paciente/mis-citas/agendar")}
            >
              Mis Citas → Agendar citas
            </button>
            .
          </p>
          {celularLocal && (
            <p className="flex items-center gap-2">
              <Phone size={14} className="shrink-0" />
              <span>
                Si deseas llamar al consultorio:{" "}
                <a
                  href={`tel:${celularLocal}`}
                  className="font-semibold underline hover:opacity-80"
                >
                  {celularLocal}
                </a>
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Servicios;