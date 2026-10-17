/**
 * TransactionsPage.ts — Pantalla /transactions ("Historial de movimientos").
 *
 * Elementos:
 *   - Filtro "Dirección": <select data-testid="transactions-direction"> (all / incoming / outgoing)
 *   - Búsqueda: <input data-testid="transactions-search"> ("Buscar por nota o cuenta")
 *   - Tabla con columnas: FECHA | TIPO | MONTO | CUENTAS | CONTRAPARTE | DESCRIPCIÓN
 *
 * Cada cambio de filtro dispara GET /api/transactions?direction=...&query=...
 * Esperamos esa respuesta antes de leer la tabla, para no leer filas viejas.
 */
import { Locator, Page } from '@playwright/test';
import { parseMoney, toCents } from '../utils/money';
import { AppShell } from './AppShell';

/** Una fila de la tabla tal como la ve el usuario. */
export interface TransactionRow {
  date: string; // texto crudo, ej. "16 Oct 2026, 10:23 pm"
  type: string; // "Ingreso" | "Salida"
  amount: number; // en centavos
  accounts: string; // "77-...-00 → 77-...-90"
  counterparty: string;
  description: string;
}

export class TransactionsPage extends AppShell {
  readonly directionSelect: Locator;
  readonly searchInput: Locator;
  readonly rows: Locator;
  readonly loading: Locator;

  constructor(page: Page) {
    super(page);
    // data-testid confirmados en la exploración (no están en todas las pantallas: acá sí).
    this.directionSelect = page.getByTestId('transactions-direction');
    this.searchInput = page.getByTestId('transactions-search');
    this.rows = page.locator('main table tbody tr');
    this.loading = page.getByText('Consultando movimientos...');
  }

  /** Abre la pantalla y espera la primera carga de datos. */
  async goto(): Promise<void> {
    const loaded = this.waitForTransactionsApi();
    await this.page.goto('/transactions');
    await loaded;
    await this.loading.waitFor({ state: 'hidden' });
  }

  private waitForTransactionsApi() {
    return this.page.waitForResponse((r) => r.url().includes('/api/transactions') && r.request().method() === 'GET');
  }

  /** Cambia el filtro de dirección y espera los datos nuevos. */
  async filterDirection(value: 'all' | 'incoming' | 'outgoing'): Promise<void> {
    const loaded = this.waitForTransactionsApi();
    await this.directionSelect.selectOption(value);
    await loaded;
    await this.loading.waitFor({ state: 'hidden' });
  }

  /**
   * Escribe en la búsqueda y espera la respuesta que corresponde a ESE texto.
   * (La búsqueda puede disparar varias llamadas mientras se escribe; nos interesa la última.)
   */
  async search(text: string): Promise<void> {
    const expected = encodeURIComponent(text).replace(/%20/g, '+');
    const loaded = this.page.waitForResponse((r) => {
      if (!r.url().includes('/api/transactions')) return false;
      const query = new URL(r.url()).searchParams.get('query') ?? '';
      return query === text || r.url().includes(`query=${expected}`);
    });
    await this.searchInput.fill(text);
    await loaded;
    await this.loading.waitFor({ state: 'hidden' });
  }

  /** Lee todas las filas visibles de la tabla. */
  async readRows(): Promise<TransactionRow[]> {
    const count = await this.rows.count();
    const result: TransactionRow[] = [];
    for (let i = 0; i < count; i++) {
      const cells = await this.rows.nth(i).locator('td').allInnerTexts();
      result.push({
        date: cells[0]?.trim() ?? '',
        type: cells[1]?.trim() ?? '',
        amount: toCents(parseMoney(cells[2] ?? '')),
        accounts: cells[3]?.trim() ?? '',
        counterparty: cells[4]?.trim() ?? '',
        description: cells[5]?.trim() ?? '',
      });
    }
    return result;
  }

  /** Fila(s) cuya descripción coincide exactamente con la nota. */
  rowsWithNote(note: string): Locator {
    return this.rows.filter({ hasText: note });
  }
}
