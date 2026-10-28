/**
 * payments.spec.ts — Pagos (PG-01 a PG-09).
 *
 * Riesgos: pagos con datos inválidos, una máquina de estados que se saltea pasos,
 * intenciones repetidas que se aplican dos veces y vistas que cuentan historias distintas.
 *
 * Preparación de datos: casi todos los tests crean SU PROPIO pago por API con un
 * beneficiario único. Así no dependen de los pagos semilla ni de otros tests.
 * Nota: la app no permite borrar pagos, así que cada ejecución deja algunos pagos
 * "QA-..." en el listado. No afectan a otros tests y desaparecen cuando caduca el sandbox.
 */
import { attachEvidence, expect, test } from '../../src/fixtures/test';
import { Account, PaymentRequest } from '../../src/api/types';
import { STATUS_LABEL } from '../../src/pages/PaymentsPage';
import { toCents } from '../../src/utils/money';
import { dateInDays, uniqueNote } from '../../src/utils/testData';

/** Datos de un pago válido. Se pueden pisar campos con `overrides`. */
function paymentData(source: Account, overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  const id = uniqueNote('PG');
  return {
    beneficiary: `${id} Comercio`,
    sourceAccountId: source.id,
    amount: 12.34,
    scheduledFor: `${dateInDays(3)}T00:00:00.000Z`,
    reference: `${id} ref`,
    ...overrides,
  };
}

/**
 * "2026-10-19" → regex que acepta "19 oct 2026" (formato de la UI en español).
 * @param anchored true = el texto completo debe ser la fecha; false = la fecha puede
 *                 estar dentro de un texto más largo (por ejemplo, una fila del listado).
 */
function displayedDatePattern(isoDate: string, anchored = true): RegExp {
  const [year, month, day] = isoDate.split('-').map(Number);
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept?', 'oct', 'nov', 'dic'];
  const core = `${day} ${months[month - 1]}\\.? ${year}`;
  return new RegExp(anchored ? `^${core}$` : `\\b${core}\\b`, 'i');
}

test.describe('Pagos', { tag: '@extended' }, () => {
  // ---------------------------------------------------------------------------
  // Creación
  // ---------------------------------------------------------------------------
  test('PG-01 · un pago válido se crea Programado y muestra los mismos datos en detalle, listado y API', async ({
    api,
    accounts,
    pages,
  }) => {
    // CH-014 "Un pago, tres lecturas": la misma operación vista por tres puertas.
    const data = paymentData(accounts.CHECKING);
    const date = dateInDays(3);

    await pages.newPayment.goto();
    await pages.newPayment.fillForm({
      beneficiary: data.beneficiary,
      sourceAccountId: accounts.CHECKING.id,
      amount: '12.34',
      date,
      reference: data.reference,
    });
    const id = await pages.newPayment.submit();
    expect(id, 'El pago debía crearse').not.toBeNull();

    // Lectura 1: detalle (la app navega sola al detalle).
    await expect(pages.paymentDetail.status).toHaveText(STATUS_LABEL.SCHEDULED);
    expect.soft(await pages.paymentDetail.field('BENEFICIARIO')).toBe(data.beneficiary);
    expect.soft(await pages.paymentDetail.field('MONTO')).toBe('$12.34');
    expect.soft(await pages.paymentDetail.field('REFERENCIA')).toBe(data.reference);
    expect.soft(await pages.paymentDetail.field('FECHA')).toMatch(displayedDatePattern(date));

    // Lectura 2: listado.
    await pages.paymentsList.goto();
    const row = pages.paymentsList.rowByBeneficiary(data.beneficiary);
    await expect(row).toHaveCount(1);
    await expect.soft(row.getByTestId('payment-status')).toHaveText(STATUS_LABEL.SCHEDULED);
    await expect.soft(row).toContainText('$12.34');

    // Lectura 3: API.
    const payment = await api.getPayment(id!);
    expect.soft(payment.status).toBe('SCHEDULED');
    expect.soft(toCents(payment.amount)).toBe(1234);
    expect.soft(payment.scheduledFor.slice(0, 10)).toBe(date);
  });

  for (const { label, amount } of [
    { label: 'cero', amount: '0' },
    { label: 'negativo', amount: '-5' },
  ]) {
    test(`PG-02 · un pago con monto ${label} no se crea`, async ({ api, accounts, pages }) => {
      const data = paymentData(accounts.CHECKING);
      await pages.newPayment.goto();
      await pages.newPayment.fillForm({ beneficiary: data.beneficiary, sourceAccountId: accounts.CHECKING.id, amount, date: dateInDays(3), reference: data.reference });

      expect(await pages.newPayment.submit(), 'No debía crearse el pago').toBeNull();
      expect((await api.getPayments()).filter((p) => p.beneficiary === data.beneficiary)).toHaveLength(0);
    });
  }

  test(
    'PG-02 · un pago mayor al saldo disponible no se programa',
    { annotation: { type: 'question', description: 'BUG-18 (a confirmar): ¿el saldo se valida al programar o al procesar? Pregunta para la Charla.' } },
    async ({ api, accounts, pages }) => {
      // La propia pantalla informa "Saldo disponible informado", lo que sugiere que el
      // saldo debería importar al programar. Dejamos el test con esa expectativa y la
      // anotación de pregunta abierta.
      const data = paymentData(accounts.CHECKING);
      await pages.newPayment.goto();
      await pages.newPayment.fillForm({
        beneficiary: data.beneficiary,
        sourceAccountId: accounts.CHECKING.id,
        amount: String(accounts.CHECKING.balance + 1000),
        date: dateInDays(3),
        reference: data.reference,
      });

      expect(await pages.newPayment.submit()).toBeNull();
      expect((await api.getPayments()).filter((p) => p.beneficiary === data.beneficiary)).toHaveLength(0);
    },
  );

  test('PG-03 · un pago sin beneficiario no se crea', async ({ api, accounts, pages }) => {
    const data = paymentData(accounts.CHECKING);
    await pages.newPayment.goto();
    await pages.newPayment.fillForm({ beneficiary: '', sourceAccountId: accounts.CHECKING.id, amount: '5', date: dateInDays(3), reference: data.reference });

    expect(await pages.newPayment.submit()).toBeNull();
    expect((await api.getPayments()).filter((p) => p.reference === data.reference)).toHaveLength(0);
  });

  test('PG-04 · la fecha programada se muestra igual que la elegida', async ({ api, accounts, pages }) => {
    // CH-015: los errores de zona horaria suelen correr la fecha un día.
    // Probamos mañana (cerca del cambio de día) y una fecha lejana como control.
    for (const days of [1, 20]) {
      const date = dateInDays(days);
      const payment = await api.createPayment(paymentData(accounts.CHECKING, { scheduledFor: `${date}T00:00:00.000Z` }));

      await pages.paymentDetail.goto(payment.id);
      expect.soft(await pages.paymentDetail.field('FECHA'), `Fecha en detalle (+${days} días)`).toMatch(displayedDatePattern(date));

      await pages.paymentsList.goto();
      // Se busca en las celdas (td) y no en el texto de la fila: al unir las celdas, el número de
      // cuenta y la fecha quedan pegados ("…-0030 oct 2026") y ninguna expresión los separa bien.
      await expect
        .soft(pages.paymentsList.rowByBeneficiary(payment.beneficiary).locator('td').filter({ hasText: displayedDatePattern(date, false) }), `Fecha en listado (+${days} días)`)
        .toHaveCount(1);
    }
  });

  test(
    'PG-04 · no se puede programar un pago con fecha pasada',
    { annotation: { type: 'issue', description: 'BUG-17: la API acepta scheduledFor en el pasado' } },
    async ({ api, accounts, pages }) => {
      const data = paymentData(accounts.CHECKING);
      await pages.newPayment.goto();
      await pages.newPayment.fillForm({ beneficiary: data.beneficiary, sourceAccountId: accounts.CHECKING.id, amount: '3', date: dateInDays(-30), reference: data.reference });

      expect(await pages.newPayment.submit(), 'Un pago con fecha pasada no debía programarse').toBeNull();
    },
  );

  // ---------------------------------------------------------------------------
  // Máquina de estados
  // ---------------------------------------------------------------------------
  test('PG-05 · "Procesar" avanza exactamente un estado y queda en el historial', async ({ api, accounts, pages }) => {
    const payment = await api.createPayment(paymentData(accounts.CHECKING));

    await pages.paymentDetail.goto(payment.id);
    await pages.paymentDetail.processOnce('PENDING');

    await expect(pages.paymentDetail.status).toHaveText(STATUS_LABEL.PENDING);
    expect.soft(await pages.paymentDetail.eventTitles()).toEqual(['Programado', 'Programado → Pendiente']);
    const fromApi = await api.getPayment(payment.id);
    expect.soft(fromApi.status).toBe('PENDING');
    expect.soft(fromApi.events?.map((e) => `${e.fromStatus}->${e.status}`)).toEqual(['null->SCHEDULED', 'SCHEDULED->PENDING']);
  });

  test(
    'PG-06 · dos clics simultáneos en "Procesar" avanzan un solo estado',
    { annotation: { type: 'issue', description: 'BUG-16: cada clic genera una clave de idempotencia nueva y el pago salta a Completado (CH-016)' } },
    async ({ api, accounts, page, pages }, testInfo) => {
      const payment = await api.createPayment(paymentData(accounts.CHECKING));

      await pages.paymentDetail.goto(payment.id);
      await pages.paymentDetail.processTwiceSimultaneous();
      // Esperamos a que la API refleje al menos un cambio de estado.
      await expect.poll(async () => (await api.getPayment(payment.id)).status, { timeout: 8_000 }).not.toBe('SCHEDULED');
      await page.waitForTimeout(2_000); // margen para un posible segundo cambio

      const after = await api.getPayment(payment.id);
      await attachEvidence(testInfo, 'historial', after.events);
      expect(after.status, 'Una intención de procesar = un estado').toBe('PENDING');
    },
  );

  test('PG-07 · ciclo completo hasta Revertido y acciones inválidas rechazadas con 409', async ({ api, accounts, pages }) => {
    // CH-017 "Una reversión trazable".
    const payment = await api.createPayment(paymentData(accounts.CHECKING));

    await pages.paymentDetail.goto(payment.id);
    await pages.paymentDetail.processOnce('PENDING');
    await pages.paymentDetail.processOnce('COMPLETED');
    await pages.paymentDetail.reverseButton.click();
    await expect(pages.paymentDetail.status).toHaveText(STATUS_LABEL.REVERSED);

    // Historial completo y en orden.
    expect.soft(await pages.paymentDetail.eventTitles()).toEqual([
      'Programado',
      'Programado → Pendiente',
      'Pendiente → Completado',
      'Completado → Revertido',
    ]);
    // En estado final no debe ofrecerse ninguna acción.
    await expect.soft(pages.paymentDetail.processButton).toHaveCount(0);
    await expect.soft(pages.paymentDetail.reverseButton).toHaveCount(0);

    // Acciones que no corresponden al estado actual → 409 y sin cambios.
    for (const action of ['PROCESS', 'REVERSE'] as const) {
      const res = await api.transition(payment.id, action, crypto.randomUUID());
      expect.soft(res.status(), `${action} sobre un pago revertido`).toBe(409);
    }
    expect((await api.getPayment(payment.id)).status).toBe('REVERSED');
  });

  test('PG-08 · el filtro por estado solo muestra pagos de ese estado', async ({ api, pages }) => {
    // `api` en los parámetros: login previo vía fixture.
    await pages.paymentsList.goto();
    for (const status of ['SCHEDULED', 'PENDING', 'COMPLETED', 'REVERSED'] as const) {
      await pages.paymentsList.filterStatus(status);
      // expect.poll reintenta hasta que la lista se actualiza con el filtro aplicado.
      await expect
        .poll(async () => {
          const statuses = await pages.paymentsList.visibleStatuses();
          return statuses.length > 0 && statuses.every((s) => s === STATUS_LABEL[status]);
        }, { message: `Todas las filas debían estar en "${STATUS_LABEL[status]}"`, timeout: 8_000 })
        .toBe(true);
    }
  });

  test(
    'PG-09 · completar un pago debita la cuenta origen y revertirlo devuelve el dinero',
    { annotation: { type: 'question', description: 'BUG-19 (a confirmar): en la exploración el saldo no cambió en ningún estado' } },
    async ({ api, accounts }, testInfo) => {
      const amount = 1.23;
      const before = await api.snapshotBalances();
      const payment = await api.createPayment(paymentData(accounts.CHECKING, { amount }));

      await api.transition(payment.id, 'PROCESS', crypto.randomUUID());
      await api.transition(payment.id, 'PROCESS', crypto.randomUUID());
      expect((await api.getPayment(payment.id)).status).toBe('COMPLETED');
      const afterCompleted = await api.snapshotBalances();

      await api.transition(payment.id, 'REVERSE', crypto.randomUUID());
      const afterReversed = await api.snapshotBalances();
      await attachEvidence(testInfo, 'saldos', { before, afterCompleted, afterReversed });

      expect.soft(afterCompleted.CHECKING, 'Al completarse, CHECKING debía bajar 1.23').toBe(before.CHECKING - toCents(amount));
      expect.soft(afterReversed.CHECKING, 'Al revertirse, CHECKING debía volver al valor inicial').toBe(before.CHECKING);
    },
  );
});
