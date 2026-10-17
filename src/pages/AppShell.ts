/**
 * AppShell.ts — Las partes comunes a todas las pantallas logueadas:
 * el encabezado (QA Mode, botón Salir) y el menú lateral.
 *
 * ¿Qué es un Page Object?
 * Es una clase que "envuelve" una pantalla: guarda los selectores y ofrece métodos con
 * nombres del negocio (`logout()`, `goToTransfers()`). Así los tests se leen como pasos
 * de un caso de prueba y, si la app cambia un selector, se corrige en UN solo lugar.
 */
import { Locator, Page } from '@playwright/test';

export class AppShell {
  readonly logoutButton: Locator;
  readonly qaModeToggle: Locator;
  readonly nav: Locator;

  constructor(protected readonly page: Page) {
    // Preferimos selectores "accesibles" (rol + nombre visible): son los que usa una
    // persona y suelen sobrevivir a cambios de estilos o de estructura HTML.
    this.logoutButton = page.getByRole('button', { name: 'Salir' });
    this.qaModeToggle = page.locator('header input[type="checkbox"]');
    this.nav = page.getByRole('navigation');
  }

  /** Link del menú por su texto visible: "Dashboard", "Transferencias", "Pagos", etc. */
  navLink(name: string): Locator {
    return this.nav.getByRole('link', { name });
  }

  async logout(): Promise<void> {
    await this.logoutButton.click();
    await this.page.waitForURL('**/login');
  }

  /**
   * Asegura que QA Mode esté apagado. QA Mode muestra pistas en pantalla; no cambia el
   * comportamiento, pero agrega textos que podrían confundir a los locators por texto.
   */
  async ensureQaModeOff(): Promise<void> {
    if ((await this.qaModeToggle.count()) > 0 && (await this.qaModeToggle.isChecked())) {
      await this.qaModeToggle.click();
    }
  }
}
