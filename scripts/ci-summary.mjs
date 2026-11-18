/**
 * ci-summary.mjs — Compara los resultados de Playwright con los resultados esperados.
 *
 * Uso:  node scripts/ci-summary.mjs <results-ci.json> <ci/expected-results.json> [list-ci.json]
 *       (list-ci.json, opcional: la lista completa de pruebas, para detectar las que no se ejecutaron)
 *
 * EL PROBLEMA:
 * BuggyBank tiene bugs a propósito, así que la suite SIEMPRE tiene pruebas en rojo.
 * Si el pipeline fallara por cualquier rojo, estaría rojo todos los días y nadie notaría
 * cuándo pasa algo nuevo. Y si cambiáramos los resultados esperados para conseguir un
 * verde, estaríamos escondiendo los bugs (el desafío pide no hacerlo).
 *
 * LA SOLUCIÓN:
 * Las pruebas NO se tocan: siguen en rojo en el informe. Este script clasifica cada
 * resultado contra la lista de rojos conocidos y decide el estado del pipeline:
 *
 *   resultado   ¿está en la lista?   significado                         pipeline
 *   ─────────   ──────────────────   ─────────────────────────────────   ────────
 *   rojo        sí (bug/pregunta)    bug conocido, sigue ahí             ok
 *   verde       sí (bug/pregunta)    ¿lo corrigieron? → verificar         FALLA
 *   rojo        no                   fallo NUEVO (bug nuevo o prueba rota) FALLA
 *   rojo/verde  sí (flaky)           intermitente, ambos esperables       ok
 *   verde       no                   todo bien                            ok
 *
 * Con ESTRICTO=true el pipeline falla ante cualquier rojo (útil para ver el estado "real").
 *
 * Escribe un resumen en Markdown en $GITHUB_STEP_SUMMARY (se ve en la página de la
 * ejecución en GitHub) y anotaciones ::error / ::notice. Sin dependencias: Node puro.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [resultsPath = 'results-ci.json', expectedPath = 'ci/expected-results.json', listPath] = process.argv.slice(2);
const strict = process.env.ESTRICTO === 'true';

/**
 * Si existe la variable RESUMEN_JSON, deja también los números de esta ejecución en ese
 * archivo. El job "Publicar informe" lo guarda en la rama `historial` del repo
 * (scripts/publicar-informes.mjs), así queda la evolución de la suite para siempre.
 */
function writeRunSummary(data) {
  if (process.env.RESUMEN_JSON) writeFileSync(process.env.RESUMEN_JSON, `${JSON.stringify(data, null, 2)}\n`);
}

/** Escribe en el resumen de GitHub (si existe) y en la consola. */
function summary(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

/** Escapa el texto para usarlo dentro de una anotación de GitHub (::error title=...::). */
function annotation(level, title, message) {
  const clean = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::${level} title=${clean(title).replace(/:/g, '%3A').replace(/,/g, '%2C')}::${clean(message)}`);
}

// ── 1. Leer los resultados ──────────────────────────────────────────────────────
if (!existsSync(resultsPath)) {
  // Si no hay archivo, Playwright no llegó a ejecutar pruebas (por ejemplo, falló la
  // creación del sandbox en el globalSetup). Eso siempre es un problema.
  summary('## ❌ No hay resultados de las pruebas');
  summary(`No se encontró \`${resultsPath}\`. Revisa el paso "Ejecutar pruebas": lo más probable es que falte el secreto \`BB_COURSE_CODE\` o que no se haya podido crear el sandbox.`);
  writeRunSummary({ estado: 'no-ejecutado', ejecutadas: 0, verdes: 0, rojosConocidos: 0, intermitentes: [], nuevos: [], corregidos: [], noEjecutadas: 0, errores: 1 });
  process.exit(1);
}

const report = JSON.parse(readFileSync(resultsPath, 'utf8'));
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const expectedByTitle = new Map(expected.tests.map((t) => [t.title, t]));

/**
 * Recorre el árbol del informe JSON de Playwright (suites → specs → tests → results)
 * y devuelve una lista plana { title, file, status }.
 * Con retries: 0 hay un solo resultado por prueba; tomamos el último por si acaso.
 */
function collect(suite, out = []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const last = test.results?.at(-1);
      const raw = last?.status ?? 'skipped';
      const status = raw === 'passed' ? 'passed' : raw === 'skipped' ? 'skipped' : 'failed'; // failed, timedOut, interrupted
      const firstLine = (last?.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').find((l) => l.trim()) ?? '';
      out.push({ title: spec.title, file: spec.file, status, error: firstLine.slice(0, 200) });
    }
  }
  for (const child of suite.suites ?? []) collect(child, out);
  return out;
}

const results = (report.suites ?? []).flatMap((s) => collect(s));
const errors = report.errors ?? []; // errores fuera de las pruebas (p. ej. en globalSetup)

/**
 * Pruebas que deberían haberse ejecutado y no aparecen en los resultados.
 * La suite se reparte en 3 jobs: si uno se cae antes de dejar su reporte (falla `npm ci`,
 * se cae la máquina...), el informe fusionado tendría menos pruebas y, sin este chequeo,
 * el pipeline podría salir verde sin haberlas ejecutado. `listPath` es la salida de
 * `npx playwright test --list --reporter=json` con el mismo filtro que la ejecución.
 */
const key = (r) => `${r.file} › ${r.title}`;
const missing = [];
if (listPath && existsSync(listPath)) {
  const ranKeys = new Set(results.map(key));
  const list = JSON.parse(readFileSync(listPath, 'utf8'));
  for (const t of (list.suites ?? []).flatMap((s) => collect(s))) {
    if (!ranKeys.has(key(t))) missing.push(t);
  }
}

// ── 2. Clasificar ────────────────────────────────────────────────────────────────
const groups = { newFailures: [], fixed: [], known: [], flaky: [], passed: [], skipped: [] };
for (const r of results) {
  const exp = expectedByTitle.get(r.title);
  if (r.status === 'skipped') groups.skipped.push(r);
  else if (exp?.kind === 'flaky') groups.flaky.push({ ...r, exp });
  else if (r.status === 'failed' && exp) groups.known.push({ ...r, exp });
  else if (r.status === 'failed') groups.newFailures.push(r);
  else if (exp) groups.fixed.push({ ...r, exp });
  else groups.passed.push(r);
}
const ran = new Set(results.map((r) => r.title));
const notRun = expected.tests.filter((t) => !ran.has(t.title));
const failedTotal = results.filter((r) => r.status === 'failed').length;

// ── 3. Decidir el estado del pipeline ─────────────────────────────────────────────
const alarms = groups.newFailures.length + groups.fixed.length + errors.length + missing.length;
const pipelineFails = alarms > 0 || (strict && failedTotal > 0) || results.length === 0;

// ── 4. Resumen ───────────────────────────────────────────────────────────────────
const headline = pipelineFails
  ? results.length === 0
    ? '## ❌ No se pudieron ejecutar las pruebas'
    : alarms > 0
    ? '## ⚠️ Hay cambios respecto a lo esperado'
    : '## ❌ Modo estricto: hay pruebas en rojo'
  : '## ✅ Sin cambios: los rojos son los bugs conocidos';
summary(headline);
summary('');
summary('| | Pruebas |');
summary('|---|---|');
summary(`| Ejecutadas | ${results.length} |`);
summary(`| ✅ Verdes | ${groups.passed.length} |`);
summary(`| 🐞 Rojas por bug conocido o pregunta abierta | ${groups.known.length} |`);
summary(`| 🔁 Intermitentes | ${groups.flaky.length} |`);
summary(`| 🚨 Fallos nuevos | ${groups.newFailures.length} |`);
summary(`| 🎉 Bugs conocidos que ahora pasan | ${groups.fixed.length} |`);
if (groups.skipped.length) summary(`| ⏭️ Omitidas | ${groups.skipped.length} |`);
if (missing.length) summary(`| ❓ No se ejecutaron | ${missing.length} |`);
summary('');

if (missing.length) {
  summary('### ❓ Pruebas que no se ejecutaron');
  summary('Deberían estar en el informe y no están. Lo más probable es que uno de los jobs paralelos se haya caído antes de terminar: revisa los jobs "Pruebas (parte N de 3)".');
  summary('');
  for (const t of missing) summary(`- ${t.title} (\`${t.file}\`)`);
  annotation('error', 'Pruebas sin ejecutar', `${missing.length} prueba(s) no aparecen en el informe`);
  summary('');
}

if (errors.length) {
  summary('### ❌ Errores fuera de las pruebas');
  for (const e of errors) {
    const msg = (e.message ?? String(e)).replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0];
    summary(`- ${msg}`);
    annotation('error', 'Error fuera de las pruebas', msg);
  }
  summary('');
}

if (groups.newFailures.length) {
  summary('### 🚨 Fallos nuevos');
  summary('No están en `ci/expected-results.json`. Pueden ser un **bug nuevo** de la app o una **prueba rota**: abre el informe y míralo como en `docs/EXTENDED_RESULTS.md` (falla en una aserción → app; falla en una acción o timeout → prueba).');
  summary('');
  for (const r of groups.newFailures) {
    summary(`- **${r.title}** (\`${r.file}\`)${r.error ? `<br>\`${r.error.replace(/`/g, "'")}\`` : ''}`);
    annotation('error', 'Fallo nuevo', r.title);
  }
  summary('');
}

if (groups.fixed.length) {
  summary('### 🎉 Bugs conocidos que ahora pasan');
  summary('Puede que los hayan corregido. **Verifícalo a mano** y, si se confirma, borra la entrada de `ci/expected-results.json` y actualiza `docs/BUGS.md`.');
  summary('');
  for (const r of groups.fixed) {
    summary(`- **${r.exp.bug}** · ${r.title}${r.exp.kind === 'question' ? ' _(era una pregunta abierta)_' : ''}`);
    annotation('notice', `¿${r.exp.bug} corregido?`, r.title);
  }
  summary('');
}

if (groups.flaky.length) {
  summary('### 🔁 Intermitentes');
  for (const r of groups.flaky) summary(`- ${r.status === 'passed' ? '✅' : '❌'} **${r.exp.bug}** · ${r.title}`);
  summary('');
}

if (groups.known.length) {
  summary('<details><summary>🐞 Rojas por bugs conocidos (siguen en rojo a propósito)</summary>');
  summary('');
  for (const r of groups.known) summary(`- **${r.exp.bug}**${r.exp.kind === 'question' ? ' (pregunta abierta)' : ''} · ${r.title}`);
  summary('');
  summary('</details>');
  summary('');
}

if (notRun.length && notRun.length < expected.tests.length) {
  summary('<details><summary>ℹ️ Entradas de la lista que no se ejecutaron</summary>');
  summary('');
  summary('Normal si se filtró la suite (por ejemplo, solo `@core`). Si se ejecutó todo, revisa si cambió el título de la prueba.');
  summary('');
  for (const t of notRun) summary(`- ${t.title}`);
  summary('');
  summary('</details>');
  summary('');
}

summary('El informe completo (capturas, vídeos, trazas y evidencia JSON) está enlazado al final de este resumen.');

writeRunSummary({
  // sin-cambios = solo los rojos conocidos · cambios = algo nuevo que mirar ·
  // no-ejecutado = no hubo pruebas (p. ej. no se pudo crear el sandbox) · estricto = modo estricto con rojos
  estado: results.length === 0 ? 'no-ejecutado' : alarms > 0 ? 'cambios' : pipelineFails ? 'estricto' : 'sin-cambios',
  ejecutadas: results.length,
  // Todas las que pasaron: también un bug conocido que ahora pasa y un intermitente en verde.
  verdes: results.filter((r) => r.status === 'passed').length,
  rojosConocidos: groups.known.length,
  intermitentes: groups.flaky.map((r) => ({ titulo: r.title, bug: r.exp.bug, resultado: r.status === 'passed' ? 'verde' : 'rojo' })),
  nuevos: groups.newFailures.map((r) => r.title),
  corregidos: groups.fixed.map((r) => ({ titulo: r.title, bug: r.exp.bug })),
  noEjecutadas: missing.length,
  errores: errors.length,
});

process.exit(pipelineFails ? 1 : 0);
