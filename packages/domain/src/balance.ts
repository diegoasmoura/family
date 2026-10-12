import type { ISODate } from './dates';
import type { Cents } from './money';

export type MovementSource = 'income' | 'expense' | 'invoice_payment' | 'invoice_due' | 'transfer_in' | 'transfer_out';

/** Movimento de caixa de uma conta, já com sinal. */
export interface Movement {
  date: ISODate;
  signed_cents: Cents;
  realized: boolean;
  source: MovementSource;
}

export interface AccountOpening {
  initial_balance_cents: Cents;
  initial_balance_on: ISODate;
}

/**
 * Saldo atual: saldo inicial + tudo que já foi efetivado entre a data do
 * saldo inicial e hoje. Movimentos anteriores à data do saldo inicial já
 * estão contidos nele e são ignorados.
 */
export function currentBalance(account: AccountOpening, movements: Movement[], today: ISODate): Cents {
  let balance = account.initial_balance_cents;
  for (const m of movements) {
    if (m.realized && m.date >= account.initial_balance_on && m.date <= today) balance += m.signed_cents;
  }
  return balance;
}

/**
 * Saldo previsto até `horizon`: saldo atual + efetivados com data futura +
 * tudo que está planejado até o horizonte (inclusive o que já venceu e não
 * foi pago, porque continua sendo devido). Faturas a pagar entram como
 * `invoice_due` na conta de pagamento do cartão.
 */
export function forecastBalance(account: AccountOpening, movements: Movement[], today: ISODate, horizon: ISODate): Cents {
  let balance = currentBalance(account, movements, today);
  for (const m of movements) {
    if (m.date < account.initial_balance_on || m.date > horizon) continue;
    if (m.realized && m.date > today) balance += m.signed_cents;
    if (!m.realized) balance += m.signed_cents;
  }
  return balance;
}
