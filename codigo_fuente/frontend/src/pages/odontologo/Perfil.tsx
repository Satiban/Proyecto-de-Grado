// src/pages/odontologo/Perfil.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import {
  Pencil,
  User,
  IdCard,
  CalendarDays,
  Droplet,
  Phone,
  Mail,
  GraduationCap,
  Briefcase,
  Clock,
  Mars,
  Venus,
} from "lucide-react";

/* ===== Tipos ===== */
type Odontologo = {
  id_odontologo: number;
  cedula: string;
  nombreCompleto?: string;
  primer_nombre?: string | null;
  segundo_nombre?: string | null;
  primer_apellido?: string | null;
  segundo_apellido?: string | null;
  sexo?: string | null;
  activo?: boolean;
  foto?: string | null;
  fecha_nacimiento?: string | null;
  tipo_sangre?: string | null;
  celular?: string | null;
  usuario_email?: string | null;
  especialidades?: string[];
  especialidades_detalle?: {
    nombre: string | null;
    universidad?: string | null;
    estado?: boolean;
  }[];
  consultorio_defecto?: { id_consultorio: number; numero: string } | null;
  horarios?: {
    dia_semana: number; // 0=Lun..6=Dom
    hora_inicio: string; // "HH:MM"
    hora_fin: string; // "HH:MM"
    vigente?: boolean;
  }[];
};

/* ===== Utils de presentación ===== */
function absolutize(url?: string | null) {
  if (!url) return null;
  try {
    new URL(url);
    return url;
  } catch {}
  const base = (api.defaults as any)?.baseURL ?? "";
  let origin = "";
  try {
    origin = new URL(base).origin;
  } catch {
    origin = window.location.origin;
  }
  return `${origin.replace(/\/$/, "")}/${String(url).replace(/^\//, "")}`;
}
function sexoLabel(s?: string | null) {
  if (!s) return "—";
  const u = s.toUpperCase();
  return u === "M" ? "Masculino" : u === "F" ? "Femenino" : s;
}
function sexoIcon(s?: string | null) {
  if (!s) return null;
  const u = s.toUpperCase();
  if (u === "M") return <Mars className="h-4 w-4" />;
  if (u === "F") return <Venus className="h-4 w-4" />;
  return null;
}
function tipoSangreLabel(s?: string | null) {
  return s ? s.toUpperCase() : "—";
}
function formatFechaLocalYMD(iso?: string | null) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.slice(0, 10));
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
  }).format(d);
}
const DIAS: Record<number, string> = {
  0: "Lun",
  1: "Mar",
  2: "Mié",
  3: "Jue",
  4: "Vie",
  5: "Sáb",
  6: "Dom",
};
const ORDEN_SEMANA = [0, 1, 2, 3, 4, 5, 6];

/* ===== UI helpers ===== */
function Card({
  title,
  icon,
  children,
  right,
}: {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const showHeader = Boolean(title || icon || right);
  return (
    <div className="rounded-2xl p-4 shadow-md bg-white">
      {showHeader && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            {icon} {title}
          </h3>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function InfoRow({
  label,
  value,
  icon,
}: {
  label: string;
  value?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm leading-6">
      {icon ? <span className="text-gray-500">{icon}</span> : null}
      <span className="text-gray-600">{label}:</span>
      <span className="font-medium text-gray-900">{value ?? "—"}</span>
    </div>
  );
}

/* ===== Página ===== */
export default function Perfil() {
  const navigate = useNavigate();
  const { usuario } = (useAuth?.() as any) ?? { usuario: null };

  const guessedId: number | null =
    (usuario as any)?.odontologo?.id_odontologo ??
    (usuario as any)?.id_odontologo ??
    null;

  // seed con contexto para que no parpadee, pero igual haremos refetch
  const [odo, setOdo] = useState<Odontologo | null>(
    (usuario as any)?.odontologo ?? null
  );
  const [loading, setLoading] = useState(!odo);
  const [err, setErr] = useState<string | null>(null);

  const nombreCompleto = useMemo(() => {
    if (!odo) return "—";
    if (odo.nombreCompleto?.trim()) return odo.nombreCompleto;
    return (
      [
        odo.primer_nombre,
        odo.segundo_nombre,
        odo.primer_apellido,
        odo.segundo_apellido,
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim() || "—"
    );
  }, [odo]);

  /* Refetch SIEMPRE al montar / cambiar guessedId */
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        const url = guessedId
          ? `/odontologos/${guessedId}/`
          : `/odontologos/me`;
        const { data } = await api.get(url, { signal: ctrl.signal as any });
        setOdo({
          ...data,
          nombreCompleto:
            data.nombreCompleto ??
            [
              data.primer_nombre,
              data.segundo_nombre,
              data.primer_apellido,
              data.segundo_apellido,
            ]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim(),
          foto: absolutize(data.foto),
        });
      } catch (e: any) {
        if (e?.name !== "CanceledError") {
          console.error(e);
          setErr(e?.response?.data?.detail || "No se pudo cargar tu perfil.");
          setOdo(null);
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [guessedId]);

  /* Horario semanal agrupado */
  const weekSchedule = useMemo(() => {
    const base = (odo?.horarios ?? []).filter((h) => h.vigente !== false);
    return base.reduce<Record<number, { inicio: string; fin: string }[]>>(
      (acc, h) => {
        const arr = acc[h.dia_semana] ?? [];
        arr.push({ inicio: h.hora_inicio, fin: h.hora_fin });
        acc[h.dia_semana] = arr;
        return acc;
      },
      {}
    );
  }, [odo?.horarios]);

  const renderSlots = (day: number) => {
    const slots = weekSchedule[day];
    if (!slots || slots.length === 0)
      return <span className="text-gray-500">No atiende</span>;
    return (
      <span className="tabular-nums">
        {slots.map((s, i) => (
          <span key={i}>
            {s.inicio} - {s.fin}
            {i < slots.length - 1 ? ", " : ""}
          </span>
        ))}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* <-- sin padding, igual a Inicio.tsx */}
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">👤 Mi perfil</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/odontologo/perfil/editar")}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-1.5 text-sm shadow hover:bg-black/80"
            title="Editar perfil"
          >
            <Pencil className="h-4 w-4" /> Editar
          </button>
        </div>
      </div>

      {/* Error */}
      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* ====== DOS CARDS ====== */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Card 1: Datos personales */}
        <Card title="Datos personales" icon={<User className="h-5 w-5" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Foto + Estado */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-44 h-44 overflow-hidden rounded-full bg-gray-50 border">
                {loading ? (
                  <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                    Cargando...
                  </div>
                ) : odo?.foto ? (
                  <img
                    src={odo.foto}
                    alt="Foto de perfil"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
                    Sin foto
                  </div>
                )}
              </div>

              {loading ? null : odo?.activo ? (
                <span className="rounded bg-green-100 px-3 py-0.5 text-sm text-green-700">
                  Activo
                </span>
              ) : (
                <span className="rounded bg-red-100 px-3 py-0.5 text-sm text-red-700">
                  Inactivo
                </span>
              )}
            </div>

            {/* Datos a la derecha de la foto */}
            <div className="space-y-2">
              <InfoRow
                label="Nombre"
                value={loading ? "—" : nombreCompleto}
                icon={<User className="h-4 w-4" />}
              />
              <InfoRow
                label="Sexo"
                value={sexoLabel(odo?.sexo)}
                icon={sexoIcon(odo?.sexo)}
              />

              <InfoRow
                label="Cédula"
                value={odo?.cedula ?? "—"}
                icon={<IdCard className="h-4 w-4" />}
              />
              <InfoRow
                label="Fecha de nacimiento"
                value={formatFechaLocalYMD(odo?.fecha_nacimiento)}
                icon={<CalendarDays className="h-4 w-4" />}
              />
              <InfoRow
                label="Tipo de sangre"
                value={tipoSangreLabel(odo?.tipo_sangre)}
                icon={<Droplet className="h-4 w-4" />}
              />
              <InfoRow
                label="Celular"
                value={odo?.celular ?? "—"}
                icon={<Phone className="h-4 w-4" />}
              />
              <InfoRow
                label="Correo"
                value={odo?.usuario_email ?? "—"}
                icon={<Mail className="h-4 w-4" />}
              />
              <InfoRow
                label="Consultorio"
                value={
                  odo?.consultorio_defecto
                    ? `#${odo.consultorio_defecto.numero}`
                    : "—"
                }
                icon={<Briefcase className="h-4 w-4" />}
              />
            </div>
          </div>
        </Card>

        {/* Card 2: Formación profesional + Horario */}
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Formación */}
            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <GraduationCap className="h-4 w-4" /> Formación profesional
              </h3>
              {(() => {
                const list = (odo?.especialidades_detalle ?? [])
                  .slice()
                  .sort((a, b) => {
                    const A = a.estado !== false,
                      B = b.estado !== false;
                    if (A === B)
                      return (a.nombre ?? "").localeCompare(b.nombre ?? "");
                    return A ? -1 : 1;
                  });

                if (list.length) {
                  return (
                    <div className="space-y-2">
                      {list.map((esp, i) => {
                        const activa = esp.estado !== false;
                        return (
                          <div
                            key={i}
                            className="flex items-start justify-between rounded-lg border p-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {esp.nombre || "—"}
                              </p>
                              <p className="text-xs text-gray-600">
                                {esp.universidad || "—"}
                              </p>
                            </div>
                            <span
                              className={[
                                "ml-3 shrink-0 rounded px-2 py-0.5 text-xs",
                                activa
                                  ? "bg-green-100 text-green-700"
                                  : "bg-gray-200 text-gray-700",
                              ].join(" ")}
                            >
                              {activa ? "Activa" : "Inactiva"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                if (odo?.especialidades?.length) {
                  return (
                    <div className="flex flex-wrap gap-2">
                      {odo.especialidades.map((e, i) => (
                        <span
                          key={i}
                          className="rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-800"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  );
                }

                return <p className="text-sm text-gray-600">—</p>;
              })()}
            </div>

            {/* Horario */}
            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <Clock className="h-4 w-4" /> Horario
              </h3>
              <ul className="space-y-1 text-sm">
                {ORDEN_SEMANA.map((d) => (
                  <li
                    key={d}
                    className="flex items-center justify-between rounded border px-3 py-2"
                  >
                    <span className="font-medium">{DIAS[d]}</span>
                    {renderSlots(d)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
