/**
 * contract.api.spec.ts — Contrato de la API: autenticación, forma de los errores e
 * idempotencia de pagos (AP-02, AP-03, AP-05).
 *
 * "Contrato" = lo que un cliente (la UI, una app móvil, otro sistema) puede esperar de la
 * API: qué status devuelve, qué forma tiene el JSON. Si cada endpoint responde errores
 * de una forma distinta, cada cliente tiene que programar casos especiales (CH-010).
 */
import { APIResponse } from '@playwright/test';
import { attachEvidence, expect, test } from '../../src/fixtures/test';
import { BASE_URL } from '../../src/config/env';
import { dateInDays, uniqueNote } from '../../src/utils/testData';

/** Lee el cuerpo como JSON sin explotar si viene vacío o no es JSON. */
async function safeJson(res: APIResponse): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __noEsJson: text };
  }
}

test.describe('API · Contrato', { tag: '@api' }, () => {
  // ---------------------------------------------------------------------------
  // AP-03 · Autenticación obligatoria
  // ---------------------------------------------------------------------------
  const privateEndpoints: { method: 'get' | 'post' | 'put'; path: string }[] = [
    { method: 'get', path: '/api/dashboard' },
    { method: 'get', path: '/api/transactions' },
    { method: 'get', path: '/api/payments' },
    { method: 'get', path: '/api/profile' },
    { method: 'post', path: '/api/transfers' },
    { method: 'put', path: '/api/profile' },
  ];

  for (const { method, path } of privateEndpoints) {
    test(`AP-03 · ${method.toUpperCase()} ${path} sin sesión responde 401 y no devuelve datos`, async ({ playwright }) => {
      // Contexto nuevo, sin cookies: es un "visitante anónimo".
      const anon = await playwright.request.newContext({ baseURL: BASE_URL });
      const res = await anon[method](path, method === 'get' ? undefined : { data: {} });

      expect(res.status()).toBe(401);
      const body = (await safeJson(res)) as Record<string, unknown>;
      expect.soft(Object.keys(body), 'Solo debe venir el mensaje de error').toEqual(['message']);
      await anon.dispose();
    });
  }

  // ---------------------------------------------------------------------------
  // AP-02 · Forma uniforme de los errores
  // ---------------------------------------------------------------------------
  test(
    'AP-02 · todos los errores son 4xx con un JSON que incluye "message"',
    { annotation: { type: 'issue', description: 'BUG-22: /api/transfers con monto no numérico responde 500 con cuerpo vacío' } },
    async ({ api, accounts, anonApi }, testInfo) => {
      // Provocamos un error "de cliente" en cada endpoint.
      const errors: Record<string, APIResponse> = {
        'login · contraseña incorrecta': await anonApi.login('qa-no-existe@buggybank.local', 'incorrecta'),
        'transfers · monto no numérico': await api.transfer({
          fromAccountId: accounts.CHECKING.id,
          toAccountId: accounts.SAVINGS.id,
          amount: 'abc',
          note: uniqueNote('AP02'),
        }),
        'payments · monto cero': await api.createPaymentRaw({
          beneficiary: 'QA-AP02',
          sourceAccountId: accounts.CHECKING.id,
          amount: 0,
          scheduledFor: `${dateInDays(3)}T00:00:00.000Z`,
          reference: 'QA-AP02',
        }),
        'transitions · acción inválida': await api.transition('id-inexistente', 'FOO' as never, crypto.randomUUID()),
      };

      const summary: Record<string, unknown> = {};
      for (const [name, res] of Object.entries(errors)) {
        const body = (await safeJson(res)) as Record<string, unknown>;
        summary[name] = { status: res.status(), body };
        expect.soft(res.status(), `${name}: status 4xx`).toBeGreaterThanOrEqual(400);
        expect.soft(res.status(), `${name}: status 4xx`).toBeLessThan(500);
        expect.soft(typeof body.message, `${name}: debe tener "message" de tipo string`).toBe('string');
      }
      await attachEvidence(testInfo, 'errores', summary);
    },
  );

  // ---------------------------------------------------------------------------
  // AP-05 · Idempotencia de pagos (lo que SÍ funciona bien)
  // ---------------------------------------------------------------------------
  test('AP-05 · la misma clave de idempotencia enviada dos veces en paralelo aplica un solo cambio', async ({ api, accounts }) => {
    // Control positivo de PG-06: con la MISMA clave, el servidor sí deduplica.
    // Tener este test en verde junto a PG-06 en rojo muestra exactamente dónde está el bug:
    // no en el servidor, sino en que la UI genera una clave nueva por cada clic.
    const payment = await api.createPayment({
      beneficiary: `${uniqueNote('AP05')} Comercio`,
      sourceAccountId: accounts.CHECKING.id,
      amount: 2,
      scheduledFor: `${dateInDays(3)}T00:00:00.000Z`,
      reference: 'QA-AP05',
    });
    const key = crypto.randomUUID();

    const [a, b] = await Promise.all([api.transition(payment.id, 'PROCESS', key), api.transition(payment.id, 'PROCESS', key)]);
    expect.soft(a.ok() && b.ok(), 'Ambas respuestas OK (la repetición devuelve el mismo resultado)').toBe(true);

    const after = await api.getPayment(payment.id);
    expect(after.status).toBe('PENDING');
    expect(after.events).toHaveLength(2); // creación + un único cambio
  });

  test('AP-05 · una transición inválida para el estado actual responde 409 con el estado actual', async ({ api, accounts }) => {
    const payment = await api.createPayment({
      beneficiary: `${uniqueNote('AP05b')} Comercio`,
      sourceAccountId: accounts.CHECKING.id,
      amount: 2,
      scheduledFor: `${dateInDays(3)}T00:00:00.000Z`,
      reference: 'QA-AP05b',
    });

    // REVERSE solo es válido desde COMPLETED; el pago está SCHEDULED.
    const res = await api.transition(payment.id, 'REVERSE', crypto.randomUUID());
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect.soft(body.code).toBe('INVALID_PAYMENT_TRANSITION');
    expect.soft(body.currentStatus).toBe('SCHEDULED');
    expect((await api.getPayment(payment.id)).status).toBe('SCHEDULED');
  });
});
