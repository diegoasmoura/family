import { diffDays, type ISODate } from './dates';

export type Kind = 'income' | 'expense';
export type DisplayStatus = 'paid' | 'overdue' | 'near' | 'planned' | 'card';
export type RecurrenceClass = 'fixed' | 'installment' | 'variable';

/** Dias até o vencimento para considerar "Próximo". */
export const NEAR_DAYS = 7;

export interface StatusInput {
  card_id?: number | null;
  paid_on?: string | null;
  due_on?: string | null;
  occurred_on: string;
  /** Vencimento da fatura. Enquanto ela não é paga, a compra usa o relógio. */
  invoice_due_on?: string | null;
  invoice_paid?: boolean | number | null;
}

/**
 * Status exibido, sempre derivado das datas (nunca salvo como texto).
 * Compra no cartão segue o vencimento da fatura: relógio até ela ser paga,
 * e pago quando a fatura quita tudo que está dentro.
 */
export function deriveStatus(tx: StatusInput, today: ISODate): DisplayStatus {
  if (tx.card_id) {
    if (tx.invoice_paid) return 'paid';
    return byDue(tx.invoice_due_on ?? tx.due_on ?? tx.occurred_on, today);
  }
  if (tx.paid_on) return 'paid';
  return byDue(tx.due_on ?? tx.occurred_on, today);
}

function byDue(due: ISODate, today: ISODate): DisplayStatus {
  const days = diffDays(due, today);
  if (days < 0) return 'overdue';
  if (days <= NEAR_DAYS) return 'near';
  return 'planned';
}

export function statusLabel(status: DisplayStatus, kind: Kind): string {
  const income = kind === 'income';
  switch (status) {
    case 'paid':
      return income ? 'Recebido' : 'Pago';
    case 'overdue':
      return income ? 'Vencida' : 'Atrasado';
    case 'near':
      return 'Próximo';
    case 'planned':
      return 'Previsto';
    case 'card':
      return 'Cartão';
  }
}

export function classifyRecurrence(tx: { recurrence_id?: number | null; plan_id?: number | null }): RecurrenceClass {
  if (tx.plan_id) return 'installment';
  if (tx.recurrence_id) return 'fixed';
  return 'variable';
}
