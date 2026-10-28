/**
 * BuggyBankApi.ts — Cliente de la API de BuggyBank.
 *
 * ¿Para qué usamos la API si las pruebas son de UI?
 * 1. PREPARAR datos rápido (login, crear un pago) sin pasar por pantallas que no son
 *    lo que estamos probando.
 * 2. VERIFICAR contra la fuente de verdad: después de transferir por la UI, preguntamos
 *    a la API los saldos y movimientos reales. Un mensaje "OK transfer" en pantalla no
 *    alcanza (lo dice el desafío): hay que comprobar débito, crédito y movimiento.
 * 3. PROBAR la API en sí (@api): reglas de negocio que la UI valida pero el backend no.
 *
 * Detalle importante: `APIRequestContext` de Playwright comparte cookies con el
 * navegador cuando se obtiene de `page.context().request`. Así, si hacemos login por
 * API, la página queda logueada también (la sesión de BuggyBank es una cookie httpOnly).
 */
import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { toCents } from '../utils/money';
import {
  Account,
  AccountType,
  BalanceSnapshot,
  Dashboard,
  Payment,
  PaymentAction,
  PaymentRequest,
  Profile,
  Transaction,
  TransferRequest,
} from './types';

export class BuggyBankApi {
  constructor(private readonly request: APIRequestContext) {}

  // ---------------------------------------------------------------------------
  // Autenticación
  // ---------------------------------------------------------------------------

  /**
   * POST /api/auth/login { email, password }.
   * Devuelve la respuesta cruda para que los tests de login puedan inspeccionar status y mensaje.
   * Si sale bien, el servidor setea la cookie de sesión en este request context.
   */
  async login(email: string, password: string): Promise<APIResponse> {
    return this.request.post('/api/auth/login', { data: { email, password } });
  }

  /**
   * Login que DEBE funcionar (precondición de casi todos los tests).
   * Si falla, cortamos con un mensaje que apunta a la causa más probable: el sandbox ha caducado.
   */
  async loginOrFail(email: string, password: string): Promise<void> {
    const res = await this.login(email, password);
    expect(
      res.ok(),
      `El login por API falló (${res.status()}). ¿Ha caducado el sandbox de 24 h? Crea uno nuevo y actualiza el .env.`,
    ).toBeTruthy();
  }

  async logout(): Promise<APIResponse> {
    return this.request.post('/api/auth/logout');
  }

  // ---------------------------------------------------------------------------
  // Cuentas y saldos
  // ---------------------------------------------------------------------------

  /** GET /api/dashboard ya parseado. */
  async getDashboard(): Promise<Dashboard> {
    const res = await this.request.get('/api/dashboard');
    expect(res.ok(), `GET /api/dashboard respondió ${res.status()}`).toBeTruthy();
    return (await res.json()) as Dashboard;
  }

  /**
   * Devuelve las dos cuentas indexadas por tipo.
   * ¿Por qué por tipo y no `accounts[0]`? Porque descubrimos que el ORDEN del array
   * cambia entre llamadas. Usar el índice haría que a veces leamos la cuenta equivocada.
   */
  async getAccounts(): Promise<Record<AccountType, Account>> {
    const { accounts } = await this.getDashboard();
    const find = (type: AccountType): Account => {
      const account = accounts.find((a) => a.type === type);
      if (!account) throw new Error(`No se encontró la cuenta ${type} en /api/dashboard`);
      return account;
    };
    return { CHECKING: find('CHECKING'), SAVINGS: find('SAVINGS') };
  }

  /**
   * "Foto" de los saldos en centavos.
   * Se toma una ANTES y otra DESPUÉS de la acción, y se comparan las diferencias.
   * Esto es lo que hace que las pruebas no dependan de los datos semilla.
   */
  async snapshotBalances(): Promise<BalanceSnapshot> {
    const dashboard = await this.getDashboard();
    const byType = (type: AccountType) => dashboard.accounts.find((a) => a.type === type)!.balance;
    return {
      CHECKING: toCents(byType('CHECKING')),
      SAVINGS: toCents(byType('SAVINGS')),
      total: toCents(dashboard.totalBalance),
    };
  }

  // ---------------------------------------------------------------------------
  // Transferencias y movimientos
  // ---------------------------------------------------------------------------

  /** POST /api/transfers. Devuelve la respuesta cruda: los tests deciden qué esperar. */
  async transfer(body: TransferRequest): Promise<APIResponse> {
    return this.request.post('/api/transfers', { data: body });
  }

  /**
   * GET /api/transactions?direction=&query=
   * @param direction 'all' | 'incoming' | 'outgoing'
   * @param query texto a buscar en nota o número de cuenta
   */
  async getTransactions(direction: 'all' | 'incoming' | 'outgoing' = 'all', query = ''): Promise<Transaction[]> {
    const res = await this.request.get('/api/transactions', { params: { direction, query } });
    expect(res.ok(), `GET /api/transactions respondió ${res.status()}`).toBeTruthy();
    const json = await res.json();
    return (json.data ?? json) as Transaction[];
  }

  /**
   * Busca los movimientos que tengan EXACTAMENTE esta nota.
   * Filtramos del lado del test (además de la búsqueda del servidor) porque la búsqueda
   * de la app tiene bugs (BUG-12, BUG-13): no queremos que un bug de búsqueda haga
   * fallar una prueba de transferencias.
   */
  async findTransactionsByNote(note: string): Promise<Transaction[]> {
    const all = await this.getTransactions('all', '');
    return all.filter((t) => t.note === note);
  }

  /**
   * LIMPIEZA: deja el saldo de CHECKING como estaba al empezar el test.
   *
   * Como todas las operaciones son entre las dos cuentas propias, el total no cambia:
   * si CHECKING vuelve a su valor original, SAVINGS también. Movemos la diferencia en el
   * sentido que corresponda.
   *
   * Usamos 3 decimales (y no centavos) a propósito: si un bug dejó un saldo como
   * 6535.625 (BUG-07), queremos devolverlo exactamente a 6500.000.
   *
   * Nunca hace fallar el test. Devuelve `true` si el saldo quedó como estaba y `false` si
   * no: el fixture lo convierte en un aviso visible en el informe.
   */
  async restoreCheckingBalance(targetChecking: number): Promise<boolean> {
    try {
      const now = await this.getAccounts();
      const diff = Math.round((targetChecking - now.CHECKING.balance) * 1000) / 1000;
      if (diff === 0) return true;
      const [from, to] = diff > 0 ? [now.SAVINGS, now.CHECKING] : [now.CHECKING, now.SAVINGS];
      const res = await this.transfer({
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: Math.abs(diff),
        note: 'QA-teardown restore',
      });
      if (!res.ok()) {
        console.warn(`[teardown] No se pudo restaurar el saldo (${res.status()})`);
        return false;
      }
      // Comprobamos que la restauración ha funcionado: una transferencia de limpieza también
      // puede verse afectada por un bug de la app (pasó con BUG-24, que la duplicó).
      const after = await this.getAccounts();
      return Math.abs(after.CHECKING.balance - targetChecking) < 0.0005;
    } catch (error) {
      console.warn(`[teardown] Restauración omitida: ${(error as Error).message.split('\n')[0]}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Pagos
  // ---------------------------------------------------------------------------

  async getPayments(): Promise<Payment[]> {
    const res = await this.request.get('/api/payments');
    expect(res.ok(), `GET /api/payments respondió ${res.status()}`).toBeTruthy();
    const json = await res.json();
    return (json.data ?? json) as Payment[];
  }

  async getPayment(id: string): Promise<Payment> {
    const res = await this.request.get(`/api/payments/${id}`);
    expect(res.ok(), `GET /api/payments/${id} respondió ${res.status()}`).toBeTruthy();
    const json = await res.json();
    return (json.data ?? json) as Payment;
  }

  /** POST /api/payments. Respuesta cruda. */
  async createPaymentRaw(body: PaymentRequest): Promise<APIResponse> {
    return this.request.post('/api/payments', { data: body });
  }

  /** Crea un pago que DEBE crearse (preparación de datos) y devuelve el objeto. */
  async createPayment(body: PaymentRequest): Promise<Payment> {
    const res = await this.createPaymentRaw(body);
    expect(res.status(), `No se pudo crear el pago de prueba: ${await res.text()}`).toBe(201);
    const json = await res.json();
    return (json.data ?? json) as Payment;
  }

  /**
   * POST /api/payments/:id/transitions { action, idempotencyKey }.
   * La "clave de idempotencia" identifica una intención: si mandas la misma clave dos
   * veces, el servidor debería aplicar el cambio una sola vez.
   */
  async transition(id: string, action: PaymentAction, idempotencyKey: string): Promise<APIResponse> {
    return this.request.post(`/api/payments/${id}/transitions`, { data: { action, idempotencyKey } });
  }

  // ---------------------------------------------------------------------------
  // Perfil
  // ---------------------------------------------------------------------------

  async getProfile(): Promise<Profile> {
    const res = await this.request.get('/api/profile');
    expect(res.ok(), `GET /api/profile respondió ${res.status()}`).toBeTruthy();
    return (await res.json()) as Profile;
  }

  async updateProfile(profile: Profile): Promise<APIResponse> {
    return this.request.put('/api/profile', { data: profile });
  }
}
