/**
 * TransferPage.ts — Pantalla /transfers ("Nueva transferencia").
 *
 * Selectores (todos con data-testid, encontrados en la exploración):
 *   transfer-from    <select> cuenta origen. Opciones: "CHECKING · 77-...-00 ($6,500.00)"
 *   transfer-to      <select> cuenta destino
 *   transfer-amount  <input type="number" step="0.01">
 *   transfer-note    <input> descripción
 *   transfer-submit  botón "Transferir"
 *
 * Mensajes observados:
 *   "OK transfer"                 → éxito (viene de la API)
 *   "Ingresa un monto mayor a 0"  → validación del frontend para montos <= 0
 */
import { Locator, Page, Response } from '@playwright/test';
import { Account, AccountType } from '../api/types';
import { parseMoney, toCents } from '../utils/money';
import { AppShell } from './AppShell';

export class TransferPage extends AppShell {
  readonly fromSelect: Locator;
  readonly toSelect: Locator;
  readonly amountInput: Locator;
  readonly noteInput: Locator;
  readonly submitButton: Locator;
  readonly successMessage: Locator;
  readonly amountValidationMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.fromSelect = page.getByTestId('transfer-from');
    this.toSelect = page.getByTestId('transfer-to');
    this.amountInput = page.getByTestId('transfer-amount');
    this.noteInput = page.getByTestId('transfer-note');
    this.submitButton = page.getByTestId('transfer-submit');
    this.successMessage = page.getByText('OK transfer');
    this.amountValidationMessage = page.getByText('Ingresa un monto mayor a 0');
  }

  async goto(): Promise<void> {
    await this.page.goto('/transfers');
    // La pantalla muestra "Preparando transferencias..." mientras carga las cuentas.
    // Esperar al <select> evita interactuar con un formulario que todavía no existe.
    await this.fromSelect.waitFor();
  }

  /**
   * Completa el formulario.
   * Seleccionamos las cuentas por su ID interno (el `value` del <option>), que viene de la
   * API. Es más robusto que elegir por texto, porque el texto incluye el saldo y cambia.
   */
  async fillForm(opts: { from: Account; to: Account; amount: string; note: string }): Promise<void> {
    await this.fromSelect.selectOption(opts.from.id);
    await this.toSelect.selectOption(opts.to.id);
    // El monto va como TEXTO a propósito: así podemos escribir "-50", "10.005" o "" igual
    // que lo haría una persona.
    await this.amountInput.fill(opts.amount);
    await this.noteInput.fill(opts.note);
  }

  /**
   * Hace clic en "Transferir" y espera la respuesta de POST /api/transfers.
   * Devolvemos la respuesta para poder adjuntarla como evidencia en el reporte.
   */
  async submitAndWaitForApi(): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('/api/transfers') && r.request().method() === 'POST'),
      this.submitButton.click(),
    ]);
    return response;
  }

  /**
   * Hace clic en "Transferir" y espera la llamada a la API SOLO si ocurre.
   * Para los casos de rechazo no sabemos de antemano quién rechaza: puede bloquear el
   * frontend (no hay request) o el backend (hay request con error). Devolvemos la
   * respuesta o null, y el test verifica los efectos (saldos y movimientos) igual.
   */
  async submitAndMaybeWaitForApi(timeoutMs = 5_000): Promise<Response | null> {
    const responsePromise = this.page
      .waitForResponse((r) => r.url().includes('/api/transfers') && r.request().method() === 'POST', {
        timeout: timeoutMs,
      })
      .catch(() => null);
    await this.submitButton.click();
    return responsePromise;
  }

  /**
   * Hace clic en "Transferir" SIN esperar una llamada a la API.
   * Se usa en los casos donde esperamos que el frontend bloquee el envío.
   */
  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /**
   * DOBLE SUBMIT SIMULTÁNEO (caso TC-05 / desafío CH-002).
   *
   * ¿Por qué no usamos `dblclick()` o `Promise.all([click(), click()])`?
   * Playwright, antes de cada click, espera que el botón esté "accionable" y simula
   * el ratón. Eso añade milisegundos entre los dos clics, como haría una persona,
   * y en la exploración ese doble clic "humano" SÍ fue filtrado por la app.
   *
   * El riesgo real es un doble envío en el mismo instante (doble toque en el móvil,
   * un script, un reintento automático). Para reproducirlo disparamos los dos clics
   * dentro del navegador, en el mismo "tick" de JavaScript, con `element.click()`.
   */
  async doubleSubmitSimultaneous(): Promise<void> {
    await this.submitButton.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  }

  /** Doble clic "humano" con el ratón de Playwright (para comparar con el simultáneo). */
  async doubleClickSubmit(): Promise<void> {
    await this.submitButton.dblclick();
  }

  /**
   * Saldo que la pantalla muestra dentro del <option> de origen, en centavos.
   * Ej: "CHECKING · 77-7919-5418600-00 ($6,486.63)" → 648663.
   * Es un tercer lugar donde se ve el saldo (además del dashboard y la API): sirve para
   * verificar que la pantalla se actualiza después de transferir.
   */
  async sourceOptionBalance(type: AccountType): Promise<number> {
    const option = this.fromSelect.locator('option', { hasText: type });
    return toCents(parseMoney(await option.innerText()));
  }

  /**
   * ¿El botón PARECE deshabilitado? (caso TR-12 / CH-008)
   * La app aplica las clases `opacity-60 cursor-not-allowed` sin poner el atributo
   * `disabled`. Devolvemos ambas cosas para poder compararlas.
   */
  async submitButtonState(): Promise<{ looksDisabled: boolean; isDisabled: boolean }> {
    const className = (await this.submitButton.getAttribute('class')) ?? '';
    // Las clases `disabled:...` de Tailwind solo aplican si el botón tiene el atributo disabled.
    // Buscamos las clases "sueltas" que se agregan a mano para simular el estado.
    const tokens = className.split(/\s+/);
    const looksDisabled = tokens.includes('opacity-60') || tokens.includes('cursor-not-allowed');
    return { looksDisabled, isDisabled: await this.submitButton.isDisabled() };
  }
}
