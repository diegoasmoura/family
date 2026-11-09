import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { monthLabel, monthOf } from '@fin/domain';
import { api, useAction, useApi, type Account, type Category } from '../api';
import { CategoryPicker } from '../categories';
import { placeLabel } from '../banks';
import { AccountForm } from '../AccountForm';
import { PersonFilter, personOf, withPerson, useHousePeople } from '../people';
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
import { Bar, Confirm, ErrorText, Icon, Loading, MoneyInput, NewButton, Seg, Sheet, brl, shortDate } from '../ui';

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
  category_id: number | null;
  category_name: string | null;
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

function ContractForm({ contract, mine, onClose }: { contract: Contract; mine: boolean; onClose: () => void }) {
  const { toast } = useAppState();
  const users = useHouseUsers();
  const [type, setType] = useState<ContractType>(contract.contract_type);
  const [lender, setLender] = useState(contract.lender ?? '');
  const [contracted, setContracted] = useState<number | null>(contract.contracted_cents);
  const [rate, setRate] = useState(rateText(contract.monthly_rate_bp));
  const cats = useApi<Category[]>('/categories?kind=expense');
  const [categoryId, setCategoryId] = useState<number | null>(contract.category_id);
  const categoryChanged = categoryId !== contract.category_id;
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
          // Só reenvia se mudou: a categoria nova vale para as prestações em aberto.
          ...(categoryChanged ? { category_id: categoryId } : {}),
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
        <small>Categoria</small>
        <CategoryPicker categories={cats.data} value={categoryId} onChange={setCategoryId} />
        {categoryChanged && <small>A categoria nova vale para as prestações em aberto; as já pagas ficam como estão.</small>}
        <small>De quem</small>
        <SplitPicker
          value={who}
          onChange={setSplit}
          users={users}
          // No Eu, a próxima prestação vem só com a parte de quem está logado: não serve de base para a divisão.
          perInstallment={mine ? null : (contract.next?.amount_cents ?? null)}
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

function ContractCard({ c, mine, onOpen, onMenu }: { c: Contract; mine: boolean; onOpen: () => void; onMenu: (action: ContractMenuAction) => void }) {
  const users = useHouseUsers();
  const housePeople = useHousePeople();
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const accountList = accounts.data?.accounts ?? [];
  const ratio = c.active_count ? c.paid_count / c.active_count : 0;
  const extra = c.contracted_cents != null ? c.total_cents - c.contracted_cents : null;
  // No Eu os valores já são a parte de quem está logado: não há o que dividir de novo.
  const nextParts = !mine && c.next && c.shares
    ? previewShares(c.next.amount_cents, c.shares.map((share) => share.bp))
    : null;
  const accountName = (id?: number | null) => accountList.find((account) => account.id === id)?.name ?? null;
  const people = c.shares && nextParts
    ? c.shares.map((share, index) => ({
        id: share.user_id,
        name: (users.find((user) => user.id === share.user_id)?.name ?? 'Pessoa').split(/\s+/)[0],
        color: personOf(housePeople, share.user_id).color,
        pct: Math.round(share.bp / 100),
        amount: nextParts[index],
        account: accountName(share.account_id),
      }))
    : null;
  const sharedAccount = people && people.length > 0 && people.every((person) => person.account && person.account === people[0].account) ? people[0].account : null;
  const who = splitLabel(c.shares, c.for_user_id, users);
  const ends = c.ends_on ? `termina ${shortMonth(c.ends_on)}/${c.ends_on.slice(0, 4)}` : '';
  const source = sharedAccount ?? (!people ? c.account_name : null);
  const split = c.shares && c.shares.length >= 2;
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
          <small>{mine && split ? 'Falta pagar da sua parte' : 'Falta pagar'}</small>
          <b className="num">{brl(c.remaining_cents)}</b>
        </div>
        <Bar ratio={ratio} />
        <small className="contract-progress">
          {Math.round(ratio * 100)}% · {c.paid_count} de {c.active_count} pagas{ends ? ` · ${ends}` : ''}
        </small>
        <div className="contract-outcome">
          <span>
            <small>{mine && split ? 'Você pagou' : 'Pago até agora'}</small>
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
              <span>{c.next.overdue ? 'Atrasada' : 'Próxima'} · {shortDate(c.next.due_on)}{mine && split ? ' · sua parte' : ''}</span>
              <b className="num">{brl(c.next.amount_cents)}</b>
            </div>
            {people ? (
              <ul className="contract-shares">
                {people.map((person) => (
                  <li key={person.id} style={{ '--who': person.color } as CSSProperties}>
                    <span className="who">{person.name} <small>{person.pct}%</small></span>
                    <b className="num">{brl(person.amount)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <small className="contract-next-owner">{mine && split ? `Dividido: ${who}. Em Nós, a prestação inteira.` : who}</small>
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

/** Lista resumida: uma linha por contrato, com o essencial (quanto falta, progresso e a próxima). */
function ContractRow({ c, mine, onOpen, onMenu }: { c: Contract; mine: boolean; onOpen: () => void; onMenu: (action: ContractMenuAction) => void }) {
  const housePeople = useHousePeople();
  const ratio = c.active_count ? c.paid_count / c.active_count : 0;
  const split = c.shares && c.shares.length >= 2;
  const ends = c.ends_on ? `${shortMonth(c.ends_on)}/${c.ends_on.slice(2, 4)}` : null;
  const owners = c.shares?.length ? c.shares.map((share) => share.user_id) : c.for_user_id != null ? [c.for_user_id] : [];
  const late = c.next?.overdue;
  return (
    <div className={`contract-row${late ? ' late' : ''}`}>
      <button type="button" className="contract-row-hit" onClick={onOpen}>
        <ContractIcon type={c.contract_type} small />
        <span className="contract-row-body">
          <span className="contract-row-top">
            <b className="contract-row-name">{c.description}</b>
            <b className="num">{brl(c.remaining_cents)}</b>
          </span>
          <span className="contract-row-mid">
            <span className="contract-row-who" aria-label={owners.map((id) => personOf(housePeople, id).label).join(' e ')}>
              {owners.map((id) => (
                <i key={id} style={{ background: personOf(housePeople, id).color }} />
              ))}
            </span>
            <small>
              {[c.lender, `${c.paid_count}/${c.active_count}`, ends ? `até ${ends}` : null].filter(Boolean).join(' · ')}
            </small>
            <small className="contract-row-left">{c.remaining_cents > 0 ? (mine && split ? 'sua parte' : 'falta') : 'quitado'}</small>
          </span>
          <Bar ratio={ratio} />
          {c.next && (
            <small className="contract-row-next">
              {late ? 'Atrasada' : 'Próxima'} {shortDate(c.next.due_on)} · <b className="num">{brl(c.next.amount_cents)}</b>
              {mine && split ? ' (sua parte)' : ''}
            </small>
          )}
        </span>
      </button>
      <ContractMenu contract={c} onPick={onMenu} />
    </div>
  );
}

const VIEW_KEY = 'fin-contratos-view';
type ContractsLayout = 'cards' | 'list';

function loadView(): ContractsLayout {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

function confirmText(contract: Contract, action: 'cancel' | 'delete', mine: boolean) {
  const kept = contract.paid_count === 1
    ? ' A prestação já paga continua no Extrato e no saldo.'
    : contract.paid_count > 1
      ? ` As ${prestacoes(contract.paid_count)} já pagas continuam no Extrato e nas contas.`
      : '';
  // No Eu, paid_cents é só a parte de quem está logado: o aviso não cita valor para não parecer o total.
  const removedPaid = mine
    ? contract.paid_count > 0
      ? ' As prestações já pagas deixam de contar nas contas, inclusive a parte da outra pessoa.'
      : ''
    : contract.paid_count === 1
    ? ` A prestação já paga (${brl(contract.paid_cents)}) deixa de contar nas contas.`
    : contract.paid_count > 1
      ? ` As ${prestacoes(contract.paid_count)} já pagas (${brl(contract.paid_cents)}) deixam de contar nas contas.`
      : '';
  if (action === 'cancel') {
    const open = contract.active_count - contract.paid_count;
    return `Cancelar ${open === 1 ? 'a prestação ainda não paga' : `as ${prestacoes(open)} ainda não pagas`} de “${contract.description}”?${kept}`;
  }
  return `Excluir “${contract.description}”? ${contract.active_count === 1 ? 'A prestação sai' : `As ${prestacoes(contract.active_count)} saem`} do Extrato, do Início, do Ano e de Parcelamentos.${removedPaid} Use só se o contrato foi lançado por engano.`;
}

export function ContratosPage() {
  const navigate = useNavigate();
  const { toast, person } = useAppState();
  const mine = person !== 'all';
  // Eu: só os contratos em que a pessoa tem parte, com a parte dela. Nós: a prestação inteira.
  const q = useApi<ContractsView>(withPerson('/installments/contracts', person));
  const [schedule, setSchedule] = useState<Contract | null>(null);
  const [form, setForm] = useState<Contract | null>(null);
  const [pending, setPending] = useState<{ contract: Contract; action: 'cancel' | 'delete' } | null>(null);
  const [view, setView] = useState<ContractsLayout>(loadView);
  const pickView = (next: ContractsLayout) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Sem armazenamento, a escolha vale só nesta visita.
    }
  };
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
    <main className="page contratos">
      <div className="hd">
        <h1>Contratos</h1>
        <NewButton label="Novo contrato" onClick={add} />
      </div>
      <PersonFilter />
      <Seg
        label="Como mostrar os contratos"
        value={view}
        onChange={pickView}
        options={[
          ['cards', <><Icon.grid /> Detalhado</>],
          ['list', <><Icon.list /> Lista</>],
        ]}
      />
      <p className="page-desc">
        {mine
          ? 'Seus financiamentos e empréstimos. No dividido, os valores são só a sua parte.'
          : 'Financiamentos e empréstimos da casa, com a prestação inteira e a parte de cada um.'}
      </p>
      <ErrorText error={q.error ?? act.error} />
      {!d ? (
        <Loading />
      ) : d.contracts.length === 0 ? (
        <section className="card dashed">
          <b>{mine ? 'Nenhum contrato seu' : 'Nenhum contrato ainda'}</b>
          <small>Lance um financiamento ou empréstimo, ou transforme em contrato um parcelamento em conta que já existe (o carro, o Fies…).</small>
          <button className="btn" onClick={add}>
            Novo contrato
          </button>
        </section>
      ) : (
        <>
          <section className="card contract-sum">
            <div>
              <small>{mine ? 'Falta você pagar' : 'Falta pagar'}</small>
              <b className="num">{brl(d.remaining_cents)}</b>
            </div>
            <div>
              <small>Prestações em {monthLabel(d.month).split(' ')[0].toLowerCase()}</small>
              <b className="num">{brl(d.month_cents)}</b>
            </div>
          </section>
          {view === 'list' ? (
            <section className="card contract-list" aria-label="Contratos">
              {d.contracts.map((c) => (
                <ContractRow key={c.id} c={c} mine={mine} onOpen={() => setSchedule(c)} onMenu={(action) => onMenu(c, action)} />
              ))}
            </section>
          ) : (
            <div className="stack">
              {d.contracts.map((c) => (
                <ContractCard key={c.id} c={c} mine={mine} onOpen={() => setSchedule(c)} onMenu={(action) => onMenu(c, action)} />
              ))}
            </div>
          )}
        </>
      )}
      {schedule && (
        <PlanSchedule
          planId={schedule.id}
          onClose={() => setSchedule(null)}
          onEditPlan={() => setForm(schedule)}
        />
      )}
      {form && <ContractForm contract={form} mine={mine} onClose={() => setForm(null)} />}
      {pending && (
        <Confirm
          danger
          text={confirmText(pending.contract, pending.action, mine)}
          onConfirm={() => act.mutate(pending)}
          onClose={() => setPending(null)}
        />
      )}
    </main>
  );
}
