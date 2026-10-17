/**
 * types.ts — Forma de los datos que devuelve la API de BuggyBank.
 *
 * Estos tipos salen de la exploración (ver TEST_PLAN.md, sección 1): son lo que
 * OBSERVAMOS que devuelve la API, no una documentación oficial.
 * Tenerlos tipados ayuda a que el editor autocomplete y a que TypeScript avise si
 * escribimos mal un campo (ej. `ammount` en vez de `amount`).
 */

export type AccountType = 'CHECKING' | 'SAVINGS';

export interface Account {
  id: string; // ID interno (lo que espera POST /api/transfers)
  type: AccountType;
  accountNumber: string; // Ej: "77-7919-5418600-00" (lo que se ve en la UI)
  currency: string; // "NZD"
  balance: number;
}

/** GET /api/dashboard */
export interface Dashboard {
  user: { id: string; fullName: string; email: string; qaAccess: boolean };
  totalBalance: number;
  accounts: Account[]; // OJO: el orden NO es estable entre llamadas (ver BUGS.md, notas)
}

export type TransactionStatus = 'COMPLETED' | 'PENDING' | 'FAILED' | 'REVERSED' | 'CANCELLED';
export type Direction = 'incoming' | 'outgoing';

/** Un elemento de GET /api/transactions → { data: Transaction[] } */
export interface Transaction {
  id: string;
  createdAt: string; // ISO 8601, ej. "2026-10-17T21:20:49.497Z"
  amount: number;
  note: string;
  status: TransactionStatus;
  direction: Direction;
  fromAccountNumber: string;
  toAccountNumber: string;
  counterpartyName: string;
}

/** Cuerpo de POST /api/transfers. `amount` es `unknown` a propósito: las pruebas de API mandan texto, negativos, etc. */
export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: unknown;
  note: string;
}

export type PaymentStatus = 'SCHEDULED' | 'PENDING' | 'COMPLETED' | 'REVERSED';
export type PaymentAction = 'PROCESS' | 'REVERSE';

export interface PaymentEvent {
  id: string;
  fromStatus: PaymentStatus | null;
  status: PaymentStatus;
  actor: string; // "USER" | "PAYMENT_PROCESSOR"
  action: PaymentAction | null;
  idempotencyKey: string;
  occurredAt: string;
}

export interface Payment {
  id: string;
  beneficiary: string;
  amount: number;
  scheduledFor: string; // ISO
  reference: string;
  status: PaymentStatus;
  createdAt?: string;
  sourceAccount: Pick<Account, 'id' | 'type' | 'accountNumber' | 'currency'>;
  events?: PaymentEvent[]; // solo en el detalle (GET /api/payments/:id)
}

/** Cuerpo de POST /api/payments */
export interface PaymentRequest {
  beneficiary: string;
  sourceAccountId: string;
  amount: unknown;
  scheduledFor: string;
  reference: string;
}

/** GET/PUT /api/profile */
export interface Profile {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  preferredLanguage: string; // "es-NZ" | "en-NZ"
}

/** Saldos "congelados" en un momento, en centavos (ver utils/money.ts para el porqué). */
export interface BalanceSnapshot {
  CHECKING: number;
  SAVINGS: number;
  total: number; // totalBalance que informa la API, también en centavos
}
