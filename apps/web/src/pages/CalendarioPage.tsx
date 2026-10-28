import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, addMonths, daysInMonth } from '@fin/domain';
import { useSwipe } from '../useSwipe';
import { useApi, type Tx } from '../api';
import { PersonFilter, personParam } from '../people';
import { useAppState } from '../state';
import { TxSheet } from '../TxSheet';
import { BackButton, ErrorText, Loading, MonthNav, Sheet, brl, dayLabel } from '../ui';

interface CalItem {
  key: string;
  day: string;
  description: string;
  amount_cents: number;
  kind: 'income' | 'expense' | 'invoice';
  status: 'paid' | 'planned';
  who: 'me' | 'other' | 'house';
  for_user_id: number | null;
  tx_id?: number;
  card_id?: number;
  reference_month?: string;
}

interface Calendar {
  month: string;
  people: { id: number; name: string; color: string; me: boolean }[];
  items: CalItem[];
}

const WEEK = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function mondayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function CalendarioPage() {
  const { month, setMonth, today, person } = useAppState();
  const [day, setDay] = useState<string | null>(null);
  const [txId, setTxId] = useState<number | null>(null);
  const cal = useApi<Calendar>(`/calendar?month=${month}&person=${personParam(person)}`);
  const tx = useApi<Tx>(txId ? `/transactions/${txId}` : null);
  const swipe = useSwipe(() => { setMonth(addMonths(month, -1)); setDay(null); }, () => { setMonth(addMonths(month, 1)); setDay(null); });
  const data = cal.data;
  const days = data ? daysInMonth(month) : 0;
  const lead = data ? mondayIndex(`${month}-01`) : 0;
  const byDay = new Map<string, CalItem[]>();
  for (const item of data?.items ?? []) {
    const list = byDay.get(item.day) ?? [];
    list.push(item);
    byDay.set(item.day, list);
  }
  const openDay = day ? (byDay.get(day) ?? []) : [];
  const colorOf = (item: CalItem) => {
    if (item.who === 'house') return 'var(--muted)';
    return data?.people.find((p) => p.id === item.for_user_id)?.color ?? 'var(--muted)';
  };
  const labelOf = (item: CalItem) => {
    if (item.who === 'house') return 'Da casa';
    if (item.who === 'me') return 'Você';
    const name = data?.people.find((p) => p.id === item.for_user_id)?.name;
    return name ? firstName(name) : 'Outra pessoa';
  };
  const items = data?.items ?? [];
  const late = new Set(items.filter((i) => i.status === 'planned' && i.day < today).map((i) => i.day));
  const soon = month === today.slice(0, 7)
    ? items.filter((i) => i.status === 'planned' && i.day >= today && i.day <= addDays(today, 7)).sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key))
    : [];

  return (
    <main className="page calendar" {...swipe}>
      <div className="hd">
        <div className="title-row">
          <BackButton fallback="/" />
          <h1>Calendário</h1>
        </div>
      </div>
      <MonthNav month={month} onChange={(m) => { setMonth(m); setDay(null); }} />
      <PersonFilter />
      <ErrorText error={cal.error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="cal" aria-label="Dias do mês">
          {WEEK.map((w) => (
            <span key={w} className="cal-wd">{w}</span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, '0')}`;
            const items = byDay.get(date) ?? [];
            const dots = new Map<string, string>();
            for (const item of items) dots.set(item.who === 'house' ? 'house' : String(item.for_user_id), colorOf(item));
            return (
              <button
                key={date}
                type="button"
                className={`cal-day${date === today ? ' today' : ''}${late.has(date) ? ' late' : ''}`}
                onClick={() => setDay(date)}
              >
                <span>{i + 1}</span>
                <span className="cal-dots">
                  {[...dots.values()].map((color, index) => (
                    <i key={index} style={{ background: color }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {soon.length > 0 && (
        <section className="card">
          <h2>Próximos 7 dias</h2>
          <div className="list">
            {soon.map((item) => (
              <button key={item.key} type="button" className="r" style={{ minHeight: 52 }} onClick={() => setDay(item.day)}>
                <i className="cal-who" style={{ background: colorOf(item) }} />
                <div className="m">
                  <span className="t">{item.description}</span>
                  <small>{dayLabel(item.day)} · {labelOf(item)}</small>
                </div>
                <b className={`num${item.kind === 'income' ? ' pos' : ''}`}>{brl(item.amount_cents)}</b>
              </button>
            ))}
          </div>
        </section>
      )}

      {day && (
        <Sheet title={dayLabel(day)} onClose={() => setDay(null)}>
          {openDay.length === 0 && <p className="empty">Nada neste dia.</p>}
          <div className="list">
            {openDay.map((item) => (
              <div key={item.key} className="r">
                <i className="cal-who" style={{ background: colorOf(item) }} />
                <div className="m">
                  <span className="t">{item.description}</span>
                  <small>
                    {labelOf(item)}
                    {' · '}
                    {item.status === 'paid' ? 'Pago' : 'Previsto'}
                  </small>
                </div>
                <b className={`num${item.kind === 'income' ? ' pos' : ''}`}>{brl(item.amount_cents)}</b>
                {item.tx_id != null && (
                  <button className="btn sm" type="button" onClick={() => { setTxId(item.tx_id!); setDay(null); }}>
                    Abrir
                  </button>
                )}
                {item.kind === 'invoice' && item.card_id != null && (
                  <Link className="btn sm" to={`/cartoes?card=${item.card_id}&mes=${item.reference_month}`}>
                    Fatura
                  </Link>
                )}
              </div>
            ))}
          </div>
        </Sheet>
      )}
      {tx.data && <TxSheet tx={tx.data} onClose={() => setTxId(null)} />}
      {txId && tx.error && <ErrorText error={tx.error} />}
    </main>
  );
}
