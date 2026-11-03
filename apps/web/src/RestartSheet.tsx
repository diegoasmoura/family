import { useState } from 'react';
import { monthLabel } from '@fin/domain';
import { api, useAction, useApi } from './api';
import { BankMark } from './banks';
import { useAppState } from './state';
import { ErrorText, Loading, MoneyInput, Sheet, brl } from './ui';
import { useConfirm } from './useConfirm';

interface Preview {
  month: string;
  date: string;
  accounts: { id: number; name: string; current_balance_cents: number; ignored_movements: number }[];
  pending_expenses: { count: number; total_cents: number };
  pending_incomes: { count: number; total_cents: number };
  card_invoices: { count: number; remaining_cents: number };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Recomeçar do zero: cada conta passa a valer a partir do dia 1º do mês, com o saldo informado. O que veio antes fica
 * no histórico e nos relatórios, mas deixa de contar para o saldo.
 */
export function RestartSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const { toast } = useAppState();
  const q = useApi<Preview>(`/accounts/restart/preview?month=${month}`, { staleTime: 0, gcTime: 0 });
  const [balances, setBalances] = useState<Record<number, number | null>>({});
  const [deletePending, setDeletePending] = useState(false);
  const { confirm, dialog } = useConfirm();
  const when = monthLabel(month);

  const save = useAction(
    () =>
      api('/accounts/restart', {
        body: {
          month,
          accounts: (q.data?.accounts ?? []).map((a) => ({ id: a.id, balance_cents: balances[a.id] ?? 0 })),
          delete_pending: deletePending,
        },
      }),
    (r: { deleted_pending: number }) => {
      toast(r.deleted_pending > 0 ? `Contas recomeçadas em ${when.toLowerCase()}. ${plural(r.deleted_pending, 'conta atrasada apagada', 'contas atrasadas apagadas')}` : `Contas recomeçadas em ${when.toLowerCase()}`);
      onClose();
    },
  );

  if (!q.data) {
    return (
      <Sheet title={`Recomeçar em ${when.toLowerCase()}`} onClose={onClose}>
        {q.error ? <ErrorText error={q.error} /> : <Loading />}
      </Sheet>
    );
  }
  const d = q.data;
  const ignored = d.accounts.reduce((sum, a) => sum + a.ignored_movements, 0);
  const pending = d.pending_expenses.count + d.pending_incomes.count;

  return (
    <>
      <Sheet title={`Recomeçar em ${when.toLowerCase()}`} onClose={onClose}>
        <p className="restart-intro">
          Cada conta passa a valer a partir de <b>{dmy(d.date)}</b> com o saldo abaixo. O que veio antes continua no histórico e nos relatórios, mas deixa de contar para o saldo.
        </p>

        {d.accounts.length === 0 && <p className="restart-intro">Nenhuma conta ativa.</p>}
        {d.accounts.map((a) => (
          <div key={a.id} className="restart-acc">
            <div className="row" style={{ gap: 10 }}>
              <BankMark name={a.name} size={34} fallback />
              <div className="m" style={{ minWidth: 0 }}>
                <b>{a.name}</b>
                <small>Hoje: {brl(a.current_balance_cents)}</small>
              </div>
            </div>
            <MoneyInput label={`Saldo em ${dmy(d.date).slice(0, 5)}`} allowNegative value={balances[a.id] ?? 0} onChange={(v) => setBalances((b) => ({ ...b, [a.id]: v }))} />
          </div>
        ))}

        <section className="card restart-left" aria-label="O que fica para trás">
          <h2>O que fica para trás</h2>
          <ul>
            <li>
              {ignored > 0
                ? `${plural(ignored, 'lançamento pago ou recebido', 'lançamentos pagos ou recebidos')} antes de ${dmy(d.date).slice(0, 5)} deixa${ignored === 1 ? '' : 'm'} de contar para o saldo.`
                : 'Nenhum lançamento pago antes dessa data.'}
            </li>
            {d.pending_expenses.count > 0 && (
              <li>
                {plural(d.pending_expenses.count, 'conta a pagar', 'contas a pagar')} em aberto de antes ({brl(d.pending_expenses.total_cents)}) continua aparecendo como atrasada, mas não pesa no saldo.
              </li>
            )}
            {d.pending_incomes.count > 0 && (
              <li>
                {plural(d.pending_incomes.count, 'conta a receber', 'contas a receber')} em aberto de antes ({brl(d.pending_incomes.total_cents)}) continua aparecendo como atrasada, mas não entra no saldo.
              </li>
            )}
            {d.card_invoices.count > 0 && (
              <li>
                {plural(d.card_invoices.count, 'fatura de cartão em aberto', 'faturas de cartão em aberto')} ({brl(d.card_invoices.remaining_cents)}) não é alterada. Para limpar, pague em Cartões ou exclua o cartão.
              </li>
            )}
          </ul>
        </section>

        {pending > 0 && (
          <label className="toggle">
            <span>Apagar as contas atrasadas de antes ({plural(pending, 'conta', 'contas')})</span>
            <input type="checkbox" checked={deletePending} onChange={(e) => setDeletePending(e.target.checked)} />
          </label>
        )}
        {deletePending && <small className="late">Apagar tira essas contas dos meses antigos também, e não dá para desfazer pelo app.</small>}

        <ErrorText error={save.error} />
        <button
          type="button"
          className="btn danger block"
          disabled={save.isPending || d.accounts.length === 0}
          onClick={() =>
            confirm(
              `Recomeçar em ${when.toLowerCase()}? ${plural(d.accounts.length, 'conta passa', 'contas passam')} a valer a partir de ${dmy(d.date)}.${deletePending ? ` As ${plural(pending, 'conta atrasada', 'contas atrasadas')} de antes serão apagadas.` : ''} Isso não dá para desfazer pelo app.`,
              () => save.mutate(undefined),
            )
          }
        >
          Recomeçar em {when.toLowerCase()}
        </button>
      </Sheet>
      {dialog}
    </>
  );
}
