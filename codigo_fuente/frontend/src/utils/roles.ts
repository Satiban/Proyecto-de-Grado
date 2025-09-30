// src/utils/roles.ts
export const ROLES = { ADMIN: 1, PACIENTE: 2, ODONTOLOGO: 3, ADMIN_CLINICO: 4 } as const;

type RolLite =
  | number
  | string
  | { id_rol?: number | string; rol?: string; id?: number | string; pk?: number | string }
  | undefined
  | null;

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function rolId(rol: RolLite): number | null {
  const direct = toNum(rol as any);
  if (direct != null) return direct;

  if (rol && typeof rol === "object") {
    const anyRol = rol as Record<string, unknown>;
    return toNum(anyRol.id_rol) ?? toNum(anyRol.id) ?? toNum(anyRol.pk) ?? null;
  }
  return null;
}

export function homeByRole(idRol?: number | null, isSuper?: boolean) {
  if (isSuper || idRol === ROLES.ADMIN || idRol === ROLES.ADMIN_CLINICO) return "/admin";
  if (idRol === ROLES.ODONTOLOGO) return "/odontologo";
  if (idRol === ROLES.PACIENTE) return "/paciente";
  return "/login";
}
