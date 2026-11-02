# Las 5 pruebas de la entrega (`@core`), explicadas paso a paso

Esta guía explica qué hace cada prueba de `tests/core/transfers.core.spec.ts`, por qué existe y cómo leer su resultado. No hace falta saber programar para seguirla; el código está al lado para quien lo quiera mirar.

Para ejecutarlas: `npm run test:core` (con un sandbox nuevo y el `.env` configurado). Para ver el informe: `npm run report`.

---

## Antes de empezar: vocabulario

| Término | Qué significa aquí |
|---|---|
| **BuggyBank** | Banco de práctica con errores sembrados a propósito. No mueve dinero real. |
| **Sandbox** | Usuario temporal que crea la app. Tiene dos cuentas, **CHECKING** y **SAVINGS**, con saldos de práctica. Caduca a las 24 horas. |
| **Saldo** | Cuánto dinero tiene cada cuenta. Las pruebas miran los saldos antes y después de cada acción. |
| **UI** | La pantalla, lo que ve y toca una persona. |
| **API** | Lo que hay detrás de la pantalla: el servidor que guarda los saldos y los movimientos. Es la fuente de verdad. |
| **Movimiento** | Una línea del historial: una transferencia registrada. |
| **Nota única** | Un texto distinto en cada prueba (por ejemplo `QA-TC01-…`) que se escribe en la transferencia. Sirve para encontrar exactamente ese movimiento y no confundirlo con otro. |
| **Céntimos** | Las comparaciones de dinero se hacen en céntimos enteros (`13.37` → `1337`). Así no aparecen errores de redondeo que no sean de la app. |
| **Oráculo** | La regla que decide si algo está bien. Por ejemplo: "CHECKING debe bajar 13,37". |
| **Teardown** | Lo que hace la prueba al terminar para dejar el sandbox como estaba. |

---

## Cómo se lee cada prueba

Todas siguen el mismo esquema:

1. **Arrange (preparar):** se anota el saldo "antes" y se crea la nota única.
2. **Act (actuar):** se hace la acción por la pantalla, como un usuario.
3. **Assert (comprobar):** se mira lo que ve el usuario **y** lo que guarda la API.

Una comprobación que falla aparece en el informe con el texto que la explica (por ejemplo, *"CHECKING no debía cambiar"*). Algunas comprobaciones son "blandas" (`expect.soft`): si una falla, la prueba sigue y se ven todas a la vez.

**Un test en rojo no es necesariamente un test roto.** Estas pruebas tienen que fallar cuando la app está mal. Si una prueba está en rojo, primero se mira si el fallo es de la app (un bug, documentado en `docs/BUGS.md`) o de la prueba (un error nuestro). Nunca se cambia lo que la prueba espera para que pase.

---

## TC-01 · Transferencia válida

**Qué hace:** transfiere **13,37** de CHECKING a SAVINGS.

**Por qué existe:** es la prueba de referencia. Si esto falla, algo fundamental va mal (dinero que se pierde o aparece de la nada).

**Paso a paso:**
1. Mira el saldo de CHECKING. Si tiene menos de 13,37, la prueba se detiene con un mensaje de precondición (no es un bug, es falta de dinero en el sandbox).
2. Abre *Transferencias*, elige origen y destino, escribe 13,37 y la nota única, y pulsa **Transferir**.
3. Espera la respuesta de la API.

**Qué comprueba:**
- La API responde `200` y la pantalla muestra **"OK transfer"**.
- CHECKING baja exactamente 13,37 y SAVINGS sube exactamente 13,37.
- El total del banco no cambia (no se crea ni se destruye dinero).
- Hay **un único** movimiento con esa nota, por 13,37, estado `COMPLETED`, y con las cuentas correctas.
- El selector de origen de la pantalla muestra el saldo nuevo.
- El historial muestra la fila con la nota y `$13.37`.

**Resultado esperado:** **verde**.

**Lo que no comprueba a propósito:** el sentido del movimiento (`direction`). Está roto en todas las transferencias (BUG-09). Si la prueba lo exigiera, un fallo de la pantalla de Movimientos taparía el resultado real de la transferencia. Eso lo cubre MV-03, en la suite extendida.

---

## TC-02 · Monto negativo

**Qué hace:** escribe **-50** y pulsa **Transferir**.

**Por qué existe:** una transferencia en negativo sería una transferencia "al revés": el dinero iría de SAVINGS a CHECKING sin que el usuario lo quisiera.

**Paso a paso:**
1. Anota los saldos y empieza a escuchar las peticiones de red.
2. Escribe -50 y pulsa **Transferir**.

**Qué comprueba:**
- La pantalla muestra el aviso **"Ingresa un monto mayor a 0"**.
- Los saldos no cambian y no hay ningún movimiento con la nota.
- **El navegador no envía ninguna petición** al servidor. Así sabemos que es la pantalla la que bloquea, no el servidor.

**Resultado esperado:** **verde**.

**Lo que no comprueba:** que el servidor también lo rechace. La pantalla lo bloquea, pero si alguien envía la petición directamente, la API acepta -50 (BUG-04). Eso lo prueba `AP-01a` en `tests/api`.

---

## TC-03 · Fondos insuficientes

**Qué hace:** transfiere **un céntimo más** que el saldo de CHECKING.

**Por qué existe:** es el caso de sobregiro. Una cuenta no debería poder quedar en negativo por una transferencia.

**Paso a paso:**
1. Lee el saldo de CHECKING y calcula saldo + 0,01. El monto se calcula al momento, así sirve para cualquier sandbox.
2. Escribe ese monto y pulsa **Transferir**.

**Qué comprueba:**
- No aparece el mensaje "OK transfer".
- Los saldos no cambian y no hay ningún movimiento con la nota.
- Ningún saldo tiene más de dos decimales (atrapa BUG-08).

**Resultado esperado:** **rojo, por BUG-01.** La app acepta la transferencia, deja CHECKING en **-0,01** y registra el movimiento. En nuestras ejecuciones del 28/10 la prueba falló justo en "CHECKING no debía cambiar" y en "No debía registrarse ningún movimiento".

**Cómo se ve en el informe:** la anotación de la prueba dice *"BUG-01: la app acepta transferencias mayores al saldo"*.

---

## TC-04 · Saldo exacto

**Qué hace:** transfiere **todo** el saldo de CHECKING (en nuestro sandbox, **6.500**).

**Por qué existe:** es el valor límite de la regla "fondos suficientes". Un error típico es escribir `si monto >= saldo, rechazar` en lugar de `si monto > saldo`. TC-03 prueba un céntimo por encima del saldo; TC-04 prueba el saldo exacto.

**Paso a paso:**
1. Comprueba que CHECKING tiene saldo positivo.
2. Escribe el saldo completo y pulsa **Transferir**.

**Qué comprueba:**
- La API responde `200` y la pantalla muestra "OK transfer".
- CHECKING queda en **exactamente 0,00**.
- CHECKING baja el saldo entero y SAVINGS sube lo mismo.
- El total no cambia.
- Hay **un único** movimiento con la nota.

**Resultado esperado:** **rojo, por BUG-24.** La app aplica la transferencia **dos veces** cuando el importe es entero y de 500 o más. En nuestras ejecuciones, CHECKING acabó en **-6.500** (en vez de 0) y SAVINGS subió 13.000 (en vez de 6.500), y la prueba falló en "CHECKING debía quedar exactamente en 0.00".

**Por qué BUG-24 y no el saldo exacto:** en la exploración manual vimos que el disparador no es el saldo exacto. Cualquier importe entero de 500 o más se duplica (499 no, 500 sí), y los decimales no. TC-04 simplemente tenía un importe así.

**Cuidado con el teardown:** al terminar, la prueba devuelve el dinero a CHECKING. Si la diferencia es un importe entero de 500 o más, esa devolución se duplicaría. Por eso la limpieza parte esos importes en dos (importe − 0,01, y después 0,01). Si aun así la limpieza no deja el saldo como estaba, sale un aviso en el informe, y hay que crear un sandbox nuevo antes de seguir.

---

## TC-05 · Doble envío simultáneo

**Qué hace:** pulsa **Transferir** dos veces **en el mismo instante** (dentro del navegador, sin esperas entre un clic y otro) para transferir **2,22**.

**Por qué existe:** es el riesgo de cobrar dos veces. Pasa con un doble toque en el móvil, un reintento automático o un script. Una sola intención del usuario debe dar un único movimiento.

**Por qué no usa un doble clic normal:** Playwright espera unos milisegundos entre clics, como una persona. En la exploración, ese doble clic "humano" sí lo filtró la app. Por eso la prueba simula el envío simultáneo, y `AP-04` y `TR-16` cubren las otras variantes.

**Paso a paso:**
1. Empieza a contar las peticiones `POST /api/transfers` que salen y sus respuestas.
2. Escribe 2,22 y la nota, y dispara los dos envíos a la vez.
3. **Espera explícita:** no usa una pausa fija. Espera hasta que cada petición enviada tiene su respuesta (máximo 15 segundos). Antes había una espera fija de 2 segundos, y la traza demostró que era frágil: una respuesta tardaba 1,8 s y otra 4,4 s.

**Qué comprueba:**
- Hay un único movimiento con la nota.
- CHECKING baja 2,22 y SAVINGS sube 2,22, una sola vez.

**Resultado esperado:** **rojo, por BUG-02.** Las dos peticiones llegan al servidor y ambas se aplican: aparecen dos movimientos de 2,22 y CHECKING baja 4,44. En nuestras ejecuciones, la prueba falló en "Una intención = un movimiento" y en "CHECKING debía variar -2.22".

---

## Cómo leer el informe

Tras `npm run test:core`, `npm run report` abre el informe HTML. Para cada prueba:

- **Estado:** verde o rojo. El rojo lleva la anotación con el bug (`BUG-01`, `BUG-02`, `BUG-24`).
- **Errores:** el texto de cada comprobación que falló, con el valor esperado y el recibido.
- **Captura, vídeo y traza:** la traza muestra paso a paso lo que hizo la prueba, incluidas las peticiones y respuestas de la API.
- **Adjuntos:** el saldo antes y después, la nota y las respuestas de la API, en formato JSON.
- **Aviso de limpieza:** si aparece, el sandbox ha quedado descuadrado. Hay que crear uno nuevo antes de volver a ejecutar.

## Qué esperar de una ejecución completa

| Prueba | Resultado esperado | Bug |
|---|---|---|
| TC-01 | Verde | — |
| TC-02 | Verde | — (la API sí acepta -50: BUG-04, en `tests/api`) |
| TC-03 | Rojo | BUG-01 |
| TC-04 | Rojo | BUG-24 |
| TC-05 | Rojo | BUG-02 |

Si una prueba sale distinta de esta tabla, no se cambia lo que espera. Primero se mira el informe para ver si el fallo es nuevo y de qué tipo.
