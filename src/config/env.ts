/**
 * env.ts — Lectura y validación de variables de entorno.
 *
 * ¿Por qué un archivo aparte?
 * - Las credenciales NUNCA van escritas en el código (lo pide el desafío y es buena práctica).
 * - Si falta una variable, queremos un error CLARO al principio ("falta BB_EMAIL, revisá tu .env")
 *   en lugar de un error confuso a mitad de un test ("Auth failed" o "Cannot read property of undefined").
 *
 * dotenv lee el archivo `.env` de la raíz del proyecto y carga sus valores en `process.env`.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

// Cargamos el .env una sola vez. `quiet: true` evita que dotenv imprima mensajes en consola.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true } as dotenv.DotenvConfigOptions);

/** URL base. Tiene un valor por defecto porque no es un secreto. */
export const BASE_URL = process.env.BB_BASE_URL?.trim() || 'https://buggybank-seven.vercel.app';

/**
 * Devuelve el valor de una variable obligatoria o corta la ejecución con un mensaje útil.
 * Se llama "lazy" (recién cuando un test la necesita) para que comandos como
 * `npx playwright test --list` funcionen aunque todavía no tengas .env.
 */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}.\n` +
        `→ Copiá .env.example a .env y completá las credenciales de tu sandbox.\n` +
        `→ Si el sandbox venció (dura 24 h), creá uno nuevo en ${BASE_URL}/login.`,
    );
  }
  return value;
}

/** Credenciales del sandbox. Se leen recién cuando se usan. */
export const credentials = {
  get email(): string {
    return required('BB_EMAIL');
  },
  get password(): string {
    return required('BB_PASSWORD');
  },
};
