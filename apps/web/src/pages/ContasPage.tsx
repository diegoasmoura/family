import { useState } from 'react';
import { api, useAction, useApi, type Account, type Me } from '../api';
import { useAppState } from '../state';
import { BankMark } from '../banks';
import { BackButton, ErrorText, Loading, MoneyInput, MonthNav, Sheet, brl, monthName, shortDate } from '../ui';
import { useConfirm } from '../useConfirm';
import { useSwipe } from '../useSwipe';
import type { Transfer } from '../types';
import { AccountForm, typeLabel } from '../AccountForm';
import { DeleteConfirm } from '../DeleteConfirm';
import { RestartSheet } from '../RestartSheet';
import { addMonths, monthOf } from '@fin/domain';

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
  const { month, setMonth, toast, today } = useAppState();
  const q = useApi<{ accounts: Account[]; current_cents: number; forecast_cents: number }>(`/accounts?month=${month}`);
  const transfers = useApi<Transfer[]>(`/transfers?month=${month}`);
  const withArchived = useApi<{ accounts: Account[] }>(`/accounts?month=${month}&archived=1`);
  const archivedAccounts = (withArchived.data?.accounts ?? []).filter((a) => a.archived);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [closing, setClosing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const removeAccount = useAction((a: Account) => api(`/accounts/${a.id}`, { method: 'DELETE' }), () => toast('Conta excluída'));
  const reactivate = useAction((a: Account) => api(`/accounts/${a.id}`, { method: 'PATCH', body: { archived: 0 } }), () => toast('Conta reativada'));
  const removeTransfer = useAction((id: number) => api(`/transfers/${id}`, { method: 'DELETE' }), () => toast('Transferência removida'));
  const { confirm, dialog } = useConfirm();
  const swipe = useSwipe(() => setMonth(addMonths(month, -1)), () => setMonth(addMonths(month, 1)));

  return (
    <main className="page" {...swipe}>
      <div className="hd">
        <div className="title-row">
          <BackButton />
          <h1>Contas</h1>
        </div>
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
          {archivedAccounts.length > 0 && (
            <section className="card">
              <h2>Arquivadas</h2>
              {archivedAccounts.map((a) => (
                <div key={a.id} className="r" style={{ minHeight: 52 }}>
                  <BankMark name={a.name} size={34} fallback />
                  <div className="m">
                    <span className="t">{a.name}</span>
                    <small>Fora das listas; o histórico continua nos totais</small>
                  </div>
                  {me.role === 'admin' && (
                    <>
                      <button className="btn ghost sm" onClick={() => reactivate.mutate(a)}>
                        Reativar
                      </button>
                      <button className="btn ghost sm danger-text" onClick={() => setDeleting(a)}>
                        Excluir
                      </button>
                    </>
                  )}
                </div>
              ))}
            </section>
          )}
          {q.data.accounts.length >= 2 && (
            <button className="btn ghost block" onClick={() => setTransferring(true)}>
              Nova transferência
            </button>
          )}
          {me.role === 'admin' && q.data.accounts.length > 0 && month <= monthOf(today) && (
            <button className="btn ghost block" onClick={() => setRestarting(true)}>
              Recomeçar do zero em {monthName(month)}
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
      {restarting && <RestartSheet month={month} onClose={() => setRestarting(false)} />}
      {deleting && (
        <DeleteConfirm
          kind="accounts"
          id={deleting.id}
          name={deleting.name}
          onConfirm={() => {
            removeAccount.mutate(deleting);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {closing && <ClosingForm account={closing} month={month} onClose={() => setClosing(null)} />}
      {transferring && q.data && <TransferForm accounts={q.data.accounts} onClose={() => setTransferring(false)} />}
      {dialog}
    </main>
  );
}
