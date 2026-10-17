/**
 * transactions.spec.ts — Historial de movimientos (MV-01 a MV-06).
 *
 * Riesgo: que el historial no refleje la realidad. Es lo que el usuario mira para
 * controlar su dinero: un filtro roto o un estado oculto lo llevan a conclusiones falsas.
 *
 * Estas pruebas usan los datos semilla del sandbox (siempre hay movimientos entrantes,
 * salientes y en distintos estados) más los que crean otras pruebas. Por eso NUNCA
 * comparan contra una cantidad fija de filas, sino contra reglas ("toda fila cumple X").
 */
import { attachEvidence, expect, test } from '../../src/fixtures/test';
import { Transaction } from '../../src/api/types';
import { toCents } from '../../src/utils/money';

/** Convierte una fecha a su "forma": dígitos → 9, letras → a. Ej: "16 Oct 2026, 10:23 pm" → "9 a 9, 9:9 a". */
function dateShape(text: string): string {
  return text.replace(/\d+/g, '9').replace(/[A-Za-zÀ-ÿ]+/g, 'a');
}

/** ¿Está ordenado de más nuevo a más viejo? */
function isSortedDesc(items: Transaction[]): boolean {
  return items.every((t, i) => i === 0 || new Date(items[i - 1].createdAt) >= new Date(t.createdAt));
}

test.describe('Movimientos', { tag: '@extended' }, () => {
  test('MV-01 · el historial se ordena del más reciente al más antiguo, con y sin filtro', async ({ api, pages }) => {
    // Oráculo en dos partes:
    // a) la API devuelve los datos ordenados por fecha (createdAt) descendente;
    // b) la tabla muestra las filas EN ESE MISMO ORDEN (comparamos las descripciones).
    // Comparamos descripciones y no fechas de la UI porque la UI mezcla formatos (BUG-14).
    for (const direction of ['all', 'incoming', 'outgoing'] as const) {
      const fromApi = await api.getTransactions(direction);
      expect.soft(isSortedDesc(fromApi), `API ordenada (${direction})`).toBe(true);

      if (direction === 'all') await pages.transactions.goto();
      else await pages.transactions.filterDirection(direction);
      const uiNotes = (await pages.transactions.readRows()).map((r) => r.description);
      expect.soft(uiNotes, `UI en el mismo orden que la API (${direction})`).toEqual(fromApi.slice(0, uiNotes.length).map((t) => t.note));
    }
  });

  test(
    'MV-02 · todas las fechas del historial usan el mismo formato',
    { annotation: { type: 'issue', description: 'BUG-14: formatos de fecha mezclados (CH-006)' } },
    async ({ api, pages }, testInfo) => {
      // `api` está en los parámetros solo para que el fixture haga login antes de abrir la página.
      await pages.transactions.goto();
      const dates = (await pages.transactions.readRows()).map((r) => r.date);
      const shapes = [...new Set(dates.map(dateShape))];
      await attachEvidence(testInfo, 'formatos-encontrados', { shapes, ejemplos: dates.slice(0, 10) });

      expect(shapes, 'Debería haber un único formato de fecha').toHaveLength(1);
    },
  );

  test(
    'MV-03 · el filtro "Entrantes" solo muestra ingresos y "Salientes" solo salidas',
    { annotation: { type: 'issue', description: 'BUG-11: filtro de dirección invertido · BUG-09: las transferencias nuevas quedan siempre "incoming"' } },
    async ({ api, pages }, testInfo) => {
      // `api` está en los parámetros solo para que el fixture haga login antes de abrir la página.
      await pages.transactions.goto();

      await pages.transactions.filterDirection('incoming');
      const incoming = await pages.transactions.readRows();
      await pages.transactions.filterDirection('outgoing');
      const outgoing = await pages.transactions.readRows();
      await attachEvidence(testInfo, 'filas', { incoming, outgoing });

      // Reglas: cada fila del filtro cumple el filtro.
      expect.soft(incoming.filter((r) => r.type !== 'Ingreso'), 'Filas NO ingreso dentro de "Entrantes"').toEqual([]);
      expect.soft(outgoing.filter((r) => r.type !== 'Salida'), 'Filas NO salida dentro de "Salientes"').toEqual([]);

      // Regla de completitud: Entrantes + Salientes = Todas (ningún movimiento "desaparece").
      const all = await api.getTransactions('all');
      const inc = await api.getTransactions('incoming');
      const out = await api.getTransactions('outgoing');
      expect.soft(inc.length + out.length, 'Entrantes + Salientes debe cubrir todo el historial').toBe(all.length);
    },
  );

  test(
    'MV-04 · combinar dirección y búsqueda devuelve solo filas que cumplen ambos filtros',
    { annotation: { type: 'issue', description: 'BUG-12: dirección + búsqueda devuelve filas de la otra dirección (CH-005)' } },
    async ({ api, pages }, testInfo) => {
      // `api` está en los parámetros solo para que el fixture haga login antes de abrir la página.
      await pages.transactions.goto();
      await pages.transactions.filterDirection('incoming');
      await pages.transactions.search('te');
      const rows = await pages.transactions.readRows();
      await attachEvidence(testInfo, 'filas', rows);

      for (const row of rows) {
        expect.soft(row.type, `"${row.description}" debía ser Ingreso`).toBe('Ingreso');
        const text = `${row.description} ${row.accounts}`.toLowerCase();
        expect.soft(text, `"${row.description}" debía contener "te"`).toContain('te');
      }
    },
  );

  test(
    'MV-05 · búsquedas equivalentes (mayúsculas, espacios) devuelven el mismo resultado',
    { annotation: { type: 'issue', description: 'BUG-13: la búsqueda distingue mayúsculas (CH-011)' } },
    async ({ api }, testInfo) => {
      // Usamos un dato semilla siempre presente: "Shared rent April".
      const ids = async (q: string) => (await api.getTransactions('all', q)).map((t) => t.id).sort();
      const base = await ids('rent');
      const variants = { RENT: await ids('RENT'), Rent: await ids('Rent'), espacios: await ids('  rent  ') };
      await attachEvidence(testInfo, 'resultados', { base, variants });

      expect(base.length, 'Precondición: "rent" debe encontrar al menos un movimiento').toBeGreaterThan(0);
      for (const [name, result] of Object.entries(variants)) {
        expect.soft(result, `La variante "${name}" debía dar lo mismo que "rent"`).toEqual(base);
      }
    },
  );

  test(
    'MV-06 · la tabla coincide con la API en montos y deja ver el estado de cada movimiento',
    { annotation: { type: 'issue', description: 'BUG-15: los movimientos FAILED / CANCELLED / REVERSED se ven igual que los efectivos' } },
    async ({ api, pages }, testInfo) => {
      const fromApi = await api.getTransactions('all');
      await pages.transactions.goto();
      const rows = await pages.transactions.readRows();

      // 1) Cada fila muestra el monto de la API, redondeado a centavos.
      rows.forEach((row, i) => {
        expect.soft(row.amount, `Monto de "${row.description}"`).toBe(toCents(fromApi[i].amount));
      });

      // 2) Los movimientos que NO se completaron deben distinguirse en la tabla.
      const notCompleted = fromApi.slice(0, rows.length).map((t, i) => ({ t, row: pages.transactions.rows.nth(i) })).filter(({ t }) => t.status !== 'COMPLETED');
      await attachEvidence(testInfo, 'no-completados', notCompleted.map(({ t }) => ({ note: t.note, status: t.status })));
      for (const { t, row } of notCompleted) {
        await expect
          .soft(row, `"${t.note}" (${t.status}) debía mostrar su estado`)
          .toContainText(/pendiente|fallid|cancelad|revertid/i);
      }
    },
  );
});
