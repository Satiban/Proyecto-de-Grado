// frontend/src/hooks/useConfig.ts
import { useEffect, useState } from "react";
import { api } from "../api/axios";

export type Configuracion = {
  celular_contacto: string;
  max_citas_activas: number;
  horas_confirmar_desde: number;
  horas_confirmar_hasta: number;
  horas_autoconfirmar: number;
  max_citas_dia: number;
  max_reprogramaciones: number;
  min_horas_anticipacion: number;
  cooldown_dias: number;
};

export function useConfig() {
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { data } = await api.get("/configuracion/");
        if (!active) return;

        // Tipado consistente con los nuevos campos
        setConfig(data as Configuracion);
      } catch (err: any) {
        if (!active) return;
        const msg =
          err?.response?.data?.detail ||
          "No se pudo cargar la configuración del sistema.";
        setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return { config, loading, error };
}