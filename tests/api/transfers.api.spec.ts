/**
 * transfers.api.spec.ts — Reglas de transferencias probadas DIRECTO contra la API (AP-01).
 *
 * ¿Por qué probar la API si ya probamos la UI?
 * Desafío CH-012 "Una regla, dos puertas": la UI es UNA forma de llegar al backend, no
 * la única. Cualquiera puede abrir las herramientas del navegador y mandar el POST a mano.
 * Si la validación vive solo en el frontend, la regla de negocio NO está protegida.
 *
 * En la exploración, la UI bloqueó -50 y 0, pero la API aceptó todo con 200.
 *
 * Patrón: `for` sobre una tabla de casos → un test por fila ("pruebas parametrizadas").
 * Agregar un caso nuevo es agregar una línea a la tabla.
 */
import { attachEvidence, expect, test } from '../../src/fixtures/test';
import { expectCleanBalances, expectNoSideEffects } from '../../src/assertions/bank';
import { Account } from '../../src/api/types';
import { uniqueNote } from '../../src/utils/testData';

interface InvalidCase {
  id: string;
  title: string;
  bug: string;
  /** Arma el cuerpo con las cuentas reales y el saldo actual (en centavos). */
  body: (a: { CHECKING: Account; SAVINGS: Account }, checkingCents: number, note: string) => Record<string, unknown>;
}

const invalidCases: InvalidCase[] = [
  {
    id: 'AP-01a',
    title: 'monto negativo',
    bug: 'BUG-04',
    body: (a, _c, note) => ({ fromAccountId: a.CHECKING.id, toAccountId: a.SAVINGS.id, amount: -50, note }),
  },
  {
    id: 'AP-01b',
    title: 'monto cero',
    bug: 'BUG-05',
    body: (a, _c, note) => ({ fromAccountId: a.CHECKING.id, toAccountId: a.SAVINGS.id, amount: 0, note }),
  },
  {
    id: 'AP-01c',
    title: 'origen igual a destino',
    bug: 'BUG-06',
    body: (a, _c, note) => ({ fromAccountId: a.CHECKING.id, toAccountId: a.CHECKING.id, amount: 1, note }),
  },
  {
    id: 'AP-01d',
    title: 'monto con 3 decimales',
    bug: 'BUG-07',
    body: (a, _c, note) => ({ fromAccountId: a.CHECKING.id, toAccountId: a.SAVINGS.id, amount: 1.005, note }),
  },
  {
    id: 'AP-01e',
    title: 'monto mayor al saldo',
    bug: 'BUG-01',
    body: (a, checkingCents, note) => ({
      fromAccountId: a.CHECKING.id,
      toAccountId: a.SAVINGS.id,
      amount: (checkingCents + 1) / 100,
      note,
    }),
  },
  {
    id: 'AP-01f',
    title: 'monto no numérico',
    bug: 'BUG-22',
    body: (a, _c, note) => ({ fromAccountId: a.CHECKING.id, toAccountId: a.SAVINGS.id, amount: 'abc', note }),
  },
  {
    id: 'AP-01g',
    title: 'cuenta destino inexistente',
    bug: '—',
    body: (a, _c, note) => ({ fromAccountId: a.CHECKING.id, toAccountId: 'cuenta-que-no-existe', amount: 1, note }),
  },
];

test.describe('API · Transferencias', { tag: '@api' }, () => {
  for (const c of invalidCases) {
    test(
      `${c.id} · la API rechaza una transferencia con ${c.title} (4xx y sin efectos)`,
      { annotation: c.bug === '—' ? [] : [{ type: 'issue', description: `${c.bug} (ver BUGS.md)` }] },
      async ({ api, accounts }, testInfo) => {
        const note = uniqueNote(c.id.replace('-', ''));
        const before = await api.snapshotBalances();
        const body = c.body(accounts, before.CHECKING, note);

        const res = await api.transfer(body as never);
        const responseText = await res.text();
        await attachEvidence(testInfo, 'request-response', { body, status: res.status(), response: responseText });

        // Rechazo "bien hecho": 4xx (error del cliente). Un 200 es aceptar lo inválido;
        // un 500 es que el servidor explotó en vez de validar.
        expect.soft(res.status(), 'Status').toBeGreaterThanOrEqual(400);
        expect.soft(res.status(), 'Status').toBeLessThan(500);
        await expectNoSideEffects(api, before, note);
        await expectCleanBalances(api);
      },
    );
  }

  test('AP-01 · control: una transferencia válida por API responde 200 y mueve el dinero', async ({ api, accounts }) => {
    // Sin este control, si TODOS los AP-01 dieran 4xx no sabríamos si la API valida bien
    // o si simplemente está rota para todo.
    const note = uniqueNote('AP01ok');
    const before = await api.snapshotBalances();

    const res = await api.transfer({ fromAccountId: accounts.CHECKING.id, toAccountId: accounts.SAVINGS.id, amount: 0.5, note });

    expect(res.status()).toBe(200);
    const after = await api.snapshotBalances();
    expect(after.CHECKING).toBe(before.CHECKING - 50);
    expect(await api.findTransactionsByNote(note)).toHaveLength(1);
  });

  test(
    'AP-04 · dos POST idénticos en paralelo generan una sola transferencia',
    { annotation: { type: 'issue', description: 'BUG-02 (vista desde la API): no hay protección contra duplicados' } },
    async ({ api, accounts }, testInfo) => {
      const note = uniqueNote('AP04');
      const body = { fromAccountId: accounts.CHECKING.id, toAccountId: accounts.SAVINGS.id, amount: 0.33, note };

      const responses = await Promise.all([api.transfer(body), api.transfer(body)]);
      const bodies = await Promise.all(responses.map((r) => r.text()));
      await attachEvidence(testInfo, 'respuestas', responses.map((r, i) => ({ status: r.status(), body: bodies[i] })));

      // El backend devuelve un campo "duplicated": la intención clara es que detecte duplicados.
      expect(await api.findTransactionsByNote(note), 'Dos requests idénticos simultáneos = una transferencia').toHaveLength(1);
    },
  );
});
