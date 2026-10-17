# Guía para entender la suite

Esta guía recorre el proyecto **en el orden en que conviene leerlo**. Cada archivo tiene comentarios línea por línea; acá está el mapa general y los conceptos.

---

## Paso 1 · El flujo de una prueba, de punta a punta

Tomemos **TC-01** (`tests/core/transfers.core.spec.ts`). Esto es lo que pasa cuando corre:

```
npx playwright test -g "TC-01"
        │
        ▼
playwright.config.ts          → baseURL, 1 worker, evidencia si falla
        │
        ▼
src/fixtures/test.ts          → Playwright prepara los fixtures que pide el test:
   ├── page                     navegador limpio (sin cookies)
   ├── api                      login por API EN ESE MISMO navegador → la página queda logueada
   │                            guarda el saldo de CHECKING para la limpieza final
   ├── accounts                 { CHECKING, SAVINGS } leídas de /api/dashboard
   └── pages                    todos los Page Objects listos
        │
        ▼
El test (Arrange / Act / Assert)
   ARRANGE  api.snapshotBalances()           foto de saldos en centavos
            uniqueNote('TC01')               "QA-TC01-lq3k9x-4821"
   ACT      pages.transfer.goto()
            pages.transfer.fillForm(...)      como un usuario
            pages.transfer.submitAndWaitForApi()
   ASSERT   mensaje "OK transfer"             ← oráculo débil
            expectBalanceDelta(...)           ← débito, crédito y total
            findTransactionsByNote(note)      ← movimiento registrado
            sourceOptionBalance(...)          ← la pantalla se actualizó
            historial en la UI                ← el usuario lo ve
        │
        ▼
Teardown del fixture `api`    → devuelve CHECKING a su saldo inicial
```

## Paso 2 · Conceptos que aparecen en todo el código

### Page Object (`src/pages/`)
Una clase por pantalla. Guarda **dónde** están las cosas (selectores) y ofrece **qué** se puede hacer (`fillForm`, `submit`). Si BuggyBank cambia un botón, se corrige en un solo lugar y los tests no se tocan.

### Selectores, en orden de preferencia
1. `getByTestId('transfer-amount')`: los `data-testid` los ponen los desarrolladores para automatizar. Son los más estables.
2. `getByRole('button', { name: 'Salir' })`: cómo lo encuentra una persona (o un lector de pantalla).
3. `locator('#fullName')`: un `id` estable cuando no hay nada mejor (pantalla de Perfil).
4. Texto parseado: solo en el Dashboard, que no tiene ninguno de los anteriores.

### Fixture (`src/fixtures/test.ts`)
Algo que Playwright prepara antes del test y limpia después. El test **lo pide por nombre** en sus parámetros: `async ({ api, accounts, pages }) => ...`. Si un test no pide `api`, no hay login (así funcionan los tests de Login y AP-03).

### Oráculo
La forma de decidir si el resultado es correcto. En esta suite hay oráculos de distinta fuerza:

| Oráculo | Fuerza | Por qué |
|---|---|---|
| Mensaje "OK transfer" | Débil | La app puede decir "OK" y no haber movido nada (o haber movido de más). |
| Saldos por API | Fuerte | Es el dato real. |
| Movimiento con la nota única | Fuerte | Prueba que quedó registrado **una** vez. |
| Total conservado | Fuerte | En transferencias propias el dinero no se crea ni se destruye. |

### Dinero en centavos (`src/utils/money.ts`)
`13.37` se guarda como `1337`. Con enteros no hay errores de redondeo, así que un `toBe` falla solo si la app está mal.

### `expect` vs `expect.soft`
- `expect`: si falla, el test **se corta** ahí. Lo usamos para precondiciones ("debe haber un movimiento") donde seguir no tiene sentido.
- `expect.soft`: si falla, lo **anota y sigue**. Lo usamos para los oráculos de negocio, para ver todas las fallas juntas.

### `expect.poll`
Reintenta una consulta hasta que cumple la condición o se agota el tiempo. Sirve cuando no hay un elemento en pantalla que avise que algo terminó (por ejemplo, esperar a que aparezca el movimiento en la API).

### Esperas: por qué casi no hay `waitForTimeout`
Un `sleep` fijo es lento si sobra y frágil si falta. Preferimos esperar **eventos concretos**: `waitForResponse` (llegó la respuesta de la API), `waitFor` (apareció el elemento), `expect.poll`. Hay cuatro `waitForTimeout(2000)` documentados: TC-05, TR-12, TR-16 y PG-06. En esos casos esperamos que **no** pase algo (un segundo request), y no hay evento que lo avise.

## Paso 3 · Por qué algunos tests están en rojo

BuggyBank tiene bugs a propósito. Un test en rojo **con el resultado esperado correcto** es un test que funciona: encontró el bug. Cada uno tiene:

- una anotación `issue` con el ID de `docs/BUGS.md` (se ve en el reporte HTML);
- un adjunto JSON con la evidencia (saldos, respuestas);
- captura, video y trace.

Si un test falla por un motivo **técnico** (un selector que no encuentra el elemento, un timeout de carga), eso **no** es un bug de la app: hay que corregir el test. La diferencia se ve en el mensaje de error: un bug falla en una **aserción** (`Expected: 0, Received: 1`), un problema técnico falla en una **acción** (`locator.click: Timeout`).

## Paso 4 · Orden de lectura recomendado

1. `src/utils/money.ts`: lo más simple, y explica una decisión clave.
2. `src/api/BuggyBankApi.ts`: qué le preguntamos a la app.
3. `src/fixtures/test.ts`: cómo se arma cada test.
4. `src/pages/TransferPage.ts`: un Page Object completo.
5. `src/assertions/bank.ts`: los oráculos.
6. `tests/core/transfers.core.spec.ts`: **la entrega**.
7. `tests/api/transfers.api.spec.ts`: la misma regla, probada por la "otra puerta".
8. El resto de `tests/extended/` en el orden que te interese.

## Paso 5 · Cómo agregar una prueba nueva

```ts
import { expect, test } from '../../src/fixtures/test';
import { expectBalanceDelta } from '../../src/assertions/bank';
import { uniqueNote } from '../../src/utils/testData';

test('TR-17 · mi caso nuevo', { tag: '@extended' }, async ({ api, accounts, pages }) => {
  const note = uniqueNote('TR17');           // 1. dato único
  const before = await api.snapshotBalances(); // 2. foto "antes"

  await pages.transfer.goto();                 // 3. acción por la UI
  await pages.transfer.fillForm({ from: accounts.SAVINGS, to: accounts.CHECKING, amount: '5.00', note });
  await pages.transfer.submitAndWaitForApi();

  const after = await api.snapshotBalances();  // 4. verificación contra la API
  expectBalanceDelta(before, after, { CHECKING: +500, SAVINGS: -500 });
});
```

No hace falta limpiar: el fixture `api` restaura los saldos.
