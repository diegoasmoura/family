import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { monthLabel } from '@fin/domain';
import { useApi, type Tx } from '../api';
import { BankMark, bankByName } from '../banks';
import { PersonFilter, personParam } from '../people';
import { useAppState } from '../state';
import { TxSheet } from '../TxSheet';
import { TxMenu, type TxSheetMode } from '../TxMenu';
import { ErrorText, Icon, Loading, MonthNav, Seg, Sheet, StatusIcon, brl, dayLabel } from '../ui';

type Kind = 'expense' | 'income';

type InvoiceLine =
  | { kind: 'installment' | 'fixed'; tx: Tx; description: string; label: string; amount_cents: number }
  | { kind: 'other'; description: string; count: number; amount_cents: number };

interface InvoiceRow {
  id: number;
  card_id: number;
  card_name: string;
  reference_month: string;
  due_date: string;
  state: 'paid' | 'overdue' | 'open' | 'closed' | 'future';
  state_label: string;
  total_cents: number;
  remaining_cents: number;
  lines: InvoiceLine[];
}

function SummarySheet({ kind, summary, month, onClose }: { kind: Kind; summary: any; month: string; onClose: () => void }) {
  const income = kind === 'income';
  const row = (label: string, value: number) => (
    <div className="kv" key={label}>
      <span>{label}</span>
      <b className="num">{brl(value)}</b>
    </div>
  );
  const s = summary.situation;
  return (
    <Sheet title={`Detalhamento das ${income ? 'receitas' : 'despesas'}`} onClose={onClose}>
      <section className="card">
        <h2>Resumo</h2>
        <div className="kv">
          <span>Referência</span>
          <b>{monthLabel(month).toLowerCase()}</b>
        </div>
        <div className="kv">
          <span>Registros</span>
          <b>{summary.records}</b>
        </div>
        {row('Total', summary.total_cents)}
        {!income && row('Total sem cartões', summary.total_without_cards_cents)}
        {row('Não somadas', summary.not_summed_cents)}
        {row('Total com não somadas', summary.total_with_not_summed_cents)}
      </section>
      <section className="card">
        <h2>Situação</h2>
        {row(income ? 'Recebidas' : 'Pagas', s.paid)}
        {row(income ? 'Próximas do recebimento' : 'Próximas do vencimento', s.near)}
        {row('Vencidas', s.overdue)}
        {row(income ? 'Distantes do recebimento' : 'Distantes do vencimento', s.planned)}
        {row(income ? 'Não recebidas' : 'Não pagas', s.unpaid)}
        {!income && row('Cartões de crédito', s.cards)}
      </section>
      <section className="card">
        <h2>Recorrência</h2>
        {row('Fixas', summary.recurrence.fixed)}
        {row('Parceladas', summary.recurrence.installment)}
        {row('Variáveis', summary.recurrence.variable)}
      </section>
    </Sheet>
  );
}

function categoryCols(parent: string | null, name: string | null) {
  if (parent && name && parent !== name) return { group: parent, sub: name };
  return { group: name, sub: null as string | null };
}

function invoiceHref(inv: InvoiceRow) {
  return `/cartoes?card=${inv.card_id}&mes=${inv.reference_month}`;
}

function PlaceRow({ name, detail, amount, href }: { name: string; detail: string; amount: number; href?: string }) {
  const tone = bankByName(name)?.color ?? '#8E9AAF';
  const body = (
    <>
      <BankMark name={name} size={28} fallback />
      <span className="place-name">
        <b>{name}</b>
        <small>{detail}</small>
      </span>
      <b className="num">{brl(amount)}</b>
    </>
  );
  const style = { '--tone': tone } as CSSProperties;
  return href ? (
    <Link to={href} className="place-row" style={style}>
      {body}
    </Link>
  ) : (
    <div className="place-row" style={style}>
      {body}
    </div>
  );
}

function InvoiceBlock({ inv, onOpen }: { inv: InvoiceRow; onOpen: (id: number) => void }) {
  const lines = inv.lines ?? [];
  const detailed = lines.some((l) => l.kind !== 'other');
  const lineStatus = inv.state === 'paid' ? 'paid' : inv.state === 'overdue' ? 'overdue' : 'planned';
  const partial = inv.remaining_cents > 0 && inv.remaining_cents < inv.total_cents;
  const head = (
    <PlaceRow
      name={inv.card_name}
      detail={partial ? `${inv.state_label} · falta ${brl(inv.remaining_cents)}` : inv.state_label}
      amount={inv.total_cents}
      href={invoiceHref(inv)}
    />
  );
  if (!detailed) return head;
  return (
    <section className="grp">
      {head}
      {lines.map((l) =>
        l.kind === 'other' ? (
          <Link key="other" to={invoiceHref(inv)} className="ledger-row">
            <StatusIcon status={lineStatus} />
            <div className="m">
              <span className="t">{l.description}</span>
              {l.count > 1 && <small>{l.count} compras</small>}
            </div>
            <span className="col">Outros</span>
            <span className="col sub">Outros</span>
            <div className="v num">{brl(l.amount_cents)}</div>
            <span />
          </Link>
        ) : (
          <button key={l.tx.id} type="button" className={`ledger-row${l.tx.include_in_reports ? '' : ' dim'}`} onClick={() => onOpen(l.tx.id)}>
            <StatusIcon status={lineStatus} />
            <div className="m">
              <span className="t">{l.description}</span>
              {l.label && <small>{l.label}</small>}
            </div>
            <span className="col">{categoryCols(l.tx.parent_category_name, l.tx.category_name).group}</span>
            <span className="col sub">{categoryCols(l.tx.parent_category_name, l.tx.category_name).sub}</span>
            <div className="v num">{brl(l.amount_cents)}</div>
            <span />
          </button>
        ),
      )}
    </section>
  );
}

export function LancamentosPage() {
  const { month, setMonth, person } = useAppState();
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get('tipo') === 'receitas' ? 'income' : 'expense';
  const [search, setSearch] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: number; mode: TxSheetMode } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const q = useApi(`/transactions?month=${month}&kind=${kind}&person=${personParam(person)}`);
  const income = kind === 'income';

  const items: Tx[] = useMemo(() => {
    const list: Tx[] = q.data?.items ?? [];
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter((t) => [t.description, t.category_name, t.parent_category_name, t.account_name].some((v) => v?.toLowerCase().includes(s)));
  }, [q.data, search]);
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Tx[]>();
    for (const t of items) {
      const name = t.account_name ?? 'Sem conta';
      if (!map.has(name)) {
        map.set(name, []);
        order.push(name);
      }
      map.get(name)!.push(t);
    }
    return order.map((name) => ({ name, items: map.get(name)! }));
  }, [items]);
  const invoices: InvoiceRow[] = income ? [] : (q.data?.invoices ?? []);
  const current =
    selected &&
    [...items, ...invoices.flatMap((inv) => (inv.lines ?? []).flatMap((l) => (l.kind === 'other' ? [] : [l.tx])))].find((t) => t.id === selected.id);

  return (
    <main className="page">
      <div className="hd">
        <h1>Lançamentos</h1>
        <div className="row">
          <button className="ic" aria-label="Resumo" onClick={() => setSummaryOpen(true)} disabled={!q.data}>
            <Icon.chart />
          </button>
          <button className="ic" aria-label="Buscar" aria-pressed={search !== null} onClick={() => setSearch(search === null ? '' : null)}>
            <Icon.search />
          </button>
        </div>
      </div>
      <Seg
        label="Tipo de lançamento"
        value={kind}
        onChange={(k) => setParams(k === 'income' ? { tipo: 'receitas' } : {})}
        options={[
          ['expense', 'Despesas'],
          ['income', 'Receitas'],
        ]}
      />
      {search !== null && (
        <input className="inp" autoFocus placeholder="Buscar por descrição, categoria ou conta" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
      )}
      <MonthNav month={month} onChange={setMonth} />
      <PersonFilter />
      <ErrorText error={q.error} />
      {!q.data ? (
        <Loading />
      ) : (
        <>
          <div className="stats">
            <div className="st">
              <small>{income ? 'Receitas' : 'Despesas'}</small>
              <b className="num">{brl(q.data.summary.total_cents)}</b>
            </div>
            <div className="st ok">
              <small>{income ? 'Recebido' : 'Pago'}</small>
              <b className="num">{brl(q.data.settled_cents)}</b>
            </div>
            <div className="st warn">
              <small>{income ? 'A receber' : 'A pagar'}</small>
              <b className="num">{brl(q.data.pending_cents + (income ? 0 : q.data.invoices.reduce((a: number, i: any) => a + i.remaining_cents, 0)))}</b>
            </div>
          </div>

          <div className="ledger">
            {(invoices.length > 0 || groups.length > 0) && (
              <div className="ledger-row head">
                <span />
                <span />
                <span>Grupo</span>
                <span>Subgrupo</span>
                <span>Valor</span>
                <span />
              </div>
            )}
            {invoices.map((inv) => (
              <InvoiceBlock key={inv.id} inv={inv} onOpen={(id) => setSelected({ id, mode: 'view' })} />
            ))}
            {groups.map((g) => (
              <section key={g.name} className="grp">
                <PlaceRow
                  name={g.name}
                  detail={(() => {
                    const pending = g.items.filter((t) => t.include_in_reports && !t.paid_on).length;
                    if (!pending) return income ? 'Recebidas' : 'Pagas';
                    return `${pending} ${income ? 'a receber' : 'a pagar'}`;
                  })()}
                  amount={g.items.filter((t) => t.include_in_reports).reduce((a, t) => a + t.amount_cents, 0)}
                />
                {g.items.map((t) => {
                  const cols = categoryCols(t.parent_category_name, t.category_name);
                  return (
                    <div key={t.id} className={`ledger-row${t.include_in_reports ? '' : ' dim'}`}>
                      <button type="button" className="ledger-hit" onClick={() => setSelected({ id: t.id, mode: 'view' })}>
                        <StatusIcon status={t.display_status} />
                        <div className="m">
                          <span className="t">{t.description || t.category_name || (income ? 'Receita' : 'Despesa')}</span>
                          <small>
                            {t.installment_label ? `${t.installment_label} · ` : ''}
                            {dayLabel(t.due_on ?? t.occurred_on)} · {t.status_label}
                          </small>
                        </div>
                        <span className="col">{cols.group}</span>
                        <span className="col sub">{cols.sub}</span>
                        <div className="v num">{brl(t.amount_cents)}</div>
                      </button>
                      <TxMenu tx={t} onOpen={(mode) => setSelected({ id: t.id, mode })} />
                    </div>
                  );
                })}
              </section>
            ))}
            {items.length === 0 && invoices.length === 0 && (
              <p className="empty">{search ? 'Nada encontrado.' : `Nenhuma ${income ? 'receita' : 'despesa'} em ${monthLabel(month).toLowerCase()}.`}</p>
            )}
          </div>
        </>
      )}
      {current && selected && (
        <TxSheet key={`${current.id}-${current.status}-${selected.mode}`} tx={current} mode={selected.mode} onClose={() => setSelected(null)} />
      )}
      {summaryOpen && q.data && <SummarySheet kind={kind} summary={q.data.summary} month={month} onClose={() => setSummaryOpen(false)} />}
    </main>
  );
}
