import { addMonths, MONTHS_SHORT_PT, monthOf } from '@fin/domain';
import { Bar, BarChart, ResponsiveContainer, XAxis } from 'recharts';

export type HistoryPoint = { month: string; planned_cents: number; paid_cents: number };

export function monthsBack(today: string, count = 6) {
  const end = monthOf(today);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) months.push(addMonths(end, -i));
  return months;
}

type SeriesRow = {
  competence_month: string;
  amount_cents: number;
  paid_on: string | null;
  card_id: number | null;
  deleted_at?: string | null;
};

/** Parcelas do plano nos últimos 6 meses. No cartão, mês já chegado conta como pago. */
export function historyFromInstallments(items: SeriesRow[], today: string): HistoryPoint[] {
  const current = monthOf(today);
  return monthsBack(today).map((month) => {
    const rows = items.filter((item) => !item.deleted_at && item.competence_month === month);
    const planned_cents = rows.reduce((sum, item) => sum + Number(item.amount_cents), 0);
    const paid_cents = rows.reduce((sum, item) => {
      const settled = item.card_id ? item.competence_month <= current : Boolean(item.paid_on);
      return sum + (settled ? Number(item.amount_cents) : 0);
    }, 0);
    return { month, planned_cents, paid_cents };
  });
}

export function HistoryChart({ points }: { points: HistoryPoint[] }) {
  const data = points.map((point) => ({
    label: MONTHS_SHORT_PT[Number(point.month.slice(5, 7)) - 1],
    paid_cents: point.paid_cents,
    open_cents: Math.max(0, point.planned_cents - point.paid_cents),
  }));
  const summary = data.map((row) => `${row.label}, ${row.paid_cents} de ${row.paid_cents + row.open_cents}`).join('. ');
  return (
    <section className="card history" aria-label={`Histórico dos últimos 6 meses. ${summary}`}>
      <b>Histórico</b>
      <div className="history-chart">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} barCategoryGap="30%">
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Bar dataKey="paid_cents" stackId="month" fill="var(--green)" maxBarSize={28} radius={[6, 6, 0, 0]} />
            <Bar dataKey="open_cents" stackId="month" fill="var(--line)" maxBarSize={28} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
