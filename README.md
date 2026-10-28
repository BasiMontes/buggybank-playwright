# BuggyBank · Suite de pruebas con Playwright

Mi entrega del **Desafío BuggyBank** de Free Range Testers: pruebas automatizadas contra [BuggyBank](https://buggybank-seven.vercel.app/login), un banco de práctica con bugs sembrados a propósito.

| | |
|---|---|
| **Flujo elegido** | Transferencias: 5 pruebas `@core` |
| **Herramienta** | Playwright + TypeScript |
| **Resultado** | 2 en verde y 3 en rojo, los tres por bugs reales de la app |
| **Hallazgo propio** | BUG-24: transferir el saldo exacto mueve el doble de dinero |
| **Bugs documentados** | 24, en [`docs/BUGS.md`](docs/BUGS.md) |
| **Plan de pruebas** | [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) |

---

## Resultado de la entrega

Ejecución del 28/10/2026 con sandboxes nuevos (`npm run test:core`):

| ID | Qué debería pasar | Riesgo que cubre | Resultado |
|----|-------------------|------------------|-----------|
| **TC-01** Transferencia válida (13.37) | Se debita el origen, se acredita el destino y queda un movimiento | Dinero que se pierde o se crea | ✅ Verde |
| **TC-02** Importe negativo (-50) | Se rechaza sin efectos | Transferencia "al revés" | ✅ Verde: la interfaz lo bloquea (la API no, ver BUG-04) |
| **TC-03** Fondos insuficientes (saldo + 0.01) | Se rechaza sin efectos | Descubierto | ❌ **Rojo → BUG-01** |
| **TC-04** Saldo exacto | Se acepta y la cuenta queda en 0.00 | Límite mal programado (`>` frente a `>=`) | ❌ **Rojo → BUG-24** |
| **TC-05** Doble envío simultáneo | Una sola transferencia | Cobro duplicado | ❌ **Rojo → BUG-02** |

**Los rojos son intencionados.** El desafío pide no cambiar el resultado esperado para conseguir un verde: las cinco pruebas comprueban lo correcto y la que falla es la app. Cada rojo lleva una anotación con su bug, visible en el informe HTML.

### El hallazgo: BUG-24

TC-04 tenía que salir en verde: en la exploración del 17/10 transferir el saldo exacto funcionaba. Al ejecutarla, salió en rojo, y la traza de Playwright mostró por qué:

1. Saldo antes: CHECKING 6,500 y SAVINGS 3,500.
2. Sale **una sola petición** `POST /api/transfers` con `amount: 6500`, y el servidor responde `{"message":"OK transfer","duplicated":true}`.
3. Saldo después: CHECKING **-6,500** y SAVINGS 16,500. Se ha movido **el doble**.
4. En el historial hay **un solo movimiento** de 6,500. El saldo y el historial no cuadran.

Se ha reproducido 3 de 3 veces, con dos importes distintos (6,500 y 19,500).

> **Disparador:** _[completar con la exploración manual: qué importes mueven el doble]_

## Cómo están diseñadas las pruebas

**Saldos relativos y nota única.** Ninguna prueba compara contra un saldo fijo. Cada una toma una "foto" de los saldos por API al empezar, hace la acción por la interfaz y compara la diferencia **en céntimos enteros**, para evitar errores de coma flotante como `0.1 + 0.2 = 0.30000000000000004`. Cada operación lleva una nota única (`QA-TC01-<id>`) para encontrar exactamente ese movimiento. Así la suite funciona con cualquier sandbox y en cualquier orden.

Otras decisiones:

- **Doble comprobación, interfaz y API.** El mensaje "OK transfer" es la comprobación más débil; los saldos y el movimiento se verifican contra la API.
- **`expect.soft`** en las comprobaciones de negocio: si falla el débito, se siguen evaluando el crédito, el total y el movimiento, y el informe lo muestra todo.
- **TC-01 no comprueba `direction`**, porque está roto en todas las transferencias (BUG-09). Si lo comprobara, un bug de Movimientos taparía el resultado real de la transferencia.
- **Un solo worker:** todas las pruebas usan las mismas dos cuentas; en paralelo se pisarían los saldos.
- **Limpieza que se comprueba:** al terminar, cada prueba devuelve CHECKING a su saldo inicial y **verifica** que lo ha conseguido. Si no, el informe muestra un aviso para crear un sandbox nuevo.
- **Esperas explícitas:** ninguna prueba usa esperas fijas (`waitForTimeout`).

## Requisitos e instalación

- **Node.js 18 o superior** (`node --version`).
- Un **sandbox de BuggyBank** activo (dura 24 horas).

```bash
git clone https://github.com/BasiMontes/buggybank-playwright.git
cd buggybank-playwright
npm install
npm run install:browsers
```

## Preparar el sandbox (cada 24 horas)

1. Entra en <https://buggybank-seven.vercel.app/login>.
2. Escribe el **código del curso** y pulsa **Crear usuario temporal**.
3. Crea el archivo de credenciales y rellena el email y la contraseña que te da la app:

   ```bash
   cp .env.example .env
   ```

> ⚠️ El `.env` está en `.gitignore` y **nunca se sube**. Cuando el sandbox caduque, crea otro y actualiza esos dos valores.

## Ejecutar

| Comando | Qué ejecuta |
|---|---|
| `npm run test:core` | **La entrega:** las 5 pruebas de Transferencias |
| `npm run test:headed` | Las mismas, con el navegador visible |
| `npm run report` | Abre el informe HTML de la última ejecución |
| `npm run typecheck` | Comprueba los tipos sin ejecutar nada |

Una prueba concreta: `npx playwright test -g "TC-04"`.

## Evidencia

`npm run report` abre el informe HTML. Para cada prueba fallida hay **captura**, **vídeo**, **traza** (DOM, red y consola paso a paso), **adjuntos JSON** con los saldos antes y después y las respuestas de la API, y una **anotación** con el bug.

> 📸 _[Añadir aquí `docs/reporte.png`, revisando que no se vea el email del sandbox]_

## Uso de IA

He trabajado con Claude (Anthropic). Esto es lo que hizo cada parte:

| Etapa | Qué hizo la IA | Qué hice yo |
|---|---|---|
| **Exploración (17/10)** | Recorrió la app en un navegador con mi sesión iniciada, registró endpoints, `data-testid` y respuestas de la API, y ejecutó las operaciones que le autoricé. | Inicié sesión yo (la IA nunca escribió mi contraseña) y autoricé cada tipo de operación. |
| **Diseño** | Propuso el plan de casos, los riesgos y las decisiones principales (saldos relativos, nota única, doble comprobación). | Elegí el flujo y la herramienta, y cambié el segundo caso límite a doble envío. |
| **Código** | Escribió la suite completa, comentada. | La ejecuté por primera vez el 28/10 y revisé cada fallo en las trazas. |
| **Revisión (28/10)** | Me ayudó a leer las trazas y a proponer cambios. | Decidí qué cambiar y qué no (abajo). |

**Lo que cambié tras ejecutarla:**

- **TC-04 no se tocó para que saliera en verde.** El rojo era un bug nuevo de la app (BUG-24), así que le añadí la anotación y lo documenté.
- **La limpieza no comprobaba nada.** En TC-04, la transferencia que devuelve el dinero también se duplicó y dejó el sandbox descuadrado sin avisar. Ahora la limpieza verifica el saldo y, si no cuadra, lo dice en el informe.
- **TC-05 tenía una espera fija de 2 segundos.** La traza mostró que las dos peticiones salen a la vez, pero responden a los 1,8 s y a los 4,4 s: la espera acertaba por poco. La cambié por una espera explícita hasta que todas las peticiones tienen respuesta.
- **Los comentarios estaban en español de Argentina.** Los pasé a mi español.

**Lo que descarté:** el informe de Playwright tiene un botón "Copy prompt" que pide a una IA "un fragmento de código con la solución" de un test fallido. En TC-04, esa "solución" habría sido cambiar lo esperado para que la prueba pasara y esconder el bug. Cuando una prueba falla, primero decido si el fallo es del test o del producto.

## Pendiente

- **Encontrar el disparador de BUG-24** con una exploración manual.
- **La suite extendida (`tests/extended`, `tests/api`, 61 pruebas) no está revisada.** La generó la IA en la exploración y aún no la he ejecutado ni repasado; la entrega son solo las 5 pruebas `@core`.
- Ejecutar la suite en GitHub Actions con las credenciales como *secrets* (hoy no es práctico: el sandbox caduca cada 24 horas).

## Para comentar en la charla

- **Bug:** BUG-24. Una sola petición, el doble de dinero movido y un solo movimiento en el historial.
- **Decisión:** las esperas explícitas. La traza demostró que la espera fija de TC-05 era frágil.
- **Pregunta:** en la traza, la cookie de sesión se llama `bb_user` y su valor parece ser el identificador del usuario. Si el servidor no comprueba nada más, ¿se podría suplantar a otro usuario? No lo he probado para no afectar a los sandboxes de otras personas.
