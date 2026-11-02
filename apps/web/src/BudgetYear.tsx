import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from './api';
import { CategoryIcon } from './categories';
import { Icon, Loading, brl } from './ui';

interface MonthCell {
  month: string;
  planned_cents: number | null;
  spent_cents: number;
}
interface BudgetItem {
  category_id: number;
  name: string;
  parent_id: number | null;
  color: string | null;
  months: MonthCell[];
  planned_cents: number;
  spent_cents: number;
}
interface BudgetYearData {
  year: number;
  planned_cents: number;
  spent_cents: number;
  items: BudgetItem[];
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const money = (cents: number) => <span className="money">{brl(cents)}</span>;
const level = (ratio: number) => (ratio >= 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok');
const levelText = (ratio: number) => (ratio >= 1 ? 'Passou' : ratio >= 0.8 ? 'Perto do limite' : 'Dentro');

/** Orçado x gasto efetivado no ano, por categoria. Mesma regra da tela Orçamento. */
export function BudgetYear({ year }: { year: number }) {
  const q = useApi<BudgetYearData>(`/budgets/year?year=${year}`);
  const [open, setOpen] = useState<number | null>(null);
  if (!q.data) return <Loading />;
  const d = q.data;
  if (d.items.length === 0) {
    return (
      <section className="card dashed">
        <b>Nenhum orçamento em {year}</b>
        <small>Defina o teto de cada categoria para comparar com o que foi gasto.</small>
        <Link className="btn" to="/orcamento">
          Definir orçamento
        </Link>
      </section>
    );
  }
  const ratio = d.planned_cents ? d.spent_cents / d.planned_cents : 0;
  const tone = ratio >= 1 ? 'neg' : 'pos';
  const left = d.planned_cents - d.spent_cents;
  const items = [...d.items].sort((a, b) => b.spent_cents / (b.planned_cents || 1) - a.spent_cents / (a.planned_cents || 1));
  return (
    <>
      <section className={`card sum-card ${tone}`} aria-label={`Orçado e gasto em ${year}`}>
        <div className="sum-top">
          <small>Orçado × gasto em {year}</small>
          <span className={`sum-pill ${tone}`}>
            {tone === 'neg' ? <Icon.alert /> : <Icon.check />}
            {ratio >= 1 ? 'Passou do orçado' : 'Dentro do orçado'}
          </span>
        </div>
        <div className="sum-hero">
          <small>{left >= 0 ? 'Ainda cabe no orçado' : 'Passou do orçado em'}</small>
          <div className="sum-amt">
            <span className="money">
              <span className="rs">R$</span> {brl(Math.abs(left)).replace('R$ ', '')}
            </span>
          </div>
        </div>
        <div className="by-meter" role="progressbar" aria-valuenow={Math.round(Math.min(1, ratio) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <i className={level(ratio)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
        <div className="sum-tiles">
          <div className="sum-tile out">
            <span className="sum-tile-hd">Gasto</span>
            <b>{money(d.spent_cents)}</b>
          </div>
          <div className="sum-tile">
            <span className="sum-tile-hd">Orçado</span>
            <b>{money(d.planned_cents)}</b>
          </div>
        </div>
      </section>

      <section className="card by-list" aria-label="Orçado por categoria">
        {items.map((it) => {
          const r = it.planned_cents ? it.spent_cents / it.planned_cents : 0;
          const expanded = open === it.category_id;
          return (
            <div key={it.category_id} className="by-item">
              <button type="button" className="by-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : it.category_id)}>
                <CategoryIcon cat={{ id: it.category_id, name: it.name, color: it.color, parent_id: it.parent_id }} size={36} />
                <span className="by-main">
                  <span className="by-title">
                    <b>{it.name}</b>
                    <small className={`by-tag ${level(r)}`}>{levelText(r)}</small>
                  </span>
                  <span className="by-meter sm">
                    <i className={level(r)} style={{ width: `${Math.min(100, r * 100)}%` }} />
                  </span>
                  <small>
                    {money(it.spent_cents)} de {money(it.planned_cents)} · {Math.round(r * 100)}%
                  </small>
                </span>
                <span className={`chev${expanded ? ' open' : ''}`} aria-hidden>
                  <Icon.right />
                </span>
              </button>
              {expanded && (
                <div className="by-months">
                  {it.months.map((m, i) =>
                    m.planned_cents == null && m.spent_cents === 0 ? null : (
                      <div key={m.month} className="by-month">
                        <span>{MONTHS[i]}</span>
                        <span className="by-meter sm">
                          <i className={level(m.planned_cents ? m.spent_cents / m.planned_cents : 0)} style={{ width: `${m.planned_cents ? Math.min(100, (m.spent_cents / m.planned_cents) * 100) : 0}%` }} />
                        </span>
                        <span className="num">
                          {m.planned_cents == null ? <>{money(m.spent_cents)} · sem orçamento</> : <>{money(m.spent_cents)} / {money(m.planned_cents)}</>}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
      <small className="by-note">O gasto conta só o que já foi efetivado (pago, ou na fatura do cartão). Cada categoria só entra nos meses em que tem orçamento.</small>
    </>
  );
}
