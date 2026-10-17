/**
 * testData.ts — Generación de datos de prueba únicos.
 *
 * ¿Por qué notas únicas?
 * El historial de movimientos tiene datos semilla y operaciones de ejecuciones
 * anteriores. Si una prueba busca "un movimiento de 13.37", podría encontrar uno
 * viejo y dar un falso verde. Con una nota única (ej. "QA-TC01-lq3k9x-4821") buscamos
 * exactamente el movimiento que creó ESTA ejecución de ESTE test.
 */

/**
 * Genera un identificador corto y único.
 * Combina la hora actual en base 36 con un número aleatorio: dos ejecuciones
 * nunca producen el mismo valor en la práctica.
 */
export function uniqueId(): string {
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0');
  return `${time}-${random}`;
}

/**
 * Nota única para una operación. El prefijo "QA-" permite filtrar después en la app
 * todo lo que generó la suite (útil para revisar el historial a mano).
 * @param caseId ID del caso del TEST_PLAN, por ejemplo "TC01".
 */
export function uniqueNote(caseId: string): string {
  return `QA-${caseId}-${uniqueId()}`;
}

/**
 * Fecha en formato YYYY-MM-DD desplazada N días desde hoy, en la zona horaria de la app
 * (Pacific/Auckland). Se usa para el campo de fecha de Pagos.
 * Ejemplo: dateInDays(1) → mañana; dateInDays(-1) → ayer.
 */
export function dateInDays(days: number, timeZone = 'Pacific/Auckland'): string {
  const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  // 'en-CA' formatea como YYYY-MM-DD, que es lo que espera un <input type="date">.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(target);
}
