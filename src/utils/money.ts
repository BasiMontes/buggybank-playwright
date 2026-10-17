/**
 * money.ts — Utilidades para trabajar con dinero sin errores de redondeo.
 *
 * EL PROBLEMA:
 * En JavaScript los números son "punto flotante". Eso hace que
 *     0.1 + 0.2 === 0.30000000000000004
 * y que 6486.63 - 6486.64 dé -0.01000000000021828 (¡lo vimos en BuggyBank! → BUG-08).
 * Si comparamos saldos con `===` o con `toBe`, una prueba podría fallar por un error
 * de redondeo NUESTRO y no de la app.
 *
 * LA SOLUCIÓN:
 * Convertir todo a CENTAVOS ENTEROS (6486.63 → 648663). Con enteros no hay errores de
 * redondeo. Las aserciones comparan centavos: si la app devuelve un saldo con
 * basura de punto flotante o con 3 decimales, lo vamos a detectar a propósito.
 */

/**
 * Convierte un monto (número) a centavos enteros.
 * Math.round corrige el ruido de punto flotante: 13.37 * 100 = 1336.9999999999998 → 1337.
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convierte centavos enteros de vuelta a un número con 2 decimales. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Convierte un texto de moneda de la UI a número.
 * Ejemplos de lo que muestra BuggyBank:
 *   "$6,500.00"   → 6500
 *   "-$0.01"      → -0.01
 *   "($3,513.37)" → 3513.37   (los paréntesis aparecen en los <option> de cuentas)
 *
 * La app usa formato inglés: coma = separador de miles, punto = decimal.
 */
export function parseMoney(text: string): number {
  // Buscamos el primer patrón de dinero dentro del texto (puede venir con otras palabras alrededor).
  const match = text.match(/(-)?\$\s?(-)?([\d,]+(?:\.\d+)?)/);
  if (!match) {
    throw new Error(`No se encontró un monto con formato "$1,234.56" en: "${text}"`);
  }
  const negative = Boolean(match[1] || match[2]);
  const value = Number(match[3].replace(/,/g, ''));
  return negative ? -value : value;
}

/**
 * Indica si un número tiene más de 2 decimales "reales".
 * Sirve para detectar saldos como 6535.625 (BUG-07) o -0.01000000000021828 (BUG-08).
 */
export function hasMoreThanTwoDecimals(amount: number): boolean {
  return Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-9;
}

/** Formatea un número para mensajes de error legibles: 6500 → "6500.00". */
export function fmt(amount: number): string {
  return amount.toFixed(2);
}
