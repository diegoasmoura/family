import { useState } from "react";
import { api, useAction, type Account } from "./api";
import { useAppState } from "./state";
import { BankPicker } from "./banks";
import { ErrorText, MoneyInput, Sheet } from "./ui";
import { useConfirm } from "./useConfirm";
import { DeleteConfirm } from "./DeleteConfirm";

export const TYPES: [string, string][] = [
  ['checking', 'Conta corrente'],
  ['savings', 'Poupança'],
  ['cash', 'Dinheiro'],
  ['wallet', 'Carteira digital'],
  ['investment', 'Investimento'],
];
export const typeLabel = (t: string) => TYPES.find(([k]) => k === t)?.[1] ?? t;

export function AccountForm({ account, isAdmin = false, onClose, onSaved }: { account?: Account; isAdmin?: boolean; onClose: () => void; onSaved?: (account: Account) => void }) {
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
    (saved: Account) => {
      toast(account ? 'Conta atualizada' : 'Conta criada');
      onSaved?.(saved);
      onClose();
    },
  );
  const [deleting, setDeleting] = useState(false);
  const archive = useAction(
    () => api(`/accounts/${account!.id}`, { method: 'PATCH', body: { archived: 1 } }),
    () => {
      toast('Conta arquivada');
      onClose();
    },
  );
  const remove = useAction(
    () => api(`/accounts/${account!.id}`, { method: 'DELETE' }),
    () => {
      toast('Conta excluída');
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
        <ErrorText error={save.error ?? archive.error ?? remove.error} />
        <button className="btn block" disabled={save.isPending || !form.name.trim()}>
          Salvar
        </button>
        {account && isAdmin && (
          <>
            <button
              type="button"
              className="btn ghost block"
              onClick={() => confirm(`Arquivar “${account.name}”? Ela some das listas, mas os lançamentos continuam no histórico e nos totais. Dá para reativar depois.`, () => archive.mutate(undefined), false)}
            >
              Arquivar conta
            </button>
            <button type="button" className="btn danger block" onClick={() => setDeleting(true)}>
              Excluir conta e lançamentos
            </button>
          </>
        )}
      </form>
    </Sheet>
    {dialog}
    {deleting && account && (
      <DeleteConfirm
        kind="accounts"
        id={account.id}
        name={account.name}
        onConfirm={() => {
          setDeleting(false);
          remove.mutate(undefined);
        }}
        onClose={() => setDeleting(false)}
      />
    )}
    </>
  );
}

