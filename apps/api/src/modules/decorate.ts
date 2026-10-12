import { classifyRecurrence, deriveStatus, statusLabel, weekdayShort, type Kind } from '@fin/domain';

/** Acrescenta os campos derivados que a interface exibe em cada linha. */
export function decorateTransactions<T extends Record<string, any>>(rows: T[], today: string) {
  return rows.map((t) => {
    const status = deriveStatus(t as any, today);
    const day = t.card_id ? t.occurred_on : (t.paid_on ?? t.due_on ?? t.occurred_on);
    return {
      ...t,
      amount_cents: Number(t.amount_cents),
      display_status: status,
      status_label: statusLabel(status, t.kind as Kind),
      classification: classifyRecurrence(t),
      installment_label: t.plan_id ? `${t.installment_no}/${t.plan_installments ?? '?'}` : null,
      display_date: day,
      weekday: weekdayShort(day),
    };
  });
}
