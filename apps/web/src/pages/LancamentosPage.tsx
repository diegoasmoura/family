import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addMonths, monthLabel } from '@fin/domain';
import { useSwipe } from '../useSwipe';
import { usePullToRefresh } from '../usePullToRefresh';
import { useApi, type Tx } from '../api';
import { BankMark, bankByName } from '../banks';
import { paintColor } from '../categories';
import { PersonFilter, personParam } from '../people';
import { useAppState } from '../state';
import { TxSheet } from '../TxSheet';
import { TxMenu, type TxSheetMode } from '../TxMenu';
import { ErrorText, Icon, Loading, MonthNav, PullToRefresh, Seg, Sheet, StatusIcon, brl, dayLabel } from '../ui';

type Kind = 'expense' | 'income';

type InvoiceLine =
  | { kind: 'installment' | 'fixed'; tx: Tx; description: string; label: string; amount_cents: number }
  | { kind: 'other'; description: string; count: number; amount_cents: number; for_user_name?: string | null };

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

function byDue(a: Tx, b: Tx) {
  const left = a.due_on ?? a.occurred_on;
  const right = b.due_on ?? b.occurred_on;
  return left.localeCompare(right) || a.id - b.id;
}

const CHIP_FALLBACK = '#8E9AAF';

function whoLabel(name: string | null | undefined) {
  const first = name?.trim().split(/\s+/)[0];
  return first || 'Da casa';
}

function WhoChip({ name }: { name: string | null | undefined }) {
  return (
    <span className="tx-chip" style={{ '--chip': CHIP_FALLBACK } as CSSProperties}>
      {whoLabel(name)}
    </span>
  );
}

function CategoryChips({ tx, who }: { tx: Pick<Tx, 'parent_category_name' | 'category_name' | 'parent_category_color' | 'category_color' | 'for_user_name'>; who?: boolean }) {
  const cols = categoryCols(tx.parent_category_name, tx.category_name);
  if (!cols.group && !who) return null;
  const groupColor = tx.parent_category_color || tx.category_color || CHIP_FALLBACK;
  const subColor = cols.sub ? paintColor(tx.category_color, groupColor, cols.sub) : groupColor;
  return (
    <span className="tx-chips">
      {cols.group && (
        <span className="tx-chip" style={{ '--chip': groupColor } as CSSProperties}>
          {cols.group}
        </span>
      )}
      {cols.sub && (
        <span className="tx-chip sub" style={{ '--chip': subColor } as CSSProperties}>
          {cols.sub}
        </span>
      )}
      {who && <WhoChip name={tx.for_user_name} />}
    </span>
  );
}

function TxLine({
  status,
  statusLabel,
  kicker,
  title,
  parcel,
  chips,
  date,
  amount,
  dim,
  onOpen,
  menu,
}: {
  status: Tx['display_status'];
  statusLabel: string;
  kicker?: string | null;
  title: string;
  parcel?: string | null;
  chips?: ReactNode;
  date: string;
  amount: number;
  dim?: boolean;
  onOpen: () => void;
  menu?: ReactNode;
}) {
  return (
    <div className={`ledger-row${dim ? ' dim' : ''}`}>
      <button type="button" className="ledger-hit" onClick={onOpen}>
        <StatusIcon status={status} label={statusLabel} />
        <span className="tx-body">
          <span className="tx-top">
            <span className="tx-title">
              <span className="name">{title}</span>
              {parcel && <span className="tx-parcel">{parcel}</span>}
            </span>
            <i className="tx-leader" aria-hidden="true" />
            <b className="num tx-amt">{brl(amount)}</b>
          </span>
          <span className="tx-bottom">
            <span className="tx-meta">
              {kicker && <span className="tx-kicker">{kicker}</span>}
              {chips}
            </span>
            <span className="tx-date">{date}</span>
          </span>
        </span>
      </button>
      {menu}
    </div>
  );
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

function InvoiceBlock({ inv, onOpen }: { inv: InvoiceRow; onOpen: (id: number, mode?: TxSheetMode) => void }) {
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
  const sorted = [...lines].sort((a, b) => {
    if (a.kind === 'other') return 1;
    if (b.kind === 'other') return -1;
    const left = a.tx.due_on ?? a.tx.occurred_on;
    const right = b.tx.due_on ?? b.tx.occurred_on;
    return left.localeCompare(right) || a.tx.id - b.tx.id;
  });
  return (
    <section className="grp">
      {head}
      {sorted.map((l) =>
        l.kind === 'other' ? (
          <div key="other" className="ledger-row">
            <Link to={invoiceHref(inv)} className="ledger-hit">
              <StatusIcon status={lineStatus} label={inv.state_label} />
              <span className="tx-body">
                <span className="tx-top">
                  <span className="tx-title">
                    <span className="name">{l.description}</span>
                  </span>
                  <i className="tx-leader" aria-hidden="true" />
                  <b className="num tx-amt">{brl(l.amount_cents)}</b>
                </span>
                <span className="tx-bottom">
                  <span className="tx-meta">
                    {(l.count > 1 || 'for_user_name' in l) && (
                      <span className="tx-chips">
                        {l.count > 1 && (
                          <span className="tx-chip" style={{ '--chip': CHIP_FALLBACK } as CSSProperties}>
                            {l.count} compras
                          </span>
                        )}
                        {'for_user_name' in l && <WhoChip name={l.for_user_name} />}
                      </span>
                    )}
                  </span>
                  <span className="tx-date">{dayLabel(inv.due_date)}</span>
                </span>
              </span>
            </Link>
          </div>
        ) : (
          <TxLine
            key={l.tx.id}
            status={l.tx.display_status}
            statusLabel={l.tx.status_label}
            title={l.description}
            parcel={l.label}
            chips={<CategoryChips tx={l.tx} who />}
            date={dayLabel(l.tx.due_on ?? l.tx.occurred_on)}
            amount={l.amount_cents}
            dim={!l.tx.include_in_reports}
            onOpen={() => onOpen(l.tx.id)}
            menu={<TxMenu tx={l.tx} onOpen={(mode) => onOpen(l.tx.id, mode)} />}
          />
        ),
      )}
    </section>
  );
}

type Situation = 'all' | 'pending' | 'overdue' | 'paid';

export function LancamentosPage() {
  const { month, setMonth, person } = useAppState();
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get('tipo') === 'receitas' ? 'income' : 'expense';
  const [search, setSearch] = useState<string | null>(null);
  const [situation, setSituation] = useState<Situation>('all');
  const [selected, setSelected] = useState<{ id: number; mode: TxSheetMode } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const q = useApi(`/transactions?month=${month}&kind=${kind}&person=${personParam(person)}`);
  const income = kind === 'income';
  const swipe = useSwipe(() => setMonth(addMonths(month, -1)), () => setMonth(addMonths(month, 1)));
  const ptr = usePullToRefresh();

  const matchTx = (t: Tx) =>
    situation === 'all' ||
    (situation === 'paid' ? t.display_status === 'paid' : situation === 'overdue' ? t.display_status === 'overdue' : t.display_status !== 'paid');
  const matchInvoice = (inv: InvoiceRow) =>
    situation === 'all' ||
    (situation === 'paid' ? inv.state === 'paid' : situation === 'overdue' ? inv.state === 'overdue' : inv.state !== 'paid');

  const items: Tx[] = useMemo(() => {
    const list: Tx[] = q.data?.items ?? [];
    const searched = !search ? list : list.filter((t) => {
      const s = search.toLowerCase();
      return [t.description, t.category_name, t.parent_category_name, t.account_name, t.card_name].some((v) => v?.toLowerCase().includes(s));
    });
    return searched.filter(matchTx);
  }, [q.data, search, situation]);
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Tx[]>();
    for (const t of items) {
      const name = t.account_name ?? t.card_name ?? 'Sem conta';
      if (!map.has(name)) {
        map.set(name, []);
        order.push(name);
      }
      map.get(name)!.push(t);
    }
    for (const list of map.values()) list.sort(byDue);
    return order.map((name) => ({ name, items: map.get(name)! }));
  }, [items]);
  const invoices: InvoiceRow[] = income ? [] : (q.data?.invoices ?? []).filter(matchInvoice);
  const current =
    selected &&
    [...items, ...invoices.flatMap((inv) => (inv.lines ?? []).flatMap((l) => (l.kind === 'other' ? [] : [l.tx])))].find((t) => t.id === selected.id);

  return (
    <main className="page lanc" {...swipe}>
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
      <MonthNav month={month} onChange={setMonth} />
      <PersonFilter />
      <Seg
        label="Tipo de lançamento"
        value={kind}
        onChange={(k) => {
          setSituation('all');
          setParams(k === 'income' ? { tipo: 'receitas' } : {});
        }}
        options={[
          ['expense', <><Icon.expense /> Despesas</>],
          ['income', <><Icon.income /> Receitas</>],
        ]}
      />
      {search !== null && (
        <input className="inp" autoFocus placeholder="Buscar por descrição, categoria ou conta" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
      )}
      <PullToRefresh ptr={ptr} />
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
              <b className="num">{brl(q.data.pending_cents)}</b>
            </div>
          </div>
          <div className="chips" role="tablist" aria-label="Situação">
            {(
              [
                ['all', 'Todos'],
                ['pending', income ? 'A receber' : 'A pagar'],
                ['overdue', 'Vencidos'],
                ['paid', income ? 'Recebidos' : 'Pagos'],
              ] as [Situation, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={situation === value}
                className={`chip sm${situation === value ? ' on' : ''}`}
                onClick={() => setSituation(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {!income && (
            <small title="Compra no cartão soma em “A pagar” assim que é lançada. Ela só entra em “Pago” quando a fatura inteira quita — até lá, quem paga de fato é a fatura, não esta linha.">
              Compras no cartão somam em “A pagar” ao serem lançadas; só entram em “Pago” quando a fatura quitar.
            </small>
          )}

          <div className="ledger">
            {invoices.map((inv) => (
              <InvoiceBlock key={inv.id} inv={inv} onOpen={(id, mode = 'view') => setSelected({ id, mode })} />
            ))}
            {groups.map((g) => (
              <section key={g.name} className="grp">
                <PlaceRow
                  name={g.name}
                  detail={(() => {
                    if (g.items.length && g.items.every((t) => t.card_id)) return `${g.items.length} no cartão`;
                    const pending = g.items.filter((t) => t.include_in_reports && !t.paid_on).length;
                    if (!pending) return income ? 'Recebidas' : 'Pagas';
                    return `${pending} ${income ? 'a receber' : 'a pagar'}`;
                  })()}
                  amount={g.items.filter((t) => t.include_in_reports).reduce((a, t) => a + t.amount_cents, 0)}
                />
                {g.items.map((t) => (
                  <TxLine
                    key={t.id}
                    status={t.display_status}
                    statusLabel={t.status_label}
                    title={t.description || t.category_name || (income ? 'Receita' : 'Despesa')}
                    parcel={t.installment_label ?? (t.card_id && t.recurrence_class === 'fixed' ? 'Fixa' : null)}
                    chips={<CategoryChips tx={t} who={person === 'all'} />}
                    date={dayLabel(t.due_on ?? t.occurred_on)}
                    amount={t.amount_cents}
                    dim={!t.include_in_reports}
                    onOpen={() => setSelected({ id: t.id, mode: 'view' })}
                    menu={<TxMenu tx={t} onOpen={(mode) => setSelected({ id: t.id, mode })} />}
                  />
                ))}
              </section>
            ))}
            {items.length === 0 && invoices.length === 0 && (
              <p className="empty">{situation !== 'all' ? 'Nada nesta situação.' : search ? 'Nada encontrado.' : `Nenhuma ${income ? 'receita' : 'despesa'} em ${monthLabel(month).toLowerCase()}.`}</p>
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
