import { useState } from 'react';
import { api, useAction, useApi, type Account, type Me } from '../api';
import { useAppState } from '../state';
import { BankMark, BankPicker } from '../banks';
import { ErrorText, Loading, MoneyInput, MonthNav, Sheet, brl, monthName, shortDate } from '../ui';
import { useConfirm } from '../useConfirm';
import { useSwipe } from '../useSwipe';
import type { Transfer } from '../types';
import { addMonths } from '@fin/domain';

const TYPES: [string, string][] = [
  ['checking', 'Conta corrente'],
  ['savings', 'Poupança'],
  ['cash', 'Dinheiro'],
  ['wallet', 'Carteira digital'],
  ['investment', 'Investimento'],
];
const typeLabel = (t: string) => TYPES.find(([k]) => k === t)?.[1] ?? t;

function AccountForm({ account, isAdmin, onClose }: { account?: Account; isAdmin: boolean; onClose: () => void }) {
  const { today, toast } = useAppState();
  const [form, setForm] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'checking',
    initial_balance_cents: (account?.initial_balance_cents ?? 0) as number | null,
    initial_balance_on: account?.initial_balance_on ?? today,
  });
  const save = useAction(
    () => {
      const body = { ...form, initial_balance_cents: form.initial_balance_cents ?? 0 };
      return account ? api(`/accounts/${account.id}`, { method: 'PATCH', body }) : api('/accounts', { body });
    },
    () => {
      toast(account ? 'Conta atualizada' : 'Conta criada');
      onClose();
    },
  );
  const archive = useAction(
    () => api(`/accounts/${account!.id}`, { method: 'DELETE' }),
    (r: any) => {
      toast(r.archived ? 'Conta arquivada' : 'Conta excluída');
      onClose();
    },
  );
  const { confirm, dialog } = useConfirm();
  return (
    <>
    <Sheet title={account ? 'Editar conta' : 'Nova conta'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <label className="f">
          <span>Banco</span>
          <BankPicker name={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} />
        </label>
        <label className="f">
          <span>Tipo</span>
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            {TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <MoneyInput label="Saldo inicial" allowNegative value={form.initial_balance_cents} onChange={(v) => setForm((f) => ({ ...f, initial_balance_cents: v }))} />
        <label className="f">
          <span>Data do saldo inicial</span>
          <input type="date" value={form.initial_balance_on} onChange={(e) => setForm((f) => ({ ...f, initial_balance_on: e.target.value }))} required />
        </label>
        <small>O saldo é calculado a partir desta data: saldo inicial + receitas − despesas − faturas pagas ± transferências.</small>
        <ErrorText error={save.error ?? archive.error} />
        <button className="btn block" disabled={save.isPending || !form.name.trim()}>
          Salvar
        </button>
        {account && isAdmin && (
          <button
            type="button"
            className="btn danger block"
            onClick={() =>
              confirm(
                `Arquivar ou excluir “${account.name}”? Se a conta já teve movimentos, ela é arquivada e o histórico fica; senão, é apagada.`,
                () => archive.mutate(undefined),
              )
            }
          >
            Arquivar conta
          </button>
        )}
      </form>
    </Sheet>
    {dialog}
    </>
  );
}

function ClosingForm({ account, month, onClose }: { account: Account; month: string; onClose: () => void }) {
  const { toast } = useAppState();
  const [value, setValue] = useState<number | null>(account.month_closing_cents ?? account.forecast_balance_cents);
  const save = useAction(
    () => api(`/accounts/${account.id}/closing`, { method: 'PUT', body: { month, closing_cents: value ?? 0 } }),
    () => {
      toast('Saldo do fim do mês corrigido');
      onClose();
    },
  );
  const clear = useAction(
    () => api(`/accounts/${account.id}/closing?month=${month}`, { method: 'DELETE' }),
    () => {
      toast('Correção desfeita');
      onClose();
    },
  );
  return (
    <Sheet title={`Fim de ${monthName(month)} · ${account.name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <small>Quanto esta conta fica no último dia do mês. Não entra em receitas nem despesas. Serve para dinheiro que veio de fora, como um investimento.</small>
        <MoneyInput allowNegative big label="Saldo no fim do mês" value={value} onChange={setValue} />
        <div className="kv">
          <span>Previsto agora</span>
          <b className="num">{brl(account.forecast_balance_cents)}</b>
        </div>
        <ErrorText error={save.error ?? clear.error} />
        <button className="btn big" disabled={value == null || save.isPending}>
          Corrigir
        </button>
        {account.month_closing_cents != null && (
          <button type="button" className="btn ghost" disabled={clear.isPending} onClick={() => clear.mutate(undefined)}>
            Desfazer correção
          </button>
        )}
      </form>
    </Sheet>
  );
}

function TransferForm({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const { today, toast } = useAppState();
  const [form, setForm] = useState({
    from_account_id: accounts[0]?.id,
    to_account_id: accounts[1]?.id,
    amount_cents: null as number | null,
    occurred_on: today,
    description: '',
  });
  const save = useAction(
    () => api('/transfers', { body: form }),
    () => {
      toast('Transferência registrada');
      onClose();
    },
  );
  const select = (k: 'from_account_id' | 'to_account_id', label: string) => (
    <label className="f">
      <span>{label}</span>
      <select value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }))}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Sheet title="Transferência" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <MoneyInput big value={form.amount_cents} onChange={(v) => setForm((f) => ({ ...f, amount_cents: v }))} />
        <div className="row">
          {select('from_account_id', 'De')}
          {select('to_account_id', 'Para')}
        </div>
        <label className="f">
          <span>Data</span>
          <input type="date" value={form.occurred_on} onChange={(e) => setForm((f) => ({ ...f, occurred_on: e.target.value }))} />
        </label>
        <label className="f">
          <span>Descrição</span>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Opcional" />
        </label>
        <small>Transferência entre contas não é receita nem despesa: só muda onde o dinheiro está.</small>
        <ErrorText error={save.error} />
        <button className="btn big" disabled={!form.amount_cents || save.isPending}>
          Transferir
        </button>
      </form>
    </Sheet>
  );
}

export function ContasPage({ me }: { me: Me }) {
  const { month, setMonth, toast } = useAppState();
  const q = useApi<{ accounts: Account[]; current_cents: number; forecast_cents: number }>(`/accounts?month=${month}`);
  const transfers = useApi<Transfer[]>(`/transfers?month=${month}`);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [closing, setClosing] = useState<Account | null>(null);
  const [transferring, setTransferring] = useState(false);
  const removeTransfer = useAction((id: number) => api(`/transfers/${id}`, { method: 'DELETE' }), () => toast('Transferência removida'));
  const { confirm, dialog } = useConfirm();
  const swipe = useSwipe(() => setMonth(addMonths(month, -1)), () => setMonth(addMonths(month, 1)));

  return (
    <main className="page" {...swipe}>
      <div className="hd">
        <h1>Contas</h1>
        <button className="btn sm" onClick={() => setEditing('new')}>
          + Conta
        </button>
      </div>
      <MonthNav month={month} onChange={setMonth} />
      <ErrorText error={q.error} />
      {!q.data ? (
        <Loading />
      ) : (
        <>
          <div className="stats">
            <div className="st ok">
              <small>Saldo atual</small>
              <b className="num">{brl(q.data.current_cents)}</b>
            </div>
            <div className="st">
              <small>Previsto no fim do mês</small>
              <b className="num">{brl(q.data.forecast_cents)}</b>
            </div>
          </div>
          <div className="list">
            {q.data.accounts.map((a) => (
              <div className="rw" key={a.id}>
                <button className="r" onClick={() => setEditing(a)}>
                  <BankMark name={a.name} size={40} fallback />
                  <div className="m">
                    <span className="t">{a.name}</span>
                    <small>
                      {typeLabel(a.type)} · desde {shortDate(a.initial_balance_on)}
                      {a.month_closing_cents != null ? ' · fim do mês corrigido' : ''}
                    </small>
                  </div>
                  <div className="v num">
                    {brl(a.current_balance_cents)}
                    <small>previsto {brl(a.forecast_balance_cents)}</small>
                  </div>
                </button>
                <button type="button" className="link" onClick={() => setClosing(a)}>
                  Corrigir
                </button>
              </div>
            ))}
            {q.data.accounts.length === 0 && <p className="empty">Cadastre a primeira conta com o saldo de hoje.</p>}
          </div>
          {q.data.accounts.length >= 2 && (
            <button className="btn ghost block" onClick={() => setTransferring(true)}>
              Nova transferência
            </button>
          )}
          {transfers.data && transfers.data.length > 0 && (
            <section className="card">
              <h2>Transferências do mês</h2>
              {transfers.data.map((t) => (
                <div className="kv" key={t.id}>
                  <span>
                    {shortDate(t.occurred_on)} · {t.from_account_name} → {t.to_account_name}
                  </span>
                  <span className="row">
                    <b className="num">{brl(t.amount_cents)}</b>
                    <button
                      className="link"
                      onClick={() =>
                        confirm(
                          `Remover a transferência de ${brl(t.amount_cents)} (${t.from_account_name} → ${t.to_account_name})? Os saldos das duas contas voltam ao que eram.`,
                          () => removeTransfer.mutate(t.id),
                        )
                      }
                    >
                      remover
                    </button>
                  </span>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {editing && <AccountForm account={editing === 'new' ? undefined : editing} isAdmin={me.role === 'admin'} onClose={() => setEditing(null)} />}
      {closing && <ClosingForm account={closing} month={month} onClose={() => setClosing(null)} />}
      {transferring && q.data && <TransferForm accounts={q.data.accounts} onClose={() => setTransferring(false)} />}
      {dialog}
    </main>
  );
}
