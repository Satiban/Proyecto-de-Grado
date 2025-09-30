// src/pages/paciente/Perfil.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  Briefcase,
  Calendar,
  Droplet,
  IdCard,
  Mail,
  MapPin,
  Mars,
  Venus,
  Pencil,
  Phone,
  User,
  ShieldAlert,
  Users as UsersIcon,
} from "lucide-react";
import { api } from "../../api/axios";

/* ================== Endpoints (ajusta si difieren) ================== */
const PATH_PACIENTES = "/pacientes/";               // lista/detalle; lista ya respeta rol paciente
const PATH_PAC_ANT   = "/paciente-antecedentes/";   // para paciente autenticado, ya filtra a su propia data

/* ================== Tipos ================== */
type RelFamiliar = "propio" | "padres" | "hermanos" | "abuelos";

type UsuarioPacienteView = {
  id_usuario?: number;
  id_paciente?: number | null;

  email?: string | null;
  usuario_email?: string | null;
  primer_nombre?: string | null;
  segundo_nombre?: string | null;
  primer_apellido?: string | null;
  segundo_apellido?: string | null;
  cedula?: string | null;
  fecha_nacimiento?: string | null; // "YYYY-MM-DD"
  sexo?: string | null;             // "M" | "F" | "O"
  tipo_sangre?: string | null;      // "O+", etc.
  celular?: string | null;
  foto?: string | null;

  // opcionales
  direccion?: string | null;
  ciudad?: string | null;
  ocupacion?: string | null;
};

type PacienteAPI = {
  id_paciente: number;
  id_usuario: number;

  // Contacto de emergencia (del serializer)
  contacto_emergencia_nom?: string | null;
  contacto_emergencia_cel?: string | null;
  contacto_emergencia_par?: string | null;
};

type PacienteAntecedenteRow = {
  id_paciente_antecedente: number;
  id_paciente: number;
  id_antecedente: number;
  antecedente_nombre?: string | null;
  relacion_familiar: RelFamiliar;
  created_at?: string;
  updated_at?: string;
};

/* ================== Utils ================== */
function sexoLabel(sexo?: string | null) {
  if (sexo === "M") return "Masculino";
  if (sexo === "F") return "Femenino";
  if (sexo === "O") return "Otro";
  return "—";
}
function safeYMD(d?: string | null) {
  if (!d) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const asDate = new Date(d);
  if (Number.isNaN(asDate.getTime())) return d;
  return asDate.toLocaleDateString();
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* Label genérico con icono */
function LabelWithIcon({
  icon: Icon,
  text,
}: {
  icon: React.ElementType;
  text: string;
}) {
  return (
    <p className="text-sm text-gray-500 flex items-center gap-1.5">
      <Icon className="h-4 w-4 text-gray-500 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

/* Label específico para Sexo: dinámico (Mars, Venus o ambos) */
function LabelSexo({ sexo }: { sexo?: string | null }) {
  const s = (sexo || "").toUpperCase();
  const showMars = s === "M";
  const showVenus = s === "F";
  const neutral = !showMars && !showVenus; // O / vacío / desconocido

  return (
    <p className="text-sm text-gray-500 flex items-center gap-1.5">
      {neutral ? (
        <span className="flex items-center gap-0.5">
          <Mars className="h-4 w-4 text-gray-500 shrink-0" />
          <Venus className="h-4 w-4 text-gray-500 shrink-0" />
        </span>
      ) : showMars ? (
        <Mars className="h-4 w-4 text-gray-500 shrink-0" />
      ) : (
        <Venus className="h-4 w-4 text-gray-500 shrink-0" />
      )}
      <span>Sexo</span>
    </p>
  );
}

/* ================== Componente ================== */
export default function PerfilPaciente() {
  const navigate = useNavigate();
  const { usuario: usuarioCtx } = useAuth();

  // Fallback por si el contexto aún no está poblado
  const usuarioStorage = (() => {
    try {
      const raw = localStorage.getItem("usuario");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const uInit = (usuarioCtx || usuarioStorage || {}) as Partial<UsuarioPacienteView>;
  const [u, setU] = useState<Partial<UsuarioPacienteView>>({
    ...uInit,
    id_paciente:
      uInit.id_paciente ??
      (() => {
        const raw = localStorage.getItem("id_paciente");
        const n = raw ? Number(raw) : NaN;
        return Number.isFinite(n) ? n : null;
      })(),
  });

  // Estado para contacto de emergencia
  const [emergNom, setEmergNom] = useState<string | null>(null);
  const [emergPar, setEmergPar] = useState<string | null>(null);
  const [emergCel, setEmergCel] = useState<string | null>(null);

  const [loadingAnt, setLoadingAnt] = useState(false);
  const [propios, setPropios] = useState<{ nombre: string }[]>([]);
  const [familiares, setFamiliares] = useState<{ nombre: string; parentesco: Exclude<RelFamiliar, "propio"> }[]>(
    []
  );

  const nombreCompleto = useMemo(() => {
    return [u.primer_nombre, u.segundo_nombre, u.primer_apellido, u.segundo_apellido]
      .filter(Boolean)
      .join(" ");
  }, [u.primer_nombre, u.segundo_nombre, u.primer_apellido, u.segundo_apellido]);

  // ============ Carga de id_paciente, contacto de emergencia y antecedentes ============
  useEffect(() => {
    let cancel = false;

    async function resolvePacienteId(): Promise<number | null> {
      if (u.id_paciente) return u.id_paciente;

      // 1) Si es paciente, el backend devuelve el suyo sin params
      try {
        const resp = await api.get(PATH_PACIENTES);
        const list: PacienteAPI[] = Array.isArray(resp.data) ? resp.data : resp.data?.results ?? [];
        if (list.length > 0) {
          const p = list[0];
          if (!cancel) {
            setU((prev) => ({ ...prev, id_paciente: p.id_paciente }));
            try {
              localStorage.setItem("id_paciente", String(p.id_paciente));
            } catch {}
          }
          // guarda contacto emergencia si vino en la lista
          if (!cancel) {
            setEmergNom(p.contacto_emergencia_nom ?? null);
            setEmergPar(p.contacto_emergencia_par ?? null);
            setEmergCel(p.contacto_emergencia_cel ?? null);
          }
          return p.id_paciente;
        }
      } catch {
        // continuar con id_usuario si existe
      }

      // 2) Respaldo: por id_usuario (útil para admin/odo)
      if (u.id_usuario) {
        try {
          const resp = await api.get(PATH_PACIENTES, { params: { id_usuario: u.id_usuario } });
          const list: PacienteAPI[] = Array.isArray(resp.data) ? resp.data : resp.data?.results ?? [];
          const p = list.find((x) => Number(x.id_usuario) === Number(u.id_usuario)) ?? list[0];
          if (p?.id_paciente) {
            if (!cancel) {
              setU((prev) => ({ ...prev, id_paciente: p.id_paciente }));
              try {
                localStorage.setItem("id_paciente", String(p.id_paciente));
              } catch {}
              setEmergNom(p.contacto_emergencia_nom ?? null);
              setEmergPar(p.contacto_emergencia_par ?? null);
              setEmergCel(p.contacto_emergencia_cel ?? null);
            }
            return p.id_paciente;
          }
        } catch {
          // ignore
        }
      }

      return null;
    }

    async function ensureEmergenciaFields(idPaciente: number | null) {
      // Si ya tenemos datos, no vuelvas a pedir.
      if (emergNom !== null || emergPar !== null || emergCel !== null) return;
      if (!idPaciente) return;

      try {
        // Para compatibilidad, traemos la lista (uno solo en rol paciente / filtrado en admin/odo)
        // y buscamos el registro del id_paciente; así evitamos depender del endpoint detail.
        let listResp: PacienteAPI[] = [];

        if (u.id_usuario) {
          const resp = await api.get(PATH_PACIENTES, { params: { id_usuario: u.id_usuario } });
          listResp = Array.isArray(resp.data) ? resp.data : resp.data?.results ?? [];
        } else {
          const resp = await api.get(PATH_PACIENTES);
          listResp = Array.isArray(resp.data) ? resp.data : resp.data?.results ?? [];
        }

        const p = listResp.find((x) => Number(x.id_paciente) === Number(idPaciente)) ?? listResp[0];
        if (p) {
          if (!cancel) {
            setEmergNom(p.contacto_emergencia_nom ?? null);
            setEmergPar(p.contacto_emergencia_par ?? null);
            setEmergCel(p.contacto_emergencia_cel ?? null);
          }
        }
      } catch {
        // silencioso: se mostrará "—"
      }
    }

    async function loadAll() {
      setLoadingAnt(true);
      try {
        const idPaciente = await resolvePacienteId();
        if (!idPaciente || cancel) return;

        // Asegura contacto de emergencia (si no vino ya en la primera llamada)
        await ensureEmergenciaFields(idPaciente);
        if (cancel) return;

        // Antecedentes del paciente
        const respAnt = await api.get(PATH_PAC_ANT, { params: { id_paciente: idPaciente } });
        const rows: PacienteAntecedenteRow[] = Array.isArray(respAnt.data)
          ? respAnt.data
          : respAnt.data?.results ?? [];

        const propiosTmp: { nombre: string }[] = [];
        const famTmp: { nombre: string; parentesco: Exclude<RelFamiliar, "propio"> }[] = [];

        for (const r of rows) {
          const rel = (r.relacion_familiar || "propio") as RelFamiliar;
          const name = (r.antecedente_nombre || "").trim() || "Antecedente";

          if (rel === "propio") {
            propiosTmp.push({ nombre: name });
          } else if (rel === "padres" || rel === "hermanos" || rel === "abuelos") {
            famTmp.push({ nombre: name, parentesco: rel });
          }
        }

        // de-dup
        const seenProp = new Set<string>();
        const seenFam = new Set<string>();
        const propiosUniq = propiosTmp.filter((x) => {
          const k = x.nombre.toLowerCase();
          if (seenProp.has(k)) return false;
          seenProp.add(k);
          return true;
        });
        const famUniq = famTmp.filter((x) => {
          const k = `${x.nombre.toLowerCase()}-${x.parentesco}`;
          if (seenFam.has(k)) return false;
          seenFam.add(k);
          return true;
        });

        if (!cancel) {
          setPropios(propiosUniq);
          setFamiliares(famUniq);
        }
      } catch {
        if (!cancel) {
          setPropios([]);
          setFamiliares([]);
        }
      } finally {
        if (!cancel) setLoadingAnt(false);
      }
    }

    void loadAll();
    return () => {
      cancel = true;
    };
  }, [u.id_usuario, u.id_paciente]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Mi perfil</h1>
        <button
          onClick={() => navigate("/paciente/perfil/editar")}
          className="px-4 py-2 rounded-lg bg-gray-800 text-white hover:bg-black/80 inline-flex items-center gap-2"
        >
          <Pencil className="h-4 w-4" />
          Editar
        </button>
      </div>

      {/* Identidad / Foto + Datos personales */}
      <div className="bg-white rounded-xl shadow p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Columna: Foto */}
        <div className="md:col-span-1">
          <div className="w-28 h-28 rounded-full bg-gray-200 overflow-hidden">
            {u.foto ? (
              <img src={u.foto} alt="Foto de perfil" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
                Sin foto
              </div>
            )}
          </div>
        </div>

        {/* Columna: Datos personales */}
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <LabelWithIcon icon={User} text="Nombre completo" />
            <p className="font-medium leading-tight mt-0.5">{nombreCompleto || "—"}</p>
          </div>
          <div>
            <LabelWithIcon icon={IdCard} text="Cédula" />
            <p className="font-medium leading-tight mt-0.5">{u.cedula || "—"}</p>
          </div>
          <div>
            <LabelSexo sexo={u.sexo} />
            <p className="font-medium leading-tight mt-0.5">{sexoLabel(u.sexo)}</p>
          </div>
          <div>
            <LabelWithIcon icon={Calendar} text="Fecha de nacimiento" />
            <p className="font-medium leading-tight mt-0.5">{safeYMD(u.fecha_nacimiento)}</p>
          </div>
          <div>
            <LabelWithIcon icon={Droplet} text="Tipo de sangre" />
            <p className="font-medium leading-tight mt-0.5">{u.tipo_sangre || "—"}</p>
          </div>

          {typeof u.ocupacion !== "undefined" && (
            <div>
              <LabelWithIcon icon={Briefcase} text="Ocupación" />
              <p className="font-medium leading-tight mt-0.5">{u.ocupacion || "—"}</p>
            </div>
          )}
          {typeof u.direccion !== "undefined" && (
            <div className="md:col-span-2">
              <LabelWithIcon icon={MapPin} text="Dirección" />
              <p className="font-medium leading-tight mt-0.5">{u.direccion || "—"}</p>
            </div>
          )}
          {typeof u.ciudad !== "undefined" && (
            <div>
              <LabelWithIcon icon={MapPin} text="Ciudad" />
              <p className="font-medium leading-tight mt-0.5">{u.ciudad || "—"}</p>
            </div>
          )}
        </div>
      </div>

      {/* Información de contacto */}
      <div className="bg-white rounded-xl shadow p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <LabelWithIcon icon={Mail} text="Email" />
          <p className="font-medium leading-tight mt-0.5">{u.email || u.usuario_email || "—"}</p>
        </div>
        <div>
          <LabelWithIcon icon={Phone} text="Celular" />
          <p className="font-medium leading-tight mt-0.5">{u.celular || "—"}</p>
        </div>
      </div>

      {/* Contacto de emergencia */}
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          Contacto de emergencia
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <LabelWithIcon icon={UsersIcon} text="Nombre" />
            <p className="font-medium leading-tight mt-0.5">{emergNom || "—"}</p>
          </div>
          <div>
            <LabelWithIcon icon={IdCard} text="Parentesco" />
            <p className="font-medium leading-tight mt-0.5">{emergPar || "—"}</p>
          </div>
          <div>
            <LabelWithIcon icon={Phone} text="Celular" />
            <p className="font-medium leading-tight mt-0.5">{emergCel || "—"}</p>
          </div>
        </div>
      </div>

      {/* Antecedentes: dos columnas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Izquierda: Propios */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Antecedentes propios</h2>
          {loadingAnt ? (
            <div className="text-sm text-gray-500">Cargando…</div>
          ) : propios.length === 0 ? (
            <div className="text-sm text-gray-500">Sin antecedentes propios.</div>
          ) : (
            <ul className="space-y-2">
              {propios.map((a, idx) => (
                <li key={idx} className="flex items-center gap-3">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-400 self-center" />
                  <span className="font-medium leading-tight">{a.nombre}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Derecha: Familiares */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Antecedentes familiares</h2>
          {loadingAnt ? (
            <div className="text-sm text-gray-500">Cargando…</div>
          ) : familiares.length === 0 ? (
            <div className="text-sm text-gray-500">Sin antecedentes familiares.</div>
          ) : (
            <ul className="space-y-2">
              {familiares.map((a, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-400 mt-1.5" />
                  <div className="leading-tight">
                    <p className="font-medium">{a.nombre}</p>
                    <p className="text-sm text-gray-600">Parentesco: {cap(a.parentesco)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
