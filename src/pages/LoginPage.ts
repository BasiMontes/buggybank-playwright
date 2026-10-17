/**
 * LoginPage.ts — Pantalla /login.
 *
 * Selectores: la pantalla tiene data-testid (login-email, login-password, login-submit),
 * que los desarrolladores agregan justamente para automatizar. Son los más estables.
 *
 * Validaciones del frontend (las leímos en el código de la página durante la exploración):
 * - email con formato válido  → si no: "Ingresa un email válido"
 * - contraseña de 4+ caracteres → si no: "La contraseña debe tener al menos 4 caracteres"
 * - si el servidor rechaza, se muestra el `message` que devuelve la API.
 */
import { Locator, Page } from '@playwright/test';

export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly createTemporaryUserButton: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.getByTestId('login-email');
    this.passwordInput = page.getByTestId('login-password');
    this.submitButton = page.getByTestId('login-submit');
    this.createTemporaryUserButton = page.getByTestId('create-temporary-user');
  }

  async goto(): Promise<void> {
    await this.page.goto('/login');
    await this.emailInput.waitFor();
  }

  /** Completa el formulario y envía. No espera resultado: cada test decide qué verificar. */
  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  /** Busca un texto dentro del formulario (para mensajes de error). */
  message(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }
}
