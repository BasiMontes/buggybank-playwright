/**
 * dashboard.spec.ts — Consistencia de saldos entre vistas (DB-01 a DB-03).
 *
 * Riesgo: que distintas pantallas muestren saldos distintos. El usuario decide con lo
 * que ve; si el dashboard dice una cosa y la API otra, alguno de los dos miente.
 * Desafíos relacionados: CH-003 (saldo cruzado) y CH-009 (regresión lateral post-transfer).
 */
import { attachEvidence, expect, test } from '../../src/fixtures/test';
import { toCents } from '../../src/utils/money';
import { uniqueNote } from '../../src/utils/testData';

test.describe('Dashboard', { tag: '@extended' }, () => {
  test('DB-01 · el total consolidado es la suma de los saldos de las cuentas', async ({ api, pages }, testInfo) => {
    // Pedimos `api` en los parámetros solo para que el fixture haga login: deja la página logueada.
    await pages.dashboard.goto();
    const ui = await pages.dashboard.readBalances();
    await attachEvidence(testInfo, 'saldos-ui', ui);

    expect(ui.total).toBe(ui.CHECKING + ui.SAVINGS);
  });

  test('DB-02 · los saldos de la pantalla coinciden con la API', async ({ api, pages }, testInfo) => {
    await pages.dashboard.goto();
    const ui = await pages.dashboard.readBalances();
    const fromApi = await api.snapshotBalances();
    await attachEvidence(testInfo, 'comparacion', { ui, api: fromApi });

    expect.soft(ui.total, 'Total').toBe(fromApi.total);
    expect.soft(ui.CHECKING, 'CHECKING').toBe(fromApi.CHECKING);
    expect.soft(ui.SAVINGS, 'SAVINGS').toBe(fromApi.SAVINGS);
  });

  test('DB-03 · después de transferir, el dashboard muestra los saldos nuevos sin recargar la sesión', async ({
    api,
    accounts,
    pages,
  }, testInfo) => {
    // CH-009: hacemos la acción en un módulo (Transferencias) y verificamos OTRO
    // (Dashboard) navegando por el menú, como un usuario, sin page.reload().
    await pages.dashboard.goto();
    const initial = await pages.dashboard.readBalances();

    await pages.transfer.navLink('Transferencias').click();
    await pages.transfer.fromSelect.waitFor();
    await pages.transfer.fillForm({ from: accounts.CHECKING, to: accounts.SAVINGS, amount: '4.56', note: uniqueNote('DB03') });
    await pages.transfer.submitAndWaitForApi();

    await pages.dashboard.navLink('Dashboard').click();
    await pages.dashboard.totalLabel.waitFor();
    const ui = await pages.dashboard.readBalances();
    const fromApi = await api.snapshotBalances();
    await attachEvidence(testInfo, 'antes-despues', { initial, ui, api: fromApi });

    expect.soft(ui.CHECKING, 'CHECKING en pantalla = API').toBe(fromApi.CHECKING);
    expect.soft(ui.SAVINGS, 'SAVINGS en pantalla = API').toBe(fromApi.SAVINGS);
    expect.soft(ui.CHECKING, 'CHECKING bajó 4.56').toBe(initial.CHECKING - toCents(4.56));
    expect.soft(ui.total, 'El total no cambia').toBe(initial.total);
  });
});
