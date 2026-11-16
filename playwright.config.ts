/**
 * playwright.config.ts — Configuración central de la suite.
 *
 * Cada opción tiene un comentario con el "por qué", porque varias decisiones
 * salen directamente de cómo funciona BuggyBank (ver TEST_PLAN.md, sección 2).
 */
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './src/config/env';

export default defineConfig({
  // Dónde están los tests.
  testDir: './tests',

  // Se ejecuta una vez antes de toda la suite. Si no hay credenciales pero sí código del
  // curso (BB_COURSE_CODE), crea un sandbox nuevo. Es lo que permite correr en GitHub
  // Actions sin renovar credenciales a mano cada 24 h. Ver src/config/globalSetup.ts.
  globalSetup: './src/config/globalSetup.ts',

  // ¿Por qué NO en paralelo?
  // Todas las pruebas usan las MISMAS dos cuentas del sandbox. Si dos tests transfieren
  // dinero al mismo tiempo, la prueba A vería cambios de saldo hechos por la prueba B y
  // fallaría sin que haya un bug real (falso positivo). Con 1 worker, los tests corren
  // uno después del otro y cada uno puede razonar sobre "saldo antes / saldo después".
  fullyParallel: false,
  workers: 1,

  // Sin reintentos: si una prueba falla por un bug, queremos verla roja la primera vez.
  // Un reintento podría ocultar bugs intermitentes (por ejemplo, condiciones de carrera
  // como el doble submit) y además volvería a mover dinero.
  retries: 0,

  // Si alguien deja un `test.only` por error, en CI falla en vez de saltear el resto.
  forbidOnly: !!process.env.CI,

  // Tiempo máximo por test. La app está en Vercel y algunas pantallas muestran
  // "Cargando..." un par de segundos, así que damos margen.
  timeout: 60_000,
  expect: {
    // Tiempo que una aserción "web-first" (toBeVisible, toHaveText...) reintenta antes de fallar.
    timeout: 10_000,
  },

  // Reportes:
  // - list: lo que ves en la terminal mientras corre.
  // - html: el reporte navegable con capturas, videos y traces (npm run report).
  //   open: 'never' para que no abra el navegador solo; lo abres cuando quieras.
  // - json (solo en CI): resultados en un archivo que lee scripts/ci-summary.mjs para
  //   comparar con los fallos conocidos (ci/expected-results.json).
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'results-ci.json' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,

    // Evidencia automática cuando una prueba falla (pedido del desafío: "dejen evidencia").
    // - screenshot: captura de la pantalla en el momento del fallo.
    // - trace: grabación paso a paso (DOM, red, consola). Se abre con `npx playwright show-trace`.
    // - video: video de la ejecución.
    // Solo se guardan si el test falla, para no llenar el disco.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',

    // La app formatea fechas y montos según el idioma y la zona horaria del navegador.
    // Fijarlos hace que la suite se comporte igual en tu máquina, en la de otra persona y en CI.
    locale: 'es-NZ',
    timezoneId: 'Pacific/Auckland',

    // Tiempo máximo para una acción (click, fill...).
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
