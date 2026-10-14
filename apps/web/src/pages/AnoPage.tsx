import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { MONTHS_SHORT_PT, formatBRL, yearOf } from '@fin/domain';
import { useApi, type Tx } from '../api';
import { CategoryIcon } from '../categories';
import { PersonFilter, personParam } from '../people';
import { useAppState } from '../state';
import { TxSheet } from '../TxSheet';
import { BankMark, bankByName } from '../banks';
import { ErrorText, Icon, Loading, Seg, Sheet, StatusIcon, shortDate } from '../ui';

interface Row {
  category_id: number | null;
  name: string;
  icon: string | null;
  color: string | null;
  months: number[];
  paid_months?: number[];
  total_cents: number;
  card_name: string | null;
  children?: Row[];
  items?: { key: string; name: string; fixed: boolean; card_name: string | null; months: number[]; paid_months?: number[]; total_cents: number }[];
}

type Kind = 'income' | 'expense';
interface AuditFilter {
  kind: Kind;
  category?: number | 'none';
  tree?: '0' | '1';
  item?: string;
  title: string;
}
type Audit = AuditFilter & { month?: number };

const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const cell = (cents: number) => (cents === 0 ? '–' : formatBRL(cents));

function filterOf(r: Row, kind: Kind, depth: number): AuditFilter {
  return { kind, category: r.category_id ?? 'none', tree: depth === 0 ? '1' : '0', title: r.name };
}

/** Lista os lançamentos que formam um valor da tabela. */
function AuditSheet({ audit, year, mode, person, onClose, onTx }: { audit: Audit; year: number; mode: string; person: string; onClose: () => void; onTx: (t: Tx) => void }) {
  const params = new URLSearchParams({ year: String(year), mode, kind: audit.kind, person });
  if (audit.month) params.set('month', String(audit.month));
  if (audit.category != null) params.set('category', String(audit.category));
  if (audit.tree) params.set('tree', audit.tree);
  if (audit.item) params.set('item', audit.item);
  const q = useApi<{ transactions: Tx[]; total_cents: number }>(`/reports/year/transactions?${params}`);
  return (
    <Sheet title={audit.title} onClose={onClose}>
      {!q.data ? (
        <Loading />
      ) : (
        <>
          <div className="kv">
            <span>
              {q.data.transactions.length} {q.data.transactions.length === 1 ? 'lançamento' : 'lançamentos'}
            </span>
            <b className="num">{formatBRL(q.data.total_cents)}</b>
          </div>
          <div className="list">
            {q.data.transactions.map((t) => (
              <button key={t.id} className="r" style={{ minHeight: 60 }} onClick={() => onTx(t)}>
                <StatusIcon status={t.display_status} />
                <div className="m">
                  <span className="t">
                    {t.description || t.category_name || (t.kind === 'income' ? 'Receita' : 'Despesa')}
                    {t.installment_label ? ` ${t.installment_label}` : ''}
                  </span>
                  <small>
                    {shortDate(t.occurred_on)} · {t.card_name ?? t.account_name}
                    {t.category_name ? ` · ${t.parent_category_name ? `${t.parent_category_name} › ` : ''}${t.category_name}` : ''}
                    {t.recurrence_id ? ' · fixa' : ''}
                  </small>
                </div>
                <div className="v">
                  <span className="num">{formatBRL(t.amount_cents)}</span>
                  <small>{t.status_label}</small>
                </div>
              </button>
            ))}
          </div>
          <small>Toque num lançamento para conferir ou editar.</small>
        </>
      )}
    </Sheet>
  );
}

export function AnoPage() {
  const { today, person } = useAppState();
  const [year, setYear] = useState(yearOf(today));
  const [mode, setMode] = useState<'realized' | 'planned'>('realized');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [audit, setAudit] = useState<Audit | null>(null);
  const [tx, setTx] = useState<Tx | null>(null);
  const who = personParam(person);
  const q = useApi(`/reports/year?year=${year}&mode=${mode}&person=${who}`);
  const d = q.data;
  const scRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const currentIdx = d && yearOf(d.current_month) === year ? Number(d.current_month.slice(5, 7)) - 1 : -1;
  useEffect(() => {
    const el = scRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;
    const col = el.querySelector<HTMLElement>('thead th.cur');
    if (col) {
      const stickyW = el.querySelector<HTMLElement>('thead th')?.offsetWidth ?? 0;
      const edge = col.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
      const view = el.clientWidth - stickyW;
      el.scrollLeft = Math.max(0, edge - stickyW - (view - col.offsetWidth) / 2);
    }
    const sync = () => {
      wrap.classList.toggle('scrolled', el.scrollLeft > 4);
      wrap.classList.toggle('more', el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [year, mode, d]);
  const isFuture = (i: number) => year > yearOf(today) || (currentIdx >= 0 && i > currentIdx);
  const cls = (i: number) => [i === currentIdx ? 'cur' : '', isFuture(i) ? 'fut' : ''].join(' ').trim() || undefined;

  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const value = (v: number, filter: AuditFilter | undefined, month?: number) =>
    filter && v !== 0 ? (
      <button
        type="button"
        className="cellbtn"
        title="Ver os lançamentos"
        onClick={() => setAudit({ ...filter, month, title: `${filter.title} · ${month ? `${MONTHS_LONG[month - 1]} ${year}` : year}` })}
      >
        {cell(v)}
      </button>
    ) : (
      cell(v)
    );

  const settled = (amount: number, paid?: number) => amount > 0 && paid === amount;
  const cells = (months: number[], total: number, paidMonths?: number[], neg = false, filter?: AuditFilter) => {
    const paidTotal = paidMonths?.reduce((sum, v) => sum + v, 0) ?? 0;
    const tone = (amount: number, paid: number | undefined, negative: boolean) =>
      [negative ? 'neg' : '', settled(amount, paid) ? 'paid' : ''].filter(Boolean).join(' ') || undefined;
    return (
      <>
        {months.map((v, i) => (
          <td key={i} className={[cls(i), tone(v, paidMonths?.[i], neg && v < 0)].filter(Boolean).join(' ') || undefined}>
            {value(v, filter, i + 1)}
          </td>
        ))}
        <td className={tone(total, paidTotal, neg && total < 0)}>{value(total, filter)}</td>
      </>
    );
  };

  const cardDot = (name: string, size: number) =>
    bankByName(name) ? (
      <span className="bank-dot" title={name} aria-label={name} style={{ width: size, height: size }}>
        <BankMark name={name} size={size} />
      </span>
    ) : (
      <span className="tag card">{name}</span>
    );

  const label = (r: Row, size: number, bank: boolean) => (
    <span className="lbl">
      <CategoryIcon cat={{ id: r.category_id ?? 0, name: r.name.replace(/ \(geral\)$/, ''), icon: r.icon, color: r.color ?? '#8E9AAF' }} size={size} />
      {r.name}
      {bank && r.card_name && cardDot(r.card_name, size)}
    </span>
  );

  const row = (r: Row, key: string, depth: number, kind: Kind, rootSingle: boolean): ReactNode => {
    const expanded = open.has(key);
    const filter = filterOf(r, kind, depth);
    const items = r.items ?? [];
    const canExpand = Boolean(r.children?.length || items.length);
    const bankSize = depth ? 20 : 24;
    return (
      <Fragment key={key}>
        <tr className={depth ? 'child' : undefined}>
          <td>
            {canExpand ? (
              <button className="exp" onClick={() => toggle(key)} aria-expanded={expanded} title={expanded ? 'Recolher' : 'Ver a composição'}>
                <span className={`caret${expanded ? ' open' : ''}`}>
                  <Icon.right />
                </span>
                {label(r, bankSize, depth === 0 && rootSingle)}
              </button>
            ) : (
              label(r, bankSize, depth === 0 && rootSingle)
            )}
          </td>
          {cells(r.months, r.total_cents, r.paid_months, false, filter)}
        </tr>
        {expanded && r.children?.map((c) => row(c, `${key}-${c.category_id}-${c.name}`, depth + 1, kind, rootSingle))}
        {expanded &&
          items.map((it) => (
            <tr key={`${key}-i-${it.key}`} className={`item${depth ? '' : ' l1'}`}>
              <td>
                {it.name}
                {it.fixed && <span className="tag fx">Fixa</span>}
                {!rootSingle && it.card_name && cardDot(it.card_name, bankSize)}
              </td>
              {cells(it.months, it.total_cents, it.paid_months, false, { ...filter, tree: '0', item: it.key, title: `${r.name.replace(/ \(geral\)$/, '')} · ${it.name}` })}
            </tr>
          ))}
      </Fragment>
    );
  };

  const keysOf = (rows: Row[], prefix: string): string[] =>
    rows.flatMap((r) => {
      const key = `${prefix}${r.category_id}`;
      return [key, ...(r.children ?? []).map((c) => `${key}-${c.category_id}-${c.name}`)];
    });
  const allKeys = d ? [...keysOf(d.income.rows, 'i'), ...keysOf(d.expense.rows, 'e')] : [];
  const allOpen = allKeys.length > 0 && allKeys.every((k) => open.has(k));

  const section = (rows: Row[], prefix: 'i' | 'e') =>
    rows.map((r) => row(r, `${prefix}${r.category_id}`, 0, prefix === 'i' ? 'income' : 'expense', Boolean(r.card_name)));

  return (
    <main className="page wide">
      <div className="hd">
        <button className="ic" aria-label="Ano anterior" onClick={() => setYear(year - 1)}>
          <Icon.left />
        </button>
        <h1>Visão anual · {year}</h1>
        <button className="ic" aria-label="Próximo ano" onClick={() => setYear(year + 1)}>
          <Icon.right />
        </button>
      </div>
      <PersonFilter />
      <Seg
        label="Realizado ou previsto"
        value={mode}
        onChange={setMode}
        options={[
          ['realized', 'Realizado'],
          ['planned', 'Previsto'],
        ]}
      />
      <ErrorText error={q.error} />
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="stats">
            <div className="st">
              <small>Receitas</small>
              <b className="num">{formatBRL(d.income.total_cents)}</b>
            </div>
            <div className="st">
              <small>Despesas</small>
              <b className="num">{formatBRL(d.expense.total_cents)}</b>
            </div>
            <div className={`st ${d.balance.total_cents >= 0 ? 'ok' : 'warn'}`}>
              <small>Saldo acumulado</small>
              <b className="num">{formatBRL(d.balance.total_cents)}</b>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <small>Toque numa categoria para abrir a composição, ou num valor para ver os lançamentos.</small>
            <button className="btn sm ghost" disabled={!allKeys.length} onClick={() => setOpen(allOpen ? new Set() : new Set(allKeys))}>
              {allOpen ? 'Recolher tudo' : 'Expandir tudo'}
            </button>
          </div>
          <div className="sc-wrap" ref={wrapRef}>
          <div className="sc" ref={scRef} tabIndex={0} aria-label="Tabela anual com rolagem horizontal">
            <table className="year">
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">Categoria</span>
                  </th>
                  {MONTHS_SHORT_PT.map((m, i) => (
                    <th key={m} className={cls(i)}>
                      {m}
                    </th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="s">
                  <th colSpan={14}>
                    <span>Receitas</span>
                  </th>
                </tr>
                {section(d.income.rows, 'i')}
                {d.income.rows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="muted">
                      Sem receitas
                    </td>
                  </tr>
                )}
                <tr className="s">
                  <th colSpan={14}>
                    <span>Despesas</span>
                  </th>
                </tr>
                {section(d.expense.rows, 'e')}
                {d.expense.rows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="muted">
                      Sem despesas
                    </td>
                  </tr>
                )}
                <tr className="t">
                  <td>Total receitas</td>
                  {cells(d.income.months, d.income.total_cents, d.income.paid_months, false, { kind: 'income', title: 'Receitas' })}
                </tr>
                <tr className="t">
                  <td>Total despesas</td>
                  {cells(d.expense.months, d.expense.total_cents, d.expense.paid_months, false, { kind: 'expense', title: 'Despesas' })}
                </tr>
                <tr className="sd">
                  <td>Saldo</td>
                  {cells(d.balance.months, d.balance.total_cents, undefined, true)}
                </tr>
              </tbody>
            </table>
          </div>
          </div>
          <small>
            A coluna destacada é o mês atual. Contas entram no vencimento, pagas ou a pagar. Compras no cartão entram no mês da fatura. O que já foi pago fica em verde.
          </small>
        </>
      )}
      {audit && <AuditSheet key={JSON.stringify(audit)} audit={audit} year={year} mode={mode} person={who} onClose={() => setAudit(null)} onTx={setTx} />}
      {tx && <TxSheet key={`${tx.id}-${tx.status}`} tx={tx} onClose={() => setTx(null)} />}
    </main>
  );
}
