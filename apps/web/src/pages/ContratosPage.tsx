import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { monthLabel, monthOf } from '@fin/domain';
import { api, useAction, useApi, type Account } from '../api';
import { AccountForm } from '../AccountForm';
import { useAppState } from '../state';
import {
  ContractIcon,
  ContractTypePicker,
  SplitPicker,
  accountPhrase,
  parseRate,
  rateText,
  splitBody,
  splitFrom,
  splitLabel,
  useHouseUsers,
  type ContractType,
  type Split,
} from '../contracts';
import { Bar, ErrorText, Loading, MoneyInput, NewButton, Sheet, brl, shortDate } from '../ui';

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
const yearsAndMonths = (n: number) => {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [y ? `${y} ${y === 1 ? 'ano' : 'anos'}` : '', m ? `${m} ${m === 1 ? 'mês' : 'meses'}` : ''].filter(Boolean).join(' e ');
};

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

function ContractCard({ c, onOpen }: { c: Contract; onOpen: () => void }) {
  const users = useHouseUsers();
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const from = accountPhrase(c.shares, users, accounts.data?.accounts ?? [], c.account_name);
  const ratio = c.active_count ? c.paid_count / c.active_count : 0;
  const extra = c.contracted_cents != null ? c.total_cents - c.contracted_cents : null;
  return (
    <button type="button" className="card click contract" onClick={onOpen}>
      <div className="contract-top">
        <ContractIcon type={c.contract_type} />
        <div className="contract-name">
          <b>{c.description}</b>
          <small>{[c.lender, splitLabel(c.shares, c.for_user_id, users)].filter(Boolean).join(' · ')}</small>
          {from && <small>{from}</small>}
        </div>
      </div>
      <div className="contract-left">
        <small>Falta</small>
        <b className="num">{brl(c.remaining_cents)}</b>
      </div>
      <Bar ratio={ratio} />
      <small className="contract-progress">
        {Math.round(ratio * 100)}% quitado · {c.paid_count} de {c.active_count} pagas
      </small>
      <dl className="contract-facts">
        {c.next && (
          <div className={c.next.overdue ? 'neg' : undefined}>
            <dt>{c.next.overdue ? 'Atrasada' : 'Próxima'}</dt>
            <dd>
              {shortDate(c.next.due_on)} · <span className="money">{brl(c.next.amount_cents)}</span>
            </dd>
          </div>
        )}
        {c.ends_on && (
          <div>
            <dt>Termina</dt>
            <dd>
              {shortMonth(c.ends_on)} {c.ends_on.slice(0, 4)}
              {c.months_left > 0 ? ` · faltam ${yearsAndMonths(c.months_left)}` : ''}
            </dd>
          </div>
        )}
        {extra != null && extra > 0 && (
          <div>
            <dt>Juros</dt>
            <dd>
              <span className="money">{brl(extra)}</span> a mais ({Math.round((extra / (c.contracted_cents || 1)) * 100)}%)
              {c.monthly_rate_bp != null ? ` · ${rateText(c.monthly_rate_bp)}% ao mês` : ''}
            </dd>
          </div>
        )}
        {extra == null && c.monthly_rate_bp != null && (
          <div>
            <dt>Juros</dt>
            <dd>{rateText(c.monthly_rate_bp)}% ao mês</dd>
          </div>
        )}
        <div>
          <dt>Já pago</dt>
          <dd>
            <span className="money">{brl(c.paid_cents)}</span> de <span className="money">{brl(c.total_cents)}</span>
          </dd>
        </div>
      </dl>
    </button>
  );
}

export function ContratosPage() {
  const navigate = useNavigate();
  const q = useApi<ContractsView>('/installments/contracts');
  const [open, setOpen] = useState<Contract | null>(null);
  const d = q.data;
  // O + abre o Lançar já no modo contrato (Novo ou Já lançado).
  const add = () => navigate('/lancar', { state: { from: '/contratos', contract: true } });
  return (
    <main className="page">
      <div className="hd">
        <h1>Contratos</h1>
        <NewButton label="Novo contrato" onClick={add} />
      </div>
      <p className="page-desc">Financiamentos e empréstimos. As prestações já contam nas despesas de cada mês.</p>
      <ErrorText error={q.error} />
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
              <ContractCard key={c.id} c={c} onOpen={() => setOpen(c)} />
            ))}
          </div>
        </>
      )}
      {open && <ContractForm contract={open} onClose={() => setOpen(null)} />}
    </main>
  );
}
