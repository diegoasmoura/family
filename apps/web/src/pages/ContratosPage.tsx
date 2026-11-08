import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { monthLabel, monthOf } from '@fin/domain';
import { api, useAction, useApi, type Account } from '../api';
import { placeLabel } from '../banks';
import { AccountForm } from '../AccountForm';
import { useAppState } from '../state';
import {
  ContractIcon,
  ContractTypePicker,
  SplitPicker,
  parseRate,
  rateText,
  splitBody,
  splitFrom,
  previewShares,
  splitLabel,
  useHouseUsers,
  type ContractType,
  type Split,
} from '../contracts';
import { PlanSchedule } from '../PlanSchedule';
import { Bar, Confirm, ErrorText, Icon, Loading, MoneyInput, NewButton, Sheet, brl, shortDate } from '../ui';

/**
 * Contratos: financiamentos e empréstimos. Cada contrato é um parcelamento em conta marcado
 * (premissas.md). As prestações já são despesas normais de cada mês; esta tela só mostra
 * quanto falta, em que parcela está, quando termina e como está dividido.
 */
interface Contract {
  id: number;
  description: string;
  lender: string | null;
  account_name: string;
  contract_type: ContractType;
  shares: { user_id: number; bp: number; account_id?: number | null }[] | null;
  for_user_id: number | null;
  installments: number;
  total_cents: number;
  contracted_cents: number | null;
  monthly_rate_bp: number | null;
  active_count: number;
  paid_count: number;
  months_left: number;
  paid_cents: number;
  remaining_cents: number;
  saved_cents: number | null;
  month_cents: number;
  next: { installment_no: number; due_on: string; amount_cents: number; overdue: boolean } | null;
  ends_on: string | null;
}
interface ContractsView {
  month: string;
  remaining_cents: number;
  month_cents: number;
  contracts: Contract[];
}

/** "2031-10-03" → "out". */
const shortMonth = (iso: string) => monthLabel(monthOf(iso)).slice(0, 3).toLowerCase();

function ContractForm({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const { toast } = useAppState();
  const users = useHouseUsers();
  const [type, setType] = useState<ContractType>(contract.contract_type);
  const [lender, setLender] = useState(contract.lender ?? '');
  const [contracted, setContracted] = useState<number | null>(contract.contracted_cents);
  const [rate, setRate] = useState(rateText(contract.monthly_rate_bp));
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const accountList = accounts.data?.accounts ?? [];
  const [split, setSplit] = useState<Split | null>(null);
  const [shareAccounts, setShareAccounts] = useState<Record<number, number | null>>({});
  const [newAccountFor, setNewAccountFor] = useState<number | null>(null);
  const who = split ?? splitFrom(contract.shares, contract.for_user_id, users);
  const accountOf = (userId: number) => (userId in shareAccounts ? shareAccounts[userId] : (contract.shares?.find((share) => share.user_id === userId)?.account_id ?? null));
  const accountsByUser = Object.fromEntries(users.slice(0, 2).map((user) => [user.id, accountOf(user.id)]));
  const needsPerson = who.mode === 'one' && who.userId == null;
  const needsAccounts = who.mode === 'split' && users.slice(0, 2).some((user) => !accountOf(user.id));
  const rateBp = parseRate(rate);
  const save = useAction(
    () =>
      api(`/installments/${contract.id}`, {
        method: 'PATCH',
        body: {
          contract_type: type,
          lender: lender.trim() || null,
          contracted_cents: contracted,
          monthly_rate_bp: rateBp,
          // A divisão só é reenviada se mudou: ela refaz as linhas das prestações em aberto.
          ...(split ? splitBody(split, users, accountsByUser) : {}),
        },
      }),
    () => {
      toast('Contrato atualizado');
      onClose();
    },
  );
  const unmark = useAction(
    () => api(`/installments/${contract.id}`, { method: 'PATCH', body: { is_contract: false } }),
    () => {
      toast('Voltou a ser um parcelamento comum');
      onClose();
    },
  );
  return (
    <Sheet title={contract.description} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <small>Tipo</small>
        <ContractTypePicker value={type} onChange={setType} />
        <label className="f">
          <span>Credor</span>
          <input value={lender} onChange={(e) => setLender(e.target.value)} maxLength={80} placeholder="Ex.: Bradesco, Caixa, Fies" />
        </label>
        <small>De quem</small>
        <SplitPicker
          value={who}
          onChange={setSplit}
          users={users}
          perInstallment={contract.next?.amount_cents ?? null}
          accounts={accountList}
          shareAccounts={accountsByUser}
          onShareAccount={(userId, id) => {
            setShareAccounts((current) => ({ ...current, [userId]: id }));
            setSplit(who.mode === 'split' ? who : { mode: 'split', bp: 5000 });
          }}
          onNewAccount={setNewAccountFor}
        />
        {split && <small>A divisão nova vale para as prestações em aberto; as já pagas ficam como estão.</small>}
        <MoneyInput label="Valor contratado" value={contracted} onChange={setContracted} />
        <label className="f">
          <span>Juros ao mês (%)</span>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Ex.: 1,49" />
        </label>
        {rateBp === undefined && <small className="err">Use só número, por exemplo 1,49.</small>}
        <ErrorText error={save.error ?? unmark.error} />
        <button className="btn big" disabled={rateBp === undefined || save.isPending || needsPerson || needsAccounts}>
          Salvar
        </button>
        <button type="button" className="btn ghost block" disabled={unmark.isPending} onClick={() => unmark.mutate(undefined)}>
          Deixar de ser contrato
        </button>
        <small>As prestações continuam lançadas; o contrato só sai desta aba e continua em Parcelamentos.</small>
      </form>
      {newAccountFor != null && (
        <AccountForm
          onClose={() => setNewAccountFor(null)}
          onSaved={(saved) => {
            const userId = newAccountFor;
            setShareAccounts((current) => ({ ...current, [userId]: saved.id }));
            setSplit(who.mode === 'split' ? who : { mode: 'split', bp: 5000 });
          }}
        />
      )}
    </Sheet>
  );
}

type ContractMenuAction = 'edit' | 'open' | 'cancel' | 'unmark' | 'delete';

function prestacoes(count: number) {
  return `${count} ${count === 1 ? 'prestação' : 'prestações'}`;
}

function ContractMenu({ contract, onPick }: { contract: Contract; onPick: (action: ContractMenuAction) => void }) {
  const [open, setOpen] = useState(false);
  const actions: [ContractMenuAction, string, boolean?][] = [
    ['edit', 'Editar dados'],
    ['open', 'Ver parcelas'],
    ...(contract.remaining_cents > 0 ? [['cancel', 'Cancelar o que falta'] as [ContractMenuAction, string, boolean?]] : []),
    ['unmark', 'Deixar de ser contrato'],
    ['delete', 'Excluir financiamento', true],
  ];
  return (
    <>
      <button
        type="button"
        className="contract-more"
        aria-label={`Mais ações de ${contract.description}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon.kebab />
      </button>
      {open && (
        <Sheet title={contract.description} onClose={() => setOpen(false)}>
          <div className="list contract-menu">
            {actions.map(([action, label, danger]) => (
              <button
                key={action}
                type="button"
                className={`r${danger ? ' danger' : ''}`}
                onClick={() => {
                  setOpen(false);
                  onPick(action);
                }}
              >
                <div className="m"><span className="t">{label}</span></div>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

function ContractCard({ c, onOpen, onMenu }: { c: Contract; onOpen: () => void; onMenu: (action: ContractMenuAction) => void }) {
  const users = useHouseUsers();
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const accountList = accounts.data?.accounts ?? [];
  const ratio = c.active_count ? c.paid_count / c.active_count : 0;
  const extra = c.contracted_cents != null ? c.total_cents - c.contracted_cents : null;
  const nextParts = c.next && c.shares
    ? previewShares(c.next.amount_cents, c.shares.map((share) => share.bp))
    : null;
  const accountName = (id?: number | null) => accountList.find((account) => account.id === id)?.name ?? null;
  const people = c.shares && nextParts
    ? c.shares.map((share, index) => ({
        id: share.user_id,
        name: (users.find((user) => user.id === share.user_id)?.name ?? 'Pessoa').split(/\s+/)[0],
        pct: Math.round(share.bp / 100),
        amount: nextParts[index],
        account: accountName(share.account_id),
      }))
    : null;
  const sharedAccount = people && people.length > 0 && people.every((person) => person.account && person.account === people[0].account) ? people[0].account : null;
  const who = splitLabel(c.shares, c.for_user_id, users);
  const ends = c.ends_on ? `termina ${shortMonth(c.ends_on)}/${c.ends_on.slice(0, 4)}` : '';
  const source = sharedAccount ?? (!people ? c.account_name : null);
  return (
    <article className="card contract">
      <ContractMenu contract={c} onPick={onMenu} />
      <button type="button" className="contract-open" onClick={onOpen}>
        <div className="contract-top">
          <ContractIcon type={c.contract_type} />
          <div className="contract-name">
            <b>{c.description}</b>
            <small>
              {[c.lender || who, source ? `sai de ${placeLabel(source, 'account')}` : ''].filter(Boolean).join(' · ')}
            </small>
          </div>
        </div>
        <div className="contract-due">
          <small>Falta pagar</small>
          <b className="num">{brl(c.remaining_cents)}</b>
        </div>
        <Bar ratio={ratio} />
        <small className="contract-progress">
          {Math.round(ratio * 100)}% · {c.paid_count} de {c.active_count} pagas{ends ? ` · ${ends}` : ''}
        </small>
        <div className="contract-outcome">
          <span>
            <small>Pago até agora</small>
            <b className="num">{brl(c.paid_cents)}</b>
          </span>
          {c.saved_cents != null && c.saved_cents !== 0 && (
            <span className={c.saved_cents > 0 ? 'pos' : 'neg'}>
              <small>{c.saved_cents > 0 ? 'Poupado' : 'A mais'}</small>
              <b className="num">{brl(Math.abs(c.saved_cents))}</b>
            </span>
          )}
        </div>
        {c.next && (
          <div className={`contract-nextcompact${c.next.overdue ? ' late' : ''}`}>
            <div className="contract-nexthead">
              <span>{c.next.overdue ? 'Atrasada' : 'Próxima'} · {shortDate(c.next.due_on)}</span>
              <b className="num">{brl(c.next.amount_cents)}</b>
            </div>
            {people ? (
              <ul className="contract-shares">
                {people.map((person) => (
                  <li key={person.id}>
                    <span className="who">{person.name} <small>{person.pct}%</small></span>
                    <b className="num">{brl(person.amount)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <small className="contract-next-owner">{who}</small>
            )}
          </div>
        )}
        {extra != null && extra > 0 && (
          <small className="contract-progress">
            Juros <b className="num">{brl(extra)}</b> a mais ({Math.round((extra / (c.contracted_cents || 1)) * 100)}%)
            {c.monthly_rate_bp != null ? ` · ${rateText(c.monthly_rate_bp)}% ao mês` : ''}
          </small>
        )}
        {extra == null && c.monthly_rate_bp != null && (
          <small className="contract-progress">Juros {rateText(c.monthly_rate_bp)}% ao mês</small>
        )}
      </button>
    </article>
  );
}

function confirmText(contract: Contract, action: 'cancel' | 'delete') {
  const kept = contract.paid_count === 1
    ? ' A prestação já paga continua no Extrato e no saldo.'
    : contract.paid_count > 1
      ? ` As ${prestacoes(contract.paid_count)} já pagas continuam no Extrato e no saldo.`
      : '';
  const removedPaid = contract.paid_count === 1
    ? ` A prestação já paga (${brl(contract.paid_cents)}) deixa de contar no saldo.`
    : contract.paid_count > 1
      ? ` As ${prestacoes(contract.paid_count)} já pagas (${brl(contract.paid_cents)}) deixam de contar no saldo.`
      : '';
  if (action === 'cancel') {
    const open = contract.active_count - contract.paid_count;
    return `Cancelar ${open === 1 ? 'a prestação ainda não paga' : `as ${prestacoes(open)} ainda não pagas`} de “${contract.description}”?${kept}`;
  }
  return `Excluir “${contract.description}”? ${contract.active_count === 1 ? 'A prestação sai' : `As ${prestacoes(contract.active_count)} saem`} do Extrato, do Início, do Ano e de Parcelamentos.${removedPaid} Use só se o contrato foi lançado por engano.`;
}

export function ContratosPage() {
  const navigate = useNavigate();
  const { toast } = useAppState();
  const q = useApi<ContractsView>('/installments/contracts');
  const [schedule, setSchedule] = useState<Contract | null>(null);
  const [form, setForm] = useState<Contract | null>(null);
  const [pending, setPending] = useState<{ contract: Contract; action: 'cancel' | 'delete' } | null>(null);
  const act = useAction(
    ({ contract, action }: { contract: Contract; action: 'cancel' | 'unmark' | 'delete' }) =>
      action === 'cancel'
        ? api(`/installments/${contract.id}/cancel`, { body: {} })
        : action === 'unmark'
          ? api(`/installments/${contract.id}`, { method: 'PATCH', body: { is_contract: false } })
          : api(`/installments/${contract.id}`, { method: 'DELETE' }),
    (_res, vars) => {
      toast(
        vars.action === 'cancel'
          ? 'Parcelas restantes canceladas'
          : vars.action === 'unmark'
            ? 'Voltou a ser um parcelamento comum'
            : 'Financiamento excluído',
      );
      setPending(null);
      if (schedule?.id === vars.contract.id) setSchedule(null);
      if (form?.id === vars.contract.id) setForm(null);
    },
  );
  const d = q.data;
  // O + abre o Lançar já no modo contrato (Novo ou Já lançado).
  const add = () => navigate('/lancar', { state: { from: '/contratos', contract: true } });
  const onMenu = (contract: Contract, action: ContractMenuAction) => {
    if (action === 'edit') setForm(contract);
    else if (action === 'open') setSchedule(contract);
    else if (action === 'unmark') act.mutate({ contract, action });
    else setPending({ contract, action });
  };
  return (
    <main className="page">
      <div className="hd">
        <h1>Contratos</h1>
        <NewButton label="Novo contrato" onClick={add} />
      </div>
      <p className="page-desc">Financiamentos e empréstimos. As prestações já contam nas despesas de cada mês.</p>
      <ErrorText error={q.error ?? act.error} />
      {!d ? (
        <Loading />
      ) : d.contracts.length === 0 ? (
        <section className="card dashed">
          <b>Nenhum contrato ainda</b>
          <small>Lance um financiamento ou empréstimo, ou transforme em contrato um parcelamento em conta que já existe (o carro, o Fies…).</small>
          <button className="btn" onClick={add}>
            Novo contrato
          </button>
        </section>
      ) : (
        <>
          <section className="card contract-sum">
            <div>
              <small>Falta pagar</small>
              <b className="num">{brl(d.remaining_cents)}</b>
            </div>
            <div>
              <small>Prestações em {monthLabel(d.month).split(' ')[0].toLowerCase()}</small>
              <b className="num">{brl(d.month_cents)}</b>
            </div>
          </section>
          <div className="stack">
            {d.contracts.map((c) => (
              <ContractCard key={c.id} c={c} onOpen={() => setSchedule(c)} onMenu={(action) => onMenu(c, action)} />
            ))}
          </div>
        </>
      )}
      {schedule && (
        <PlanSchedule
          planId={schedule.id}
          onClose={() => setSchedule(null)}
          onEditPlan={() => setForm(schedule)}
        />
      )}
      {form && <ContractForm contract={form} onClose={() => setForm(null)} />}
      {pending && (
        <Confirm
          danger
          text={confirmText(pending.contract, pending.action)}
          onConfirm={() => act.mutate(pending)}
          onClose={() => setPending(null)}
        />
      )}
    </main>
  );
}
