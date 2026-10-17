# BuggyBank · Suite de pruebas con Playwright

Entrega del **Desafío BuggyBank** de Free Range Testers: suite automatizada contra [BuggyBank](https://buggybank-seven.vercel.app/login), un banco de práctica con bugs sembrados a propósito.

| | |
|---|---|
| **Flujo elegido (entrega)** | Transferencias — 5 pruebas `@core` |
| **Cobertura extra** | Dashboard, Movimientos, Pagos, Perfil, Login y API — 61 pruebas `@extended` / `@api` |
| **Herramienta** | Playwright + TypeScript |
| **Bugs documentados** | 23 → [`docs/BUGS.md`](docs/BUGS.md) |
| **Plan de pruebas** | [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) |
| **Guía para leer el código** | [`docs/GUIA.md`](docs/GUIA.md) |

---

## 1. Requisitos

- **Node.js 18 o superior** (`node -v` para verificar).
- Un **sandbox de BuggyBank** vigente (dura 24 horas).
- Sistema operativo: Windows, macOS o Linux.

## 2. Instalación

```bash
git clone <URL-de-este-repo>
cd buggybank-playwright
npm install                 # instala Playwright, TypeScript y dotenv
npm run install:browsers    # descarga Chromium para Playwright (una sola vez)
```

## 3. Preparar el sandbox (cada 24 horas)

1. Entrá a <https://buggybank-seven.vercel.app/login>.
2. Escribí el **código del curso** en "Código del curso" y tocá **Crear usuario temporal**.
3. Copiá el email y la contraseña que te da la app.
4. Creá tu archivo de credenciales a partir de la plantilla:

   ```bash
   cp .env.example .env
   ```

5. Completá `.env`:

   ```
   BB_BASE_URL=https://buggybank-seven.vercel.app
   BB_EMAIL=<tu email del sandbox>
   BB_PASSWORD=<tu contraseña del sandbox>
   ```

> ⚠️ El `.env` está en `.gitignore` y **nunca se sube**. El código del curso no hace falta en el `.env`: las pruebas usan un usuario ya creado.
> Cuando el sandbox vence, creá uno nuevo y actualizá estos dos valores. Las pruebas **no dependen de los datos iniciales**: leen los saldos al empezar.

## 4. Ejecutar

| Comando | Qué corre |
|---|---|
| `npm run test:core` | **La entrega:** las 5 pruebas de Transferencias |
| `npm test` | Toda la suite (66 pruebas, ~10 min) |
| `npm run test:extended` | Solo la cobertura extendida de UI |
| `npm run test:api` | Solo las pruebas de API |
| `npm run test:headed` | Las `@core` con el navegador visible (para ver qué hace) |
| `npm run test:ui` | Modo interactivo de Playwright: elegís y mirás cada test paso a paso |
| `npm run report` | Abre el reporte HTML de la última ejecución |
| `npm run typecheck` | Verifica tipos sin ejecutar nada |

Un test puntual: `npx playwright test -g "TC-03"`.

## 5. Las 5 pruebas de la entrega

| ID | Qué debería pasar | Riesgo que cubre | Cómo se comprueba | Resultado |
|----|-------------------|------------------|-------------------|-----------|
| **TC-01** Transferencia válida (13.37) | Se debita el origen, se acredita el destino y queda un movimiento | Dinero que se pierde o se crea | Saldos antes/después por API (en centavos), total conservado, 1 movimiento con monto/estado/cuentas correctos, saldo actualizado en pantalla y fila en el historial | ✅ Verde |
| **TC-02** Monto negativo (-50) | Se rechaza sin efectos | Transferencia "al revés" | Mensaje de validación + saldos iguales + sin movimiento + ningún POST enviado | ✅ Verde (la UI bloquea; la API no → AP-01a) |
| **TC-03** Fondos insuficientes (saldo + 0.01) | Se rechaza sin efectos | Sobregiro | Sin mensaje de éxito + saldos iguales + sin movimiento + saldos con ≤ 2 decimales | ❌ **Rojo → BUG-01** |
| **TC-04** Saldo exacto | Se acepta y la cuenta queda en 0.00 | Límite mal programado (`>` vs `>=`) | Saldo origen = 0 exacto + delta correcto + 1 movimiento | ✅ Verde |
| **TC-05** Doble submit simultáneo | Una sola transferencia | Cobro duplicado | Cantidad de movimientos con la nota + delta de saldos + POSTs registrados como evidencia | ❌ **Rojo → BUG-02** |

Los resultados "previstos" salen de la exploración manual del 17/10/2026. **Los rojos son intencionales**: el desafío pide no cambiar el resultado esperado para conseguir un verde. Cada test rojo tiene una anotación con el ID del bug, visible en el reporte HTML.

### Decisión de diseño principal

**Saldos relativos + nota única.** Ninguna prueba compara contra un saldo fijo ("6,500.00"). Cada una saca una "foto" de los saldos por API al empezar, hace la acción por la UI y compara la diferencia **en centavos enteros** (para evitar errores de punto flotante como `0.1 + 0.2 = 0.30000000000000004`). Cada operación lleva una nota única (`QA-TC01-<id>`) para encontrar *ese* movimiento y no uno parecido de otra ejecución. Así la suite funciona con cualquier sandbox y en cualquier orden.

Otras decisiones (detalle en [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)):

- **Doble oráculo UI + API:** el mensaje "OK transfer" es el chequeo más débil; los saldos y el movimiento se verifican contra la API.
- **`expect.soft`** en las verificaciones de negocio: si falla el débito, igual se evalúan el crédito, el total y el movimiento, y el reporte muestra todo.
- **En TC-01 no se verifica `direction`**, porque está roto para todas las transferencias (BUG-09). Si se verificara, un bug de Movimientos taparía el resultado real de la transferencia. Lo cubre MV-03.
- **Un solo worker:** todas las pruebas comparten las mismas dos cuentas; en paralelo se pisarían los saldos.
- **Limpieza automática:** el fixture `api` devuelve CHECKING a su saldo inicial al terminar cada test, aunque el test haya fallado.

## 6. Preparación de datos

| Qué | Cómo |
|-----|------|
| Sesión | El fixture `api` hace login por `POST /api/auth/login` en el mismo contexto del navegador → la página queda logueada sin pasar por el formulario (excepto en los tests de Login, que prueban el formulario). |
| Cuentas | Se leen de `/api/dashboard` **por tipo** (`CHECKING` / `SAVINGS`), nunca por posición: el orden del array cambia entre llamadas. |
| Saldos | "Foto" antes y después en cada test. |
| Pagos | Cada test de Pagos crea su propio pago por API con beneficiario único. |
| Perfil | Se guarda el original en `beforeEach` y se restaura en `afterEach`. |
| Limpieza | Saldos restaurados por el fixture. Quedan en el historial los movimientos `QA-...` y `QA-teardown restore`, y los pagos de prueba (la app no permite borrarlos). Desaparecen al vencer el sandbox. |

## 7. Evidencia y reporte

Al terminar, `npm run report` abre el reporte HTML. Para cada test fallido hay:

- **Captura** de pantalla del momento del fallo.
- **Video** de la ejecución.
- **Trace**: grabación paso a paso con DOM, red y consola (`Ver trace` en el reporte).
- **Adjuntos JSON** (`evidencia-TC03`, etc.) con saldos antes/después y respuestas de la API.
- **Anotación** con el ID del bug esperado.

> 📸 _Captura del reporte:_ agregar acá `docs/reporte.png` después de la primera ejecución. Antes de subirla, revisá que no se vea el email del sandbox (aparece en el saludo del dashboard si la captura incluye el encabezado).

## 8. Estructura del proyecto

```
buggybank-playwright/
├── playwright.config.ts        Configuración: 1 worker, sin reintentos, evidencia al fallar
├── .env.example                Plantilla de credenciales (sin valores)
├── src/
│   ├── config/env.ts           Lee y valida variables de entorno
│   ├── api/
│   │   ├── types.ts            Forma de los datos de la API
│   │   └── BuggyBankApi.ts     Cliente de la API (login, saldos, transferencias, pagos, perfil)
│   ├── fixtures/test.ts        Fixtures: api logueada, cuentas, page objects, evidencia
│   ├── assertions/bank.ts      Aserciones de negocio (delta de saldos, "no pasó nada")
│   ├── pages/                  Page Objects, uno por pantalla
│   └── utils/                  Dinero en centavos, datos únicos, fechas
├── tests/
│   ├── core/                   ⭐ La entrega: 5 pruebas de Transferencias
│   ├── extended/               Transferencias extra, Dashboard, Movimientos, Pagos, Perfil, Login
│   └── api/                    Reglas y contrato de la API
└── docs/
    ├── TEST_PLAN.md            Casos, riesgos y decisiones
    ├── BUGS.md                 23 hallazgos con esperado / obtenido / test que lo detecta
    └── GUIA.md                 Cómo leer el código, en orden
```

## 9. Uso de IA

Trabajé con Claude (Anthropic) como asistente. Detalle de qué hizo cada parte:

| Etapa | Qué generó la IA | Qué revisé / decidí yo |
|---|---|---|
| Exploración | Recorrió la app en un navegador con mi sesión iniciada, registró endpoints, `data-testid` y respuestas de la API, y ejecutó las operaciones exploratorias que autoricé. | Autoricé cada tipo de operación. Repasé los hallazgos en la app. |
| Diseño | Propuso el plan de casos, los riesgos y las decisiones (saldos relativos, nota única, doble oráculo). | Elegí el flujo, el framework y el nivel de cobertura. Cambié el segundo borde del núcleo a doble submit. |
| Código | Escribió la suite completa con comentarios explicativos. | _Completar después de revisar:_ qué entendí, qué cambié, qué test ajusté tras la primera ejecución. |
| Correcciones de la IA | Detectó que el orden de las cuentas en la API no es estable y que un doble clic "humano" no reproduce el bug de doble submit; ajustó los tests en consecuencia. | _Completar:_ correcciones propias. |

> La IA no inició sesión con mis credenciales: yo inicié sesión en el navegador y ella trabajó sobre esa sesión. El código lee las credenciales solo desde mi `.env` local.

## 10. Pendiente

- **Ejecutar la suite completa** contra un sandbox nuevo y ajustar los selectores que fallen por motivos técnicos (no por bugs). La suite se escribió a partir de la exploración y pasa `typecheck` y `--list`, pero esta primera versión todavía no se corrió de punta a punta.
- **BUG-10** (mensaje de éxito viejo junto al error) no tiene test.
- **PG-02 (pago mayor al saldo) y PG-09 (efecto financiero del pago)** quedan como preguntas: no está claro si es un bug o una regla del sandbox.
- Agregar la captura del reporte (sección 7).
- Posible mejora: correr la suite en GitHub Actions con las credenciales como *secrets*.

## 11. Para conversar en la Charla

- **Bug:** el doble submit (TC-05). Con un doble clic "humano" la app lo filtra; con dos clics en el mismo instante crea dos transferencias, y el servidor responde `duplicated: false` en las dos. Un campo `duplicated` sugiere que la protección existe pero no funciona.
- **Decisión:** no verificar `direction` en TC-01 para que un bug ajeno no tape el resultado de la transferencia.
- **Pregunta:** ¿PG-09 es un bug? Un pago completado no mueve el saldo. ¿Es una simplificación del sandbox o un error?
