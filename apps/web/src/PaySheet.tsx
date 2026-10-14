import { useState } from 'react';
import { api, useAction, useApi, type Account, type Card } from './api';
import { useAppState } from './state';
import { ErrorText, Loading, MoneyInput, Sheet, brl, monthName } from './ui';

function useInvoiceDetail(card: Card, month: string) {
  return useApi<any>(`/cards/${card.id}/invoices/${month}`);
}

export function PaySheet({ card, month, onClose }: { card: Card; month: string; onClose: () => void }) {
  const { today, toast } = useAppState();
  const detail = useInvoiceDetail(card, month);
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const [amount, setAmount] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(card.default_pay_account_id);
  const [date, setDate] = useState(today);
  const inv = detail.data;
  const value = amount ?? (inv?.remaining_cents || null);
  const pay = useAction(
    (account: number | null) => api(`/invoices/${inv!.id}/payments`, { body: { amount_cents: value, account_id: account ?? undefined, paid_on: date } }),
    () => {
      toast('Pagamento registrado');
      onClose();
    },
  );
  const chosenAccount = accountId ?? accounts.data?.accounts[0]?.id ?? null;
  return (
    <Sheet title={`Pagar fatura de ${monthName(month)}`} onClose={onClose}>
      {!inv ? (
        <Loading />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate(chosenAccount);
          }}
        >
          <MoneyInput big value={value} onChange={setAmount} />
          <small className="right">Saldo da fatura: {brl(inv.remaining_cents)}</small>
          {amount != null && inv.remaining_cents > 0 && amount !== inv.remaining_cents && (
            <button type="button" className="chip sm" onClick={() => setAmount(null)}>
              Valor total ({brl(inv.remaining_cents)})
            </button>
          )}
          <label className="f">
            <span>Sai da conta</span>
            <select value={chosenAccount ?? ''} onChange={(e) => setAccountId(Number(e.target.value))} required>
              {accounts.data?.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {brl(a.current_balance_cents)}
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            <span>Data do pagamento</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {value != null && value > inv.remaining_cents && (
            <div className="card soft" style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700 }}>
              {brl(value - inv.remaining_cents)} ficam como crédito e abatem a próxima fatura.
            </div>
          )}
          <small>Pagar a fatura tira da conta, mas não conta como despesa.</small>
          <ErrorText error={pay.error} />
          <button className="btn big" disabled={!value || !chosenAccount || pay.isPending}>
            {value ? `Pagar ${brl(value)}` : 'Registrar pagamento'}
          </button>
        </form>
      )}
    </Sheet>
  );
}
