// src/hooks/useRoleContext.ts
import { useState, useEffect } from 'react';
import { getRolesActivos } from '../api/auth';

export type RoleContext = 'paciente' | 'odontologo' | null;

export type RolesInfo = {
  es_paciente: boolean;
  es_odontologo: boolean;
  id_paciente: number | null;
  id_odontologo: number | null;
  rol_principal: number;
  contexto_activo: RoleContext;
  tiene_multiples_roles: boolean;
};

// Hook para obtener y gestionar el contexto de rol activo del usuario
export function useRoleContext() {
  const [rolesInfo, setRolesInfo] = useState<RolesInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRoles = async () => {
    try {
      setLoading(true);
      const userId = localStorage.getItem('userId');
      if (!userId) {
        setError('No hay usuario autenticado');
        return;
      }

      const data = await getRolesActivos(Number(userId));
      const contextoActivo = (localStorage.getItem('contexto_activo') as RoleContext) || null;
      
      setRolesInfo({
        es_paciente: data.es_paciente,
        es_odontologo: data.es_odontologo,
        id_paciente: data.id_paciente,
        id_odontologo: data.id_odontologo,
        rol_principal: data.rol_principal,
        contexto_activo: contextoActivo,
        tiene_multiples_roles: data.es_paciente && data.es_odontologo,
      });
    } catch (err) {
      console.error('Error al cargar roles:', err);
      setError('No se pudieron cargar los roles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const cambiarContexto = (nuevoContexto: RoleContext) => {
    if (!nuevoContexto) return;
    
    localStorage.setItem('contexto_activo', nuevoContexto);
    setRolesInfo(prev => prev ? { ...prev, contexto_activo: nuevoContexto } : null);
  };

  return {
    rolesInfo,
    loading,
    error,
    cambiarContexto,
    recargarRoles: loadRoles,
  };
}
