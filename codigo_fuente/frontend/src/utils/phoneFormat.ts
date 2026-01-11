// src/utils/phoneFormat.ts
/**
 * Utilidades para conversión de números telefónicos entre formato E.164 y formato local ecuatoriano
 * 
 * Formato E.164: +593999090660 (se guarda en la BD)
 * Formato local: 0999090660 (se muestra en el frontend)
 */

/**
 * Convierte un número de formato E.164 (+593999090660) a formato local ecuatoriano (0999090660)
 * @param e164 - Número en formato E.164 o formato local
 * @returns Número en formato local (0999090660) o string vacío si no es válido
 * 
 * @example
 * e164ToLocal("+593999090660") // "0999090660"
 * e164ToLocal("0999090660")     // "0999090660"
 * e164ToLocal("999090660")      // "0999090660"
 */
export function e164ToLocal(e164?: string | null): string {
  if (!e164) return "";
  const str = String(e164).trim();
  
  // Si empieza con +593, quitar el +593 y agregar 0 al inicio
  if (str.startsWith("+593")) {
    return "0" + str.substring(4);
  }
  
  // Si ya está en formato local, devolverlo tal cual
  if (str.startsWith("0") && str.length === 10) {
    return str;
  }
  
  // Si tiene 9 dígitos y empieza con 9, agregar 0
  if (str.length === 9 && str.startsWith("9")) {
    return "0" + str;
  }
  
  return str;
}

/**
 * Convierte un número de formato local ecuatoriano (0999090660) a formato E.164 (+593999090660)
 * @param local - Número en formato local o E.164
 * @returns Número en formato E.164 (+593999090660) o string vacío si no es válido
 * 
 * @example
 * localToE164("0999090660")     // "+593999090660"
 * localToE164("+593999090660")  // "+593999090660"
 * localToE164("999090660")      // "+593999090660"
 */
export function localToE164(local?: string | null): string {
  if (!local) return "";
  const str = String(local).trim();
  
  // Si ya está en E.164, devolverlo tal cual
  if (str.startsWith("+593")) {
    return str;
  }
  
  // Si empieza con 0 y tiene 10 dígitos, convertir a E.164
  if (str.startsWith("0") && str.length === 10) {
    return "+593" + str.substring(1);
  }
  
  // Si tiene 9 dígitos y empieza con 9, agregar +593
  if (str.length === 9 && str.startsWith("9")) {
    return "+593" + str;
  }
  
  return str;
}
