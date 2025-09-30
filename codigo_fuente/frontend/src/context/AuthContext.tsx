// src/context/AuthContext.tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/axios";
import axios from "axios";

type RolLite = { id_rol: number; rol?: string } | number;

type OdontologoLite = {
  id_odontologo: number;
  // opcionalmente el backend puede incluir id_usuario, consultorio, etc.
  [k: string]: any;
};

export interface Usuario {
  id_usuario: number;
  email: string;
  usuario_email?: string;

  primer_nombre?: string | null;
  segundo_nombre?: string | null;
  primer_apellido?: string | null;
  segundo_apellido?: string | null;
  cedula?: string | null;
  fecha_nacimiento?: string | null;
  sexo?: string | null;
  tipo_sangre?: string | null;
  celular?: string | null;
  foto?: string | null;

  id_rol?: RolLite;
  rol_nombre?: string;

  // Flags
  is_active?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;

  // Extras que agregaremos nosotros:
  odontologo?: OdontologoLite | null;
  id_odontologo?: number | null;

  // Auditoría
  created_at?: string | null;
  updated_at?: string | null;

  [key: string]: any;
}

interface AuthContextType {
  usuario: Usuario | null;
  setUsuario: (usuario: Usuario | null) => void;
  isAuthenticated: boolean;
  refreshUsuario: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [usuario, setUsuario] = useState<Usuario | null>(() => {
    const stored = localStorage.getItem("usuario");
    return stored ? JSON.parse(stored) : null;
  });

  // Persistencia en localStorage
  useEffect(() => {
    if (usuario) localStorage.setItem("usuario", JSON.stringify(usuario));
    else localStorage.removeItem("usuario");
  }, [usuario]);

  // Setea Authorization si hay token persistido
  useEffect(() => {
    const token =
      localStorage.getItem("accessToken") ||
      sessionStorage.getItem("accessToken");
    if (token) {
      axios.defaults.headers.common.Authorization = `Bearer ${token}`;
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common.Authorization;
      delete (api.defaults.headers.common as any).Authorization;
    }
  }, []);

  // Trae /usuarios/me y, si existe, /odontologos/me. Fusiona ambos.
  const refreshUsuario = async () => {
    try {
      const { data: me } = await api.get("/usuarios/me/");
      let merged: Usuario = { ...(me as Usuario) };

      // si el usuario es odontólogo (id_rol=3) o por si acaso, consultamos /odontologos/me
      try {
        const { data: odo } = await api.get("/odontologos/me/");
        if (odo && typeof odo.id_odontologo === "number") {
          merged = {
            ...merged,
            odontologo: odo,
            id_odontologo: odo.id_odontologo,
          };
        } else {
          // no está vinculado a un odontólogo
          merged = { ...merged, odontologo: null, id_odontologo: null };
        }
      } catch {
        // si falla, no rompemos la sesión; solo limpiamos los campos
        merged = { ...merged, odontologo: null, id_odontologo: null };
      }

      setUsuario(merged);
      localStorage.setItem("usuario", JSON.stringify(merged));
    } catch {
      // Token inválido o error → limpiar todo
      setUsuario(null);
      localStorage.removeItem("usuario");
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      sessionStorage.removeItem("accessToken");
      sessionStorage.removeItem("refreshToken");
      delete axios.defaults.headers.common.Authorization;
      delete (api.defaults.headers.common as any).Authorization;
    }
  };

  // Al montar: si hay token y no hay usuario en memoria, carga /me (+ odontólogo)
  useEffect(() => {
    const token =
      localStorage.getItem("accessToken") ||
      sessionStorage.getItem("accessToken");
    const hasUsuario = !!localStorage.getItem("usuario");
    if (token && !hasUsuario) {
      refreshUsuario();
    }
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      usuario,
      setUsuario,
      isAuthenticated: !!usuario,
      refreshUsuario,
    }),
    [usuario]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
