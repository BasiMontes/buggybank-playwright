/**
 * DashboardPage.ts — Pantalla /dashboard.
 *
 * Esta pantalla NO tiene data-testid, así que leemos el texto visible.
 * Lo que muestra (observado en la exploración):
 *
 *   Hola, Temporary Tester
 *   Resumen consolidado
 *   $10,000.00
 *   Saldo total disponible
 *   CHECKING account
 *   77-7919-5418600-00
 *   $6,500.00
 *   SAVINGS account
 *   ...
 *
 * Por eso parseamos línea por línea: el total es el monto que está justo ANTES de
 * "Saldo total disponible", y el saldo de cada cuenta es el primer monto DESPUÉS de
 * "<TIPO> account".
 */
import { Locator, Page } from '@playwright/test';
import { AccountType } from '../api/types';
import { parseMoney, toCents } from '../utils/money';
import { AppShell } from './AppShell';

const MONEY_LINE = /^-?\$-?[\d,]+\.\d+$/;

export interface DashboardBalances {
  total: number; // en centavos
  CHECKING: number; // en centavos
  SAVINGS: number; // en centavos
}

export class DashboardPage extends AppShell {
  readonly main: Locator;
  readonly totalLabel: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.totalLabel = page.getByText('Saldo total disponible');
  }

  async goto(): Promise<void> {
    await this.page.goto('/dashboard');
    // Esperamos a que aparezca el total: ahí sabemos que los datos ya cargaron.
    await this.totalLabel.waitFor();
  }

  /** Lee el total y el saldo de cada cuenta tal como los ve el usuario, en centavos. */
  async readBalances(): Promise<DashboardBalances> {
    const lines = (await this.main.innerText())
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Total: el monto inmediatamente anterior a la etiqueta.
    const labelIndex = lines.indexOf('Saldo total disponible');
    if (labelIndex < 1) throw new Error('No se encontró "Saldo total disponible" en el dashboard');
    const total = toCents(parseMoney(lines[labelIndex - 1]));

    // Cuentas: el primer monto después de "<TIPO> account".
    const accountBalance = (type: AccountType): number => {
      const start = lines.findIndex((l) => l.toUpperCase() === `${type} ACCOUNT`);
      if (start < 0) throw new Error(`No se encontró la card "${type} account" en el dashboard`);
      const moneyLine = lines.slice(start + 1).find((l) => MONEY_LINE.test(l));
      if (!moneyLine) throw new Error(`No se encontró el saldo de ${type} en el dashboard`);
      return toCents(parseMoney(moneyLine));
    };

    return { total, CHECKING: accountBalance('CHECKING'), SAVINGS: accountBalance('SAVINGS') };
  }
}
