import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addMonths, monthLabel } from '@fin/domain';
import { useSwipe } from '../useSwipe';
import { usePullToRefresh } from '../usePullToRefresh';
import { useApi, type Tx } from '../api';
import { BankMark, bankByName, placeLabel } from '../banks';
import { HOUSE_COLOR, PersonFilter, PersonTag, personOf, personParam, useHousePeople, type HousePerson } from '../people';
import { useAppState } from '../state';
import { TxSheet } from '../TxSheet';
import { TxMenu, type TxSheetMode } from '../TxMenu';
import { ErrorText, Icon, Loading, MonthNav, NewButton, PullToRefresh, Seg, Sheet, StatusIcon, brl, dayLabel } from '../ui';

type Kind = 'expense' | 'income';

const GROUPS_KEY = 'fin-extrato-groups';

function loadExtratoGroups(): { order: string[]; collapsed: string[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(GROUPS_KEY) || 'null');
    const list = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
    return { order: list(raw?.order), collapsed: list(raw?.collapsed) };
  } catch {
    return { order: [], collapsed: [] };
  }
}

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

const SLICES = ['fixed', 'installment', 'contract', 'variable'] as const;
type Slice = (typeof SLICES)[number];
const SLICE_NAME: Record<Slice, string> = { fixed: 'Fixas', installment: 'Parceladas', contract: 'Contratos', variable: 'Variáveis' };
const SLICE_EMPTY: Record<Slice, string> = { fixed: 'fixa', installment: 'parcelada', contract: 'de contrato', variable: 'variável' };

function readSlice(raw: string | null): Slice | null {
  return SLICES.includes(raw as Slice) ? (raw as Slice) : null;
}

function lineSlice(line: InvoiceLine): Slice {
  if (line.kind === 'other') return 'variable';
  if (line.tx.recurrence_class === 'contract') return 'contract';
  return line.kind === 'fixed' ? 'fixed' : 'installment';
}

/** A fatura só com as linhas que passam no filtro, com total e restante refeitos a partir delas. */
function keepLines(inv: InvoiceRow, keep: (line: InvoiceLine) => boolean): InvoiceRow[] {
  const lines = (inv.lines ?? []).filter(keep);
  if (!lines.length) return [];
  const total = lines.reduce((sum, line) => sum + line.amount_cents, 0);
  const remaining = lines.reduce((sum, line) => sum + ((line.kind === 'other' ? inv.state === 'paid' : line.tx.display_status === 'paid') ? 0 : line.amount_cents), 0);
  return [{ ...inv, lines, total_cents: total, remaining_cents: remaining }];
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
        {row('Contratos', summary.recurrence.contract)}
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

/** No Nós, de quem é a linha: bolinha na cor da pessoa (a mesma do avatar) e o primeiro nome. */
function WhoChip({ userId, name }: { userId?: number | null; name: string | null | undefined }) {
  const people = useHousePeople();
  const who = personOf(people, userId, name);
  return <PersonTag className="tx-who" color={who.color} label={who.label} />;
}

/** Filtro por pessoa dentro do Nós: 'all', o id de uma pessoa ou 'house' (Da casa). */
type WhoKey = 'all' | 'house' | number;

function txWho(t: Pick<Tx, 'for_user_id'>): WhoKey {
  return t.for_user_id == null ? 'house' : t.for_user_id;
}

/** Linha da fatura que pertence a quem está filtrado. "Outras compras" só tem dono quando todas são da mesma pessoa. */
function lineWho(line: InvoiceLine, people: HousePerson[]): WhoKey | null {
  if (line.kind !== 'other') return txWho(line.tx);
  if (!('for_user_name' in line)) return null;
  if (line.for_user_name == null) return 'house';
  return people.find((p) => p.name === line.for_user_name)?.id ?? null;
}

function CategoryChips({ tx, who }: { tx: Pick<Tx, 'parent_category_name' | 'category_name' | 'parent_category_color' | 'category_color' | 'for_user_name' | 'for_user_id'>; who?: boolean }) {
  const cols = categoryCols(tx.parent_category_name, tx.category_name);
  if (!cols.group && !who) return null;
  const groupColor = tx.parent_category_color || tx.category_color || CHIP_FALLBACK;
  return (
    <span className="tx-cats">
      {cols.group && (
        <>
          <i className="tx-dot" style={{ background: groupColor }} aria-hidden />
          <span className="tx-cat">{cols.group}</span>
        </>
      )}
      {cols.sub && <span className="tx-sub">{cols.sub}</span>}
      {who && <WhoChip userId={tx.for_user_id} name={tx.for_user_name} />}
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

function PlaceRow({
  name,
  detail,
  amount,
  href,
  expanded,
  onToggle,
}: {
  name: string;
  detail: string;
  amount: number;
  href?: string;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const tone = bankByName(name)?.color ?? '#8E9AAF';
  const body = (
    <>
      <BankMark name={name} size={24} fallback />
      <span className="place-name">
        <b>{name}</b>
        <small>{detail}</small>
      </span>
      <b className="num">{brl(amount)}</b>
      {onToggle && <Icon.down />}
    </>
  );
  const style = { '--tone': tone } as CSSProperties;
  if (onToggle) {
    return (
      <div className="place-row" style={style}>
        <button type="button" className={`place-fold${expanded ? ' open' : ''}`} aria-expanded={expanded} onClick={onToggle}>
          {body}
        </button>
      </div>
    );
  }
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

function InvoiceBlock({ inv, collapsed, onToggle, onOpen }: { inv: InvoiceRow; collapsed: boolean; onToggle: () => void; onOpen: (id: number, mode?: TxSheetMode) => void }) {
  const lines = inv.lines ?? [];
  const detailed = lines.some((l) => l.kind !== 'other');
  const lineStatus = inv.state === 'paid' ? 'paid' : inv.state === 'overdue' ? 'overdue' : 'planned';
  const partial = inv.remaining_cents > 0 && inv.remaining_cents < inv.total_cents;
  const head = (
    <PlaceRow
      name={placeLabel(inv.card_name, 'card')}
      detail={partial ? `${inv.state_label} · falta ${brl(inv.remaining_cents)}` : inv.state_label}
      amount={inv.total_cents}
      href={detailed ? undefined : invoiceHref(inv)}
      expanded={!collapsed}
      onToggle={detailed ? onToggle : undefined}
    />
  );
  if (!detailed || collapsed) return <section className="grp">{head}</section>;
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
                      <span className="tx-cats">
                        {l.count > 1 && <span className="tx-cat">{l.count} compras</span>}
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
  const slice = kind === 'expense' ? readSlice(params.get('recorrencia')) : null;
  const clearSlice = () => {
    const next = new URLSearchParams(params);
    next.delete('recorrencia');
    setParams(next);
  };
  const [search, setSearch] = useState<string | null>(null);
  const [situation, setSituation] = useState<Situation>('all');
  const [whoPick, setWhoPick] = useState<WhoKey>('all');
  // A divisão por pessoa só existe no Nós; no Eu a lista já é de uma pessoa.
  const who: WhoKey = person === 'all' ? whoPick : 'all';
  const people = useHousePeople();
  const [selected, setSelected] = useState<{ id: number; mode: TxSheetMode } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [groupPrefs, setGroupPrefs] = useState(loadExtratoGroups);
  const [orderOpen, setOrderOpen] = useState(false);
  const saveGroupPrefs = (next: { order: string[]; collapsed: string[] }) => {
    setGroupPrefs(next);
    localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
  };
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

  const sliceItems = useMemo(() => {
    const list: Tx[] = q.data?.items ?? [];
    if (!slice) return list;
    return list.filter((t) => t.include_in_reports && t.recurrence_class === slice);
  }, [q.data, slice]);
  const sliceInvoices = useMemo(() => {
    const list: InvoiceRow[] = income ? [] : (q.data?.invoices ?? []);
    if (!slice) return list;
    return list.flatMap((inv) => keepLines(inv, (line) => lineSlice(line) === slice && (line.kind === 'other' || Boolean(line.tx.include_in_reports))));
  }, [q.data, income, slice]);
  // Quanto é de cada um no Nós, com a mesma faixa de recorrência que estiver aberta.
  const whoTotals = useMemo(() => {
    const totals = new Map<WhoKey, number>();
    const add = (key: WhoKey | null, cents: number) => {
      if (key != null) totals.set(key, (totals.get(key) ?? 0) + cents);
    };
    for (const t of sliceItems) if (t.include_in_reports) add(txWho(t), t.amount_cents);
    for (const inv of sliceInvoices) {
      for (const line of inv.lines) if (line.kind === 'other' || line.tx.include_in_reports) add(lineWho(line, people), line.amount_cents);
    }
    return totals;
  }, [sliceItems, sliceInvoices, people]);
  const scopedItems = useMemo(() => (who === 'all' ? sliceItems : sliceItems.filter((t) => txWho(t) === who)), [sliceItems, who]);
  const scopedInvoices = useMemo(
    () => (who === 'all' ? sliceInvoices : sliceInvoices.flatMap((inv) => keepLines(inv, (line) => lineWho(line, people) === who))),
    [sliceInvoices, who, people],
  );
  const items: Tx[] = useMemo(() => {
    const list = scopedItems;
    const searched = !search ? list : list.filter((t) => {
      const s = search.toLowerCase();
      return [t.description, t.category_name, t.parent_category_name, t.account_name, t.card_name].some((v) => v?.toLowerCase().includes(s));
    });
    return searched.filter(matchTx);
  }, [scopedItems, search, situation]);
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { key: string; name: string; items: Tx[] }>();
    for (const t of items) {
      const card = t.card_id != null;
      const key = card ? `card:${t.card_id}` : `account:${t.account_id ?? 0}`;
      if (!map.has(key)) {
        const bank = (card ? t.card_name : t.account_name) || 'Sem conta';
        map.set(key, { key, name: placeLabel(bank, card ? 'card' : 'account'), items: [] });
        order.push(key);
      }
      map.get(key)!.items.push(t);
    }
    for (const group of map.values()) group.items.sort(byDue);
    return order.map((key) => map.get(key)!);
  }, [items]);
  const invoices: InvoiceRow[] = scopedInvoices.filter(matchInvoice);
  const sections = useMemo(() => {
    const natural = [
      ...invoices.map((inv) => ({ key: `invoice:${inv.card_id}`, name: placeLabel(inv.card_name, 'card'), invoice: inv, group: null as (typeof groups)[number] | null })),
      ...groups.map((group) => ({ key: `place:${group.key}`, name: group.name, invoice: null as InvoiceRow | null, group })),
    ];
    const rank = new Map(groupPrefs.order.map((key, index) => [key, index]));
    return natural
      .map((item, index) => ({ ...item, index }))
      .sort((a, b) => (rank.get(a.key) ?? 10000) - (rank.get(b.key) ?? 10000) || a.index - b.index);
  }, [invoices, groups, groupPrefs.order]);
  const moveSection = (key: string, dir: -1 | 1) => {
    const order = sections.map((section) => section.key);
    const index = order.indexOf(key);
    const next = index + dir;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    saveGroupPrefs({ ...groupPrefs, order });
  };
  const toggleSection = (key: string) => {
    const collapsed = groupPrefs.collapsed.includes(key)
      ? groupPrefs.collapsed.filter((item) => item !== key)
      : [...groupPrefs.collapsed, key];
    saveGroupPrefs({ ...groupPrefs, collapsed });
  };
  const current =
    selected &&
    [...items, ...invoices.flatMap((inv) => (inv.lines ?? []).flatMap((l) => (l.kind === 'other' ? [] : [l.tx])))].find((t) => t.id === selected.id);

  const allInvoices: InvoiceRow[] = scopedInvoices;
  const overdueTxs: Tx[] = scopedItems.filter((t: Tx) => t.display_status === 'overdue' && t.include_in_reports);
  const overdueInvoices = allInvoices.filter((inv) => inv.state === 'overdue');
  const overdueCount = overdueTxs.length + overdueInvoices.length;
  const overdueCents = overdueTxs.reduce((a, t) => a + t.amount_cents, 0) + overdueInvoices.reduce((a, inv) => a + (slice ? inv.lines.reduce((sum, line) => sum + line.amount_cents, 0) : (inv.remaining_cents ?? 0)), 0);
  // A API já inclui no "A pagar" a compra de cartão cuja fatura ainda não quitou.
  const pendingTotal = q.data?.pending_cents ?? 0;
  const sliceFigures = useMemo(() => {
    if (!slice && who === 'all') return null;
    let total = 0;
    let paid = 0;
    let pending = 0;
    for (const tx of scopedItems) {
      total += tx.amount_cents;
      if (tx.display_status === 'paid') paid += tx.amount_cents;
      else pending += tx.amount_cents;
    }
    for (const inv of scopedInvoices) {
      for (const line of inv.lines) {
        total += line.amount_cents;
        const settled = line.kind === 'other' ? inv.state === 'paid' : line.tx.display_status === 'paid';
        if (settled) paid += line.amount_cents;
        else pending += line.amount_cents;
      }
    }
    return { total, paid, pending };
  }, [slice, who, scopedItems, scopedInvoices]);

  return (
    <main className="page lanc" {...swipe}>
      <div className="hd">
        {search === null ? (
          <h1>Extrato</h1>
        ) : (
          <input className="inp grow" autoFocus placeholder="Buscar por descrição, categoria ou conta" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
        )}
        <div className="row">
          <button className="ic" aria-label="Resumo" onClick={() => setSummaryOpen(true)} disabled={!q.data}>
            <Icon.chart />
          </button>
          <button className="ic" aria-label="Buscar" aria-pressed={search !== null} onClick={() => setSearch(search === null ? '' : null)}>
            <Icon.search />
          </button>
          <NewButton label={income ? 'Nova receita' : 'Nova despesa'} state={{ kind }} />
        </div>
      </div>
      <PersonFilter />
      <MonthNav month={month} onChange={setMonth} />
      <div className={income ? 'tone-in' : 'tone-out'}>
        <Seg
          label="Tipo de lançamento"
          value={kind}
          onChange={(k) => {
            setSituation('all');
            setParams(k === 'income' ? { tipo: 'receitas' } : slice ? { recorrencia: slice } : {});
          }}
          options={[
            ['expense', <><Icon.expense /> Despesas</>],
            ['income', <><Icon.income /> Receitas</>],
          ]}
        />
      </div>
      <PullToRefresh ptr={ptr} />
      <ErrorText error={q.error} />
      {!q.data ? (
        <Loading />
      ) : (
        <>
          <div className="stats" role="group" aria-label="Filtrar pela situação">
            <button type="button" className={`st${situation === 'all' ? ' on' : ''}`} aria-pressed={situation === 'all'} onClick={() => setSituation('all')}>
              <small>{income ? 'Receitas' : 'Despesas'}</small>
              <b className="num">{brl(sliceFigures?.total ?? q.data.summary.total_cents)}</b>
            </button>
            <button type="button" className={`st ok${situation === 'paid' ? ' on' : ''}`} aria-pressed={situation === 'paid'} onClick={() => setSituation(situation === 'paid' ? 'all' : 'paid')}>
              <small>{income ? 'Recebido' : 'Pago'}</small>
              <b className="num">{brl(sliceFigures?.paid ?? q.data.settled_cents)}</b>
            </button>
            <button type="button" className={`st warn${situation === 'pending' ? ' on' : ''}`} aria-pressed={situation === 'pending'} onClick={() => setSituation(situation === 'pending' ? 'all' : 'pending')}>
              <small>{income ? 'A receber' : 'A pagar'}</small>
              <b className="num">{brl(sliceFigures?.pending ?? pendingTotal)}</b>
            </button>
          </div>
          {person === 'all' && people.length > 0 && (
            <div className="who-chips" role="group" aria-label="De quem">
              <button type="button" className={`who-chip${who === 'all' ? ' on' : ''}`} aria-pressed={who === 'all'} onClick={() => setWhoPick('all')}>
                <span>Todos</span>
              </button>
              {[...people.map((p) => ({ key: p.id as WhoKey, label: p.first, color: p.color })), { key: 'house' as WhoKey, label: 'Da casa', color: HOUSE_COLOR }]
                .filter((chip) => chip.key !== 'house' || (whoTotals.get('house') ?? 0) > 0 || who === 'house')
                .map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={`who-chip${who === chip.key ? ' on' : ''}`}
                    aria-pressed={who === chip.key}
                    onClick={() => setWhoPick(who === chip.key ? 'all' : chip.key)}
                  >
                    <PersonTag color={chip.color} label={chip.label} />
                    <b className="num">{brl(whoTotals.get(chip.key) ?? 0)}</b>
                  </button>
                ))}
            </div>
          )}
          {overdueCount > 0 && (
            <button type="button" className={`lanc-alert${situation === 'overdue' ? ' on' : ''}`} aria-pressed={situation === 'overdue'} onClick={() => setSituation(situation === 'overdue' ? 'all' : 'overdue')}>
              <Icon.alert />
              <span>
                {overdueCount} {overdueCount === 1 ? 'vencida' : 'vencidas'} · <span className="money">{brl(overdueCents)}</span>
              </span>
              <em>{situation === 'overdue' ? 'Limpar' : 'Ver'}</em>
            </button>
          )}
          {!income && (
            <div className="lanc-note">
              <button type="button" className="info-btn" aria-expanded={noteOpen} onClick={() => setNoteOpen((v) => !v)}>
                <Icon.info /> Como as compras do cartão contam
              </button>
              {noteOpen && <small>Compras no cartão somam em “A pagar” ao serem lançadas; só entram em “Pago” quando a fatura quitar.</small>}
            </div>
          )}

          {slice && (
            <div className="lanc-slice">
              <span>{SLICE_NAME[slice]} de {monthLabel(month).toLowerCase()}</span>
              <button type="button" onClick={clearSlice}>Ver o mês inteiro</button>
            </div>
          )}

          <div className="ledger">
            {sections.map((section) => {
              const collapsed = groupPrefs.collapsed.includes(section.key);
              if (section.invoice) {
                return (
                  <InvoiceBlock
                    key={section.key}
                    inv={section.invoice}
                    collapsed={collapsed}
                    onToggle={() => toggleSection(section.key)}
                    onOpen={(id, mode = 'view') => setSelected({ id, mode })}
                  />
                );
              }
              const g = section.group!;
              return (
                <section key={section.key} className="grp">
                  <PlaceRow
                    name={g.name}
                    detail={(() => {
                      if (g.items.length && g.items.every((t) => t.card_id)) return `${g.items.length} no cartão`;
                      const pending = g.items.filter((t) => t.include_in_reports && !t.paid_on).length;
                      if (!pending) return income ? 'Recebidas' : 'Pagas';
                      return `${pending} ${income ? 'a receber' : 'a pagar'}`;
                    })()}
                    amount={g.items.filter((t) => t.include_in_reports).reduce((a, t) => a + t.amount_cents, 0)}
                    expanded={!collapsed}
                    onToggle={() => toggleSection(section.key)}
                  />
                  {!collapsed && g.items.map((t) => (
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
              );
            })}
            {items.length === 0 && invoices.length === 0 && (
              <p className="empty">{who !== 'all' ? `Nada de ${who === 'house' ? 'Da casa' : (people.find((p) => p.id === who)?.first ?? 'quem está filtrado')} aqui.` : situation !== 'all' ? 'Nada nesta situação.' : search ? 'Nada encontrado.' : slice ? `Nenhuma despesa ${SLICE_EMPTY[slice]} em ${monthLabel(month).toLowerCase()}.` : `Nenhuma ${income ? 'receita' : 'despesa'} em ${monthLabel(month).toLowerCase()}.`}</p>
            )}
          </div>
          {sections.length > 1 && (
            <section className={`card home-layout${orderOpen ? ' open' : ''}`}>
              <button type="button" className="layout-toggle" aria-expanded={orderOpen} aria-controls="extrato-order-panel" onClick={() => setOrderOpen((value) => !value)}>
                <span className="layout-toggle-text">
                  <span>Ordem dos grupos</span>
                </span>
                <Icon.down />
              </button>
              {orderOpen && (
                <div id="extrato-order-panel" className="layout-panel">
                  <p>As setas mudam qual grupo aparece primeiro. Vale neste aparelho.</p>
                  <div className="layout-list">
                    {sections.map((section, index) => (
                      <div key={section.key} className="layout-row">
                        <span className="layout-name">{section.name}</span>
                        <span className="layout-tools">
                          <button type="button" className="mv" aria-label={`Subir ${section.name}`} disabled={index === 0} onClick={() => moveSection(section.key, -1)}>
                            <Icon.arrowUp />
                          </button>
                          <button type="button" className="mv" aria-label={`Descer ${section.name}`} disabled={index === sections.length - 1} onClick={() => moveSection(section.key, 1)}>
                            <Icon.arrowDown />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn ghost block" onClick={() => saveGroupPrefs({ order: [], collapsed: [] })}>
                    Restaurar padrão
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {current && selected && (
        <TxSheet key={`${current.id}-${current.status}-${selected.mode}`} tx={current} mode={selected.mode} onClose={() => setSelected(null)} />
      )}
      {summaryOpen && q.data && <SummarySheet kind={kind} summary={q.data.summary} month={month} onClose={() => setSummaryOpen(false)} />}
    </main>
  );
}
