// src/api/publicApi.ts
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

/**
 * Cliente PÚBLICO: jamás envía Authorization.
 */
export const publicApi = axios.create({ baseURL: BASE_URL });

// Blindaje: si alguien mete Authorization por error, lo quitamos.
publicApi.interceptors.request.use((config) => {
  if (config.headers) {
    delete (config.headers as any).Authorization;
    delete (config.headers as any).authorization;
  }
  return config;
});
