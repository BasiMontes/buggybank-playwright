/**
 * transfers.core.spec.ts — LA ENTREGA DEL DESAFÍO: 5 pruebas de Transferencias.
 *
 * Ejecuta solo estas con:  npm run test:core
 *
 * ┌───────┬──────────────────────────────┬────────────────────────────┬──────────────────┐
 * │ ID    │ Caso                         │ Riesgo que cubre           │ Resultado previsto│
 * ├───────┼──────────────────────────────┼────────────────────────────┼──────────────────┤
 * │ TC-01 │ Transferencia válida         │ Dinero perdido o creado    │ Verde            │
 * │ TC-02 │ Monto negativo               │ Transferencia invertida    │ Verde (UI)       │
 * │ TC-03 │ Fondos insuficientes         │ Sobregiro                  │ ROJO → BUG-01    │
 * │ TC-04 │ Borde: saldo exacto          │ Límite > vs >=             │ Verde            │
 * │ TC-05 │ Borde: doble submit          │ Cobro duplicado            │ ROJO → BUG-02    │
 * └───────┴──────────────────────────────┴────────────────────────────┴──────────────────┘
 *
 * Patrón que siguen TODAS las pruebas (Arrange / Act / Assert):
 *   1. ARRANGE: foto de saldos "antes" por API + nota única para identificar el movimiento.
 *   2. ACT:     la acción se hace POR LA UI, como un usuario.
 *   3. ASSERT:  se verifica en la UI (lo que ve el usuario) y en la API (la fuente de verdad).
 *
 * Los tests en ROJO son intencionales: BuggyBank tiene bugs a propósito y el desafío pide
 * NO cambiar el resultado esperado para conseguir un verde. Cada test rojo tiene una
 * anotación "issue" que aparece en el reporte HTML con el ID del bug de BUGS.md.
 */
import { attachEvidence, expect, test } from '../../src/fixtures/test';
import { expectBalanceDelta, expectCleanBalances, expectNoSideEffects } from '../../src/assertions/bank';
import { fmt, fromCents, toCents } from '../../src/utils/money';
import { uniqueNote } from '../../src/utils/testData';

test.describe('Transferencias @core', () => {
  // ---------------------------------------------------------------------------
  // TC-01 · Transferencia válida
  // ---------------------------------------------------------------------------
  test(
    'TC-01 · transferencia válida debita el origen, acredita el destino y registra el movimiento',
    { tag: '@core' },
    async ({ api, accounts, pages }, testInfo) => {
      // ARRANGE ---------------------------------------------------------------
      // 13.37 es un monto "poco común": difícil confundirlo con datos semilla.
      const amount = 13.37;
      const amountCents = toCents(amount);
      const note = uniqueNote('TC01');
      const before = await api.snapshotBalances();

      // Precondición: tiene que haber saldo suficiente. Si no lo hay, el test no es
      // válido (no es un bug de la app, es un problema de datos) → mensaje claro.
      expect(before.CHECKING, 'Precondición: CHECKING necesita al menos 13.37').toBeGreaterThanOrEqual(amountCents);

      // ACT -------------------------------------------------------------------
      await pages.transfer.goto();
      await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: String(amount), note });
      const response = await pages.transfer.submitAndWaitForApi();

      // ASSERT ----------------------------------------------------------------
      // 1) Lo que ve el usuario: mensaje de éxito. Es el oráculo MÁS DÉBIL: por sí solo
      //    no alcanza, por eso hay 4 verificaciones más abajo.
      expect(response.status(), 'La API debía aceptar la transferencia').toBe(200);
      await expect(pages.transfer.successMessage).toBeVisible();

      // 2) Débito y crédito exactos + total conservado (fuente de verdad: la API).
      const after = await api.snapshotBalances();
      expectBalanceDelta(before, after, { CHECKING: -amountCents, SAVINGS: +amountCents });
      await expectCleanBalances(api);

      // 3) El movimiento quedó registrado UNA vez, con los datos correctos.
      //    NO verificamos `direction` a propósito: está roto para todas las transferencias
      //    (BUG-09) y lo cubre MV-03. Si lo verificáramos aquí, este test quedaría rojo por
      //    un bug de OTRO módulo y taparía el resultado real de la transferencia.
      const movements = await api.findTransactionsByNote(note);
      expect(movements, 'Debía registrarse exactamente un movimiento con la nota de la prueba').toHaveLength(1);
      const [movement] = movements;
      expect.soft(toCents(movement.amount)).toBe(amountCents);
      expect.soft(movement.status).toBe('COMPLETED');
      expect.soft(movement.fromAccountNumber).toBe(accounts.CHECKING.accountNumber);
      expect.soft(movement.toAccountNumber).toBe(accounts.SAVINGS.accountNumber);

      // 4) La pantalla de transferencias muestra el saldo nuevo en el selector de origen.
      expect.soft(await pages.transfer.sourceOptionBalance('CHECKING'), 'El saldo del <option> de origen debía actualizarse').toBe(after.CHECKING);

      // 5) El usuario ve el movimiento en el historial (UI).
      await pages.transactions.goto();
      await expect(pages.transactions.rowsWithNote(note)).toHaveCount(1);
      await expect(pages.transactions.rowsWithNote(note)).toContainText(`$${fmt(amount)}`);

      await attachEvidence(testInfo, 'evidencia-TC01', { amount, note, before, after, movement });
    },
  );

  // ---------------------------------------------------------------------------
  // TC-02 · Monto inválido (negativo)
  // ---------------------------------------------------------------------------
  test(
    'TC-02 · monto negativo se rechaza sin mover dinero ni registrar movimiento',
    { tag: '@core' },
    async ({ api, accounts, page, pages }, testInfo) => {
      // ARRANGE
      const note = uniqueNote('TC02');
      const before = await api.snapshotBalances();

      // Escuchamos la red: si el frontend bloquea, NO debería salir ningún POST.
      // Es una evidencia extra de QUIÉN rechaza (front o back).
      const transferRequests: string[] = [];
      page.on('request', (req) => {
        if (req.url().includes('/api/transfers') && req.method() === 'POST') transferRequests.push(req.postData() ?? '');
      });

      // ACT: un usuario escribe -50.
      await pages.transfer.goto();
      await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '-50', note });
      await pages.transfer.submit();

      // ASSERT
      // 1) El usuario ve el motivo del rechazo.
      await expect(pages.transfer.amountValidationMessage).toBeVisible();
      // 2) Lo que importa de verdad: no pasó nada (saldos iguales, sin movimiento).
      await expectNoSideEffects(api, before, note);
      // 3) Evidencia de que el rechazo fue en el frontend.
      expect.soft(transferRequests, 'El frontend no debía enviar la transferencia al servidor').toHaveLength(0);

      // OJO: que esto quede VERDE no significa que el riesgo esté cubierto del todo.
      // La API acepta -50 si se lo mandas directamente (BUG-04). Eso lo prueba AP-01 en tests/api.
      await attachEvidence(testInfo, 'evidencia-TC02', { note, before, transferRequests });
    },
  );

  // ---------------------------------------------------------------------------
  // TC-03 · Fondos insuficientes
  // ---------------------------------------------------------------------------
  test(
    'TC-03 · transferir un centavo más que el saldo se rechaza sin mover dinero',
    {
      tag: '@core',
      annotation: { type: 'issue', description: 'BUG-01: la app acepta transferencias mayores al saldo (deja CHECKING en negativo)' },
    },
    async ({ api, accounts, pages }, testInfo) => {
      // ARRANGE: el monto es el saldo ACTUAL + 0.01. Lo calculamos en el momento,
      // no lo escribimos fijo, para que funcione con cualquier sandbox.
      const note = uniqueNote('TC03');
      const before = await api.snapshotBalances();
      const amount = fromCents(before.CHECKING + 1);

      // ACT
      await pages.transfer.goto();
      await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: fmt(amount), note });
      const response = await pages.transfer.submitAndMaybeWaitForApi();

      // ASSERT
      // No sabemos qué mensaje mostraría la app al rechazar (nunca lo hizo), así que
      // verificamos lo que SÍ sabemos: no debe decir "OK transfer" y no debe mover dinero.
      await expect.soft(pages.transfer.successMessage, 'No debía mostrarse un mensaje de éxito').toBeHidden();
      await expectNoSideEffects(api, before, note);
      await expectCleanBalances(api); // también atrapa el -0.01000000000021828 (BUG-08)

      await attachEvidence(testInfo, 'evidencia-TC03', {
        note,
        amount,
        before,
        after: await api.snapshotBalances(),
        apiStatus: response?.status() ?? 'sin request (bloqueado por el frontend)',
        apiBody: response ? await response.text() : null,
      });
      // El saldo se restaura automáticamente en el teardown del fixture `api`.
    },
  );

  // ---------------------------------------------------------------------------
  // TC-04 · Borde: transferir el saldo exacto
  // ---------------------------------------------------------------------------
  test(
    'TC-04 · transferir exactamente el saldo disponible se acepta y deja la cuenta en 0.00',
    {
      tag: '@core',
      annotation: {
        type: 'issue',
        description: 'BUG-24: transferir el saldo exacto mueve el doble (duplicated:true) y registra un solo movimiento',
      },
    },
    async ({ api, accounts, pages }, testInfo) => {
      // ¿Por qué este caso? Es el valor LÍMITE de la regla "fondos suficientes".
      // Un error típico es programar `monto >= saldo → rechazar` en vez de `monto > saldo`.
      // TC-03 prueba saldo + 0.01 (justo afuera); TC-04 prueba el saldo (justo adentro).

      // ARRANGE
      const note = uniqueNote('TC04');
      const before = await api.snapshotBalances();
      expect(before.CHECKING, 'Precondición: CHECKING debe tener saldo positivo').toBeGreaterThan(0);
      const amount = fromCents(before.CHECKING);

      // ACT
      await pages.transfer.goto();
      await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: fmt(amount), note });
      const response = await pages.transfer.submitAndWaitForApi();

      // ASSERT
      expect(response.status()).toBe(200);
      await expect(pages.transfer.successMessage).toBeVisible();
      const after = await api.snapshotBalances();
      expect.soft(after.CHECKING, 'CHECKING debía quedar exactamente en 0.00').toBe(0);
      expectBalanceDelta(before, after, { CHECKING: -before.CHECKING, SAVINGS: +before.CHECKING });
      await expectCleanBalances(api);
      expect(await api.findTransactionsByNote(note)).toHaveLength(1);

      await attachEvidence(testInfo, 'evidencia-TC04', { note, amount, before, after });
      // TEARDOWN: el fixture `api` devuelve el dinero a CHECKING al terminar.
    },
  );

  // ---------------------------------------------------------------------------
  // TC-05 · Borde: doble submit
  // ---------------------------------------------------------------------------
  test(
    'TC-05 · dos envíos simultáneos de la misma transferencia generan un solo movimiento',
    {
      tag: '@core',
      annotation: { type: 'issue', description: 'BUG-02: el doble submit simultáneo crea dos transferencias (duplicated:false en ambas)' },
    },
    async ({ api, accounts, page, pages }, testInfo) => {
      // ARRANGE
      const amount = 2.22;
      const amountCents = toCents(amount);
      const note = uniqueNote('TC05');
      const before = await api.snapshotBalances();

      // Contamos cuántos POST salen y qué responde el servidor a cada uno.
      let postsSent = 0;
      page.on('request', (req) => {
        if (req.url().includes('/api/transfers') && req.method() === 'POST') postsSent++;
      });
      const apiCalls: { status: number; body: string }[] = [];
      page.on('response', async (res) => {
        if (res.url().includes('/api/transfers') && res.request().method() === 'POST') {
          apiCalls.push({ status: res.status(), body: await res.text().catch(() => '') });
        }
      });

      // ACT: una sola intención del usuario, enviada dos veces en el mismo instante.
      await pages.transfer.goto();
      await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: String(amount), note });
      await pages.transfer.doubleSubmitSimultaneous();

      // ESPERA EXPLÍCITA: seguimos cuando han salido peticiones y TODAS tienen respuesta.
      // Antes había una espera fija de 2 s tras la primera respuesta. La traza mostró que las
      // dos peticiones salen a la vez, pero una responde a los 1,8 s y la otra a los 4,4 s:
      // la espera fija acertaba por poco y, con la red lenta, podía dar un verde falso.
      // `toPass` reintenta el bloque hasta que se cumple (o hasta el timeout).
      await expect(() => {
        expect(postsSent, 'Debía salir al menos una petición de transferencia').toBeGreaterThan(0);
        expect(apiCalls, 'Cada petición enviada debía tener su respuesta').toHaveLength(postsSent);
      }).toPass({ timeout: 15_000 });

      // ASSERT
      const after = await api.snapshotBalances();
      const movements = await api.findTransactionsByNote(note);
      expect.soft(movements, 'Una intención = un movimiento').toHaveLength(1);
      expectBalanceDelta(before, after, { CHECKING: -amountCents, SAVINGS: +amountCents });

      await attachEvidence(testInfo, 'evidencia-TC05', {
        note,
        amount,
        before,
        after,
        postsEnviados: apiCalls.length,
        respuestas: apiCalls,
        movimientos: movements.map((m) => ({ id: m.id, amount: m.amount, createdAt: m.createdAt })),
      });
    },
  );
});
