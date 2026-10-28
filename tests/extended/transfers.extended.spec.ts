/**
 * transfers.extended.spec.ts — Cobertura extendida de Transferencias (TR-06 a TR-16).
 *
 * Complementa al núcleo @core con más valores límite, entradas raras y robustez.
 * Ejecuta solo esto con:  npx playwright test tests/extended/transfers.extended.spec.ts
 *
 * Técnicas de diseño usadas aquí (vale la pena nombrarlas en la Charla):
 * - VALORES LÍMITE: 0, 0.01 (mínimo), saldo, saldo + 0.01.
 * - PARTICIONES DE EQUIVALENCIA: negativo / cero / válido / no numérico / demasiados decimales.
 * - ORÁCULO DE CONSERVACIÓN: en transferencias entre cuentas propias el total no cambia.
 */
import { attachEvidence, expect, test } from '../../src/fixtures/test';
import { expectBalanceDelta, expectCleanBalances, expectNoSideEffects } from '../../src/assertions/bank';
import { fmt, fromCents, toCents } from '../../src/utils/money';
import { uniqueNote } from '../../src/utils/testData';

test.describe('Transferencias · extendido', { tag: '@extended' }, () => {
  test('TR-06 · monto 0 se rechaza sin efectos', async ({ api, accounts, pages }) => {
    const note = uniqueNote('TR06');
    const before = await api.snapshotBalances();

    await pages.transfer.goto();
    await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '0', note });
    await pages.transfer.submitAndMaybeWaitForApi();

    await expect(pages.transfer.amountValidationMessage).toBeVisible();
    await expectNoSideEffects(api, before, note);
  });

  test('TR-07 · el monto mínimo (0.01) se acepta y mueve exactamente un centavo', async ({ api, accounts, pages }) => {
    const note = uniqueNote('TR07');
    const before = await api.snapshotBalances();

    await pages.transfer.goto();
    await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '0.01', note });
    const response = await pages.transfer.submitAndWaitForApi();

    expect(response.status()).toBe(200);
    expectBalanceDelta(before, await api.snapshotBalances(), { CHECKING: -1, SAVINGS: +1 });
    expect(await api.findTransactionsByNote(note)).toHaveLength(1);
  });

  test('TR-08 · tres transferencias de 0.10 suman exactamente 0.30 (sin errores de punto flotante)', async ({
    api,
    accounts,
    pages,
  }) => {
    // 0.1 + 0.1 + 0.1 en JavaScript da 0.30000000000000004. Si el backend suma con
    // floats sin redondear, el saldo queda "sucio". Este test lo detecta.
    const note = uniqueNote('TR08');
    const before = await api.snapshotBalances();

    await pages.transfer.goto();
    for (let i = 1; i <= 3; i++) {
      await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '0.10', note: `${note}-${i}` });
      const response = await pages.transfer.submitAndWaitForApi();
      expect(response.status()).toBe(200);
    }

    expectBalanceDelta(before, await api.snapshotBalances(), { CHECKING: -30, SAVINGS: +30 });
    await expectCleanBalances(api);
  });

  test(
    'TR-09 · un monto con 3 decimales se rechaza o se redondea igual en débito y crédito',
    { annotation: { type: 'issue', description: 'BUG-07: la API persiste 3 decimales (visto por API; por UI depende de la validación del navegador)' } },
    async ({ api, accounts, pages }, testInfo) => {
      const note = uniqueNote('TR09');
      const before = await api.snapshotBalances();

      await pages.transfer.goto();
      await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '10.005', note });
      const response = await pages.transfer.submitAndMaybeWaitForApi();

      // Dos resultados aceptables:
      //  a) rechazo (nada cambia), o
      //  b) se procesa con un monto redondeado a centavos, igual en ambas cuentas.
      // Lo que NO es aceptable: saldos con 3 decimales o débito ≠ crédito.
      const after = await api.snapshotBalances();
      const debit = before.CHECKING - after.CHECKING;
      const credit = after.SAVINGS - before.SAVINGS;
      expect.soft(debit, 'Débito y crédito deben ser iguales').toBe(credit);
      expect.soft([0, 1000, 1001], 'El débito debe ser 0 (rechazo), 10.00 o 10.01').toContain(debit);
      await expectCleanBalances(api);

      await attachEvidence(testInfo, 'evidencia-TR09', { before, after, apiStatus: response?.status() ?? 'sin request' });
    },
  );

  test('TR-10 · origen igual a destino no genera movimiento ni cambia saldos', async ({ api, accounts, pages }, testInfo) => {
    const note = uniqueNote('TR10');
    const before = await api.snapshotBalances();

    await pages.transfer.goto();
    await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.CHECKING, amount: '1.00', note });
    const response = await pages.transfer.submitAndMaybeWaitForApi();

    await expect.soft(pages.transfer.successMessage, 'No debía informarse éxito').toBeHidden();
    await expectNoSideEffects(api, before, note);
    await attachEvidence(testInfo, 'evidencia-TR10', { apiStatus: response?.status() ?? 'sin request' });
  });

  test('TR-11 · monto vacío no envía nada y no muestra un éxito viejo', async ({ api, accounts, pages }) => {
    const note = uniqueNote('TR11');
    const before = await api.snapshotBalances();

    await pages.transfer.goto();
    await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '', note });
    await pages.transfer.submitAndMaybeWaitForApi(3_000);

    await expect.soft(pages.transfer.successMessage).toBeHidden();
    await expectNoSideEffects(api, before, note);
  });

  test(
    'TR-12 · si el botón Transferir se ve deshabilitado, no debe ejecutar la transferencia',
    { annotation: { type: 'issue', description: 'BUG-03: el botón tiene estilo deshabilitado pero sigue funcionando (CH-008)' } },
    async ({ api, accounts, page, pages }, testInfo) => {
      const note = uniqueNote('TR12');
      const before = await api.snapshotBalances();
      const overBalance = fmt(fromCents(before.CHECKING + 1));

      await pages.transfer.goto();
      await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: overBalance, note });

      // 1) El estado visual y el estado real del botón deben coincidir.
      const state = await pages.transfer.submitButtonState();
      await attachEvidence(testInfo, 'estado-boton', state);
      expect.soft(state.isDisabled, 'Si el botón se ve deshabilitado, debe tener el atributo disabled').toBe(state.looksDisabled);

      // 2) Aunque alguien lo fuerce (como sugiere el desafío CH-008 con force: true),
      //    no debe moverse dinero. `force: true` saltea los chequeos de Playwright, igual
      //    que un usuario que hace clic sin mirar el estilo.
      if (state.looksDisabled) {
        await pages.transfer.submitButton.click({ force: true });
        await page.waitForTimeout(2_000); // margen para un posible request
      }
      await expectNoSideEffects(api, before, note);
    },
  );

  test('TR-13 · una descripción con HTML se muestra como texto y no se ejecuta', async ({ api, accounts, page, pages }) => {
    // Prueba básica de XSS (inyección de código en la página). Si la app insertara la
    // descripción como HTML, el `onerror` se ejecutaría y setearía window.__xss.
    const marker = uniqueNote('TR13');
    const payload = `${marker} <img src=x onerror="window.__xss=1">`;

    await pages.transfer.goto();
    await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '0.01', note: payload });
    await pages.transfer.submitAndWaitForApi();

    await pages.transactions.goto();
    const row = pages.transactions.rowsWithNote(marker);
    await expect(row).toHaveCount(1);
    await expect(row, 'El texto debe mostrarse literal').toContainText('<img src=x');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), 'No debía ejecutarse código').toBeUndefined();
    // La nota guardada por la API debe ser exactamente la enviada.
    expect((await api.findTransactionsByNote(payload)).length).toBe(1);
  });

  test('TR-14 · una descripción muy larga se rechaza o se guarda sin romper el historial', async ({ api, accounts, pages }, testInfo) => {
    const marker = uniqueNote('TR14');
    const longNote = `${marker}-${'x'.repeat(500)}`;
    const before = await api.snapshotBalances();

    await pages.transfer.goto();
    await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '0.01', note: longNote });
    const response = await pages.transfer.submitAndMaybeWaitForApi();
    await attachEvidence(testInfo, 'respuesta', { status: response?.status() ?? 'sin request' });

    const after = await api.snapshotBalances();
    const rejected = after.CHECKING === before.CHECKING;
    testInfo.annotations.push({ type: 'info', description: rejected ? 'La app rechazó la nota larga' : 'La app aceptó la nota larga' });
    if (rejected) {
      // Rechazada: no debe haber movimiento.
      await expectNoSideEffects(api, before, longNote);
    } else {
      // Aceptada: el historial debe seguir cargando y mostrar la fila.
      await pages.transactions.goto();
      await expect(pages.transactions.rowsWithNote(marker)).toHaveCount(1);
      expect(await pages.transactions.rows.count()).toBeGreaterThan(0);
    }
  });

  test('TR-15 · ida y vuelta A→B→A deja los saldos como al inicio y registra 2 movimientos', async ({ api, accounts, pages }) => {
    const note = uniqueNote('TR15');
    const before = await api.snapshotBalances();

    await pages.transfer.goto();
    await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '7.77', note: `${note}-ida` });
    await pages.transfer.submitAndWaitForApi();
    await pages.transfer.fillForm({ from: accounts.SAVINGS, to: accounts.CHECKING, amount: '7.77', note: `${note}-vuelta` });
    await pages.transfer.submitAndWaitForApi();

    expectBalanceDelta(before, await api.snapshotBalances(), { CHECKING: 0, SAVINGS: 0 });
    expect(await api.findTransactionsByNote(`${note}-ida`)).toHaveLength(1);
    expect(await api.findTransactionsByNote(`${note}-vuelta`)).toHaveLength(1);
  });

  test('TR-16 · un doble clic "humano" (con el ratón) genera una sola transferencia', async ({ api, accounts, page, pages }) => {
    // Control de TC-05: este doble clic tiene milisegundos entre clic y clic, como una
    // persona real. En la exploración la app SÍ lo filtró. Tener los dos tests juntos
    // muestra que el bug aparece solo con envíos realmente simultáneos.
    const amountCents = toCents(1.11);
    const note = uniqueNote('TR16');
    const before = await api.snapshotBalances();

    await pages.transfer.goto();
    await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '1.11', note });
    await pages.transfer.doubleClickSubmit();
    await expect.poll(async () => (await api.findTransactionsByNote(note)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(2_000);

    expect(await api.findTransactionsByNote(note)).toHaveLength(1);
    expectBalanceDelta(before, await api.snapshotBalances(), { CHECKING: -amountCents, SAVINGS: +amountCents });
  });

  // BUG-24: valores límite alrededor de 500. Se hace por API para ir rápido y no depender de la pantalla.
  for (const { amount, shouldDuplicate } of [
    { amount: 499, shouldDuplicate: false },
    { amount: 500, shouldDuplicate: true },
    { amount: 500.5, shouldDuplicate: false },
    { amount: 1000, shouldDuplicate: true },
  ]) {
    test(
      `TR-17 · una transferencia de ${amount} mueve exactamente ${amount}${shouldDuplicate ? ' (BUG-24: se duplica)' : ''}`,
      { annotation: shouldDuplicate ? { type: 'issue', description: 'BUG-24: los importes enteros >= 500 se aplican dos veces' } : [] },
      async ({ api, accounts }, testInfo) => {
        const before = await api.snapshotBalances();
        test.skip(before.CHECKING < toCents(amount * 2), 'Saldo insuficiente para que un duplicado no cause otro error');
        const note = uniqueNote(`TR17-${amount}`);

        const res = await api.transfer({ fromAccountId: accounts.CHECKING.id, toAccountId: accounts.SAVINGS.id, amount, note });
        await attachEvidence(testInfo, 'respuesta', { status: res.status(), body: await res.text() });

        expect(res.status()).toBe(200);
        expectBalanceDelta(before, await api.snapshotBalances(), { CHECKING: -toCents(amount), SAVINGS: +toCents(amount) });
        expect(await api.findTransactionsByNote(note), 'Una intención = un movimiento').toHaveLength(1);
      },
    );
  }
});
