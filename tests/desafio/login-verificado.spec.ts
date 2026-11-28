/**
 * login-verificado.spec.ts — Desafío "¿Cómo sabes que de verdad entraste?" (28/11/2026).
 *
 * LA PREGUNTA:
 * Un test que completa el formulario, hace clic y queda en verde no demuestra nada si su
 * aserción también se cumple SIN haber entrado. Por ejemplo, comprobar que se ve el texto
 * "BuggyBank" no sirve: la pantalla de login ya dice "Bienvenido a BuggyBank".
 *
 * LA ASERCIÓN ELEGIDA:
 * El resumen del dashboard, "Saldo total disponible". Solo existe después de entrar: no
 * aparece en /login, y la app lo dibuja con los datos de las cuentas de la sesión.
 * Como refuerzo, se le pregunta al servidor: /api/dashboard tiene que responder 200 con el
 * email de ESTA cuenta. Así no basta con que la pantalla "parezca" un dashboard: el servidor
 * tiene que reconocer la sesión, y tiene que ser la de esta cuenta.
 *
 * CÓMO SE COMPROBÓ QUE LA ASERCIÓN SIRVE (el experimento, solo en la copia local):
 *   1. Comentar la línea del clic (marcada abajo) y correr el test → tiene que FALLAR en
 *      la aserción del dashboard: sin clic no hay login y el resumen nunca aparece.
 *   2. Restaurar el clic y correrlo otra vez → tiene que PASAR.
 * Si en el paso 1 el test siguiera en verde, la aserción no estaría comprobando el login.
 *
 * Ejecutar:  npm run test:desafio-login
 * (Credenciales: las del .env, o un sandbox nuevo si el .env tiene BB_COURSE_CODE.
 *  Ver "Preparar el sandbox" en el README.)
 */
import { expect, test } from '@playwright/test';
import { credentials } from '../../src/config/env';
import { LoginPage } from '../../src/pages/LoginPage';

test(
  'Login con una cuenta de prueba: después de entrar se ve el saldo del dashboard y el servidor reconoce la sesión',
  { tag: '@desafio-login' },
  async ({ page }) => {
    const login = new LoginPage(page);

    // Los pasos del login van uno a uno, y no con login.login(), para que el clic sea UNA
    // línea de este archivo y el experimento no toque código que usan otras pruebas.
    await login.goto();
    await login.emailInput.fill(credentials.email);
    await login.passwordInput.fill(credentials.password);
    await login.submitButton.click(); // ← EXPERIMENTO: esta es la línea que se comenta

    // Aserción principal: algo que solo se ve después de entrar.
    // Espera hasta 10 s (expect.timeout en playwright.config.ts) a que aparezca.
    await expect(page.getByText('Saldo total disponible'), 'El resumen del dashboard solo se ve con la sesión iniciada').toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Refuerzo: el servidor reconoce la sesión, y es la de esta cuenta.
    // page.request comparte las cookies del navegador: pregunta con la misma sesión que la página.
    const response = await page.request.get('/api/dashboard');
    expect(response.status(), 'Con la sesión iniciada, /api/dashboard responde 200 (sin sesión: 401)').toBe(200);
    const dashboard = await response.json();
    expect(dashboard.user.email, 'La sesión es la de la cuenta con la que se hizo login').toBe(credentials.email);
  },
);
