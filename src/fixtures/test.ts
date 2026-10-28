/**
 * test.ts — Fixtures propios: el "kit" que recibe cada prueba ya preparado.
 *
 * ¿Qué es un fixture?
 * Es algo que Playwright prepara ANTES de un test y limpia DESPUÉS. El ejemplo más
 * conocido es `page`. Acá agregamos los nuestros:
 *
 *   api        → cliente de la API, YA LOGUEADO. Comparte cookies con `page`, así que
 *                la página también queda logueada sin pasar por el formulario.
 *   accounts   → las dos cuentas { CHECKING, SAVINGS } con sus IDs, leídas de la API.
 *   anonApi    → cliente de la API SIN sesión (para probar que los endpoints exigen login).
 *   pages      → todos los Page Objects instanciados sobre la misma `page`.
 *
 * Cómo se usa en un test:
 *   import { test, expect } from '../../src/fixtures/test';
 *   test('algo', async ({ api, accounts, pages }) => { ... });
 *
 * INDEPENDENCIA DE LOS TESTS (lo pide el desafío):
 * Playwright crea un navegador "limpio" (BrowserContext) para cada test. Como el fixture
 * `api` hace login dentro de ese contexto, cada test tiene su propia sesión y NO depende
 * de que otro test haya corrido antes. Podés ejecutar cualquier test solo.
 */
import { test as base, expect, APIRequestContext, TestInfo } from '@playwright/test';
import { BuggyBankApi } from '../api/BuggyBankApi';
import { Account, AccountType } from '../api/types';
import { BASE_URL, credentials } from '../config/env';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { NewPaymentPage, PaymentDetailPage, PaymentsListPage } from '../pages/PaymentsPage';
import { ProfilePage } from '../pages/ProfilePage';
import { TransactionsPage } from '../pages/TransactionsPage';
import { TransferPage } from '../pages/TransferPage';

export interface Pages {
  login: LoginPage;
  dashboard: DashboardPage;
  transfer: TransferPage;
  transactions: TransactionsPage;
  paymentsList: PaymentsListPage;
  newPayment: NewPaymentPage;
  paymentDetail: PaymentDetailPage;
  profile: ProfilePage;
}

interface Fixtures {
  api: BuggyBankApi;
  accounts: Record<AccountType, Account>;
  anonApi: BuggyBankApi;
  pages: Pages;
}

export const test = base.extend<Fixtures>({
  /**
   * api: login por API en el MISMO contexto que la página.
   * `page.request` es un APIRequestContext que comparte la "cookie jar" del navegador:
   * la cookie de sesión que devuelve /api/auth/login queda disponible para `page`.
   */
  api: async ({ page }, use, testInfo) => {
    const api = new BuggyBankApi(page.request);
    await api.loginOrFail(credentials.email, credentials.password);

    // Guardamos el saldo de CHECKING al empezar, para la limpieza final.
    const { CHECKING } = await api.getAccounts();

    await use(api); // ← acá corre el test

    // TEARDOWN: pase lo que pase en el test (verde, rojo o error), devolvemos los saldos
    // a como estaban. Así el siguiente test arranca con datos "sanos" aunque este haya
    // encontrado un bug que dejó la cuenta en negativo.
    // Si el test cerró sesión, volvemos a entrar solo para limpiar.
    if (!(await page.request.get('/api/me')).ok()) {
      await api.login(credentials.email, credentials.password);
    }
    const restored = await api.restoreCheckingBalance(CHECKING.balance);
    if (!restored) {
      testInfo.annotations.push({
        type: 'warning',
        description: 'La limpieza no dejó el saldo como estaba: crea un sandbox nuevo antes de volver a ejecutar.',
      });
    }
    // No hacemos logout: el contexto se destruye solo y la cookie desaparece con él.
  },

  /** Las cuentas se leen frescas en cada test (los IDs no cambian, los saldos sí). */
  accounts: async ({ api }, use) => {
    await use(await api.getAccounts());
  },

  /**
   * Cliente SIN sesión. Creamos un APIRequestContext nuevo e independiente
   * (no comparte cookies con nada) y lo cerramos al terminar.
   */
  anonApi: async ({ playwright }, use) => {
    const context: APIRequestContext = await playwright.request.newContext({ baseURL: BASE_URL });
    await use(new BuggyBankApi(context));
    await context.dispose();
  },

  /** Todos los Page Objects sobre la misma página. */
  pages: async ({ page }, use) => {
    await use({
      login: new LoginPage(page),
      dashboard: new DashboardPage(page),
      transfer: new TransferPage(page),
      transactions: new TransactionsPage(page),
      paymentsList: new PaymentsListPage(page),
      newPayment: new NewPaymentPage(page),
      paymentDetail: new PaymentDetailPage(page),
      profile: new ProfilePage(page),
    });
  },
});

export { expect };

/**
 * Adjunta un objeto como JSON al reporte HTML de Playwright.
 * Es nuestra EVIDENCIA: en el reporte se ve qué saldos había antes/después, qué
 * respondió la API, etc. Lo pide el desafío ("dejen evidencia") y ayuda muchísimo
 * a explicar un test en rojo en la Charla.
 */
export async function attachEvidence(testInfo: TestInfo, name: string, data: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: JSON.stringify(data, null, 2),
    contentType: 'application/json',
  });
}
