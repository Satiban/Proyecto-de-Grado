// src/hooks/useFotoPerfil.ts
import { api } from "../api/axios";

/**
 * Hook reutilizable para manejar actualización y eliminación de la foto de perfil.
 * Conecta con el endpoint PATCH /usuarios/{id}/foto/
 */
export function useFotoPerfil() {
  //Sube una nueva foto de perfil al backend
  const subirFoto = async (id_usuario: number, archivo: File): Promise<string> => {
    const fd = new FormData();
    fd.append("foto", archivo);

    const { data } = await api.patch(`/usuarios/${id_usuario}/foto/`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    return data.foto; // secure_url
  };

  //Elimina la foto de perfil actual
  const eliminarFoto = async (id_usuario: number): Promise<null> => {
    const fd = new FormData();
    fd.append("foto_remove", "true");

    const { data } = await api.patch(`/usuarios/${id_usuario}/foto/`, fd);

    return data.foto;
  };

  return {
    subirFoto,
    eliminarFoto,
  };
}
