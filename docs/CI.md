# Integración continua con GitHub Actions

La suite se ejecuta sola en GitHub Actions: con cada cambio en `main`, en cada pull request, **todos los días** y a mano desde la pestaña **Actions**. La idea es la que propuso el profe: volver a correrla cuando los defectos se vayan resolviendo, y enterarse si aparecen otros.

Archivos que intervienen:

| Archivo | Qué hace |
|---|---|
| [`.github/workflows/pruebas.yml`](../.github/workflows/pruebas.yml) | El workflow: 3 jobs en paralelo que ejecutan un tercio de la suite cada uno, y un job final que fusiona, compara y sube el informe |
| [`src/config/globalSetup.ts`](../src/config/globalSetup.ts) | Crea un sandbox nuevo de BuggyBank al empezar cada job |
| [`ci/expected-results.json`](../ci/expected-results.json) | La lista de rojos conocidos: qué prueba falla y por qué bug |
| [`scripts/ci-summary.mjs`](../scripts/ci-summary.mjs) | Compara los resultados con esa lista y decide si el pipeline pasa |

---

## Problema 1: el sandbox caduca cada 24 horas

Guardar el email y la contraseña del sandbox como secretos no sirve: al día siguiente ya no funcionan.

**Solución:** el workflow guarda solo el **código del curso** (secreto `BB_COURSE_CODE`) y, antes de ejecutar las pruebas, `globalSetup.ts` crea un sandbox nuevo, igual que el botón "Crear usuario temporal":

```
POST /api/sandbox/users
x-bb-access-code: <código del curso>
→ { email, password }
```

El endpoint se sacó del código público de la página de login: es lo que hace el botón.

Ventajas que salen gratis:

- **Cada ejecución arranca con datos limpios.** Ya no hace falta crear un sandbox a mano antes de la suite extendida (la advertencia sobre BUG-24 y los saldos descuadrados no aplica en CI).
- **Las ejecuciones no se pisan**: dos ejecuciones a la vez usan sandboxes distintos. Esto es también lo que permite partir la suite en jobs paralelos (abajo).
- **El email y la contraseña se ocultan en los logs** (`::add-mask::`): aparecen como `***`.
- **Reintentos ante fallos de BuggyBank.** El 16/11/2026, la primera ejecución con 3 jobs recibió HTTP 500 ("No se pudo crear el usuario temporal") en las tres partes, y no se ejecutó ninguna prueba. Ahora, ante un 5xx o un error de red, se reintenta hasta 3 veces (tras unos 10, 30 y 60 s, con un margen aleatorio para que los jobs no coincidan). Un 4xx, como un código del curso incorrecto, no se reintenta.

En local no cambia nada: si el `.env` tiene `BB_EMAIL` y `BB_PASSWORD`, se usan. Si los dejas vacíos y completas `BB_COURSE_CODE`, cada ejecución local también crea su propio sandbox.

## Problema 2: la suite siempre tiene rojos

BuggyBank tiene bugs a propósito, así que hoy hay 26 pruebas en rojo (más PG-06, que es intermitente). Había tres opciones:

| Opción | Problema |
|---|---|
| El pipeline falla con cualquier rojo | Estaría rojo todos los días. Nadie notaría cuándo pasa algo nuevo. |
| Marcar los bugs conocidos con `test.fail()` para que salgan verdes | Es cambiar el resultado esperado para conseguir un verde: justo lo que pide no hacer el desafío. Y esconde los bugs en el informe. |
| **Comparar con una lista de rojos conocidos** ✅ | Las pruebas no se tocan y siguen en rojo en el informe. El pipeline solo avisa cuando **cambia** algo. |

Cómo decide `ci-summary.mjs`:

| Resultado | ¿Está en `expected-results.json`? | Qué significa | Pipeline |
|---|---|---|---|
| Rojo | Sí (`bug` o `question`) | El bug conocido sigue ahí | ✅ |
| **Verde** | Sí (`bug` o `question`) | **¿Lo corrigieron?** Hay que verificarlo | ❌ |
| **Rojo** | No | **Fallo nuevo**: un bug nuevo o una prueba rota | ❌ |
| Rojo o verde | Sí (`flaky`) | Intermitente: ambos resultados son esperables | ✅ |
| Verde | No | Todo bien | ✅ |

Así que un **pipeline verde no significa que la app no tenga bugs**. Significa "nada cambió respecto a lo que ya sabemos". El distintivo del README hay que leerlo así.

Para ver el estado "crudo" (rojo con cualquier fallo), ejecuta el workflow a mano con la opción **Modo estricto**.

## Problema 3: 14 minutos es mucho esperar

Con un solo job, la suite tardaba unos 14 minutos. No se podía subir el número de workers: las pruebas comparten las dos cuentas del sandbox y en paralelo se pisarían los saldos.

**Solución:** paralelizar **entre sandboxes**, no dentro de uno. El workflow lanza 3 jobs a la vez y cada uno crea su propio sandbox y ejecuta un tercio de la suite con `--shard=N/3`:

```
┌ Pruebas (parte 1 de 3) ┐
├ Pruebas (parte 2 de 3) ┼──▶ Resumen: fusiona los informes, compara con los
└ Pruebas (parte 3 de 3) ┘    rojos conocidos y sube un único informe HTML
```

- **`fullyParallel: true` en `playwright.config.ts`** hace que `--shard` reparta prueba por prueba (24 + 23 + 23) y no archivo por archivo. No ejecuta nada en paralelo dentro de un job: sigue habiendo 1 worker. Es seguro porque ninguna prueba usa `beforeAll` ni depende de otra; la única variable compartida (`original`, en Perfil) se vuelve a leer en el `beforeEach` de cada prueba.
- **Cada parte deja un reporte "blob"** y el job Resumen los fusiona con `npx playwright merge-reports`. El informe HTML y el resumen son uno solo, como antes.
- **Red de seguridad:** el Resumen compara contra la lista completa de pruebas (`--list`). Si una parte se cae antes de dejar su reporte, sus pruebas aparecen como "No se ejecutaron" y el pipeline falla, en lugar de salir verde con 47 pruebas.

Con los tiempos de la primera ejecución, las partes quedan en unos 3,7, 3,9 y 5,5 minutos de pruebas. La tercera es la más larga porque le tocan TR-17 y el resto de Transferencias extendidas. Sumando la instalación y el Resumen, el total baja de unos 16 a unos 8 minutos.

## Qué hacer cuando el pipeline se pone rojo

Abre la ejecución en la pestaña **Actions**. El resumen dice qué cambió y el artefacto **playwright-report** tiene el informe completo (descárgalo, descomprímelo y abre `index.html`).

**🎉 "Bugs conocidos que ahora pasan"**
1. Comprueba el bug a mano en BuggyBank. Un verde aislado puede ser casualidad.
2. Si está corregido: borra su entrada de `ci/expected-results.json` y marca el bug como corregido en `docs/BUGS.md`.
3. Si era una `question` (PG-02, PG-09), el cambio también responde la pregunta: anótalo.

**🚨 "Fallos nuevos"**
1. Mira **dónde** falla, como en [`EXTENDED_RESULTS.md`](EXTENDED_RESULTS.md):
   - en una **aserción** (`Expected… Received…`) → probablemente es la app: un bug nuevo;
   - en una **acción** (`locator.click: Timeout`, elemento no encontrado) → probablemente cambió la pantalla y hay que arreglar la prueba.
2. Si es un bug nuevo: documéntalo en `docs/BUGS.md`, añade la anotación `issue` a la prueba y añádelo a `ci/expected-results.json`.
3. Si es la prueba: arréglala. **No** la añadas a la lista para silenciarla.

**❌ "No se pudieron ejecutar las pruebas"**
Casi siempre es el sandbox: falta el secreto `BB_COURSE_CODE`, el código cambió, o BuggyBank no respondía. El mensaje lo dice.

## Configuración (una sola vez)

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
2. Nombre: `BB_COURSE_CODE`. Valor: el código del curso.
3. Pestaña **Actions → Pruebas BuggyBank → Run workflow** para la primera ejecución.

> Los pull requests que vengan de un **fork** no reciben secretos (GitHub lo hace así por seguridad), así que en ellos el workflow falla al crear el sandbox. Es esperable.

## Seguridad: qué queda expuesto y qué no

- **El código del curso** solo vive en el secreto. No aparece en los logs ni en el informe: el sandbox se crea desde Node y no desde el navegador, así que tampoco queda en las trazas.
- **El email y la contraseña del sandbox de esa ejecución** sí quedan dentro de las trazas del informe (la petición de login). El repo es público, así que cualquiera con cuenta de GitHub puede descargar el artefacto. Es un sandbox desechable que caduca en 24 horas y solo tiene datos de práctica. Aun así, el artefacto se borra a los 7 días.
- El workflow tiene permisos de **solo lectura** sobre el repo.

## Cuánto cuesta

Unos 8 minutos de espera por ejecución, que consumen unos 20 minutos de máquina en total (3 jobs a la vez más el Resumen). Un repo público tiene minutos de GitHub Actions gratis e ilimitados en los runners estándar.

Cada ejecución crea **3 sandboxes** en BuggyBank, uno por parte. Con la ejecución diaria son 3 al día, más 3 por cada push o PR. Si al profe le parece mucho, hay dos palancas: cambiar el `cron` (por ejemplo, a semanal: `'17 6 * * 1'`) o bajar las partes a 2 (en `matrix.parte` del workflow).
