// src/utils/urlHelpers.ts

/**
 * Convierte URLs relativas a absolutas usando el backend como base.
 * Si la URL ya es absoluta (ej: Cloudinary), la retorna sin cambios.
 * Si la URL está encriptada, retorna null para evitar errores.
 * 
 * @param url - URL que puede ser relativa, absoluta o encriptada
 * @param baseURL - URL base del backend (opcional)
 * @returns URL absoluta o null
 */
export function absolutizeUrl(url?: string | null, baseURL?: string): string | null {
  if (!url) return null;
  
  // Detectar URLs encriptadas (empiezan con "gAAAAA" de Fernet)
  if (url.startsWith('gAAAAA')) {
    console.warn('⚠️ URL encriptada detectada:', url.substring(0, 30) + '...');
    return null;
  }
  
  // Si ya es una URL absoluta, retornarla directamente
  try {
    new URL(url);
    return url;
  } catch {
    // Es relativa, convertirla a absoluta
    const base = baseURL || (window as any).API_BASE_URL || '';
    let origin = '';
    
    try {
      origin = new URL(base).origin;
    } catch {
      origin = window.location.origin;
    }
    
    return `${origin.replace(/\/$/, '')}/${String(url).replace(/^\//, '')}`;
  }
}
