// src/pages/RegistroPaciente.tsx
import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/axios";
import { publicApi } from "../api/publicApi";
import { Eye, EyeOff, User } from "lucide-react";
import logoUrl from "../assets/oralflow-logo.png";
import heroImg from "../assets/diente-login.png";

const PRIMARY = "#0070B7";

// Lista de antecedentes desde la BD
type AntecedenteOpt = { id: number; nombre: string };

/** Valores que espera el backend (minúsculas) */
type FamiliarRel = "padres" | "hermanos" | "abuelos" | "propio";
type PersonalRow = { id: string; sel: number | "" };
type FamiliarRow = {
  id: string;
  sel: number | "";
  relacion: Exclude<FamiliarRel, "propio">;
};

const makeId = (() => {
  let counter = 0;
  return () => `antecedente_${++counter}_${Date.now()}`;
})();

/* ===========================
   Helpers de validación
=========================== */

// Cédula Ecuador (persona natural)
function isValidCedulaEC(ci: string): boolean {
  if (!/^\d{10}$/.test(ci)) return false;
  const provincia = parseInt(ci.slice(0, 2), 10);
  if (provincia < 1 || (provincia > 24 && provincia !== 30)) return false;
  const tercer = parseInt(ci[2], 10);
  if (tercer >= 6) return false;
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let prod = coef[i] * parseInt(ci[i], 10);
    if (prod >= 10) prod -= 9;
    suma += prod;
  }
  const mod = suma % 10;
  const digitoVerif = mod === 0 ? 0 : 10 - mod;
  return digitoVerif === parseInt(ci[9], 10);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function atLeastSixMonthsOld(isoDate: string): boolean {
  if (!isoDate) return false;
  const birth = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(birth.getTime())) return false;
  const now = new Date();
  const sixMonthsAgo = new Date(
    now.getFullYear(),
    now.getMonth() - 6,
    now.getDate()
  );
  return birth <= sixMonthsAgo;
}

function fullNameTwoWords(name: string): boolean {
  return /^\s*\S+\s+\S+(\s+\S+)*\s*$/.test(name);
}

// Contraseña fuerte: 6+ caracteres, al menos 1 mayúscula y 1 dígito
function isStrongPassword(pwd: string) {
  return /^(?=.*[A-Z])(?=.*\d).{6,}$/.test(pwd);
}

// Debounce simple
function useDebouncedCallback(cb: () => void, delay = 400) {
  const t = useRef<number | undefined>(undefined as any);
  return () => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(cb, delay);
  };
}

/* ===========================
   Componente
=========================== */

export default function RegistroPaciente() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);
  const [errorTop, setErrorTop] = useState("");

  const [antecedentes, setAntecedentes] = useState<AntecedenteOpt[]>([]);
  const [loadingAnt, setLoadingAnt] = useState<boolean>(true);
  const [errorAnt, setErrorAnt] = useState<string>("");

  // Toast de éxito
  const [showSuccess, setShowSuccess] = useState(false);

  // Verificación remota (cédula/email/celular)
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

  // Cargar antecedentes desde API pública (dentro del componente)
  useEffect(() => {
    let cancel = false;

    async function fetchAntecedentes() {
      try {
        setLoadingAnt(true);
        setErrorAnt("");
        const all: AntecedenteOpt[] = [];

        let url: string | null = "/antecedentes/";
        while (url) {
          const resp: { data: { results?: any[]; next?: string } | any[] } =
            await publicApi.get<{ results?: any[]; next?: string } | any[]>(
              url
            );
          const data = resp.data;
          const itemsRaw = Array.isArray(data) ? data : data.results ?? [];
          const items = itemsRaw.map((a: any) => ({
            id: a.id_antecedente ?? a.id ?? a.pk,
            nombre: a.nombre,
          }));
          all.push(...items);
          url = Array.isArray(data)
            ? null
            : (data as { next?: string }).next ?? null;
        }

        if (!cancel) setAntecedentes(all);
      } catch (e) {
        console.error("Error cargando antecedentes", e);
        if (!cancel) setErrorAnt("No se pudieron cargar los antecedentes.");
      } finally {
        if (!cancel) setLoadingAnt(false);
      }
    }

    fetchAntecedentes();
    return () => {
      cancel = true;
    };
  }, []);

  // Estados de errores por campo
  type Errors = Partial<
    Record<
      | "primer_nombre"
      | "primer_apellido"
      | "segundo_apellido"
      | "cedula"
      | "celular"
      | "email"
      | "fecha_nacimiento"
      | "password"
      | "password2"
      | "sexo"
      | "tipo_sangre"
      | "contacto_emergencia_nom"
      | "contacto_emergencia_cel"
      | "parSelect",
      string
    >
  >;
  const [errors, setErrors] = useState<Errors>({});

  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  // Paso 1: datos personales
  const [personal, setPersonal] = useState({
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
  });

  // === Validación en vivo de contraseña ===
  const [pwdTouched, setPwdTouched] = useState(false);
  const [pwd2Touched, setPwd2Touched] = useState(false);
  const pwd = personal.password ?? "";
  const pwd2 = personal.password2 ?? "";
  const pwdHasMin = pwd.length >= 6;
  const pwdHasUpper = /[A-Z]/.test(pwd);
  const pwdHasDigit = /\d/.test(pwd);
  const pwdStrong = pwdHasMin && pwdHasUpper && pwdHasDigit;
  const pwdMatch = pwd.length > 0 && pwd2.length > 0 && pwd === pwd2;

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

  // Paso 2: datos clínicos
  const [clinico, setClinico] = useState({ sexo: "", tipo_sangre: "" });

  // Foto (en Paso 1) con preview y botones
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const fotoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!foto) {
      setFotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setFotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  const handleSelectFoto: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (f) setFoto(f);
  };
  const handleClearFoto = () => {
    setFoto(null);
    if (fotoInputRef.current) fotoInputRef.current.value = "";
  };

  // Paso 3: contacto de emergencia
  const [emergencia, setEmergencia] = useState({
    contacto_emergencia_nom: "",
    contacto_emergencia_cel: "",
    parSelect: "", // hijos|padres|hermanos|abuelos|esposos|otros
  });

  // Antecedentes
  const [propias, setPropias] = useState<PersonalRow[]>([]);
  const [familiares, setFamiliares] = useState<FamiliarRow[]>([]);

  // --- LÍMITES y flags de integridad ---
  const MAX_PROP = 3;
  const MAX_FAM = 3;
  const propiasIncomplete = propias.some((p) => !p.sel);
  const familiaresIncomplete = familiares.some((f) => !f.sel); // relacion siempre tiene valor

  // Helpers de UI
  const onChange = (
    setter: React.Dispatch<React.SetStateAction<any>>,
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setter((s: any) => ({ ...s, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
    if (name === "cedula") setCedulaExists(null);
    if (name === "email") setEmailExists(null);
    if (name === "celular") setCelularExists(null);
  };

  const handleNumeric =
    <T extends Record<string, any>>(
      setter: React.Dispatch<React.SetStateAction<T>>,
      field: keyof T,
      maxLen: number
    ) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.replace(/\D/g, "").slice(0, maxLen);
      setter((prev) => ({ ...prev, [field]: val }));
      setErrors((prev) => ({ ...prev, [field as string]: "" }));
      if (field === "cedula") setCedulaExists(null);
      if (field === "celular") setCelularExists(null);
    };

  // --- Verificación remota de unicidad (público) ---
  const verificarUnico = async (opts: {
    cedula?: string;
    email?: string;
    celular?: string;
  }) => {
    try {
      const params: Record<string, string> = {};
      if (opts.cedula) params.cedula = opts.cedula;
      if (opts.email) params.email = opts.email;
      if (opts.celular) params.celular = opts.celular;

      if (params.cedula) setCheckingCedula(true);
      if (params.email) setCheckingEmail(true);
      if (params.celular) setCheckingCelular(true);

      const { data } = await publicApi.get(`/usuarios/verificar/`, { params });

      // Actualiza solo si coincide con lo último consultado
      if (data.cedula && lastQueried.current.cedula === data.cedula.value) {
        const exists = Boolean(data.cedula.exists);
        setCedulaExists(exists);
        setErrors((prev) => ({
          ...prev,
          cedula: exists ? "Cédula ya registrada." : "",
        }));
      }

      if (data.email && lastQueried.current.email === data.email.value) {
        const exists = Boolean(data.email.exists);
        setEmailExists(exists);
        setErrors((prev) => ({
          ...prev,
          email: exists ? "Correo ya registrado." : "",
        }));
      }

      if (data.celular && lastQueried.current.celular === data.celular.value) {
        const exists = Boolean(data.celular.exists);
        setCelularExists(exists);
        setErrors((prev) => ({
          ...prev,
          celular: exists ? "Celular ya registrado." : "",
        }));
      }
    } catch (e) {
      console.error("Fallo al verificar cedula/email/celular", e);
    } finally {
      if (opts.cedula) setCheckingCedula(false);
      if (opts.email) setCheckingEmail(false);
      if (opts.celular) setCheckingCelular(false);
    }
  };

  // Chequeos onBlur
  const handleCedulaBlur = () => {
    const c = personal.cedula;
    if (!c) return;
    if (!/^\d{10}$/.test(c) || !isValidCedulaEC(c)) {
      setErrors((p) => ({ ...p, cedula: "Cédula inválida." }));
      setCedulaExists(null);
      return;
    }
    setErrors((p) => ({ ...p, cedula: "" }));
    lastQueried.current.cedula = c;
    verificarUnico({ cedula: c });
  };

  const handleEmailBlur = () => {
    const m = personal.email.trim();
    if (!m) return;
    if (!isValidEmail(m)) {
      setErrors((p) => ({ ...p, email: "Correo inválido." }));
      setEmailExists(null);
      return;
    }
    setErrors((p) => ({ ...p, email: "" }));
    lastQueried.current.email = m;
    verificarUnico({ email: m });
  };

  const handleCelularBlur = () => {
    const c = personal.celular.trim();
    if (!c) return;
    if (!/^09\d{8}$/.test(c)) {
      setErrors((p) => ({
        ...p,
        celular: "El celular debe iniciar con 09 y tener 10 dígitos.",
      }));
      setCelularExists(null);
      return;
    }
    setErrors((p) => ({ ...p, celular: "" }));
    lastQueried.current.celular = c;
    verificarUnico({ celular: c });
  };

  // === Derivados para habilitar "Siguiente" (PASO 1) ===
  const cedulaOk =
    /^\d{10}$/.test(personal.cedula) && isValidCedulaEC(personal.cedula);
  const celularOk = /^09\d{8}$/.test(personal.celular);
  const emailOk = isValidEmail(personal.email);
  const fechaOk =
    !!personal.fecha_nacimiento &&
    atLeastSixMonthsOld(personal.fecha_nacimiento);

  const canNextStep1 = Boolean(
    pwdStrong &&
      pwdMatch &&
      cedulaOk &&
      celularOk &&
      emailOk &&
      fechaOk &&
      !checkingCedula &&
      !checkingEmail &&
      !checkingCelular &&
      cedulaExists !== true &&
      emailExists !== true &&
      celularExists !== true
  );

  // Debouncers
  const debouncedCheckCedula = useDebouncedCallback(() => {
    const c = personal.cedula;
    if (/^\d{10}$/.test(c) && isValidCedulaEC(c)) {
      lastQueried.current.cedula = c;
      verificarUnico({ cedula: c });
    } else {
      setCedulaExists(null);
    }
  }, 400);

  const debouncedCheckEmail = useDebouncedCallback(() => {
    const m = personal.email.trim();
    if (isValidEmail(m)) {
      lastQueried.current.email = m;
      verificarUnico({ email: m });
    } else {
      setEmailExists(null);
    }
  }, 400);

  const debouncedCheckCelular = useDebouncedCallback(() => {
    const c = personal.celular.trim();
    if (/^09\d{8}$/.test(c)) {
      lastQueried.current.celular = c;
      verificarUnico({ celular: c });
    } else {
      setCelularExists(null);
    }
  }, 400);

  useEffect(() => {
    if (personal.cedula) debouncedCheckCedula();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal.cedula]);

  useEffect(() => {
    if (personal.email) debouncedCheckEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal.email]);

  useEffect(() => {
    if (personal.celular) debouncedCheckCelular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal.celular]);

  // Validaciones por paso
  const validateStep1 = () => {
    const newErrors: Errors = {};

    if (!personal.primer_nombre.trim())
      newErrors.primer_nombre = "El primer nombre es obligatorio.";
    if (!personal.primer_apellido.trim())
      newErrors.primer_apellido = "El primer apellido es obligatorio.";
    // segundo apellido obligatorio
    if (!personal.segundo_apellido.trim())
      newErrors.segundo_apellido = "El segundo apellido es obligatorio.";

    if (!/^\d{10}$/.test(personal.cedula) || !isValidCedulaEC(personal.cedula))
      newErrors.cedula = "Cédula inválida.";

    if (!/^09\d{8}$/.test(personal.celular))
      newErrors.celular = "El celular debe iniciar con 09 y tener 10 dígitos.";

    if (cedulaExists === true) newErrors.cedula = "Cédula ya registrada.";
    if (!isValidEmail(personal.email)) newErrors.email = "Correo inválido.";
    if (emailExists === true) newErrors.email = "Correo ya registrado.";
    if (celularExists === true) newErrors.celular = "Celular ya registrado.";

    if (!personal.fecha_nacimiento)
      newErrors.fecha_nacimiento = "La fecha de nacimiento es obligatoria.";
    else if (!atLeastSixMonthsOld(personal.fecha_nacimiento))
      newErrors.fecha_nacimiento = "Debe tener al menos 6 meses de edad.";

    if (!isStrongPassword(personal.password))
      newErrors.password = "Mín. 6 car., al menos 1 mayúscula y 1 número.";
    if (personal.password2 !== personal.password)
      newErrors.password2 = "Las contraseñas no coinciden.";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0
      ? ""
      : "Corrige los campos marcados.";
  };

  const validateStep2 = () => {
    const newErrors: Errors = {};
    if (!clinico.sexo) newErrors.sexo = "Selecciona el sexo.";
    if (!clinico.tipo_sangre)
      newErrors.tipo_sangre = "Selecciona el tipo de sangre.";
    setErrors((prev) => ({ ...prev, ...newErrors }));

    // Reglas adicionales: no filas vacías y máximo 3
    if (propiasIncomplete)
      return "Selecciona cada enfermedad propia o quítala.";
    if (familiaresIncomplete)
      return "Selecciona cada antecedente familiar o quítalo.";
    if (propias.length > MAX_PROP)
      return "Solo puedes añadir hasta 3 enfermedades propias.";
    if (familiares.length > MAX_FAM)
      return "Solo puedes añadir hasta 3 antecedentes familiares.";

    return Object.keys(newErrors).length === 0
      ? ""
      : "Completa los campos requeridos.";
  };

  const validateStep3 = () => {
    const newErrors: Errors = {};
    if (!fullNameTwoWords(emergencia.contacto_emergencia_nom))
      newErrors.contacto_emergencia_nom =
        "Ingresa nombre y apellido del contacto.";
    if (!/^09\d{8}$/.test(emergencia.contacto_emergencia_cel))
      newErrors.contacto_emergencia_cel =
        "El celular debe iniciar con 09 y tener 10 dígitos.";
    if (!emergencia.parSelect)
      newErrors.parSelect = "Selecciona el parentesco.";
    setErrors((prev) => ({ ...prev, ...newErrors }));
    return Object.keys(newErrors).length === 0
      ? ""
      : "Corrige los datos del contacto.";
  };

  const next = () => {
    setErrorTop("");
    if (step === 1) {
      const e = validateStep1();
      if (e) return setErrorTop(e);
      setStep(2);
    } else if (step === 2) {
      const e = validateStep2();
      if (e) return setErrorTop(e);
      setStep(3);
    } else if (step === 3) {
      const e = validateStep3();
      if (e) return setErrorTop(e);
      setStep(4);
    }
  };

  const back = () => {
    setErrorTop("");
    setStep((s) => (s === 4 ? 3 : s === 3 ? 2 : 1));
  };

  // Estilo condicional para inputs con error
  const inputClass = (field?: keyof Errors) =>
    `w-full rounded-lg border px-4 py-2 ${
      field && errors[field]
        ? "border-red-500 focus:ring-2 focus:ring-red-500"
        : "border-gray-300"
    }`;

  // Enviar todo
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorTop("");

    // Si no estamos en el último paso, avanzar con validación
    if (step < 4) return next();

    try {
      setLoading(true);

      // 1) Crear Usuario (público)
      const fd = new FormData();
      Object.entries({
        ...personal,
        password: personal.password,
        id_rol: "2",
        sexo: clinico.sexo, // 'M' | 'F'
        tipo_sangre: clinico.tipo_sangre,
      }).forEach(([k, v]) => fd.append(k, String(v)));
      fd.delete("password2");
      fd.append("activo", "true");
      if (foto) fd.append("foto", foto);

      const userRes = await publicApi.post(`/usuarios/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const id_usuario = userRes.data.id_usuario;

      // 2) Login inmediato (público) para crear entidades protegidas
      const tokenRes = await publicApi.post(`/token/`, {
        email: personal.email,
        password: personal.password,
      });
      const access = tokenRes.data.access as string;
      const refresh = tokenRes.data.refresh as string;

      // Deja tokens en sessionStorage y marca storage para la instancia `api`
      sessionStorage.setItem("accessToken", access);
      sessionStorage.setItem("refreshToken", refresh);
      localStorage.setItem("tokenStore", "session");

      // 3) Crear Paciente (protegido) con `api`
      const pacRes = await api.post(`/pacientes/`, {
        id_usuario,
        contacto_emergencia_nom: emergencia.contacto_emergencia_nom,
        contacto_emergencia_cel: emergencia.contacto_emergencia_cel,
        contacto_emergencia_par: emergencia.parSelect, // minúsculas
      });
      const id_paciente =
        pacRes.data.id_paciente ?? pacRes.data.id ?? pacRes.data.pk;

      // 4) Registrar ENFERMEDADES PROPIAS (protegido) -> relacion_familiar = 'propio'
      for (const row of propias) {
        if (id_paciente && row.sel) {
          await api.post(`/paciente-antecedentes/`, {
            id_paciente,
            id_antecedente: row.sel,
            relacion_familiar: "propio",
          });
        }
      }

      // 5) Registrar ANTECEDENTES FAMILIARES (protegido) -> padres|hermanos|abuelos
      for (const row of familiares) {
        if (id_paciente && row.sel) {
          await api.post(`/paciente-antecedentes/`, {
            id_paciente,
            id_antecedente: row.sel,
            relacion_familiar: row.relacion,
          });
        }
      }

      // 6) Limpiar tokens (no queda logueado) y mostrar toast
      sessionStorage.removeItem("accessToken");
      sessionStorage.removeItem("refreshToken");
      localStorage.removeItem("tokenStore");

      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        navigate("/login");
      }, 1200);
    } catch (err: any) {
      console.error("Registro falló:", err?.response?.data || err);
      setErrorTop(
        err?.response?.data
          ? JSON.stringify(err.response.data)
          : "No se pudo completar el registro. Intenta nuevamente."
      );
    } finally {
      setLoading(false);
    }
  };

  // Subcomponentes UI
  const AntecedenteSelect = ({
    value,
    onChangeSel,
    withRelacion,
    relacion,
    onChangeRelacion,
  }: {
    value: number | "";
    onChangeSel: (val: number | "") => void;
    withRelacion?: boolean;
    relacion?: Exclude<FamiliarRel, "propio">;
    onChangeRelacion?: (rel: Exclude<FamiliarRel, "propio">) => void;
  }) => {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
          value={value === "" ? "" : String(value)}
          onChange={(e) =>
            onChangeSel(e.target.value === "" ? "" : Number(e.target.value))
          }
          disabled={loadingAnt || !!errorAnt}
        >
          <option value="">
            {loadingAnt
              ? "Cargando antecedentes…"
              : errorAnt
              ? "Error"
              : "Selecciona antecedente…"}
          </option>

          {!loadingAnt &&
            !errorAnt &&
            antecedentes.map((opt) => (
              <option key={opt.id} value={String(opt.id)}>
                {opt.nombre}
              </option>
            ))}
        </select>

        {withRelacion && (
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            value={relacion}
            onChange={(e) =>
              onChangeRelacion?.(
                e.target.value as Exclude<FamiliarRel, "propio">
              )
            }
          >
            <option value="padres">Padres</option>
            <option value="hermanos">Hermanos</option>
            <option value="abuelos">Abuelos</option>
          </select>
        )}
      </div>
    );
  };

  const sexoLabel = (s: string) =>
    s === "M" ? "Masculino" : s === "F" ? "Femenino" : "—";
  const nombreAntecedente = (id: number) =>
    antecedentes.find((a) => a.id === id)?.nombre ?? `#${id}`;

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      {/* Toast de éxito */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in zoom-in duration-200">
          <div className="rounded-xl bg-green-600 text-white shadow-lg px-4 py-3">
            <div className="font-semibold">¡Paciente registrado!</div>
            <div className="text-sm text-white/90">
              Redirigiendo al inicio de sesión…
            </div>
          </div>
        </div>
      )}

      {/* Columna izquierda */}
      <div className="relative px-8 py-10 flex items-start justify-center">
        <div className="fixed lg:absolute left-4 top-4 lg:left-8 lg:top-6 z-20">
          <img src={logoUrl} alt="OralFlow" className="h-16 w-auto" />
        </div>

        <div className="w-full max-w-xl mt-24">
          {/* Stepper */}
          <div className="mb-6 flex items-center justify-center gap-6">
            {[
              { n: 1, t: "Datos personales" },
              { n: 2, t: "Datos clínicos" },
              { n: 3, t: "Contacto de emergencia" },
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
                <span className="hidden sm:block text-sm text-gray-700">
                  {s.t}
                </span>
              </div>
            ))}
          </div>

          <h1 className="text-3xl font-semibold text-center text-gray-900 mb-4">
            Registrarse
          </h1>

          {errorTop && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorTop}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* PASO 1: Foto + Datos personales */}
            {step === 1 && (
              <>
                {/* Foto (opcional) */}
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
                        id="fotoPacientePublic"
                        ref={fotoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleSelectFoto}
                      />
                      <label
                        htmlFor="fotoPacientePublic"
                        className="cursor-pointer rounded-lg bg-gray-800 text-white px-4 py-2 shadow hover:bg-black/80"
                      >
                        Seleccionar archivo
                      </label>

                      {foto && (
                        <button
                          type="button"
                          onClick={handleClearFoto}
                          className="rounded-lg border bg-white px-4 py-2 hover:bg-gray-50"
                          title="Quitar la foto seleccionada"
                        >
                          Quitar selección
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 mt-2">
                    Formatos: JPG/PNG. Recomendado: imagen cuadrada para mejor
                    encuadre.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Primer nombre
                    </label>
                    <input
                      name="primer_nombre"
                      value={personal.primer_nombre}
                      onChange={(e) => onChange(setPersonal, e)}
                      className={inputClass("primer_nombre")}
                      required
                    />
                    {errors.primer_nombre && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.primer_nombre}
                      </p>
                    )}
                  </div>
                  {/* Segundo nombre OPCIONAL */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Segundo nombre (Opcional)
                    </label>
                    <input
                      name="segundo_nombre"
                      value={personal.segundo_nombre}
                      onChange={(e) => onChange(setPersonal, e)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Primer apellido
                    </label>
                    <input
                      name="primer_apellido"
                      value={personal.primer_apellido}
                      onChange={(e) => onChange(setPersonal, e)}
                      className={inputClass("primer_apellido")}
                      required
                    />
                    {errors.primer_apellido && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.primer_apellido}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Segundo apellido
                    </label>
                    <input
                      name="segundo_apellido"
                      value={personal.segundo_apellido}
                      onChange={(e) => onChange(setPersonal, e)}
                      className={inputClass("segundo_apellido")}
                      required
                    />
                    {errors.segundo_apellido && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.segundo_apellido}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Cédula
                    </label>
                    <input
                      name="cedula"
                      value={personal.cedula}
                      onChange={handleNumeric(setPersonal, "cedula", 10)}
                      onBlur={handleCedulaBlur}
                      className={inputClass("cedula")}
                      placeholder="10 dígitos"
                      inputMode="numeric"
                      maxLength={10}
                      pattern="\\d{10}"
                      required
                    />
                    {errors.cedula && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.cedula}
                      </p>
                    )}
                    {checkingCedula && !errors.cedula && (
                      <p className="mt-1 text-xs text-gray-500">
                        Verificando cédula…
                      </p>
                    )}
                    {cedulaExists === false && !errors.cedula && (
                      <p className="mt-1 text-xs text-green-600">
                        Cédula validada
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Celular
                    </label>
                    <input
                      name="celular"
                      value={personal.celular}
                      onChange={handleNumeric(setPersonal, "celular", 10)}
                      onBlur={handleCelularBlur}
                      className={inputClass("celular")}
                      placeholder="09xxxxxxxx"
                      inputMode="numeric"
                      maxLength={10}
                      pattern="^09\\d{8}$"
                      required
                    />
                    {errors.celular && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.celular}
                      </p>
                    )}
                    {checkingCelular && !errors.celular && (
                      <p className="mt-1 text-xs text-gray-500">
                        Verificando celular…
                      </p>
                    )}
                    {celularExists === false && !errors.celular && (
                      <p className="mt-1 text-xs text-green-600">
                        Celular validado
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Correo
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={personal.email}
                      onChange={(e) => onChange(setPersonal, e)}
                      onBlur={handleEmailBlur}
                      className={inputClass("email")}
                      required
                    />
                    {errors.email && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.email}
                      </p>
                    )}
                    {checkingEmail && !errors.email && (
                      <p className="mt-1 text-xs text-gray-500">
                        Verificando correo…
                      </p>
                    )}
                    {emailExists === false && !errors.email && (
                      <p className="mt-1 text-xs text-green-600">
                        Correo validado
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Fecha de nacimiento
                    </label>
                    <input
                      type="date"
                      name="fecha_nacimiento"
                      value={personal.fecha_nacimiento}
                      onChange={(e) => onChange(setPersonal, e)}
                      className={inputClass("fecha_nacimiento")}
                      required
                    />
                    {errors.fecha_nacimiento && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.fecha_nacimiento}
                      </p>
                    )}
                  </div>
                </div>

                {/* === CONTRASEÑA con validación en vivo === */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Contraseña
                    </label>
                    <div className="relative">
                      <input
                        type={showPass1 ? "text" : "password"}
                        name="password"
                        value={personal.password}
                        onChange={(e) => {
                          onChange(setPersonal, e);
                          if (!pwdTouched) setPwdTouched(true);
                        }}
                        onFocus={() => setPwdTouched(true)}
                        className={`w-full rounded-lg border px-4 py-2 pr-12 ${borderForPwdField(
                          pwdStrong,
                          pwdTouched,
                          (personal.password ?? "").length === 0
                        )}`}
                        required
                        aria-invalid={!!errors.password}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass1((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
                        aria-label={
                          showPass1
                            ? "Ocultar contraseña"
                            : "Mostrar contraseña"
                        }
                        title={
                          showPass1
                            ? "Ocultar contraseña"
                            : "Mostrar contraseña"
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
                    <ul className="mt-2 text-xs space-y-1" aria-live="polite">
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

                    {errors.password && pwdTouched && !pwdStrong && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.password}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Repite la contraseña
                    </label>
                    <div className="relative">
                      <input
                        type={showPass2 ? "text" : "password"}
                        name="password2"
                        value={personal.password2}
                        onChange={(e) => {
                          onChange(setPersonal, e);
                          if (!pwd2Touched) setPwd2Touched(true);
                        }}
                        onFocus={() => setPwd2Touched(true)}
                        className={`w-full rounded-lg border px-4 py-2 pr-12 ${borderForPwdField(
                          pwdMatch,
                          pwd2Touched,
                          (personal.password2 ?? "").length === 0
                        )}`}
                        required
                        aria-invalid={!!errors.password2}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass2((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
                        aria-label={
                          showPass2
                            ? "Ocultar contraseña"
                            : "Mostrar contraseña"
                        }
                        title={
                          showPass2
                            ? "Ocultar contraseña"
                            : "Mostrar contraseña"
                        }
                      >
                        {showPass2 ? (
                          <EyeOff className="h-5 w-5" />
                        ) : (
                          <Eye className="h-5 w-5" />
                        )}
                      </button>
                    </div>

                    <p
                      className={`mt-1 text-xs ${
                        !pwd2Touched && (personal.password2 ?? "").length === 0
                          ? "text-gray-500"
                          : pwdMatch
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {!pwd2Touched &&
                        (personal.password2 ?? "").length === 0 &&
                        "Vuelve a escribir la contraseña."}
                      {pwd2Touched &&
                        !pwdMatch &&
                        "Las contraseñas no coinciden."}
                      {pwd2Touched &&
                        pwdMatch &&
                        "Ambas contraseñas coinciden."}
                    </p>

                    {errors.password2 && pwd2Touched && !pwdMatch && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.password2}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Link
                    to="/login"
                    className="inline-flex items-center h-10 leading-none text-sm text-gray-600 hover:underline"
                  >
                    ¿Ya tienes cuenta? Inicia sesión
                  </Link>
                  <button
                    type="button"
                    onClick={next}
                    disabled={!canNextStep1}
                    className="inline-flex items-center justify-center h-10 rounded-lg px-5 font-medium text-white disabled:opacity-70"
                    style={{ backgroundColor: PRIMARY }}
                  >
                    Siguiente
                  </button>
                </div>
              </>
            )}

            {/* PASO 2: Datos clínicos + Antecedentes */}
            {step === 2 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Sexo
                  </label>
                  <select
                    name="sexo"
                    value={clinico.sexo}
                    onChange={(e) => onChange(setClinico, e)}
                    className={inputClass("sexo")}
                    required
                  >
                    <option value="">Selecciona…</option>
                    <option value="M">Masculino</option>
                    <option value="F">Femenino</option>
                  </select>
                  {errors.sexo && (
                    <p className="mt-1 text-sm text-red-600">{errors.sexo}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Tipo de sangre
                  </label>
                  <select
                    name="tipo_sangre"
                    value={clinico.tipo_sangre}
                    onChange={(e) => onChange(setClinico, e)}
                    className={inputClass("tipo_sangre")}
                    required
                  >
                    <option value="">Selecciona…</option>
                    <option value="Desconocido">Desconocido</option>
                    {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
                      (g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      )
                    )}
                  </select>
                  {errors.tipo_sangre && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.tipo_sangre}
                    </p>
                  )}
                </div>

                {/* Enfermedades propias */}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">
                    Enfermedades propias (opcional)
                  </h3>

                  {propias.length === 0 && (
                    <p className="text-sm text-gray-500 mb-2">
                      No has añadido ninguna.
                    </p>
                  )}

                  <div className="space-y-3">
                    {propias.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-lg border border-gray-200 p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <AntecedenteSelect
                            value={row.sel}
                            onChangeSel={(val) =>
                              setPropias((arr) =>
                                arr.map((r) =>
                                  r.id === row.id ? { ...r, sel: val } : r
                                )
                              )
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setPropias((arr) =>
                                arr.filter((r) => r.id !== row.id)
                              )
                            }
                            className="self-start rounded-md border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (propias.length >= MAX_PROP || propiasIncomplete)
                        return;
                      setPropias((arr) => [...arr, { id: makeId(), sel: "" }]);
                    }}
                    className="mt-3 rounded-lg px-4 py-2 text-white disabled:opacity-60"
                    style={{ backgroundColor: PRIMARY }}
                    disabled={
                      loadingAnt ||
                      !!errorAnt ||
                      antecedentes.length === 0 ||
                      propias.length >= MAX_PROP ||
                      propiasIncomplete
                    }
                  >
                    {propias.length >= MAX_PROP
                      ? "Límite alcanzado (3)"
                      : "Añadir enfermedad propia"}
                  </button>

                  {propiasIncomplete && (
                    <p className="mt-1 text-xs text-red-600">
                      Primero selecciona la enfermedad anterior o quítala.
                    </p>
                  )}
                </div>

                {/* Antecedentes familiares */}
                <div className="mt-8">
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">
                    Antecedentes familiares (opcional)
                  </h3>

                  {familiares.length === 0 && (
                    <p className="text-sm text-gray-500 mb-2">
                      No has añadido ninguno.
                    </p>
                  )}

                  <div className="space-y-3">
                    {familiares.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-lg border border-gray-200 p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <AntecedenteSelect
                            value={row.sel}
                            onChangeSel={(val) =>
                              setFamiliares((arr) =>
                                arr.map((r) =>
                                  r.id === row.id ? { ...r, sel: val } : r
                                )
                              )
                            }
                            withRelacion
                            relacion={row.relacion}
                            onChangeRelacion={(rel) =>
                              setFamiliares((arr) =>
                                arr.map((r) =>
                                  r.id === row.id ? { ...r, relacion: rel } : r
                                )
                              )
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setFamiliares((arr) =>
                                arr.filter((r) => r.id !== row.id)
                              )
                            }
                            className="self-start sm:ml-auto rounded-md border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (familiares.length >= MAX_FAM || familiaresIncomplete)
                        return;
                      setFamiliares((arr) => [
                        ...arr,
                        { id: makeId(), sel: "", relacion: "padres" },
                      ]);
                    }}
                    className="mt-3 rounded-lg px-4 py-2 text-white disabled:opacity-60"
                    style={{ backgroundColor: PRIMARY }}
                    disabled={
                      familiares.length >= MAX_FAM || familiaresIncomplete
                    }
                  >
                    {familiares.length >= MAX_FAM
                      ? "Límite alcanzado (3)"
                      : "Añadir antecedente familiar"}
                  </button>

                  {familiaresIncomplete && (
                    <p className="mt-1 text-xs text-red-600">
                      Primero selecciona el antecedente anterior o quítalo.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={back}
                    className="inline-flex items-center justify-center h-10 rounded-lg border border-gray-300 px-4 text-gray-700 hover:bg-gray-50"
                  >
                    Atrás
                  </button>

                  <div className="flex gap-3">
                    <Link
                      to="/login"
                      className="inline-flex items-center h-10 leading-none text-sm text-gray-600 hover:underline"
                    >
                      Cancelar
                    </Link>
                    <button
                      type="button"
                      onClick={next}
                      className="inline-flex items-center justify-center h-10 rounded-lg px-5 font-medium text-white"
                      style={{ backgroundColor: PRIMARY }}
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* PASO 3: Contacto de emergencia */}
            {step === 3 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Nombre contacto emergencia
                    </label>
                    <input
                      name="contacto_emergencia_nom"
                      value={emergencia.contacto_emergencia_nom}
                      onChange={(e) => onChange(setEmergencia, e)}
                      className={inputClass("contacto_emergencia_nom")}
                      placeholder="Nombre y apellido"
                      required
                    />
                    {errors.contacto_emergencia_nom && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.contacto_emergencia_nom}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Celular emergencia
                    </label>
                    <input
                      name="contacto_emergencia_cel"
                      value={emergencia.contacto_emergencia_cel}
                      onChange={handleNumeric(
                        setEmergencia,
                        "contacto_emergencia_cel",
                        10
                      )}
                      className={inputClass("contacto_emergencia_cel")}
                      placeholder="09xxxxxxxx"
                      inputMode="numeric"
                      maxLength={10}
                      required
                    />
                    {errors.contacto_emergencia_cel && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.contacto_emergencia_cel}
                      </p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Parentesco
                    </label>
                    <select
                      name="parSelect"
                      value={emergencia.parSelect}
                      onChange={(e) => onChange(setEmergencia, e)}
                      className={`w-full rounded-lg border px-4 py-2 ${
                        errors.parSelect
                          ? "border-red-500 focus:ring-2 focus:ring-red-500"
                          : "border-gray-300"
                      }`}
                      required
                    >
                      <option value="">Selecciona…</option>
                      <option value="hijos">Hijos</option>
                      <option value="padres">Padres</option>
                      <option value="hermanos">Hermanos</option>
                      <option value="abuelos">Abuelos</option>
                      <option value="esposos">Esposos</option>
                      <option value="otros">Otros</option>
                    </select>
                    {errors.parSelect && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.parSelect}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={back}
                    className="inline-flex items-center justify-center h-10 rounded-lg border border-gray-300 px-4 text-gray-700 hover:bg-gray-50"
                  >
                    Atrás
                  </button>

                  <div className="flex gap-3">
                    <Link
                      to="/login"
                      className="inline-flex items-center h-10 leading-none text-sm text-gray-600 hover:underline"
                    >
                      Cancelar
                    </Link>
                    <button
                      type="button"
                      onClick={next}
                      className="inline-flex items-center justify-center h-10 rounded-lg px-5 font-medium text-white"
                      style={{ backgroundColor: PRIMARY }}
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* PASO 4: Revisión */}
            {step === 4 && (
              <div className="space-y-4">
                <h3 className="font-semibold">Revisión</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <strong>Nombre:</strong> {personal.primer_nombre}{" "}
                    {personal.segundo_nombre} {personal.primer_apellido}{" "}
                    {personal.segundo_apellido}
                  </div>
                  <div>
                    <strong>Cédula:</strong> {personal.cedula}
                  </div>
                  <div>
                    <strong>Correo:</strong> {personal.email}
                  </div>
                  <div>
                    <strong>Celular:</strong> {personal.celular}
                  </div>
                  <div>
                    <strong>Fecha de nacimiento:</strong>{" "}
                    {personal.fecha_nacimiento || "—"}
                  </div>
                  <div>
                    <strong>Sexo:</strong> {sexoLabel(clinico.sexo)}
                  </div>
                  <div>
                    <strong>Tipo de sangre:</strong>{" "}
                    {clinico.tipo_sangre || "—"}
                  </div>

                  <div className="sm:col-span-2">
                    <strong>Enfermedades propias:</strong>{" "}
                    {propias.filter((p) => p.sel).length === 0
                      ? "—"
                      : propias
                          .filter((p) => p.sel)
                          .map((p) => nombreAntecedente(p.sel as number))
                          .join(", ")}
                  </div>
                  <div className="sm:col-span-2">
                    <strong>Antecedentes familiares:</strong>{" "}
                    {familiares.filter((f) => f.sel).length === 0
                      ? "—"
                      : familiares
                          .filter((f) => f.sel)
                          .map(
                            (f) =>
                              `${nombreAntecedente(f.sel as number)} (${
                                f.relacion
                              })`
                          )
                          .join(", ")}
                  </div>

                  <div className="sm:col-span-2">
                    <strong>Contacto de emergencia:</strong>{" "}
                    {emergencia.contacto_emergencia_nom || "—"} —{" "}
                    {emergencia.contacto_emergencia_cel || "—"} —{" "}
                    {emergencia.parSelect || "—"}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={back}
                    className="inline-flex items-center justify-center h-10 rounded-lg border px-4 text-gray-700 hover:bg-gray-50"
                  >
                    Atrás
                  </button>
                  <div className="flex items-center gap-3">
                    <Link
                      to="/login"
                      className="inline-flex items-center h-10 leading-none text-sm text-gray-600 hover:underline"
                    >
                      Cancelar
                    </Link>
                    <button
                      type="submit"
                      disabled={loading}
                      className="inline-flex items-center justify-center h-10 gap-2 rounded-lg px-5 font-medium text-white disabled:opacity-60"
                      style={{ backgroundColor: PRIMARY }}
                    >
                      {loading ? "Registrando…" : "Registrar"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Columna derecha: imagen */}
      <div className="hidden lg:block" aria-hidden="true">
        <div
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${heroImg})` }}
        />
      </div>
    </div>
  );
}
