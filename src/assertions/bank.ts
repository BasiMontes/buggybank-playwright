/**
 * bank.ts — Aserciones reutilizables "de negocio".
 *
 * La idea es que los tests digan QUÉ se espera ("los saldos cambiaron así", "no pasó
 * nada"), y que el CÓMO (comparar centavos, buscar el movimiento por nota) quede aquí.
 *
 * ¿Por qué `expect.soft`?
 * Un `expect` normal corta el test en el primer fallo. Un `expect.soft` registra el fallo
 * y SIGUE. En una transferencia queremos conocer TODOS los oráculos a la vez:
 * "¿falló el débito, el crédito, el total o el movimiento?". Con soft asserts, el reporte
 * muestra la lista completa, que es justamente lo que vamos a explicar en la Charla.
 * El test igual termina en rojo si alguna soft assertion falla.
 */
import { expect } from '@playwright/test';
import { BuggyBankApi } from '../api/BuggyBankApi';
import { BalanceSnapshot } from '../api/types';
import { fmt, fromCents, hasMoreThanTwoDecimals } from '../utils/money';

/**
 * Verifica que cada saldo cambió EXACTAMENTE lo esperado (en centavos) y que el total
 * del banco se conservó (en una transferencia entre cuentas propias no se crea ni se
 * destruye dinero).
 */
export function expectBalanceDelta(
  before: BalanceSnapshot,
  after: BalanceSnapshot,
  expectedDelta: { CHECKING: number; SAVINGS: number },
): void {
  expect
    .soft(after.CHECKING - before.CHECKING, `CHECKING debía variar ${fmt(fromCents(expectedDelta.CHECKING))}`)
    .toBe(expectedDelta.CHECKING);
  expect
    .soft(after.SAVINGS - before.SAVINGS, `SAVINGS debía variar ${fmt(fromCents(expectedDelta.SAVINGS))}`)
    .toBe(expectedDelta.SAVINGS);
  expect.soft(after.total, 'El total del banco no debe cambiar en una transferencia entre cuentas propias').toBe(before.total);
}

/**
 * Verifica que los saldos que devuelve la API tienen como máximo 2 decimales.
 * Atrapa errores de punto flotante (BUG-08) y montos de 3 decimales persistidos (BUG-07).
 */
export async function expectCleanBalances(api: BuggyBankApi): Promise<void> {
  const dashboard = await api.getDashboard();
  for (const account of dashboard.accounts) {
    expect
      .soft(hasMoreThanTwoDecimals(account.balance), `El saldo de ${account.type} (${account.balance}) tiene más de 2 decimales`)
      .toBe(false);
  }
}

/**
 * "No pasó nada": saldos idénticos y ningún movimiento con la nota de la prueba.
 * Es el oráculo de TODOS los casos de rechazo. Un mensaje de error en pantalla con
 * dinero movido igual es un bug, y esta función lo detecta.
 */
export async function expectNoSideEffects(api: BuggyBankApi, before: BalanceSnapshot, note: string): Promise<void> {
  const after = await api.snapshotBalances();
  expect.soft(after.CHECKING, 'CHECKING no debía cambiar').toBe(before.CHECKING);
  expect.soft(after.SAVINGS, 'SAVINGS no debía cambiar').toBe(before.SAVINGS);
  const movements = await api.findTransactionsByNote(note);
  expect.soft(movements, `No debía registrarse ningún movimiento con la nota "${note}"`).toHaveLength(0);
}
