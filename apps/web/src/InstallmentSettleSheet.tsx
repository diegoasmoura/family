import { useMemo, useState } from 'react';
import { splitByShares } from '@fin/domain';
import { api, useAction, useApi, type Account, type Me } from './api';
import { useAppState } from './state';
import { ErrorText, MoneyInput, Sheet, brl } from './ui';

export interface SettlementPart {
  userId: number | null;
  name: string;
  bp: number | null;
  amountCents: number;
  accountId: number | null;
}

export function InstallmentSettleSheet({
  planId,
  installmentNo,
  expectedCents,
  parts,
  divisionText,
  partial,
  onClose,
  onDone,
}: {
  planId: number;
  installmentNo: number;
  expectedCents: number;
  parts: SettlementPart[];
  divisionText: string;
  partial: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { today, toast } = useAppState();
  const me = useApi<Me>('/auth/me');
  const users = useApi<{ id: number; name: string }[]>('/users');
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const people = users.data ?? [];
  const activeAccounts = (accounts.data?.accounts ?? []).filter((account) => !account.archived);
  const defaultPayer = me.data?.id ?? parts[0]?.userId ?? people[0]?.id ?? null;
  const [chosenPayer, setChosenPayer] = useState<number | null>(null);
  const payerId = chosenPayer ?? defaultPayer;
  const suggestedAccount = parts.find((part) => part.userId === payerId)?.accountId ?? activeAccounts[0]?.id ?? null;
  const [chosenAccount, setChosenAccount] = useState<number | null>(null);
  const accountId = chosenAccount ?? suggestedAccount;
  const [amount, setAmount] = useState<number | null>(expectedCents);
  const [paidOn, setPaidOn] = useState(today);
  const payerName = people.find((person) => person.id === payerId)?.name ?? parts.find((part) => part.userId === payerId)?.name ?? 'A pessoa escolhida';
  const accountName = activeAccounts.find((account) => account.id === accountId)?.name ?? 'a conta escolhida';
  const delta = amount == null ? 0 : expectedCents - amount;

  const allocation = useMemo(() => {
    if (amount == null || amount <= 0 || !parts.length) return null;
    if (parts.length === 1) return [amount];
    const saved = parts.every((part) => part.bp != null) && parts.reduce((sum, part) => sum + Number(part.bp), 0) === 10000;
    const total = parts.reduce((sum, part) => sum + part.amountCents, 0);
    const bps = saved
      ? parts.map((part) => Number(part.bp))
      : parts.map((part) => Math.round((part.amountCents * 10000) / Math.max(1, total)));
    if (!saved) bps[bps.length - 1] = 10000 - bps.slice(0, -1).reduce((sum, bp) => sum + bp, 0);
    try {
      return splitByShares(amount, bps);
    } catch {
      return null;
    }
  }, [amount, parts]);

  const settle = useAction(
    () =>
      api(`/installments/${planId}/settle-installment`, {
        body: {
          installment_no: installmentNo,
          amount_cents: amount,
          paid_on: paidOn,
          payer_user_id: payerId,
          account_id: accountId,
        },
      }),
    () => {
      toast(partial ? 'Restante da parcela quitado' : 'Parcela inteira quitada');
      onDone();
    },
  );
  const ready = Boolean(amount && amount > 0 && allocation && payerId && accountId && paidOn) && !settle.isPending;

  return (
    <Sheet title={partial ? 'Quitar restante' : 'Quitar parcela inteira'} onClose={onClose}>
      <form
        className="stack installment-settle"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) settle.mutate(undefined);
        }}
      >
        <div className="settle-installment-head">
          <small>Parcela {installmentNo} · valor ainda aberto</small>
          <b className="num">{brl(expectedCents)}</b>
        </div>
        <MoneyInput label="Valor realmente cobrado" value={amount} onChange={setAmount} />
        {allocation && parts.length > 1 && (
          <div className="settle-allocation">
            {parts.map((part, index) => (
              <span key={`${part.userId}-${index}`}>
                {part.name} <b className="num">{brl(allocation[index])}</b>
              </span>
            ))}
          </div>
        )}
        {amount != null && delta !== 0 && (
          <div className={`settle-delta ${delta > 0 ? 'pos' : 'neg'}`}>
            <span>{delta > 0 ? 'Economia nesta quitação' : 'Valor a mais nesta quitação'}</span>
            <b className="num">{brl(Math.abs(delta))}</b>
          </div>
        )}
        <label className="f">
          <span>Quem está pagando</span>
          <select
            value={payerId ?? ''}
            required
            onChange={(event) => {
              const next = Number(event.target.value);
              setChosenPayer(next);
              setChosenAccount(parts.find((part) => part.userId === next)?.accountId ?? null);
            }}
          >
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        <label className="f">
          <span>Conta de onde sairá o total</span>
          <select value={accountId ?? ''} required onChange={(event) => setChosenAccount(Number(event.target.value))}>
            {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <label className="f">
          <span>Data do pagamento</span>
          <input type="date" value={paidOn} required onChange={(event) => setPaidOn(event.target.value)} />
        </label>
        <p className="settle-confirmation">
          A responsabilidade continua {divisionText}. <b>{payerName.split(/\s+/)[0]}</b> pagará <b className="num">{brl(amount ?? 0)}</b> pela conta <b>{accountName}</b>.
        </p>
        <ErrorText error={settle.error} />
        <div className="settle-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn" disabled={!ready}>Confirmar quitação</button>
        </div>
      </form>
    </Sheet>
  );
}
