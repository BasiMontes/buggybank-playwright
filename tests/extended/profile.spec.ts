/**
 * profile.spec.ts — Perfil (PF-01 a PF-04).
 *
 * Riesgos: que un cambio "guardado" no sea durable, y que el backend acepte lo que el
 * frontend bloquea (las validaciones del front se saltean fácil: basta con llamar a la API).
 *
 * LIMPIEZA: cada test modifica el perfil del sandbox. Guardamos el perfil original en
 * `beforeEach` y lo restauramos en `afterEach`, pase lo que pase en el test.
 */
import { attachEvidence, expect, test } from '../../src/fixtures/test';
import { Profile } from '../../src/api/types';
import { credentials } from '../../src/config/env';
import { uniqueId } from '../../src/utils/testData';

let original: Profile;

test.describe('Perfil', { tag: '@extended' }, () => {
  test.beforeEach(async ({ api }) => {
    original = await api.getProfile();
  });

  test.afterEach(async ({ api }) => {
    const res = await api.updateProfile(original);
    if (!res.ok()) console.warn(`[afterEach] No se pudo restaurar el perfil (${res.status()})`);
  });

  test('PF-01 · un nombre guardado persiste al recargar y al volver a iniciar sesión', async ({ api, page, pages }) => {
    // CH-013 "El perfil después de la sesión".
    const newName = `QA Tester ${uniqueId()}`;

    await pages.profile.goto();
    await pages.profile.nameInput.fill(newName);
    expect(await pages.profile.saveAndWait()).toBe(200);
    await expect(pages.profile.savedMessage).toBeVisible();

    // 1) Recarga.
    await page.reload();
    await pages.profile.goto();
    await expect.soft(pages.profile.nameInput, 'Después de recargar').toHaveValue(newName);

    // 2) API.
    expect.soft((await api.getProfile()).fullName, 'En la API').toBe(newName);

    // 3) Cerrar sesión y volver a entrar por la UI.
    await pages.profile.logout();
    await pages.login.login(credentials.email, credentials.password);
    await page.waitForURL('**/dashboard');
    await pages.profile.goto();
    await expect.soft(pages.profile.nameInput, 'Después de re-login').toHaveValue(newName);
  });

  test('PF-02 · la interfaz no permite guardar un nombre vacío o de una letra', async ({ pages }) => {
    // `api` no está en los parámetros, pero `beforeEach`/`afterEach` lo usan: el login ya ocurrió.
    await pages.profile.goto();
    for (const name of ['', 'A']) {
      await pages.profile.nameInput.fill(name);
      await expect.soft(pages.profile.saveButton, `Guardar con nombre "${name}"`).toBeDisabled();
    }
  });

  test(
    'PF-02 · la API aplica las mismas reglas que la interfaz (nombre corto, teléfono excesivo)',
    { annotation: { type: 'issue', description: 'BUG-20: el backend acepta nombre vacío, de una letra y teléfono de 60 dígitos (CH-007)' } },
    async ({ api }, testInfo) => {
      const cases: { label: string; change: Partial<Profile> }[] = [
        { label: 'nombre vacío', change: { fullName: '' } },
        { label: 'nombre de una letra', change: { fullName: 'A' } },
        { label: 'teléfono de 60 dígitos', change: { phone: '9'.repeat(60) } },
      ];
      const results: Record<string, number> = {};
      for (const { label, change } of cases) {
        const res = await api.updateProfile({ ...original, ...change });
        results[label] = res.status();
        expect.soft(res.status(), `${label} debía rechazarse con 400`).toBe(400);
        await api.updateProfile(original); // restauramos entre casos
      }
      await attachEvidence(testInfo, 'status-por-caso', results);
    },
  );

  test('PF-03 · el idioma elegido persiste después de recargar', async ({ api, page, pages }) => {
    const target = original.preferredLanguage === 'en-NZ' ? 'es-NZ' : 'en-NZ';

    await pages.profile.goto();
    await pages.profile.languageSelect.selectOption(target);
    expect(await pages.profile.saveAndWait()).toBe(200);

    await page.reload();
    await pages.profile.goto();
    await expect.soft(pages.profile.languageSelect).toHaveValue(target);
    expect.soft((await api.getProfile()).preferredLanguage).toBe(target);
  });

  test(
    'PF-04 · un email inválido se rechaza con error, no se ignora en silencio',
    { annotation: { type: 'issue', description: 'BUG-21: responde 200 "Saved profile" pero conserva el email anterior' } },
    async ({ api }, testInfo) => {
      // Usamos un email INVÁLIDO a propósito: si la app lo aceptara de verdad, no
      // cambiaría tus credenciales por uno real que no controlas.
      const res = await api.updateProfile({ ...original, email: 'no-es-email' });
      const body = await res.text();
      await attachEvidence(testInfo, 'respuesta', { status: res.status(), body });

      // Lo correcto: 400 con un mensaje. Un 200 que no guarda nada engaña al usuario.
      expect(res.status(), 'Un email inválido debía rechazarse').toBe(400);
    },
  );
});
