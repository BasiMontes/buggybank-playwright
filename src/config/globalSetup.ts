/**
 * globalSetup.ts — Se ejecuta UNA vez antes de toda la suite (no antes de cada test).
 *
 * EL PROBLEMA QUE RESUELVE:
 * Un sandbox de BuggyBank dura 24 horas. En tu máquina lo renuevas a mano y actualizas
 * el .env. Pero en GitHub Actions nadie puede hacer eso: unas credenciales guardadas
 * como secreto dejarían de funcionar al día siguiente.
 *
 * LA SOLUCIÓN:
 * Si no hay BB_EMAIL/BB_PASSWORD pero sí hay BB_COURSE_CODE, creamos un sandbox nuevo
 * igual que el botón "Crear usuario temporal" de la pantalla de login:
 *
 *   POST /api/sandbox/users
 *   cabecera  x-bb-access-code: <código del curso>
 *   cuerpo    {}
 *   respuesta { email, password, ... }
 *
 * (Lo sacamos del código público de la página de login: es exactamente lo que hace el botón.)
 *
 * Guardamos las credenciales en process.env. Playwright arranca los workers DESPUÉS del
 * globalSetup y les pasa process.env, así que `credentials.email` y `credentials.password`
 * (src/config/env.ts) las encuentran sin cambiar nada más.
 *
 * Orden de prioridad:
 *   1. BB_EMAIL + BB_PASSWORD en el entorno o en el .env → se usan tal cual (uso local).
 *   2. BB_COURSE_CODE → sandbox nuevo para esta ejecución (CI, o local si dejas el email vacío).
 *   3. Nada → en CI corta con un mensaje claro; en local deja que env.ts avise cuando un test
 *      pida credenciales (así `npx playwright test --list` funciona sin .env).
 */
import { BASE_URL } from './env';

interface SandboxUser {
  email?: string;
  password?: string;
  message?: string;
}

export default async function globalSetup(): Promise<void> {
  const email = process.env.BB_EMAIL?.trim();
  const password = process.env.BB_PASSWORD?.trim();
  if (email && password) return; // caso 1: credenciales propias

  const courseCode = process.env.BB_COURSE_CODE?.trim();
  if (!courseCode) {
    if (process.env.CI) {
      throw new Error(
        'No hay credenciales para BuggyBank.\n' +
          '→ En GitHub: Settings → Secrets and variables → Actions → New repository secret\n' +
          '  Nombre: BB_COURSE_CODE · Valor: el código del curso.\n' +
          '→ Los pull requests desde forks no reciben secretos: en ese caso este error es esperable.',
      );
    }
    return; // caso 3 en local
  }

  // Caso 2: crear un sandbox nuevo.
  const response = await fetch(`${BASE_URL}/api/sandbox/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bb-access-code': courseCode },
    body: JSON.stringify({}),
  });
  const body = (await response.json().catch(() => ({}))) as SandboxUser;

  if (!response.ok || !body.email || !body.password) {
    // Nunca imprimimos el código del curso: solo el status y el mensaje de la app.
    throw new Error(
      `No se pudo crear el sandbox de BuggyBank (HTTP ${response.status}): ${body.message ?? 'la respuesta no trae email y contraseña'}.\n` +
        '→ Comprueba que el secreto BB_COURSE_CODE tiene el código del curso vigente.',
    );
  }

  // En GitHub Actions, "::add-mask::" hace que el valor aparezca como *** en todos los logs
  // a partir de aquí (incluidos los mensajes de error de los tests).
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::add-mask::${body.password}`);
    console.log(`::add-mask::${body.email}`);
  }

  process.env.BB_EMAIL = body.email;
  process.env.BB_PASSWORD = body.password;
  console.log('Sandbox nuevo creado para esta ejecución (caduca en 24 h).');
}
