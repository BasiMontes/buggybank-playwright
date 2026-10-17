/**
 * ProfilePage.ts — Pantalla /profile ("Perfil y preferencias").
 *
 * No tiene data-testid, pero los inputs tienen `id` (fullName, email, phone, language),
 * que también son estables. Usamos `#id` como selector CSS.
 *
 * Comportamiento observado:
 * - Al guardar: PUT /api/profile y mensaje "Saved profile".
 * - Con un nombre de 1 letra, el botón "Guardar cambios" queda deshabilitado (validación del front).
 */
import { Locator, Page } from '@playwright/test';
import { AppShell } from './AppShell';

export class ProfilePage extends AppShell {
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly phoneInput: Locator;
  readonly languageSelect: Locator;
  readonly saveButton: Locator;
  readonly savedMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.nameInput = page.locator('#fullName');
    this.emailInput = page.locator('#email');
    this.phoneInput = page.locator('#phone');
    this.languageSelect = page.locator('#language');
    this.saveButton = page.getByRole('button', { name: 'Guardar cambios' });
    this.savedMessage = page.getByText('Saved profile');
  }

  async goto(): Promise<void> {
    await this.page.goto('/profile');
    // El nombre se carga desde la API: esperamos a que el input tenga algún valor.
    await this.nameInput.waitFor();
    await this.page.waitForFunction(() => {
      const input = document.querySelector<HTMLInputElement>('#fullName');
      return !!input && input.value.length > 0;
    });
  }

  /** Guarda y espera la respuesta del servidor. */
  async saveAndWait(): Promise<number> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('/api/profile') && r.request().method() === 'PUT'),
      this.saveButton.click(),
    ]);
    return response.status();
  }
}
