// src/pages/admin/OdontologosNuevo.tsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { api } from "../../api/axios";
import { Loader2, Eye, EyeOff, User, ArrowLeft } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";
const PRIMARY = "#0070B7";

/* ===== Tipos ===== */
type Consultorio = {
  id_consultorio: number;
  numero: string;
  descripcion?: string;
  estado: boolean;
};
type Especialidad = { id_especialidad: number; nombre: string };
type UniversidadMap = Record<number, string>;
type DiaConfig = { enabled: boolean; inicio: string; fin: string };
type Errors = Record<string, string | undefined>;

/* ===== Helpers ===== */
type MaybePage<T> = T[] | { results?: T[] };
function unwrap<T>(data: MaybePage<T>): T[] {
  return Array.isArray(data) ? data : data.results ?? [];
}

const DAY_LABELS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

// Rango de atención del consultorio
const MIN_TIME = "09:00";
const MAX_TIME = "22:00"; // 10pm

// 👉 Bloque de almuerzo (no se atiende)
const LUNCH_START = "13:00";
const LUNCH_END = "15:00";

function sexoLabel(code: string) {
  return code === "M" ? "Masculino" : code === "F" ? "Femenino" : code || "—";
}
function isValidEmail(m: string) {
  return /^[^\s@]+@[^\s@]{1,}\.[^\s@]{2,}$/.test(m);
}
// Cédula EC (natural)
function isValidCedulaEC(ci: string) {
  if (!/^\d{10}$/.test(ci)) return false;
  const prov = +ci.slice(0, 2);
  if (prov < 1 || (prov > 24 && prov !== 30)) return false;
  const t = +ci[2];
  if (t >= 6) return false;
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let s = 0;
  for (let i = 0; i < 9; i++) {
    let p = coef[i] * +ci[i];
    if (p >= 10) p -= 9;
    s += p;
  }
  const d = s % 10 === 0 ? 0 : 10 - (s % 10);
  return d === +ci[9];
}
// >= 18 años
function isAdult18(dateStr: string) {
  if (!dateStr) return false;
  const dob = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(dob.getTime())) return false;
  const today = new Date();
  let years = today.getFullYear() - dob.getFullYear();
  const mDiff = today.getMonth() - dob.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < dob.getDate())) years--;
  return years >= 18;
}
// Contraseña: min 6, 1 mayúscula y 1 número
function isStrongPassword(pwd: string) {
  return /^(?=.*[A-Z])(?=.*\d).{6,}$/.test(pwd);
}
// minutos desde "HH:MM"
function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map((x) => +x);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

export default function OdontologosNuevo() {
  const navigate = useNavigate();

  // Stepper (4 pasos)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);
  const [errorTop, setErrorTop] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  // catálogos
  const [consultorios, setConsultorios] = useState<Consultorio[]>([]);
  const [especialidades, setEspecialidades] = useState<Especialidad[]>([]);

  // verificación remota (cédula/email/celular)
  const [checkingCedula, setCheckingCedula] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [checkingCelular, setCheckingCelular] = useState(false);
  const [cedulaExists, setCedulaExists] = useState<boolean | null>(null);
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [celularExists, setCelularExists] = useState<boolean | null>(null);
  const lastQueried = useRef<{
    cedula?: string;
    email?: string;
    celular?: string;
  }>({});

  // Paso 1: Usuario (datos personales)
  const [u, setU] = useState({
    primer_nombre: "",
    segundo_nombre: "",
    primer_apellido: "",
    segundo_apellido: "",
    cedula: "",
    fecha_nacimiento: "",
    email: "",
    password: "",
    password2: "",
    celular: "",
    sexo: "",
    tipo_sangre: "",
  });

  // Foto (opcional) — ahora arriba, con preview circular
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!foto) {
      setFotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setFotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFoto(f);
  };
  const handleClearPhoto = () => {
    setFoto(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  // --- Live password checks ---
  const [pwdTouched, setPwdTouched] = useState(false);
  const [pwd2Touched, setPwd2Touched] = useState(false);

  const pwd = u.password ?? "";
  const pwd2 = u.password2 ?? "";

  // Criterios
  const pwdHasMin = pwd.length >= 6;
  const pwdHasUpper = /[A-Z]/.test(pwd);
  const pwdHasDigit = /\d/.test(pwd);
  const pwdStrong = pwdHasMin && pwdHasUpper && pwdHasDigit;

  // Coincidencia
  const pwdMatch = pwd.length > 0 && pwd2.length > 0 && pwd === pwd2;

  // Helpers de color (gris inicial, luego rojo/verde)
  function hintColor(valid: boolean, touched: boolean, value: string) {
    if (!touched && value.length === 0) return "text-gray-500";
    return valid ? "text-green-600" : "text-red-600";
  }
  function borderForPwdField(valid: boolean, touched: boolean, empty: boolean) {
    if (!touched && empty) return "border-gray-300";
    return valid
      ? "border-green-600 focus:ring-2 focus:ring-green-500"
      : "border-red-500 focus:ring-2 focus:ring-red-500";
  }

  // Paso 2: Profesionales (especialidades + universidades)
  const [idsEspecialidades, setIdsEspecialidades] = useState<number[]>([]);
  const [universidadesPorEsp, setUniversidadesPorEsp] =
    useState<UniversidadMap>({});
  const [atenderPorEsp, setAtenderPorEsp] = useState<Record<number, boolean>>(
    {}
  );
  useEffect(() => {
    setAtenderPorEsp((prev) => {
      const next: Record<number, boolean> = {};
      for (const id of idsEspecialidades) next[id] = prev[id] ?? true;
      return next;
    });
  }, [idsEspecialidades]);

  // Paso 3: Laborales (consultorio + días/horarios)
  const [idConsultorioDefecto, setIdConsultorioDefecto] = useState<number | "">(
    ""
  );
  const [diasTrabajo, setDiasTrabajo] = useState<Record<number, DiaConfig>>(
    () => {
      const base: Record<number, DiaConfig> = {};
      for (let d = 0; d < 7; d++)
        base[d] = { enabled: false, inicio: MIN_TIME, fin: MAX_TIME };
      return base;
    }
  );

  // errores
  const [errors, setErrors] = useState<Errors>({});
  const inputClass = (name?: string) =>
    `w-full rounded-lg border px-4 py-2 ${
      name && errors[name]
        ? "border-red-500 focus:ring-2 focus:ring-red-500"
        : "border-gray-300"
    }`;

  // Sanitiza numéricos (cédula/celular)
  const handleNumeric =
    <T extends Record<string, any>>(
      setter: React.Dispatch<React.SetStateAction<T>>,
      field: keyof T,
      maxLen: number
    ) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.replace(/\D/g, "").slice(0, maxLen);
      setter((prev) => ({ ...prev, [field]: val }));
      setErrors((prev) => ({ ...prev, [field as string]: undefined }));
      setErrorTop("");
      if (field === "cedula") setCedulaExists(null);
      if (field === "celular") setCelularExists(null);
    };

  const onChange =
    (setter: React.Dispatch<React.SetStateAction<any>>) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value, type, checked } = e.target as any;
      setter((s: any) => ({
        ...s,
        [name]: type === "checkbox" ? checked : value,
      }));
      setErrors((prev) => ({ ...prev, [name]: undefined }));
      setErrorTop("");

      if (name === "cedula") setCedulaExists(null);
      if (name === "email") setEmailExists(null);
      if (name === "celular") setCelularExists(null);

      // --- feedback en vivo de contraseña ---
      if (name === "password") {
        setErrors((prev) => ({
          ...prev,
          password:
            value.length === 0
              ? undefined
              : isStrongPassword(value)
              ? undefined
              : "Mín. 6 car., al menos 1 mayúscula y 1 número",
          // si ya hay password2, validar coincidencia también
          password2:
            u.password2 && value !== u.password2 ? "No coincide" : undefined,
        }));
      }
      if (name === "password2") {
        setErrors((prev) => ({
          ...prev,
          password2:
            value.length === 0
              ? undefined
              : value ===
                (name === "password"
                  ? value
                  : typeof u.password === "string"
                  ? u.password
                  : "")
              ? undefined
              : "No coincide",
        }));
      }
    };

  // catálogos
  useEffect(() => {
    (async () => {
      try {
        const [cRes, eRes] = await Promise.all([
          api.get<MaybePage<Consultorio>>("/consultorios/"),
          api.get<MaybePage<Especialidad>>("/especialidades/"),
        ]);
        const cs = unwrap<Consultorio>(cRes.data).filter((c) => c.estado);
        const es = unwrap<Especialidad>(eRes.data);
        setConsultorios(cs);
        setEspecialidades(es);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  // verificación remota (cédula/email/celular)
  async function verificarUnico(opts: {
    cedula?: string;
    email?: string;
    celular?: string;
  }) {
    try {
      const params: Record<string, string> = {};
      if (opts.cedula) params.cedula = opts.cedula;
      if (opts.email) params.email = opts.email;
      if (opts.celular) params.celular = opts.celular;

      if (params.cedula) setCheckingCedula(true);
      if (params.email) setCheckingEmail(true);
      if (params.celular) setCheckingCelular(true);

      const { data } = await axios.get(`${API}/usuarios/verificar/`, {
        params,
      });

      if (data.cedula && lastQueried.current.cedula === data.cedula.value) {
        const exists = !!data.cedula.exists;
        setCedulaExists(exists);
        setErrors((prev) => ({
          ...prev,
          cedula: exists ? "Cédula ya registrada" : undefined,
        }));
      }
      if (data.email && lastQueried.current.email === data.email.value) {
        const exists = !!data.email.exists;
        setEmailExists(exists);
        setErrors((prev) => ({
          ...prev,
          email: exists ? "Correo ya registrado" : undefined,
        }));
      }
      if (data.celular && lastQueried.current.celular === data.celular.value) {
        const exists = !!data.celular.exists;
        setCelularExists(exists);
        setErrors((prev) => ({
          ...prev,
          celular: exists ? "Celular ya registrado" : undefined,
        }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (opts.cedula) setCheckingCedula(false);
      if (opts.email) setCheckingEmail(false);
      if (opts.celular) setCheckingCelular(false);
    }
  }

  const handleCedulaBlur = () => {
    const c = u.cedula;
    if (!c) return;
    if (!/^\d{10}$/.test(c)) {
      setErrors((p) => ({ ...p, cedula: "Debe tener 10 dígitos" }));
      setCedulaExists(null);
      return;
    }
    if (!isValidCedulaEC(c)) {
      setErrors((p) => ({ ...p, cedula: "Cédula inválida" }));
      setCedulaExists(null);
      return;
    }
    setErrors((p) => ({ ...p, cedula: undefined }));
    lastQueried.current.cedula = c;
    verificarUnico({ cedula: c });
  };

  const handleEmailBlur = () => {
    const m = u.email.trim();
    if (!m) return;
    if (!isValidEmail(m)) {
      setErrors((p) => ({ ...p, email: "Correo inválido" }));
      setEmailExists(null);
      return;
    }
    setErrors((p) => ({ ...p, email: undefined }));
    lastQueried.current.email = m;
    verificarUnico({ email: m });
  };

  const handleCelularBlur = () => {
    const c = u.celular.trim();
    if (!c) return;
    if (!/^09\d{8}$/.test(c)) {
      setErrors((p) => ({ ...p, celular: "Formato 09xxxxxxxx" }));
      setCelularExists(null);
      return;
    }
    setErrors((p) => ({ ...p, celular: undefined }));
    lastQueried.current.celular = c;
    verificarUnico({ celular: c });
  };

  useEffect(() => {
    if (u.cedula && /^\d{10}$/.test(u.cedula) && isValidCedulaEC(u.cedula)) {
      lastQueried.current.cedula = u.cedula;
      const t = setTimeout(() => verificarUnico({ cedula: u.cedula }), 400);
      return () => clearTimeout(t);
    } else {
      setCedulaExists(null);
    }
  }, [u.cedula]);

  useEffect(() => {
    if (u.email && isValidEmail(u.email)) {
      lastQueried.current.email = u.email;
      const t = setTimeout(() => verificarUnico({ email: u.email }), 400);
      return () => clearTimeout(t);
    } else {
      setEmailExists(null);
    }
  }, [u.email]);

  useEffect(() => {
    if (u.celular && /^09\d{8}$/.test(u.celular)) {
      lastQueried.current.celular = u.celular;
      const t = setTimeout(() => verificarUnico({ celular: u.celular }), 400);
      return () => clearTimeout(t);
    } else {
      setCelularExists(null);
    }
  }, [u.celular]);

  // validaciones
  function validateStep1() {
    const e: Errors = {};

    // Todos obligatorios (excepto foto y segundo nombre)
    if (!u.primer_nombre.trim()) e.primer_nombre = "Ingrese el primer nombre";
    if (!u.primer_apellido.trim())
      e.primer_apellido = "Ingrese el primer apellido";
    if (!u.segundo_apellido.trim())
      e.segundo_apellido = "Ingrese el segundo apellido";

    if (!/^\d{10}$/.test(u.cedula)) e.cedula = "Debe tener 10 dígitos";
    else if (!isValidCedulaEC(u.cedula)) e.cedula = "Cédula inválida";
    if (cedulaExists) e.cedula = "Cédula ya registrada";

    if (!/^09\d{8}$/.test(u.celular)) e.celular = "Formato 09xxxxxxxx";
    if (celularExists) e.celular = "Celular ya registrado";

    if (!u.fecha_nacimiento) e.fecha_nacimiento = "Seleccione la fecha";
    else if (!isAdult18(u.fecha_nacimiento))
      e.fecha_nacimiento = "Debe ser mayor de 18 años";

    if (!["M", "F"].includes(u.sexo)) e.sexo = "Seleccione el sexo";
    if (!u.tipo_sangre) e.tipo_sangre = "Seleccione el tipo de sangre";

    if (!isValidEmail(u.email)) e.email = "Correo inválido";
    if (emailExists) e.email = "Correo ya registrado";

    if (!isStrongPassword(u.password))
      e.password = "Mín. 6 car., al menos 1 mayúscula y 1 número";
    if (u.password !== u.password2) e.password2 = "No coincide";

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2() {
    const e: Errors = {};
    if (idsEspecialidades.length === 0)
      e["especialidades"] = "Seleccione al menos una especialidad";
    for (const id of idsEspecialidades) {
      const uni = (universidadesPorEsp[id] ?? "").trim();
      if (!uni) e[`uni_${id}`] = "Ingrese la universidad";
    }
    setErrors((prev) => ({ ...prev, ...e }));
    return Object.keys(e).length === 0;
  }

  function validateTime(hhmm: string) {
    return hhmm >= MIN_TIME && hhmm <= MAX_TIME;
  }

  function validateStep3() {
    const e: Errors = {};
    if (idConsultorioDefecto === "")
      e["consultorio"] = "Seleccione un consultorio";

    const seleccionados = Object.values(diasTrabajo).filter((d) => d.enabled);
    if (seleccionados.length === 0)
      e["dias_trabajo"] = "Seleccione al menos un día de trabajo";

    const lunchStartMin = toMinutes(LUNCH_START);
    const lunchEndMin = toMinutes(LUNCH_END);

    Object.entries(diasTrabajo).forEach(([k, cfg]) => {
      const dia = Number(k);
      if (!cfg.enabled) return;

      const outStart = !validateTime(cfg.inicio);
      const outEnd = !validateTime(cfg.fin);

      if (outStart) e[`dia_${dia}_inicio`] = `Inicio mínimo ${MIN_TIME}`;
      if (outEnd) e[`dia_${dia}_fin`] = `Fin máximo ${MAX_TIME}`;

      // 👉 Si alguna hora está fuera del horario laboral total, mensaje genérico
      if (outStart || outEnd) {
        e[
          `dia_${dia}_rango`
        ] = `Fuera del horario laboral (${MIN_TIME}-${MAX_TIME})`;
      } else {
        const minIni = toMinutes(cfg.inicio);
        const minFin = toMinutes(cfg.fin);

        if (!Number.isNaN(minIni) && !Number.isNaN(minFin)) {
          // ✅ Nueva regla: solo inicio/fin dentro del almuerzo (13:00–15:00) es inválido.
          const startInLunch = minIni >= lunchStartMin && minIni < lunchEndMin;
          const endInLunch = minFin > lunchStartMin && minFin <= lunchEndMin;

          if (startInLunch) {
            e[`dia_${dia}_rango`] =
              "Fuera del horario laboral: inicio dentro de almuerzo (13:00–15:00)";
          } else if (endInLunch) {
            e[`dia_${dia}_rango`] =
              "Fuera del horario laboral: fin dentro de almuerzo (13:00–15:00)";
          } else if (minIni >= minFin) {
            e[`dia_${dia}_rango`] =
              "La hora de inicio debe ser menor a la hora de fin";
          } else if (minFin - minIni < 120) {
            e[`dia_${dia}_rango`] = "Duración mínima 2 horas";
          }
        }
      }
    });

    const atenderSeleccionadas = idsEspecialidades.filter(
      (id) => atenderPorEsp[id] === true
    );
    if (idsEspecialidades.length > 0 && atenderSeleccionadas.length === 0) {
      e["atender_especialidades"] =
        "Marque al menos una especialidad para atender.";
    }

    setErrors((prev) => ({ ...prev, ...e }));
    return Object.keys(e).length === 0;
  }

  const selectedEspNames = idsEspecialidades
    .map((id) => especialidades.find((e) => e.id_especialidad === id)?.nombre)
    .filter(Boolean)
    .join(", ");

  // submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (step === 1) {
      if (!validateStep1()) return setErrorTop("Corrige los campos marcados.");
      return setStep(2);
    }
    if (step === 2) {
      if (!validateStep2())
        return setErrorTop("Revisa las especialidades y universidades.");
      return setStep(3);
    }
    if (step === 3) {
      if (!validateStep3()) return setErrorTop("Completa los datos laborales.");
      return setStep(4);
    }

    setErrorTop("");
    setLoading(true);
    try {
      // 1) Crear Usuario (rol=3 odontólogo) + activo=true
      const fd = new FormData();
      const payloadUsuario: any = { ...u, id_rol: "3" };
      delete payloadUsuario.password2;
      Object.entries(payloadUsuario).forEach(([k, v]) =>
        fd.append(k, String(v))
      );
      fd.append("activo", "true"); // activar usuario al crear
      if (foto) fd.append("foto", foto);

      const usrRes = await api.post(`/usuarios/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const id_usuario = usrRes.data.id_usuario;

      // 2) Armar especialidades_detalle
      const especialidades_detalle = idsEspecialidades.map((id) => ({
        nombre:
          especialidades.find((e) => e.id_especialidad === id)?.nombre ?? "",
        universidad: (universidadesPorEsp[id] ?? "").trim(),
        estado: atenderPorEsp[id] ?? true,
      }));

      // 3) Armar horarios
      const horariosPayload: {
        dia_semana: number;
        hora_inicio: string;
        hora_fin: string;
        vigente: boolean;
      }[] = [];

      for (let idx = 0; idx < 7; idx++) {
        const cfg = diasTrabajo[idx];
        if (!cfg?.enabled) continue;

        // ✅ mapeo correcto para tu BD
        const dia_semana = idx; // Lunes=0 … Domingo=6

        horariosPayload.push({
          dia_semana,
          hora_inicio: cfg.inicio, // "HH:MM"
          hora_fin: cfg.fin, // "HH:MM"
          vigente: true,
        });
      }

      // 4) Crear odontólogo en un solo POST
      await api.post(`/odontologos/`, {
        id_usuario,
        consultorio_defecto_id:
          idConsultorioDefecto === "" ? null : idConsultorioDefecto,
        especialidades_detalle,
        horarios: horariosPayload,
      });

      setShowSuccess(true);
      setTimeout(() => navigate("/admin/odontologos"), 1000);
    } catch (err: any) {
      console.error(err?.response?.data || err);
      setErrorTop(
        err?.response?.data
          ? JSON.stringify(err.response.data)
          : "No se pudo crear el odontólogo."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Toast éxito */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
            <div className="font-semibold">
              ¡Odontólogo creado correctamente!
            </div>
            <div className="text-sm text-white/90">Redirigiendo…</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">👨‍⚕️ Nuevo Odontólogo</h1>
        <Link
          to="/admin/odontologos"
          className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al listado
        </Link>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-6">
        {[
          { n: 1, t: "Datos personales" },
          { n: 2, t: "Datos profesionales" },
          { n: 3, t: "Datos laborales" },
          { n: 4, t: "Revisión" },
        ].map((s) => (
          <div key={s.n} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full grid place-items-center text-sm font-semibold ${
                step >= (s.n as 1 | 2 | 3 | 4)
                  ? "text-white"
                  : "bg-gray-200 text-gray-600"
              }`}
              style={
                step >= (s.n as 1 | 2 | 3 | 4)
                  ? { backgroundColor: PRIMARY }
                  : {}
              }
            >
              {s.n}
            </div>
            <span className="hidden sm:block text-sm text-gray-700">{s.t}</span>
          </div>
        ))}
      </div>

      {errorTop && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorTop}
        </div>
      )}

      {/* Form principal */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl bg-white shadow-md p-4 space-y-6"
      >
        {/* PASO 1 */}
        {step === 1 && (
          <div className="space-y-4">
            {/* === Foto al inicio con preview circular y botones === */}
            <div className="rounded-lg border p-4 bg-gray-50">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Foto (opcional)
              </label>

              <div className="flex items-center gap-4 flex-wrap">
                {/* Avatar / preview */}
                <div className="w-28 h-28 rounded-full overflow-hidden border bg-white grid place-items-center">
                  {fotoPreview ? (
                    <img
                      src={fotoPreview}
                      alt="Vista previa"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-10 h-10 text-gray-400" />
                  )}
                </div>

                {/* Controles */}
                <div className="flex items-center gap-2">
                  <input
                    id="fotoInput"
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSelectFile}
                  />
                  <label
                    htmlFor="fotoInput"
                    className="cursor-pointer rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
                  >
                    Seleccionar archivo
                  </label>

                  {foto && (
                    <button
                      type="button"
                      onClick={handleClearPhoto}
                      className="rounded-lg border bg-white px-4 py-2 hover:bg-gray-50"
                      title="Quitar la foto seleccionada"
                    >
                      Quitar selección
                    </button>
                  )}
                </div>
              </div>

              {/* Info de ayuda */}
              <p className="text-xs text-gray-500 mt-2">
                Formatos: JPG/PNG. encuadre.
              </p>
            </div>

            {/* Datos personales */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Primer nombre
                </label>
                <input
                  name="primer_nombre"
                  value={u.primer_nombre}
                  onChange={onChange(setU)}
                  className={inputClass("primer_nombre")}
                />
                {errors.primer_nombre && (
                  <p className="text-red-600 text-sm">{errors.primer_nombre}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Segundo nombre (Opcional)
                </label>
                <input
                  name="segundo_nombre"
                  value={u.segundo_nombre}
                  onChange={onChange(setU)}
                  className={inputClass("segundo_nombre")}
                />
                {errors.segundo_nombre && (
                  <p className="text-red-600 text-sm">
                    {errors.segundo_nombre}
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Primer apellido
                </label>
                <input
                  name="primer_apellido"
                  value={u.primer_apellido}
                  onChange={onChange(setU)}
                  className={inputClass("primer_apellido")}
                />
                {errors.primer_apellido && (
                  <p className="text-red-600 text-sm">
                    {errors.primer_apellido}
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Segundo apellido
                </label>
                <input
                  name="segundo_apellido"
                  value={u.segundo_apellido}
                  onChange={onChange(setU)}
                  className={inputClass("segundo_apellido")}
                />
                {errors.segundo_apellido && (
                  <p className="text-red-600 text-sm">
                    {errors.segundo_apellido}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Cédula
                </label>
                <input
                  name="cedula"
                  value={u.cedula}
                  onChange={handleNumeric(setU, "cedula", 10)}
                  onBlur={handleCedulaBlur}
                  maxLength={10}
                  inputMode="numeric"
                  placeholder="10 dígitos"
                  className={inputClass("cedula")}
                />
                {errors.cedula && (
                  <p className="text-red-600 text-sm">{errors.cedula}</p>
                )}
                {checkingCedula && !errors.cedula && (
                  <p className="text-xs text-gray-500 mt-1">
                    Verificando cédula…
                  </p>
                )}
                {cedulaExists === false && !errors.cedula && (
                  <p className="text-xs text-green-600 mt-1">Cédula validada</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Celular
                </label>
                <input
                  name="celular"
                  value={u.celular}
                  onChange={handleNumeric(setU, "celular", 10)}
                  onBlur={handleCelularBlur}
                  maxLength={10}
                  inputMode="numeric"
                  placeholder="09xxxxxxxx"
                  className={inputClass("celular")}
                />
                {errors.celular && (
                  <p className="text-red-600 text-sm">{errors.celular}</p>
                )}
                {checkingCelular && !errors.celular && (
                  <p className="text-xs text-gray-500 mt-1">
                    Verificando celular…
                  </p>
                )}
                {celularExists === false && !errors.celular && (
                  <p className="text-xs text-green-600 mt-1">
                    Celular validado
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Fecha de nacimiento
                </label>
                <input
                  type="date"
                  name="fecha_nacimiento"
                  value={u.fecha_nacimiento}
                  onChange={onChange(setU)}
                  className={inputClass("fecha_nacimiento")}
                />
                {errors.fecha_nacimiento && (
                  <p className="text-red-600 text-sm">
                    {errors.fecha_nacimiento}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Correo
                </label>
                <input
                  type="email"
                  name="email"
                  value={u.email}
                  onChange={onChange(setU)}
                  onBlur={handleEmailBlur}
                  className={inputClass("email")}
                />
                {errors.email && (
                  <p className="text-red-600 text-sm">{errors.email}</p>
                )}
                {checkingEmail && !errors.email && (
                  <p className="text-xs text-gray-500 mt-1">
                    Verificando correo…
                  </p>
                )}
                {emailExists === false && !errors.email && (
                  <p className="text-xs text-green-600 mt-1">Correo validado</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Sexo
                </label>
                <select
                  name="sexo"
                  value={u.sexo}
                  onChange={onChange(setU)}
                  className={inputClass("sexo")}
                >
                  <option value="">Selecciona…</option>
                  <option value="M">Masculino</option>
                  <option value="F">Femenino</option>
                </select>
                {errors.sexo && (
                  <p className="text-red-600 text-sm">{errors.sexo}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Tipo de sangre
                </label>
                <select
                  name="tipo_sangre"
                  value={u.tipo_sangre}
                  onChange={onChange(setU)}
                  className={inputClass("tipo_sangre")}
                >
                  <option value="">Selecciona…</option>
                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
                    (g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    )
                  )}
                </select>
                {errors.tipo_sangre && (
                  <p className="text-red-600 text-sm">{errors.tipo_sangre}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Contraseña */}
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPass1 ? "text" : "password"}
                    name="password"
                    value={u.password}
                    onChange={(e) => {
                      onChange(setU)(e);
                      if (!pwdTouched) setPwdTouched(true);
                    }}
                    onFocus={() => setPwdTouched(true)}
                    className={`w-full rounded-lg border px-4 py-2 pr-16 ${borderForPwdField(
                      pwdStrong,
                      pwdTouched,
                      pwd.length === 0
                    )}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass1((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    aria-label={
                      showPass1 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                    title={
                      showPass1 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    {showPass1 ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>

                {/* Criterios en vivo */}
                <ul className="mt-2 text-xs space-y-1">
                  <li className={hintColor(pwdHasMin, pwdTouched, pwd)}>
                    • Mínimo 6 caracteres
                  </li>
                  <li className={hintColor(pwdHasUpper, pwdTouched, pwd)}>
                    • Al menos 1 mayúscula (A–Z)
                  </li>
                  <li className={hintColor(pwdHasDigit, pwdTouched, pwd)}>
                    • Al menos 1 número (0–9)
                  </li>
                </ul>

                {/* Mensaje de estado global */}
                <p
                  className={`mt-1 text-xs ${
                    !pwdTouched && pwd.length === 0
                      ? "text-gray-500"
                      : pwdStrong
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {!pwdTouched &&
                    pwd.length === 0 &&
                    "Escribe una contraseña que cumpla los requisitos."}
                  {pwdTouched &&
                    !pwdStrong &&
                    "La contraseña aún no cumple los requisitos."}
                  {pwdTouched &&
                    pwdStrong &&
                    "La contraseña cumple con el formato requerido."}
                </p>
              </div>

              {/* Repite contraseña */}
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Repite contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPass2 ? "text" : "password"}
                    name="password2"
                    value={u.password2}
                    onChange={(e) => {
                      onChange(setU)(e);
                      if (!pwd2Touched) setPwd2Touched(true);
                    }}
                    onFocus={() => setPwd2Touched(true)}
                    className={`w-full rounded-lg border px-4 py-2 pr-16 ${borderForPwdField(
                      pwdMatch,
                      pwd2Touched,
                      (u.password2 ?? "").length === 0
                    )}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass2((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    aria-label={
                      showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                    title={
                      showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    {showPass2 ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>

                {/* Mensaje en vivo de coincidencia */}
                <p
                  className={`mt-1 text-xs ${
                    !pwd2Touched && (u.password2 ?? "").length === 0
                      ? "text-gray-500"
                      : pwdMatch
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {!pwd2Touched &&
                    (u.password2 ?? "").length === 0 &&
                    "Vuelve a escribir la contraseña."}
                  {pwd2Touched && !pwdMatch && "Las contraseñas no coinciden."}
                  {pwd2Touched && pwdMatch && "Ambas contraseñas coinciden."}
                </p>
              </div>

              {/* (La foto ya está al inicio) */}
              <div className="sm:col-span-1" />
            </div>

            <div className="flex items-center justify-between">
              <Link
                to="/admin/odontologos"
                className="text-sm text-gray-600 hover:underline"
              >
                Cancelar
              </Link>
              <button
                type="button"
                onClick={() =>
                  validateStep1()
                    ? setStep(2)
                    : setErrorTop("Corrige los campos marcados.")
                }
                disabled={checkingCedula || checkingEmail || checkingCelular}
                className="rounded-lg px-5 py-2 font-medium text-white disabled:opacity-70"
                style={{ backgroundColor: PRIMARY }}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {/* PASO 2: Profesionales */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Especialidades
              </label>
              {errors["especialidades"] && (
                <p className="text-red-600 text-sm mt-1">
                  {errors["especialidades"]}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
                {especialidades.map((esp) => {
                  const checked = idsEspecialidades.includes(
                    esp.id_especialidad
                  );
                  return (
                    <div
                      key={esp.id_especialidad}
                      className="rounded-lg bg-gray-50 p-3"
                    >
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(ev) => {
                            setIdsEspecialidades((prev) =>
                              ev.target.checked
                                ? [...prev, esp.id_especialidad]
                                : prev.filter(
                                    (id) => id !== esp.id_especialidad
                                  )
                            );
                            setErrors((prev) => ({
                              ...prev,
                              ["especialidades"]: undefined,
                              [`uni_${esp.id_especialidad}`]: undefined,
                            }));
                          }}
                        />
                        <span>{esp.nombre}</span>
                      </label>
                      {checked && (
                        <div className="mt-2">
                          <input
                            type="text"
                            placeholder="Universidad donde obtuvo el título"
                            value={
                              universidadesPorEsp[esp.id_especialidad] ?? ""
                            }
                            onChange={(e) =>
                              setUniversidadesPorEsp((prev) => ({
                                ...prev,
                                [esp.id_especialidad]: e.target.value,
                              }))
                            }
                            className={inputClass(`uni_${esp.id_especialidad}`)}
                          />
                          {errors[`uni_${esp.id_especialidad}`] && (
                            <p className="text-red-600 text-sm mt-1">
                              {errors[`uni_${esp.id_especialidad}`]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {idsEspecialidades.length > 0 && (
                <p className="text-xs text-gray-600 mt-2">
                  Seleccionadas: {selectedEspNames}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                Atrás
              </button>
              <div className="flex items-center gap-3">
                <Link
                  to="/admin/odontologos"
                  className="text-sm text-gray-600 hover:underline"
                >
                  Cancelar
                </Link>
                <button
                  type="button"
                  onClick={() => (validateStep2() ? setStep(3) : null)}
                  className="rounded-lg px-5 py-2 font-medium text-white"
                  style={{ backgroundColor: PRIMARY }}
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PASO 3: Laborales */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Consultorio por defecto
              </label>
              <select
                className={inputClass("consultorio")}
                value={
                  idConsultorioDefecto === ""
                    ? ""
                    : String(idConsultorioDefecto)
                }
                onChange={(e) => {
                  const val =
                    e.target.value === "" ? "" : Number(e.target.value);
                  setIdConsultorioDefecto(val);
                  setErrors((prev) => ({ ...prev, consultorio: undefined }));
                }}
              >
                <option value="">— Selecciona —</option>
                {consultorios.map((c) => (
                  <option key={c.id_consultorio} value={c.id_consultorio}>
                    Consultorio {c.numero}
                  </option>
                ))}
              </select>
              {errors["consultorio"] && (
                <p className="text-red-600 text-sm mt-1">
                  {errors["consultorio"]}
                </p>
              )}
            </div>

            {/* Especialidades a atender */}
            <div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Especialidades a atender
                </label>
              </div>
              {errors["atender_especialidades"] && (
                <p className="text-red-600 text-sm mt-1">
                  {errors["atender_especialidades"]}
                </p>
              )}

              {idsEspecialidades.length === 0 ? (
                <p className="text-sm text-gray-600 mt-2">
                  No hay especialidades seleccionadas en el paso anterior.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
                  {idsEspecialidades.map((id) => {
                    const esp = especialidades.find(
                      (e) => e.id_especialidad === id
                    );
                    if (!esp) return null;
                    const checked = atenderPorEsp[id] ?? true;
                    return (
                      <div
                        key={id}
                        className="rounded-lg bg-gray-50 p-3 flex items-center gap-2"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setAtenderPorEsp((prev) => ({
                              ...prev,
                              [id]: e.target.checked,
                            }));
                            setErrors((prev) => ({
                              ...prev,
                              atender_especialidades: undefined,
                            }));
                          }}
                        />
                        <span className="text-sm">
                          {esp.nombre}{" "}
                          <span className="text-gray-500">
                            {universidadesPorEsp[id]
                              ? `— ${universidadesPorEsp[id]}`
                              : ""}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Días / horarios */}
            <div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Días de trabajo y horarios
                </label>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                Horario laboral: {MIN_TIME}–{MAX_TIME}.{" "}
                <strong>
                  No se atiende de {LUNCH_START} a {LUNCH_END}
                </strong>{" "}
                (almuerzo).
              </p>
              {errors["dias_trabajo"] && (
                <p className="text-red-600 text-sm mt-1">
                  {errors["dias_trabajo"]}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
                {DAY_LABELS.map((label, idx) => {
                  const cfg = diasTrabajo[idx];
                  return (
                    <div key={idx} className="rounded-lg bg-gray-50 p-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={cfg.enabled}
                          onChange={(e) => {
                            setDiasTrabajo((prev) => ({
                              ...prev,
                              [idx]: {
                                ...prev[idx],
                                enabled: e.target.checked,
                              },
                            }));
                            setErrors((prev) => ({
                              ...prev,
                              dias_trabajo: undefined,
                              [`dia_${idx}_inicio`]: undefined,
                              [`dia_${idx}_fin`]: undefined,
                              [`dia_${idx}_rango`]: undefined,
                            }));
                          }}
                        />
                        <span>{label}</span>
                      </label>

                      {cfg.enabled && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-600">
                              Inicio (min {MIN_TIME})
                            </label>
                            <input
                              type="time"
                              min={MIN_TIME}
                              max={MAX_TIME}
                              value={cfg.inicio}
                              onChange={(e) => {
                                const v = e.target.value;
                                setDiasTrabajo((prev) => ({
                                  ...prev,
                                  [idx]: {
                                    ...prev[idx],
                                    inicio: v,
                                  },
                                }));
                                setErrors((prev) => ({
                                  ...prev,
                                  [`dia_${idx}_inicio`]: undefined,
                                  [`dia_${idx}_rango`]: undefined,
                                }));
                              }}
                              className={inputClass(`dia_${idx}_inicio`)}
                            />
                            {errors[`dia_${idx}_inicio`] && (
                              <p className="text-red-600 text-xs mt-1">
                                {errors[`dia_${idx}_inicio`]}
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-gray-600">
                              Fin (max {MAX_TIME})
                            </label>
                            <input
                              type="time"
                              min={MIN_TIME}
                              max={MAX_TIME}
                              value={cfg.fin}
                              onChange={(e) => {
                                const v = e.target.value;
                                setDiasTrabajo((prev) => ({
                                  ...prev,
                                  [idx]: { ...prev[idx], fin: v },
                                }));
                                setErrors((prev) => ({
                                  ...prev,
                                  [`dia_${idx}_fin`]: undefined,
                                  [`dia_${idx}_rango`]: undefined,
                                }));
                              }}
                              className={inputClass(`dia_${idx}_fin`)}
                            />
                            {errors[`dia_${idx}_fin`] && (
                              <p className="text-red-600 text-xs mt-1">
                                {errors[`dia_${idx}_fin`]}
                              </p>
                            )}
                          </div>
                          {errors[`dia_${idx}_rango`] && (
                            <div className="col-span-2">
                              <p className="text-red-600 text-xs">
                                {errors[`dia_${idx}_rango`]}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-lg border px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                Atrás
              </button>
              <div className="flex items-center gap-3">
                <Link
                  to="/admin/odontologos"
                  className="text-sm text-gray-600 hover:underline"
                >
                  Cancelar
                </Link>
                <button
                  type="button"
                  onClick={() => (validateStep3() ? setStep(4) : null)}
                  className="rounded-lg px-5 py-2 font-medium text-white"
                  style={{ backgroundColor: PRIMARY }}
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PASO 4: Revisión */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="font-semibold">Revisión</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <strong>Nombre:</strong> {u.primer_nombre} {u.segundo_nombre}{" "}
                {u.primer_apellido} {u.segundo_apellido}
              </div>
              <div>
                <strong>Cédula:</strong> {u.cedula}
              </div>
              <div>
                <strong>Correo:</strong> {u.email}
              </div>
              <div>
                <strong>Celular:</strong> {u.celular}
              </div>
              <div>
                <strong>Sexo:</strong> {sexoLabel(u.sexo)}
              </div>
              <div>
                <strong>Tipo de sangre:</strong> {u.tipo_sangre}
              </div>
              <div>
                <strong>Estado:</strong> Activo
              </div>
              <div>
                <strong>Consultorio defecto:</strong>{" "}
                {consultorios.find(
                  (c) => c.id_consultorio === idConsultorioDefecto
                )?.numero ?? "—"}
              </div>

              <div className="sm:col-span-2">
                <strong>Especialidades seleccionadas:</strong>{" "}
                {selectedEspNames || "—"}
              </div>
              <div className="sm:col-span-2">
                <strong>Atenderá estas especialidades:</strong>{" "}
                {idsEspecialidades
                  .filter((id) => atenderPorEsp[id])
                  .map(
                    (id) =>
                      especialidades.find((e) => e.id_especialidad === id)
                        ?.nombre
                  )
                  .filter(Boolean)
                  .join(", ") || "—"}
              </div>
              <div className="sm:col-span-2">
                <strong>No atenderá:</strong>{" "}
                {idsEspecialidades
                  .filter((id) => atenderPorEsp[id] === false)
                  .map(
                    (id) =>
                      especialidades.find((e) => e.id_especialidad === id)
                        ?.nombre
                  )
                  .filter(Boolean)
                  .join(", ") || "—"}
              </div>
              <div className="sm:col-span-2">
                <strong>Días y horarios:</strong>{" "}
                {Object.entries(diasTrabajo)
                  .filter(([, cfg]) => cfg.enabled)
                  .map(
                    ([k, cfg]) => `${DAY_LABELS[+k]} ${cfg.inicio}-${cfg.fin}`
                  )
                  .join(", ") || "—"}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="rounded-lg border px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                Atrás
              </button>
              <div className="flex items-center gap-3">
                <Link
                  to="/admin/odontologos"
                  className="text-sm text-gray-600 hover:underline"
                >
                  Cancelar
                </Link>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg px-5 py-2 font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: PRIMARY }}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  {loading ? "Guardando…" : "Guardar odontólogo"}
                </button>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
