// src/api/axios.ts
import axios from "axios";
import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

/** Dónde están los tokens (respeta “Recordarme”). Se marca en login con localStorage.setItem("tokenStore", "local"|"session") */
function getStore(): Storage {
  const which = localStorage.getItem("tokenStore"); // 'local' | 'session'
  return which === "session" ? sessionStorage : localStorage;
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

/** Pide un nuevo access token usando el refresh token */
async function refreshAccessToken(): Promise<string | null> {
  const store = getStore();
  const refresh = store.getItem("refreshToken");
  if (!refresh) return null;

  try {
    const res = await axios.post(`${API_BASE}/token/refresh/`, { refresh });
    const newAccess = (res.data?.access as string) ?? null;
    if (!newAccess) return null;

    store.setItem("accessToken", newAccess);
    // Deja el header por defecto en esta instancia
    api.defaults.headers.common.Authorization = `Bearer ${newAccess}`;
    return newAccess;
  } catch {
    return null;
  }
}

export const api: AxiosInstance = axios.create({ baseURL: API_BASE });

/** Adjunta access token a cada request */
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStore().getItem("accessToken");
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Si 401 por token vencido → refresh → reintenta */
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (!original || error.response?.status !== 401 || original._retry) {
      throw error;
    }

    original._retry = true;

    // Evitar múltiples refresh concurrentes
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = refreshAccessToken().finally(() => {
        isRefreshing = false;
        // importante: dejamos que refreshPromise quede listo para el await de abajo
      });
    }

    const newToken = await (refreshPromise as Promise<string | null>);
    refreshPromise = null;

    if (!newToken) {
      // Refresh falló: limpiar y salir a /login
      const store = getStore();
      store.removeItem("accessToken");
      store.removeItem("refreshToken");
      localStorage.removeItem("usuario");
      // Redirección dura para limpiar estado del router
      window.location.href = "/login";
      throw error;
    }

    // Reintentar con nuevo token
    original.headers = original.headers ?? {};
    (original.headers as any).Authorization = `Bearer ${newToken}`;
    return api(original);
  }
);
