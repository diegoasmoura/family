import { lastDayOfMonth, type ISODate, type Month } from './dates';
import type { Cents } from './money';

export type MovementSource = 'income' | 'expense' | 'invoice_payment' | 'invoice_due' | 'transfer_in' | 'transfer_out' | 'balance_adjustment';

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

export interface MonthClosing {
  month: Month;
  closing_cents: Cents;
}

/**
 * Cada correção vira a diferença que falta para o saldo previsto fechar
 * no valor informado, no último dia daquele mês. Meses seguintes enxergam
 * as correções anteriores. Não é receita nem despesa.
 */
export function closingAdjustments(account: AccountOpening, movements: Movement[], closings: MonthClosing[], today: ISODate): Movement[] {
  const extra: Movement[] = [];
  for (const closing of [...closings].sort((a, b) => a.month.localeCompare(b.month))) {
    const date = lastDayOfMonth(closing.month);
    if (date < account.initial_balance_on) continue;
    const forecast = forecastBalance(account, [...movements, ...extra], today, date);
    const delta = closing.closing_cents - forecast;
    if (delta === 0) continue;
    extra.push({ date, signed_cents: delta, realized: date <= today, source: 'balance_adjustment' });
  }
  return extra;
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

/** O que entrou e saiu de uma conta dentro de um mês, sem carregar o saldo dos meses anteriores. */
export interface MonthFlow {
  /** Já efetivado no mês. */
  in_cents: Cents;
  out_cents: Cents;
  /** Ainda previsto no mês (a receber / a pagar, faturas em aberto). */
  planned_in_cents: Cents;
  planned_out_cents: Cents;
}

/**
 * Fluxo do mês: soma só os movimentos com data dentro de `month`. Saldo inicial, correção de fim
 * de mês e o que veio antes não entram. `skip` tira fontes da soma (ex.: transferências no total da casa).
 */
export function monthFlow(movements: Movement[], month: Month, skip: MovementSource[] = []): MonthFlow {
  const flow: MonthFlow = { in_cents: 0, out_cents: 0, planned_in_cents: 0, planned_out_cents: 0 };
  const from = `${month}-01`;
  const to = lastDayOfMonth(month);
  for (const m of movements) {
    if (m.source === 'balance_adjustment' || skip.includes(m.source)) continue;
    if (m.date < from || m.date > to) continue;
    if (m.realized) {
      if (m.signed_cents >= 0) flow.in_cents += m.signed_cents;
      else flow.out_cents -= m.signed_cents;
    } else if (m.signed_cents >= 0) flow.planned_in_cents += m.signed_cents;
    else flow.planned_out_cents -= m.signed_cents;
  }
  return flow;
}
