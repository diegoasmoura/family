import { useState } from 'react';
import { api, useAction, useApi, type Account, type Tx } from './api';
import { useAppState } from './state';
import { ErrorText, MoneyInput, Sheet } from './ui';

/** Confirma valor, data e conta antes de efetivar, sem sair da lista. */
export function SettleSheet({ tx, onClose }: { tx: Tx; onClose: () => void }) {
  const { today, toast } = useAppState();
  const income = tx.kind === 'income';
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const [amount, setAmount] = useState<number | null>(tx.amount_cents);
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState<number | null>(tx.account_id);
  const due = tx.due_on ?? tx.occurred_on;
  const active = (accounts.data?.accounts ?? []).filter((account) => !account.archived);
  const chosen = accountId ?? active[0]?.id ?? null;
  const pay = useAction(
    async () => {
      const patch: { amount_cents?: number; account_id?: number } = {};
      if (amount !== tx.amount_cents) patch.amount_cents = amount!;
      if (chosen !== tx.account_id) patch.account_id = chosen!;
      if (Object.keys(patch).length) await api(`/transactions/${tx.id}`, { method: 'PATCH', body: patch });
      await api(`/transactions/${tx.id}/pay`, { body: { paid_on: date } });
    },
    () => {
      toast(income ? 'Recebimento registrado' : 'Pagamento registrado');
      onClose();
    },
  );
  const ready = Boolean(amount && amount > 0 && chosen && date) && !pay.isPending;
  return (
    <Sheet title={income ? 'Efetivar receita' : 'Efetivar despesa'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) pay.mutate(undefined);
        }}
      >
        <label className="f">
          <span>{income ? 'Receita' : 'Despesa'}</span>
          <b className="settle-name">{tx.description || (income ? 'Receita' : 'Despesa')}</b>
        </label>
        <MoneyInput bare label="Valor" value={amount} onChange={setAmount} />
        <label className="f">
          <span>Data pagamento</span>
          <span className="settle-date">
            <input type="date" value={date} aria-label="Data pagamento" required onChange={(event) => setDate(event.target.value)} />
            <button type="button" className="chip sm" onClick={() => setDate(due)}>
              Vencimento
            </button>
          </span>
        </label>
        <label className="f">
          <span>Conta</span>
          <select aria-label="Conta" value={chosen ?? ''} required onChange={(event) => setAccountId(Number(event.target.value))}>
            {active.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <ErrorText error={pay.error} />
        <div className="settle-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={!ready}>
            Efetivar
          </button>
        </div>
      </form>
    </Sheet>
  );
}
