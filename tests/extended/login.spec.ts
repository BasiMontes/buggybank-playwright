/**
 * login.spec.ts — Inicio y cierre de sesión (LG-01 a LG-04).
 *
 * A diferencia del resto, estas pruebas pasan por el FORMULARIO de login (no por la API),
 * porque el formulario es justamente lo que se está probando.
 *
 * Riesgos: no poder entrar, mensajes de error confusos o que revelan información
 * ("ese email no existe" ayuda a un atacante a adivinar usuarios), y sesiones que
 * siguen vivas después de "Salir".
 */
import { attachEvidence, expect, test } from '../../src/fixtures/test';
import { credentials } from '../../src/config/env';

test.describe('Login', { tag: '@extended' }, () => {
  test('LG-01 · con credenciales válidas se entra al dashboard', async ({ page, pages }) => {
    await pages.login.goto();
    await pages.login.login(credentials.email, credentials.password);

    await page.waitForURL('**/dashboard');
    await expect(page.getByText(/^Hola, /)).toBeVisible();
    await expect(pages.dashboard.totalLabel).toBeVisible();
  });

  test('LG-02 · con un email de formato inválido el botón queda deshabilitado y no se llama al servidor', async ({ page, pages }) => {
    // La app no deja pulsar "Iniciar sesión" mientras el email no es válido (el botón queda `disabled`),
    // así que lo que se comprueba es eso, no un mensaje tras el clic.
    const loginCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/auth/login')) loginCalls.push(r.url());
    });

    await pages.login.goto();
    await pages.login.emailInput.fill('no-es-un-email');
    await pages.login.passwordInput.fill('cualquiera');

    await expect(pages.login.submitButton).toBeDisabled();
    expect(loginCalls, 'La validación del frontend debía frenar el envío').toHaveLength(0);
    await expect(page).toHaveURL(/\/login/);
  });

  test(
    'LG-02 · una contraseña incorrecta muestra un mensaje en el idioma de la app',
    { annotation: { type: 'issue', description: 'BUG-23: el servidor responde "Auth failed" en inglés mientras el resto de la app está en español (CH-001)' } },
    async ({ page, pages }, testInfo) => {
      await pages.login.goto();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/auth/login')),
        pages.login.login(credentials.email, 'contraseña-incorrecta'),
      ]);

      await expect(page).toHaveURL(/\/login/);
      await attachEvidence(testInfo, 'respuesta', { status: response.status(), body: await response.text() });
      // El error aparece como texto rojo dentro del formulario (no como role="alert": ese elemento
      // es el anunciador de rutas de Next.js y siempre está vacío). Aquí aparece "Auth failed" en inglés.
      await expect.soft(page.getByText('Auth failed'), 'El mensaje no debía estar en inglés ("Auth failed")').toBeHidden();
    },
  );

  test('LG-02 · el servidor no revela si un email existe (misma respuesta para usuario real y falso)', async ({ anonApi }, testInfo) => {
    // Si "usuario inexistente" y "contraseña incorrecta" respondieran distinto, alguien
    // podría averiguar qué emails están registrados (enumeración de usuarios).
    const realUser = await anonApi.login(credentials.email, 'contraseña-incorrecta');
    const fakeUser = await anonApi.login('qa-no-existe-xyz@buggybank.local', 'contraseña-incorrecta');
    const real = { status: realUser.status(), body: await realUser.json() };
    const fake = { status: fakeUser.status(), body: await fakeUser.json() };
    await attachEvidence(testInfo, 'respuestas', { real, fake });

    expect.soft(real.status).toBe(fake.status);
    expect.soft(real.body.message).toBe(fake.body.message);
  });

  test('LG-03 · sin sesión, las pantallas privadas redirigen al login', async ({ page }) => {
    for (const path of ['/dashboard', '/transfers', '/payments', '/transactions', '/profile', '/challenges']) {
      await page.goto(path);
      await expect.soft(page, `${path} sin sesión`).toHaveURL(/\/login/);
    }
  });

  test('LG-04 · "Salir" cierra la sesión: ni la pantalla ni la API vuelven a mostrar datos', async ({ api, page, pages }) => {
    // `api` inicia sesión (vía fixture); después salimos por la UI.
    await pages.dashboard.goto();
    await pages.dashboard.logout();

    // 1) Volver atrás o entrar directo al dashboard no debe mostrar datos.
    await page.goBack();
    await page.goto('/dashboard');
    await expect.soft(page).toHaveURL(/\/login/);

    // 2) La API tampoco: la cookie de sesión ya no sirve.
    const res = await page.request.get('/api/dashboard');
    expect.soft(res.status(), 'La API debía responder 401 después de salir').toBe(401);
    // Nota: el teardown del fixture `api` vuelve a iniciar sesión para restaurar saldos.
    void api;
  });
});
