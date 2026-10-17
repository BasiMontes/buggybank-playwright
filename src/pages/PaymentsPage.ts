/**
 * PaymentsPage.ts — Las tres pantallas de Pagos:
 *   /payments       listado con filtro por estado
 *   /payments/new   formulario "Nuevo pago" (se guarda como Programado)
 *   /payments/:id   detalle, historial de estados y botones Procesar / Revertir
 *
 * Todas tienen data-testid (confirmados en la exploración).
 *
 * Ciclo de vida de un pago (máquina de estados):
 *
 *   Programado ──Procesar──▶ Pendiente ──Procesar──▶ Completado ──Revertir──▶ Revertido
 *
 * Regla que dice la propia app: "El procesamiento avanza un único estado".
 */
import { Locator, Page } from '@playwright/test';
import { PaymentStatus } from '../api/types';
import { AppShell } from './AppShell';

/** Texto en español que la UI muestra para cada estado de la API. */
export const STATUS_LABEL: Record<PaymentStatus, string> = {
  SCHEDULED: 'Programado',
  PENDING: 'Pendiente',
  COMPLETED: 'Completado',
  REVERSED: 'Revertido',
};

// -----------------------------------------------------------------------------
// Listado
// -----------------------------------------------------------------------------
export class PaymentsListPage extends AppShell {
  readonly statusFilter: Locator;
  readonly newPaymentLink: Locator;
  readonly rows: Locator;

  constructor(page: Page) {
    super(page);
    this.statusFilter = page.getByTestId('payments-status-filter');
    this.newPaymentLink = page.getByTestId('payments-new-link');
    this.rows = page.getByTestId('payment-row');
  }

  async goto(): Promise<void> {
    await this.page.goto('/payments');
    await this.statusFilter.waitFor();
    await this.rows.first().waitFor();
  }

  /** Filtra por estado. Values: ALL | SCHEDULED | PENDING | COMPLETED | REVERSED */
  async filterStatus(value: PaymentStatus | 'ALL'): Promise<void> {
    await this.statusFilter.selectOption(value);
  }

  /** La fila de un pago identificada por su beneficiario (que en las pruebas es único). */
  rowByBeneficiary(beneficiary: string): Locator {
    return this.rows.filter({ hasText: beneficiary });
  }

  /** Textos de estado de todas las filas visibles. */
  async visibleStatuses(): Promise<string[]> {
    return (await this.rows.getByTestId('payment-status').allInnerTexts()).map((s) => s.trim());
  }
}

// -----------------------------------------------------------------------------
// Formulario "Nuevo pago"
// -----------------------------------------------------------------------------
export class NewPaymentPage extends AppShell {
  readonly beneficiaryInput: Locator;
  readonly sourceAccountSelect: Locator;
  readonly amountInput: Locator;
  readonly dateInput: Locator;
  readonly referenceInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    this.beneficiaryInput = page.getByTestId('payment-beneficiary');
    this.sourceAccountSelect = page.getByTestId('payment-source-account');
    this.amountInput = page.getByTestId('payment-amount');
    this.dateInput = page.getByTestId('payment-date');
    this.referenceInput = page.getByTestId('payment-reference');
    this.submitButton = page.getByTestId('payment-submit');
  }

  async goto(): Promise<void> {
    await this.page.goto('/payments/new');
    await this.beneficiaryInput.waitFor();
  }

  async fillForm(opts: {
    beneficiary: string;
    sourceAccountId: string;
    amount: string;
    date: string; // YYYY-MM-DD
    reference: string;
  }): Promise<void> {
    await this.beneficiaryInput.fill(opts.beneficiary);
    await this.sourceAccountSelect.selectOption(opts.sourceAccountId);
    await this.amountInput.fill(opts.amount);
    await this.dateInput.fill(opts.date);
    await this.referenceInput.fill(opts.reference);
  }

  /**
   * Envía el formulario. Si el pago se crea, la app navega al detalle (/payments/<id>).
   * Devolvemos el ID tomado de la URL, o null si nos quedamos en /payments/new (rechazo).
   */
  async submit(): Promise<string | null> {
    const responsePromise = this.page
      .waitForResponse((r) => r.url().endsWith('/api/payments') && r.request().method() === 'POST', { timeout: 10_000 })
      .catch(() => null); // si el frontend bloquea el envío, no hay respuesta: no es un error del test
    await this.submitButton.click();
    const response = await responsePromise;
    if (!response || response.status() !== 201) return null;
    await this.page.waitForURL(/\/payments\/(?!new)[^/]+$/);
    return this.page.url().split('/').pop() ?? null;
  }
}

// -----------------------------------------------------------------------------
// Detalle
// -----------------------------------------------------------------------------
export class PaymentDetailPage extends AppShell {
  readonly detail: Locator;
  readonly status: Locator;
  readonly processButton: Locator;
  readonly reverseButton: Locator;
  readonly events: Locator;

  constructor(page: Page) {
    super(page);
    this.detail = page.getByTestId('payment-detail');
    this.status = page.getByTestId('payment-detail-status');
    this.processButton = page.getByTestId('payment-process');
    this.reverseButton = page.getByTestId('payment-reverse');
    this.events = page.getByTestId('payment-event');
  }

  async goto(id: string): Promise<void> {
    await this.page.goto(`/payments/${id}`);
    await this.status.waitFor();
  }

  /** Procesa una vez y espera a que el estado mostrado cambie. */
  async processOnce(expectedNext: PaymentStatus): Promise<void> {
    await this.processButton.click();
    await this.status.filter({ hasText: STATUS_LABEL[expectedNext] }).waitFor();
  }

  /**
   * Dos clics simultáneos en "Procesar" (caso PG-06 / CH-016).
   * Misma técnica que el doble submit de transferencias: los dos `click()` se disparan
   * dentro del navegador en el mismo instante. Cada clic genera su propia clave de
   * idempotencia, y ahí está el riesgo: el servidor ve dos intenciones distintas.
   */
  async processTwiceSimultaneous(): Promise<void> {
    await this.processButton.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  }

  /** Lista de transiciones del historial, ej. ["Programado", "Programado → Pendiente"]. */
  async eventTitles(): Promise<string[]> {
    const texts = await this.events.allInnerTexts();
    // El primer renglón de cada evento es el título (estado o "A → B").
    return texts.map((t) => t.split('\n')[0].trim());
  }

  /** Lee un dato del bloque de detalle por su etiqueta (BENEFICIARIO, MONTO, FECHA...). */
  async field(label: string): Promise<string> {
    const lines = (await this.detail.innerText())
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const index = lines.findIndex((l) => l.toUpperCase() === label.toUpperCase());
    if (index < 0) throw new Error(`No se encontró el campo "${label}" en el detalle del pago`);
    return lines[index + 1];
  }
}
