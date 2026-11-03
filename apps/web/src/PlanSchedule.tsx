import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MONTHS_SHORT_PT, splitByShares, statusLabel, type DisplayStatus } from '@fin/domain';
import { api, useAction, useApi, type Tx } from './api';
import { ContractIcon, contractTypeOf } from './contracts';
import { InstallmentSettleSheet } from './InstallmentSettleSheet';
import { useAppState } from './state';
import { SettleSheet } from './SettleSheet';
import { Bar, ErrorText, Icon, Loading, MoneyInput, Seg, Sheet, StatusIcon, brl } from './ui';

/** Uma linha do parcelamento, como o banco devolve em GET /installments/:id. */
interface RawLine {
  id: number;
  installment_no: number;
  amount_cents: number;
  paid_on: string | null;
  competence_month: string;
  due_on: string | null;
  occurred_on: string;
  account_id: number | null;
  card_id: number | null;
  for_user_id: number | null;
  split_bp: number | null;
  description: string;
  kind: 'income' | 'expense';
  deleted_at: string | null;
  status: 'planned' | 'posted';
  include_in_reports: number;
  category_id: number | null;
  invoice_id: number | null;
  plan_id: number | null;
  account_name: string | null;
  card_name: string | null;
  for_user_name: string | null;
  paid_by_user_id: number | null;
  paid_by_user_name: string | null;
  settlement_expected_cents: number | null;
  settlement_previous_account_id: number | null;
  settlement_previous_account_name: string | null;
  settlement_previous_overridden: number | null;
  settlement_uuid: string | null;
  invoice_due_on: string | null;
  invoice_paid: number;
  display_status: DisplayStatus;
  status_label: string;
}

interface PlanDetail {
  description: string;
  total_cents: number;
  installments: number;
  purchased_on: string;
  account_name: string | null;
  card_name: string | null;
  category_name: string | null;
  is_contract: number;
  lender: string | null;
  contracted_cents: number | null;
  monthly_rate_bp: number | null;
  contract_type: string | null;
  items: RawLine[];
}

interface Group {
  no: number;
  lines: RawLine[];
  amount: number;
  settled: boolean;
  editable: boolean;
  month: string;
  status: DisplayStatus;
  dueOn: string;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

function lineSettled(line: RawLine): boolean {
  return line.display_status === 'paid';
}

function groupOf(no: number, lines: RawLine[]): Group {
  const settledLine = (line: RawLine) => lineSettled(line);
  const settled = lines.every(settledLine);
  const amount = lines.reduce((sum, line) => sum + Number(line.amount_cents), 0);
  let status: DisplayStatus = 'planned';
  if (settled) status = 'paid';
  else {
    const open = lines.filter((line) => !settledLine(line)).map((line) => line.display_status);
    status = open.includes('overdue') ? 'overdue' : open.includes('near') ? 'near' : 'planned';
  }
  const dueOn = lines[0].invoice_due_on ?? lines[0].due_on ?? lines[0].occurred_on;
  return { no, lines, amount, settled, editable: lines.every((line) => !settledLine(line)), month: lines[0].competence_month, status, dueOn };
}

function shareBps(lines: RawLine[]): number[] {
  if (lines.length === 1) return [10000];
  if (lines.every((line) => line.split_bp != null) && lines.reduce((sum, line) => sum + Number(line.split_bp), 0) === 10000) {
    return lines.map((line) => Number(line.split_bp));
  }
  const total = lines.reduce((sum, line) => sum + Number(line.amount_cents), 0);
  const bps = lines.map((line) => Math.round((Number(line.amount_cents) * 10000) / Math.max(1, total)));
  bps[bps.length - 1] = 10000 - bps.slice(0, -1).reduce((sum, bp) => sum + bp, 0);
  return bps;
}

function yearOf(month: string) {
  return month.slice(0, 4);
}

function byYear(groups: Group[]) {
  const blocks: { year: string; groups: Group[] }[] = [];
  for (const group of groups) {
    const year = yearOf(group.month);
    const last = blocks[blocks.length - 1];
    if (last?.year === year) last.groups.push(group);
    else blocks.push({ year, groups: [group] });
  }
  return blocks;
}

function asTx(line: RawLine): Tx {
  return {
    id: line.id,
    kind: line.kind ?? 'expense',
    description: line.description,
    amount_cents: Number(line.amount_cents),
    occurred_on: line.occurred_on,
    due_on: line.due_on,
    paid_on: line.paid_on,
    competence_month: line.competence_month,
    category_id: line.category_id,
    category_name: null,
    category_color: null,
    parent_category_name: null,
    parent_category_color: null,
    account_id: line.account_id,
    account_name: line.account_name,
    card_id: line.card_id,
    card_name: line.card_name,
    invoice_id: line.invoice_id,
    plan_id: line.plan_id,
    installment_no: Number(line.installment_no),
    recurrence_id: null,
    for_user_id: line.for_user_id,
    for_user_name: line.for_user_name,
    status: line.status ?? 'planned',
    include_in_reports: line.include_in_reports ?? 1,
    overridden: 0,
    deleted_at: null,
    display_status: line.display_status,
    status_label: line.status_label,
    recurrence_class: 'installment',
    installment_label: null,
    has_following: 0,
  };
}

/**
 * Lista de todas as parcelas de um plano. O total da criação não muda quando
 * uma parcela é editada: a diferença é o que foi poupado (ou a mais).
 */
export function PlanSchedule({
  planId,
  onClose,
  onEditPlan,
  footer,
}: {
  planId: number;
  onClose: () => void;
  onEditPlan?: () => void;
  footer?: ReactNode;
}) {
  const { toast } = useAppState();
  const q = useApi<PlanDetail>(`/installments/${planId}`);
  const [view, setView] = useState<'open' | 'paid'>('open');
  const [openYears, setOpenYears] = useState<Set<string>>(() => new Set());
  const [expandedNo, setExpandedNo] = useState<number | null>(null);
  const [editingNo, setEditingNo] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [paying, setPaying] = useState<RawLine | null>(null);
  const [settling, setSettling] = useState<Group | null>(null);
  const [pin, setPin] = useState<number | null>(null);

  const plan = q.data;
  const alive = useMemo(() => (plan?.items ?? []).filter((line) => !line.deleted_at), [plan?.items]);
  const groups = useMemo(() => {
    const byNo = new Map<number, RawLine[]>();
    for (const line of alive) byNo.set(Number(line.installment_no), [...(byNo.get(Number(line.installment_no)) ?? []), line]);
    return [...byNo.entries()].sort((a, b) => a[0] - b[0]).map(([no, lines]) => groupOf(no, lines));
  }, [alive]);
  const paid = useMemo(() => groups.filter((group) => group.settled), [groups]);
  const open = useMemo(() => groups.filter((group) => !group.settled), [groups]);
  const paidCents = alive.filter(lineSettled).reduce((sum, line) => sum + Number(line.amount_cents), 0);
  const openCents = alive.filter((line) => !lineSettled(line)).reduce((sum, line) => sum + Number(line.amount_cents), 0);
  const currentCents = alive.reduce((sum, line) => sum + Number(line.amount_cents), 0);
  const total = Number(plan?.total_cents ?? 0);
  const count = Number(plan?.installments ?? groups.length);
  const intact = plan != null && groups.length === count;
  const editing = editingNo == null ? null : (groups.find((group) => group.no === editingNo) ?? null);
  const previewOpen = editing && amount != null ? openCents - editing.amount + amount : openCents;
  const previewCurrent = editing && amount != null ? currentCents - editing.amount + amount : currentCents;
  const delta = total - previewCurrent;
  const visible = view === 'open' ? open : paid;
  const yearBlocks = useMemo(() => byYear(visible), [visible]);
  const firstVisibleYear = yearBlocks[0]?.year;
  const paidRatio = groups.length ? paid.length / groups.length : 0;
  const profileSummaries = useMemo(() => {
    const byPerson = new Map<number, { id: number; name: string; bp: number | null; total: number; paid: number; open: number }>();
    for (const line of alive) {
      if (line.for_user_id == null) continue;
      const id = Number(line.for_user_id);
      const current = byPerson.get(id) ?? {
        id,
        name: firstName(line.for_user_name ?? 'Pessoa'),
        bp: line.split_bp == null ? null : Number(line.split_bp),
        total: 0,
        paid: 0,
        open: 0,
      };
      current.total += Number(line.amount_cents);
      if (lineSettled(line)) current.paid += Number(line.amount_cents);
      else current.open += Number(line.amount_cents);
      if (!lineSettled(line) && line.split_bp != null) current.bp = Number(line.split_bp);
      byPerson.set(id, current);
    }
    return [...byPerson.values()];
  }, [alive]);
  const divided = profileSummaries.length > 1;

  const saveOne = useAction(
    async (group: Group) => {
      if (amount == null || amount <= 0) throw new Error('Informe o valor');
      const parts = group.lines.length === 1 ? [amount] : splitByShares(amount, shareBps(group.lines));
      if (parts.some((part) => part < 1)) throw new Error('O valor fica pequeno demais para dividir entre as duas pessoas.');
      await Promise.all(group.lines.map((line, index) => api(`/transactions/${line.id}`, { method: 'PATCH', body: { amount_cents: parts[index] } })));
    },
    (_res, group) => {
      toast('Valor desta parcela atualizado');
      setEditingNo(null);
      setPin(group.no);
    },
  );
  const saveFollowing = useAction(
    async (group: Group) => {
      if (amount == null || amount <= 0) throw new Error('Informe o valor');
      await api(`/installments/${planId}/apply-from`, { body: { from_installment: group.no, amount_cents: amount } });
    },
    (_res, group) => {
      toast('Esta e as seguintes foram atualizadas');
      setEditingNo(null);
      setPin(group.no);
    },
  );
  const undoSettlement = useAction(
    ({ uuid }: { uuid: string; no: number }) =>
      api(`/installments/${planId}/unsettle-installment`, { body: { settlement_uuid: uuid } }),
    (_res, vars) => {
      toast('Quitação desfeita');
      setPin(vars.no);
    },
  );

  const monthText = (value: string) => `${MONTHS_SHORT_PT[Number(value.slice(5, 7)) - 1].toLowerCase()} ${value.slice(0, 4)}`;
  const monthSlash = (value: string) => `${MONTHS_SHORT_PT[Number(value.slice(5, 7)) - 1].toLowerCase()}/${value.slice(0, 4)}`;
  const dateText = (value: string | null | undefined) => (value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '—');
  const yearKey = (kind: 'open' | 'paid', year: string) => `${kind}-${year}`;

  useEffect(() => {
    if (!firstVisibleYear) return;
    setOpenYears((years) => {
      const key = yearKey(view, firstVisibleYear);
      return years.has(key) ? years : new Set(years).add(key);
    });
  }, [planId, view, firstVisibleYear]);

  useEffect(() => {
    if (pin == null) return;
    const group = groups.find((item) => item.no === pin);
    if (!group) return;
    const targetView = group.settled ? 'paid' : 'open';
    setView(targetView);
    setOpenYears((years) => new Set(years).add(yearKey(targetView, yearOf(group.month))));
    const el = document.getElementById(`sched-${pin}`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      setPin(null);
    }
  }, [pin, plan, openYears, groups]);

  useEffect(() => {
    if (editingNo == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || paying) return;
      event.stopImmediatePropagation();
      setEditingNo(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editingNo, paying]);

  const partsOf = (group: Group) => {
    if (amount == null || amount <= 0 || group.lines.length === 1) return { parts: amount != null && amount > 0 ? [amount] : null, error: null as string | null };
    try {
      const parts = splitByShares(amount, shareBps(group.lines));
      if (parts.some((part) => part < 1)) return { parts: null, error: 'O valor fica pequeno demais para dividir entre as duas pessoas.' };
      return { parts, error: null };
    } catch {
      return { parts: null, error: 'O valor fica pequeno demais para dividir entre as duas pessoas.' };
    }
  };

  const unique = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))];
  const namesOf = (group: Group) => unique(group.lines.map((line) => line.for_user_name)).map(firstName).join(' e ');
  const placesOf = (group: Group) => unique(group.lines.map((line) => line.account_name ?? line.card_name)).join(' e ');

  const row = (group: Group) => {
    const expanded = expandedNo === group.no;
    const editingThis = editing?.no === group.no;
    const split = group.lines.length > 1;
    const draft = editingThis ? partsOf(group) : null;
    const following = groups.filter((item) => item.no > group.no && item.editable).length;
    const paidDates = unique(group.lines.map((line) => line.paid_on));
    const openLines = group.lines.filter((line) => !line.card_id && !lineSettled(line));
    const groupLabel = statusLabel(group.status, 'expense');
    const settlementLines = group.lines.filter((line) => line.settlement_uuid);
    const settlementExpected = settlementLines.reduce((sum, line) => sum + Number(line.settlement_expected_cents ?? line.amount_cents), 0);
    const settlementPaid = settlementLines.reduce((sum, line) => sum + Number(line.amount_cents), 0);
    const settlementDelta = settlementExpected - settlementPaid;
    const settlementPayers = unique(settlementLines.map((line) => line.paid_by_user_name)).map(firstName).join(' e ');
    const settlementAccounts = unique(settlementLines.map((line) => line.account_name)).join(' e ');
    const detailId = `sched-detail-${group.no}`;
    return (
      <article key={group.no} id={`sched-${group.no}`} className={`sched-item${expanded ? ' open' : ''}`}>
        <button
          type="button"
          className="sched-line"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => {
            setExpandedNo(expanded ? null : group.no);
            if (expanded) setEditingNo(null);
          }}
        >
          <StatusIcon status={group.status} label={groupLabel} />
          <span className="tx-body">
            <span className="tx-top">
              <span className="tx-title">Parcela {group.no} de {count}</span>
              <i className="tx-leader" />
              <b className="num tx-amt">{brl(group.amount)}</b>
            </span>
            <span className="tx-bottom">
              <span>{group.settled ? `Pago${paidDates[0] ? ` em ${dateText(paidDates[0])}` : ''}` : `Vence em ${dateText(group.dueOn)}`}</span>
              <span className={`sched-badge ${group.status}`}>{groupLabel}</span>
            </span>
            {split && (
              <span className="sched-line-parts">
                {group.lines.map((line) => (
                  <span key={line.id}>
                    {firstName(line.for_user_name ?? 'Pessoa')} {line.split_bp != null ? `${Number(line.split_bp) / 100}% · ` : ''}
                    <b className="num">{brl(Number(line.amount_cents))}</b>
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className={`sched-chevron${expanded ? ' open' : ''}`}><Icon.down /></span>
        </button>
        {expanded && (
          <div id={detailId} className="sched-detail">
            <dl className="sched-facts">
              <div><dt>Valor da prestação</dt><dd className="num">{brl(group.amount)}</dd></div>
              <div><dt>Vencimento</dt><dd>{dateText(group.dueOn)}</dd></div>
              {group.settled && <div><dt>Pagamento</dt><dd>{paidDates[0] ? dateText(paidDates[0]) : 'Fatura quitada'}</dd></div>}
              <div><dt>{group.lines[0].card_id ? 'Cartão' : 'Conta'}</dt><dd>{placesOf(group) || '—'}</dd></div>
              {namesOf(group) && <div><dt>De quem</dt><dd>{namesOf(group)}</dd></div>}
              <div><dt>Competência</dt><dd>{monthText(group.month)}</dd></div>
            </dl>
            {split && (
              <div className="sched-responsibility">
                <h3>Responsabilidade</h3>
                <div className="sched-shares">
                  {group.lines.map((line) => (
                    <div key={line.id}>
                      <span>
                        <b>{firstName(line.for_user_name ?? '—')} {line.split_bp != null && <small>· {Number(line.split_bp) / 100}%</small>}</b>
                        <small>
                          {line.settlement_previous_account_name ?? line.account_name ?? 'Sem conta'}
                          {line.paid_on ? ` · pago em ${dateText(line.paid_on)}` : ''}
                        </small>
                      </span>
                      <b className="num">{brl(Number(line.amount_cents))}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {settlementLines.length > 0 && (
              <div className="sched-payment">
                <h3>Pagamento</h3>
                <p>
                  <span><small>Quem pagou</small><b>{settlementPayers || '—'}</b></span>
                  <span><small>Conta usada</small><b>{settlementAccounts || '—'}</b></span>
                </p>
                <dl>
                  <div><dt>Valor previsto</dt><dd className="num">{brl(settlementExpected)}</dd></div>
                  <div><dt>Valor efetivo</dt><dd className="num">{brl(settlementPaid)}</dd></div>
                  {settlementDelta !== 0 && (
                    <div className={settlementDelta > 0 ? 'pos' : 'neg'}>
                      <dt>{settlementDelta > 0 ? 'Economia' : 'A mais'}</dt>
                      <dd className="num">{brl(Math.abs(settlementDelta))}</dd>
                    </div>
                  )}
                </dl>
                <button
                  type="button"
                  className="sched-text"
                  disabled={undoSettlement.isPending}
                  onClick={() => undoSettlement.mutate({ uuid: settlementLines[0].settlement_uuid!, no: group.no })}
                >
                  Desfazer quitação
                </button>
                <ErrorText error={undoSettlement.error} />
              </div>
            )}
            {editingThis ? (
              <div className="sched-edit">
                <MoneyInput autoFocus label="Novo valor da prestação" value={amount} onChange={setAmount} />
                {split && draft?.parts && (
                  <small>
                    {group.lines.map((line, index) => (
                      <span key={line.id}>
                        {index > 0 && ' · '}
                        {firstName(line.for_user_name ?? '—')} <span className="money">{brl(draft.parts?.[index] ?? 0)}</span>
                      </span>
                    ))}
                  </small>
                )}
                <small>{split ? 'O valor é o total e será repartido novamente. O que já foi pago não muda.' : 'O que já foi pago não muda.'}</small>
                <ErrorText error={draft?.error ? new Error(draft.error) : (saveOne.error ?? saveFollowing.error)} />
                <button type="button" className="btn ghost block" disabled={amount == null || amount <= 0 || Boolean(draft?.error) || saveOne.isPending || saveFollowing.isPending} onClick={() => saveOne.mutate(group)}>
                  Só esta parcela
                </button>
                {following > 0 && (
                  <button type="button" className="btn ghost block sched-scope" disabled={amount == null || amount <= 0 || Boolean(draft?.error) || saveOne.isPending || saveFollowing.isPending} onClick={() => saveFollowing.mutate(group)}>
                    {following === 1 ? 'Esta e a seguinte' : `Esta e as ${following} seguintes`}, a partir de {monthSlash(group.month)}
                  </button>
                )}
                <button type="button" className="sched-text" onClick={() => setEditingNo(null)}>Cancelar edição</button>
              </div>
            ) : (
              <div className="sched-actions">
                {group.editable && (
                  <button type="button" className="btn ghost sm" onClick={() => { setEditingNo(group.no); setAmount(group.amount); }}>
                    Editar valor
                  </button>
                )}
                {openLines.map((line) => (
                  <button key={line.id} type="button" className="btn sm" onClick={() => setPaying(line)}>
                    Pagar{split && line.for_user_name ? ` ${firstName(line.for_user_name)}` : ''}
                  </button>
                ))}
                {plan?.is_contract && openLines.length > 0 && (
                  <button type="button" className="btn sm sched-settle-all" onClick={() => setSettling(group)}>
                    {openLines.length < group.lines.length ? 'Quitar restante' : 'Quitar parcela inteira'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </article>
    );
  };

  const yearSection = (block: { year: string; groups: Group[] }) => {
    const key = yearKey(view, block.year);
    const expanded = openYears.has(key);
    const subtotal = block.groups.reduce((sum, group) => sum + group.amount, 0);
    return (
      <section key={block.year} className="sched-year-card">
        <button
          type="button"
          className="sched-year-head"
          aria-expanded={expanded}
          onClick={() => setOpenYears((years) => {
            const next = new Set(years);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })}
        >
          <span><b>{block.year}</b><small>{block.groups.length} {block.groups.length === 1 ? 'parcela' : 'parcelas'}</small></span>
          <span><b className="num">{brl(subtotal)}</b><i className={`sched-chevron${expanded ? ' open' : ''}`}><Icon.down /></i></span>
        </button>
        {expanded && <div className="sched-year-lines">{block.groups.map(row)}</div>}
      </section>
    );
  };

  const contracted = Number(plan?.contracted_cents ?? 0);
  const predictedCost = contracted > 0 ? total - contracted : 0;
  const endOn = groups.map((group) => group.dueOn).sort().at(-1) ?? null;
  const planPlaces = unique(alive.map((line) => line.account_name ?? line.card_name));
  const lastOpen = open.at(-1) ?? null;
  const typeInfo = contractTypeOf(plan?.contract_type);
  const rateText = plan?.monthly_rate_bp == null ? null : (Number(plan.monthly_rate_bp) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <Sheet title={plan?.description ?? 'Parcelas'} onClose={onClose} full>
        {!plan ? (
          <Loading />
        ) : (
          <div className="sched">
            <div className="sched-scroll">
              <section className="card sched-overview">
                <div className="sched-overview-title">
                  {plan.is_contract ? <ContractIcon type={plan.contract_type} small /> : <span className="sched-plan-icon"><Icon.list /></span>}
                  <span>
                    <small>{plan.is_contract ? typeInfo.label : plan.card_name ? 'Compra parcelada' : 'Parcelamento'}</small>
                    <b>{plan.lender || plan.account_name || plan.card_name || plan.category_name || 'Agenda de pagamentos'}</b>
                  </span>
                </div>
                <div className="sched-hero">
                  <small>Falta pagar</small>
                  <b className="num">{brl(previewOpen)}</b>
                </div>
                <Bar ratio={paidRatio} />
                <p className="sched-progress">
                  <b>{Math.round(paidRatio * 100)}% quitado</b>
                  <span>{paid.length} de {groups.length} {groups.length === 1 ? 'parcela paga' : 'parcelas pagas'}</span>
                </p>
              </section>

              <section className="card sched-values-card">
                <h2>Valores {plan.is_contract ? 'do contrato' : 'do parcelamento'}</h2>
                <div className="sched-value-grid">
                  {contracted > 0 && <div><small>Valor contratado</small><b className="num">{brl(contracted)}</b></div>}
                  <div><small>Total previsto</small><b className="num">{brl(total)}</b></div>
                  <div><small>Pago até agora</small><b className="num">{brl(paidCents)}</b></div>
                </div>
                {(predictedCost > 0 || rateText) && (
                  <div className="sched-cost">
                    {predictedCost > 0 && <span><small>Custo previsto acima do contratado</small><b className="num">{brl(predictedCost)}</b></span>}
                    {rateText && <span><small>Taxa informada</small><b>{rateText}% ao mês</b></span>}
                  </div>
                )}
              </section>

              {plan.is_contract && divided && (
                <section className="card sched-division-card">
                  <div>
                    <h2>Divisão do contrato</h2>
                    <small>Responsabilidade de cada pessoa, sem mudar quem fez o pagamento.</small>
                  </div>
                  <div className="sched-profile-grid">
                    {profileSummaries.map((profile) => (
                      <article key={profile.id}>
                        <header>
                          <b>{profile.name}</b>
                          {profile.bp != null && <span>{profile.bp / 100}%</span>}
                        </header>
                        <div><small>Total atual</small><b className="num">{brl(profile.total)}</b></div>
                        <p>
                          <span>Pago <b className="num">{brl(profile.paid)}</b></span>
                          <span>Falta <b className="num">{brl(profile.open)}</b></span>
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {intact && delta !== 0 && (
                <section className={`card sched-saving ${delta > 0 ? 'pos' : 'neg'}`}>
                  <div>
                    <small>{delta > 0 ? 'Poupado' : 'A mais'}</small>
                    <b className="num">{brl(Math.abs(delta))}</b>
                  </div>
                  <p>
                    <span>Plano inicial <b className="num">{brl(total)}</b></span>
                    <span>Soma atual <b className="num">{brl(previewCurrent)}</b></span>
                  </p>
                </section>
              )}

              {plan.is_contract ? (
                <section className="card sched-contract-data">
                  <div className="sched-section-title">
                    <h2>Dados do contrato</h2>
                    {onEditPlan && <button type="button" className="sched-text" onClick={onEditPlan}>Editar dados</button>}
                  </div>
                  <dl className="sched-facts">
                    <div><dt>Tipo</dt><dd>{typeInfo.label}</dd></div>
                    <div><dt>Credor</dt><dd>{plan.lender || 'Não informado'}</dd></div>
                    <div><dt>Início</dt><dd>{dateText(plan.purchased_on)}</dd></div>
                    <div><dt>Término previsto</dt><dd>{dateText(endOn)}</dd></div>
                    <div><dt>Sai de</dt><dd>{planPlaces.join(' e ') || plan.account_name || '—'}</dd></div>
                    <div><dt>Categoria</dt><dd>{plan.category_name || 'Sem categoria'}</dd></div>
                  </dl>
                </section>
              ) : (
                <section className="card sched-plan-data">
                  <dl className="sched-facts">
                    <div><dt>Começou em</dt><dd>{dateText(plan.purchased_on)}</dd></div>
                    <div><dt>Termina em</dt><dd>{dateText(endOn)}</dd></div>
                    <div><dt>{plan.card_name ? 'Cartão' : 'Conta'}</dt><dd>{planPlaces.join(' e ') || '—'}</dd></div>
                    <div><dt>Categoria</dt><dd>{plan.category_name || 'Sem categoria'}</dd></div>
                  </dl>
                </section>
              )}

              <section className="sched-agenda">
                <div className="sched-agenda-title">
                  <div><h2>Agenda de parcelas</h2><small>Toque em uma parcela para ver todos os dados</small></div>
                  {lastOpen && (
                    <button
                      type="button"
                      className="sched-text"
                      onClick={() => {
                        setView('open');
                        setOpenYears((years) => new Set(years).add(yearKey('open', yearOf(lastOpen.month))));
                        setPin(lastOpen.no);
                      }}
                    >
                      Ir para as últimas
                    </button>
                  )}
                </div>
                <Seg
                  value={view}
                  options={[[ 'open', `A pagar (${open.length})` ], [ 'paid', `Pagas (${paid.length})` ]]}
                  onChange={(next) => { setView(next); setExpandedNo(null); setEditingNo(null); }}
                  label="Situação das parcelas"
                />
                <div className="sched-years">
                  {yearBlocks.length > 0 ? yearBlocks.map(yearSection) : <p className="empty">{view === 'open' ? 'Não há parcelas a pagar.' : 'Nenhuma parcela foi paga ainda.'}</p>}
                </div>
              </section>
              {footer && <div className="sched-foot">{footer}</div>}
            </div>
          </div>
        )}
      </Sheet>
      {paying && <SettleSheet tx={asTx(paying)} onClose={() => setPaying(null)} />}
      {settling && (
        <InstallmentSettleSheet
          planId={planId}
          installmentNo={settling.no}
          expectedCents={settling.lines.filter((line) => !lineSettled(line)).reduce((sum, line) => sum + Number(line.amount_cents), 0)}
          parts={settling.lines.filter((line) => !lineSettled(line)).map((line) => ({
            userId: line.for_user_id,
            name: firstName(line.for_user_name ?? 'Pessoa'),
            bp: line.split_bp,
            amountCents: Number(line.amount_cents),
            accountId: line.account_id,
          }))}
          divisionText={settling.lines.length > 1
            ? settling.lines.map((line) => `${line.split_bp == null ? '' : `${Number(line.split_bp) / 100}% de `}${firstName(line.for_user_name ?? 'Pessoa')}`).join(' e ')
            : `100% de ${firstName(settling.lines[0].for_user_name ?? 'uma pessoa')}`}
          partial={settling.lines.some(lineSettled)}
          onClose={() => setSettling(null)}
          onDone={() => {
            setSettling(null);
            setPin(settling.no);
          }}
        />
      )}
    </>
  );
}
