// src/api/auth.ts
import { publicApi } from "./publicApi";
import { api } from "./axios";

// Login con cédula 
export async function login(cedula: string, password: string) {
  try {
    const { data } = await publicApi.post(`/token/`, { cedula, password });
    return { success: true, data };
  } catch (error: any) {
    // Capturar errores personalizados del backend
    if (error.response?.data) {
      const errorData = error.response.data;
      
      // Error de cuenta DESACTIVADA (20+ intentos)
      if (errorData.desactivada || errorData.requiere_admin) {
        return {
          success: false,
          desactivada: true,
          requiereAdmin: true,
          mensaje: errorData.detail || "Cuenta desactivada por múltiples intentos fallidos. Contacta al administrador."
        };
      }
      
      // Error de cuenta bloqueada temporalmente (5-19 intentos)
      if (errorData.bloqueado) {
        return {
          success: false,
          bloqueado: true,
          minutosRestantes: errorData.minutos_restantes || errorData.minutos_restante,
          mensaje: errorData.detail || "Cuenta bloqueada temporalmente"
        };
      }
      
      // Error con intentos restantes (1-4 intentos)
      if (errorData.intentos_restantes !== undefined) {
        return {
          success: false,
          bloqueado: false,
          intentosRestantes: errorData.intentos_restantes,
          mensaje: errorData.detail || "Credenciales incorrectas"
        };
      }
      
      // Error genérico
      return {
        success: false,
        bloqueado: false,
        mensaje: errorData.detail || "Credenciales incorrectas o error de conexión"
      };
    }
    
    // Error de conexión u otro
    return {
      success: false,
      bloqueado: false,
      mensaje: "Error de conexión con el servidor"
    };
  }
}

// Perfil actual (con token, usa api para soportar refresh) 
export async function getProfile() {
  const { data } = await api.get(`/usuarios/me/`);
  return data; // { id_usuario, email, id_rol, ... }
}

// Obtener roles activos de un usuario 
export async function getRolesActivos(userId: number) {
  const { data } = await api.get(`/usuarios/${userId}/roles-activos/`);
  return data; 
  // { id_usuario, email, rol_principal, rol_principal_nombre, es_paciente, es_odontologo, id_paciente, id_odontologo }
}

// Verificar si usuario tiene rol de paciente 
export async function verificarRolPaciente(userId: number) {
  try {
    const { data } = await api.get(`/usuarios/${userId}/verificar-rol-paciente/`);
    return data; // { existe: true, id_paciente, ... }
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { existe: false };
    }
    throw error;
  }
}

// Verificar si usuario tiene rol de odontólogo 
export async function verificarRolOdontologo(userId: number) {
  try {
    const { data } = await api.get(`/usuarios/${userId}/verificar-rol-odontologo/`);
    return data; // { existe: true, id_odontologo, ... }
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { existe: false };
    }
    throw error;
  }
}
