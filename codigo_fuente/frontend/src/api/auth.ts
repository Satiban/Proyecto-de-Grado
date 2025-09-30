// src/api/auth.ts
import { publicApi } from "./publicApi";
import { api } from "./axios";

/** Login (sin token) */
export async function login(email: string, password: string) {
  const { data } = await publicApi.post(`/token/`, { email, password });
  return data;
}

/** Perfil actual (con token, usa api para soportar refresh) */
export async function getProfile() {
  const { data } = await api.get(`/usuarios/me/`);
  return data; // { id_usuario, email, id_rol, ... }
}
