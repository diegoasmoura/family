import { addMonths, dateInMonth, monthOf, type ISODate, type Month } from './dates';
import type { Cents } from './money';

export interface CardCycleConfig {
  closing_day: number;
  due_day: number;
}

export interface InvoiceCycle {
  reference_month: Month;
  closing_date: ISODate;
  due_date: ISODate;
}

/** Mês em que a fatura fecha, dado o mês em que vence (reference_month). */
function closingMonthFor(card: CardCycleConfig, referenceMonth: Month): Month {
  return card.due_day > card.closing_day ? referenceMonth : addMonths(referenceMonth, -1);
}

export function cycleForReference(card: CardCycleConfig, referenceMonth: Month): InvoiceCycle {
  return {
    reference_month: referenceMonth,
    closing_date: dateInMonth(closingMonthFor(card, referenceMonth), card.closing_day),
    due_date: dateInMonth(referenceMonth, card.due_day),
  };
}

/**
 * Fatura de uma compra. Compras até a véspera do fechamento entram na
 * fatura que fecha neste mês; no dia do fechamento ou depois, na seguinte.
 */
export function invoiceForPurchase(card: CardCycleConfig, purchaseDate: ISODate): InvoiceCycle {
  const month = monthOf(purchaseDate);
  const closingThisMonth = dateInMonth(month, card.closing_day);
  const closingMonth = purchaseDate < closingThisMonth ? month : addMonths(month, 1);
  const referenceMonth = card.due_day > card.closing_day ? closingMonth : addMonths(closingMonth, 1);
  return cycleForReference(card, referenceMonth);
}

/**
 * Data de uma ocorrência recorrente no cartão que cai na fatura `referenceMonth`.
 * Usa o dia configurado dentro do ciclo dessa fatura.
 */
export function recurringChargeDate(card: CardCycleConfig, referenceMonth: Month, day: number): ISODate {
  const cycle = cycleForReference(card, referenceMonth);
  const closingMonth = monthOf(cycle.closing_date);
  for (const m of [closingMonth, addMonths(closingMonth, -1)]) {
    const candidate = dateInMonth(m, day);
    if (invoiceForPurchase(card, candidate).reference_month === referenceMonth) return candidate;
  }
  const [y, mo, d] = cycle.closing_date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d - 1)).toISOString().slice(0, 10);
}

export type InvoiceState = 'future' | 'open' | 'closed' | 'overdue' | 'paid';

export interface InvoiceTotals {
  id: number | null;
  reference_month: Month;
  closing_date: ISODate;
  due_date: ISODate;
  total_cents: Cents;
  paid_cents: Cents;
}

export interface InvoiceBalance extends InvoiceTotals {
  credit_in_cents: Cents;
  due_cents: Cents;
  remaining_cents: Cents;
  credit_out_cents: Cents;
  state: InvoiceState;
}

/**
 * Saldo de cada fatura em ordem de vencimento. O que foi pago além do devido
 * vira crédito e abate a fatura seguinte; nunca vira receita.
 */
export function computeInvoiceBalances(invoices: InvoiceTotals[], today: ISODate): InvoiceBalance[] {
  const sorted = [...invoices].sort((a, b) => a.reference_month.localeCompare(b.reference_month));
  let credit = 0;
  let openAssigned = false;
  return sorted.map((inv) => {
    const creditIn = credit;
    const due = Math.max(0, inv.total_cents - creditIn);
    const remaining = Math.max(0, due - inv.paid_cents);
    credit = Math.max(0, inv.paid_cents + creditIn - inv.total_cents);
    let state: InvoiceState;
    if (today < inv.closing_date) {
      state = openAssigned ? 'future' : 'open';
      openAssigned = true;
    } else if (remaining === 0) state = 'paid';
    else if (today > inv.due_date) state = 'overdue';
    else state = 'closed';
    return { ...inv, credit_in_cents: creditIn, due_cents: due, remaining_cents: remaining, credit_out_cents: credit, state };
  });
}

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = {
  future: 'Futura',
  open: 'Aberta',
  closed: 'Fechada',
  overdue: 'Atrasada',
  paid: 'Paga',
};

/**
 * Limite comprometido = compras efetivadas no cartão ainda não liberadas
 * por pagamento. Pagamento libera limite na hora, até o comprometido.
 */
export function cardLimit(limitCents: Cents | null, postedPurchasesCents: Cents, paymentsCents: Cents) {
  const committed = Math.max(0, postedPurchasesCents - paymentsCents);
  const limit = limitCents ?? 0;
  return {
    limit_cents: limit,
    committed_cents: committed,
    available_cents: Math.max(0, limit - committed),
    used_ratio: limit > 0 ? Math.min(1, committed / limit) : 0,
  };
}
