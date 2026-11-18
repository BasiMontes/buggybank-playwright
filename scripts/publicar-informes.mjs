/**
 * publicar-informes.mjs — Arma el sitio de GitHub Pages con el historial de ejecuciones.
 *
 * Lo ejecuta el job "Publicar informe" del workflow, solo en ejecuciones de main.
 * Sin dependencias: Node puro (más el comando `unzip`, que viene en los runners de GitHub).
 *
 * DÓNDE SE GUARDA CADA COSA (y por qué):
 *
 *   Historial liviano  → rama `historial` del repo, carpeta ejecuciones/
 *                        Un JSON de pocos KB por ejecución (fecha, verdes, rojos, cambios).
 *                        Se conserva para siempre y no ensucia main. La rama tiene un
 *                        README con la tabla de todas las ejecuciones.
 *
 *   Informes completos → NO van a Git: pesan ~23 MB cada uno (vídeos y trazas) y las trazas
 *                        guardan el login del sandbox. Se guardan como artefacto de cada
 *                        ejecución (30 días) y aquí se descargan los de las últimas
 *                        INFORMES_MAX ejecuciones de main para publicarlos en Pages.
 *
 * El sitio queda así:
 *   /                    → redirige al informe de la última ejecución (el enlace de siempre)
 *   /historial/          → tabla de todas las ejecuciones, con enlace a cada informe disponible
 *   /informes/<run-id>/  → informe de Playwright de esa ejecución
 *
 * Variables de entorno (las pone el workflow):
 *   SITE_DIR, HIST_DIR    carpetas del sitio y de la rama historial (por defecto site/ y hist/)
 *   RESUMEN               run-summary.json que deja scripts/ci-summary.mjs
 *   RUN_ID, RUN_URL, SHA, EVENTO, SUITE   datos de esta ejecución
 *   REPO, GITHUB_TOKEN    para listar y descargar los informes anteriores (API de GitHub)
 *   INFORMES_MAX          cuántos informes completos publicar (por defecto 15)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = process.env;
const SITE = env.SITE_DIR ?? 'site';
const HIST = env.HIST_DIR ?? 'hist';
const RUN_ID = String(env.RUN_ID ?? 'local');
const MAX = Number(env.INFORMES_MAX ?? 15);
const API = env.GITHUB_API_URL ?? 'https://api.github.com';

// ── 1. Registrar esta ejecución en el historial ─────────────────────────────────
function registrar() {
  const resumen = env.RESUMEN && existsSync(env.RESUMEN) ? JSON.parse(readFileSync(env.RESUMEN, 'utf8')) : { estado: 'sin-datos' };
  const fecha = new Date().toISOString();
  const entrada = {
    fecha,
    runId: RUN_ID,
    runUrl: env.RUN_URL ?? null,
    sha: (env.SHA ?? '').slice(0, 7) || null,
    evento: env.EVENTO ?? null,
    suite: env.SUITE ?? 'todas',
    ...resumen,
  };
  const dir = join(HIST, 'ejecuciones');
  mkdirSync(dir, { recursive: true });
  // El nombre empieza por la fecha: ordenar por nombre = ordenar por fecha.
  writeFileSync(join(dir, `${fecha.slice(0, 10)}_${RUN_ID}.json`), `${JSON.stringify(entrada, null, 2)}\n`);
  console.log(`Ejecución ${RUN_ID} registrada en el historial (${entrada.estado}).`);
}

// ── 2. Descargar los informes de ejecuciones anteriores ─────────────────────────
async function gh(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} → HTTP ${res.status}`);
  return res;
}

async function descargarAnteriores() {
  if (!env.REPO || !env.GITHUB_TOKEN) {
    console.log('Sin REPO/GITHUB_TOKEN: no se descargan informes anteriores.');
    return;
  }
  // Artefactos "playwright-report" de main, sin caducar, del más nuevo al más viejo.
  const candidatos = [];
  for (let page = 1; page <= 5 && candidatos.length < MAX; page++) {
    const { artifacts = [] } = await (await gh(`/repos/${env.REPO}/actions/artifacts?name=playwright-report&per_page=100&page=${page}`)).json();
    if (artifacts.length === 0) break;
    for (const a of artifacts) {
      const run = a.workflow_run ?? {};
      if (a.expired || run.head_branch !== 'main' || String(run.id) === RUN_ID) continue;
      if (!candidatos.some((c) => c.runId === String(run.id))) candidatos.push({ runId: String(run.id), id: a.id, creado: a.created_at });
    }
  }
  candidatos.sort((a, b) => b.creado.localeCompare(a.creado));

  // Solo las ejecuciones que están entre las MAX más recientes del historial: una ejecución
  // de antes de que existiera el historial no tendría fila desde la que enlazar su informe.
  // El informe de esta ejecución ya está en el sitio (lo pone el workflow).
  const recientes = new Set(leerHistorial().slice(0, MAX).map((e) => e.runId));
  for (const c of candidatos.filter((c) => recientes.has(c.runId))) {
    const destino = join(SITE, 'informes', c.runId);
    if (existsSync(destino)) continue;
    try {
      const zip = Buffer.from(await (await gh(`/repos/${env.REPO}/actions/artifacts/${c.id}/zip`)).arrayBuffer());
      mkdirSync(destino, { recursive: true });
      const zipPath = join(SITE, `.${c.runId}.zip`);
      writeFileSync(zipPath, zip);
      execFileSync('unzip', ['-q', '-o', zipPath, '-d', destino]);
      rmSync(zipPath);
      console.log(`Informe de la ejecución ${c.runId} recuperado.`);
    } catch (error) {
      // Un informe que no se puede bajar no impide publicar el resto.
      rmSync(destino, { recursive: true, force: true });
      console.warn(`No se pudo recuperar el informe de ${c.runId}: ${error.message}`);
    }
  }
}

// ── 3. Generar las páginas ──────────────────────────────────────────────────────
const ESTADOS = {
  'sin-cambios': ['✅', 'Sin cambios'],
  cambios: ['⚠️', 'Cambios'],
  'no-ejecutado': ['❌', 'No se ejecutó'],
  estricto: ['❌', 'Rojo (estricto)'],
  'sin-datos': ['❔', 'Sin datos'],
};
const EVENTOS = { schedule: 'Diaria', push: 'Push a main', workflow_dispatch: 'Manual' };
const fechaMadrid = (iso) =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function leerHistorial() {
  const dir = join(HIST, 'ejecuciones');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Texto corto con lo que cambió: "1 nuevo · BUG-13 corregido". */
function cambios(e, html) {
  const partes = [];
  for (const t of e.nuevos ?? []) partes.push(html ? `🚨 Nuevo: ${esc(t)}` : `🚨 Nuevo: ${t}`);
  for (const c of e.corregidos ?? []) partes.push(html ? `🎉 ${esc(c.bug)} pasa: ${esc(c.titulo)}` : `🎉 ${c.bug} pasa: ${c.titulo}`);
  if (e.noEjecutadas) partes.push(`❓ ${e.noEjecutadas} sin ejecutar`);
  if (e.errores && e.estado !== 'no-ejecutado') partes.push(`❌ ${e.errores} error(es) fuera de las pruebas`);
  return partes;
}

function generar(historial) {
  // Página del historial.
  const filas = historial
    .map((e) => {
      const [icono, estado] = ESTADOS[e.estado] ?? ESTADOS['sin-datos'];
      const informe = existsSync(join(SITE, 'informes', e.runId))
        ? `<a href="../informes/${esc(e.runId)}/">Ver informe</a>`
        : '<span class="muted">caducado</span>';
      const flaky = (e.intermitentes ?? []).map((f) => `${f.resultado === 'verde' ? '✅' : '❌'} ${esc(f.bug)}`).join(' ') || '—';
      const lista = cambios(e, true);
      return `<tr class="${esc(e.estado)}">
  <td>${esc(fechaMadrid(e.fecha))}</td>
  <td>${esc(EVENTOS[e.evento] ?? e.evento ?? '—')}${e.suite && e.suite !== 'todas' ? ` · ${esc(e.suite)}` : ''}</td>
  <td>${icono} ${estado}</td>
  <td class="num">${e.ejecutadas ?? '—'}</td>
  <td class="num">${e.verdes ?? '—'}</td>
  <td class="num">${e.rojosConocidos ?? '—'}</td>
  <td>${flaky}</td>
  <td>${lista.length ? lista.join('<br>') : '<span class="muted">—</span>'}</td>
  <td>${informe}</td>
  <td>${e.runUrl ? `<a href="${esc(e.runUrl)}">Actions</a>` : '—'}</td>
</tr>`;
    })
    .join('\n');

  mkdirSync(join(SITE, 'historial'), { recursive: true });
  writeFileSync(
    join(SITE, 'historial', 'index.html'),
    `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Historial de ejecuciones · BuggyBank</title>
<style>
  :root { --bg:#fff; --fg:#1f2328; --muted:#656d76; --line:#d0d7de; --head:#f6f8fa; --link:#0969da; --warn:#fff8c5; --bad:#ffebe9; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8d96a0; --line:#30363d; --head:#161b22; --link:#4493f8; --warn:#3b2e00; --bad:#3d1214; } }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:1200px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:24px; margin:0 0 4px; }
  p { margin:4px 0 16px; color:var(--muted); }
  a { color:var(--link); }
  .wrap { overflow-x:auto; border:1px solid var(--line); border-radius:8px; }
  table { border-collapse:collapse; width:100%; min-width:900px; }
  th, td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
  th { background:var(--head); font-weight:600; white-space:nowrap; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  tr.cambios td { background:var(--warn); }
  tr.no-ejecutado td, tr.estricto td { background:var(--bad); }
  .muted { color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Historial de ejecuciones · BuggyBank</h1>
  <p><a href="../">Último informe</a> · Una fila por ejecución de <code>main</code>, la más reciente arriba.
  Los informes completos se conservan para las últimas ${MAX} ejecuciones; el historial, para siempre
  (también en la <a href="https://github.com/${esc(env.REPO ?? '')}/tree/historial">rama <code>historial</code></a> del repo).</p>
  <div class="wrap">
  <table>
    <thead><tr><th>Fecha (Madrid)</th><th>Origen</th><th>Resultado</th><th>Ejecutadas</th><th>Verdes</th><th>Rojos conocidos</th><th>Intermitentes</th><th>Cambios</th><th>Informe</th><th>Ejecución</th></tr></thead>
    <tbody>
${filas}
    </tbody>
  </table>
  </div>
  <p>✅ Sin cambios: los únicos rojos son los bugs conocidos · ⚠️ Cambios: un fallo nuevo o un bug conocido que ahora pasa · ❌ No se ejecutó: por ejemplo, no se pudo crear el sandbox.</p>
</main>
</body>
</html>
`,
  );

  // Raíz: redirige al último informe, así el enlace que ya circula sigue funcionando.
  // Si el informe de esta ejecución no llegó (el resumen no pudo subirlo), al historial.
  const destino = existsSync(join(SITE, 'informes', RUN_ID)) ? `informes/${esc(RUN_ID)}/` : 'historial/';
  writeFileSync(
    join(SITE, 'index.html'),
    `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${destino}">
<title>Último informe · BuggyBank</title>
</head>
<body>
<p>Abriendo el <a href="${destino}">informe de la última ejecución</a>…
También puedes ver el <a href="historial/">historial de ejecuciones</a>.</p>
</body>
</html>
`,
  );

  // README de la rama historial: la misma tabla, en Markdown, visible en GitHub.
  const pages = env.PAGES_URL ?? '';
  const md = historial
    .map((e) => {
      const [icono, estado] = ESTADOS[e.estado] ?? ESTADOS['sin-datos'];
      const lista = cambios(e, false).join('<br>').replace(/\|/g, '\\|') || '—';
      // Enlace al informe en Pages mientras siga entre los últimos MAX; después, "caducado".
      // Como este README se regenera entero en cada ejecución, nunca queda un enlace roto.
      const informe = pages && existsSync(join(SITE, 'informes', e.runId)) ? `[Ver informe](${pages}informes/${e.runId}/)` : 'caducado';
      return `| ${fechaMadrid(e.fecha)} | ${EVENTOS[e.evento] ?? e.evento ?? '—'} | ${icono} ${estado} | ${e.ejecutadas ?? '—'} | ${e.verdes ?? '—'} | ${e.rojosConocidos ?? '—'} | ${lista} | ${informe} | ${e.runUrl ? `[Actions](${e.runUrl})` : '—'} |`;
    })
    .join('\n');
  writeFileSync(
    join(HIST, 'README.md'),
    `# Historial de ejecuciones

Esta rama la escribe el workflow **Pruebas BuggyBank** (job "Publicar informe") en cada ejecución de \`main\`. No se mergea a \`main\`: solo guarda el historial.

- Cada ejecución deja un JSON en [\`ejecuciones/\`](ejecuciones/) con sus números y lo que cambió.
- Cada fila enlaza a su informe HTML completo (capturas, vídeos, trazas) mientras esté entre las últimas ${MAX} ejecuciones. ${pages ? `[Último informe](${pages}) · [Historial en GitHub Pages](${pages}historial/)` : ''}

| Fecha (Madrid) | Origen | Resultado | Ejecutadas | Verdes | Rojos conocidos | Cambios | Informe | Ejecución |
|---|---|---|---|---|---|---|---|---|
${md}
`,
  );
  console.log(`Historial generado: ${historial.length} ejecución(es).`);
}

// ── Programa principal ──────────────────────────────────────────────────────────
registrar();
await descargarAnteriores();
// Por si quedó alguna carpeta de informe de más (p. ej. al bajar INFORMES_MAX), recortamos.
const informesDir = join(SITE, 'informes');
if (existsSync(informesDir)) {
  const historial = leerHistorial();
  const conservar = new Set(historial.slice(0, MAX).map((e) => e.runId).concat(RUN_ID));
  for (const d of readdirSync(informesDir)) if (!conservar.has(d)) rmSync(join(informesDir, d), { recursive: true, force: true });
}
generar(leerHistorial());
