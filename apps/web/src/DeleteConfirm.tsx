import { useApi } from './api';
import { Confirm, ErrorText, Loading, Sheet } from './ui';

interface Impact {
  transactions: number;
  installment_plans: number;
  recurrences: number;
  invoice_payments: number;
  transfers?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const join = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items.at(-1)}` : (items[0] ?? ''));

/** Confirmação de exclusão que mostra, antes, tudo o que vai embora junto. */
export function DeleteConfirm({ kind, id, name, onConfirm, onClose }: { kind: 'cards' | 'accounts'; id: number; name: string; onConfirm: () => void; onClose: () => void }) {
  const q = useApi<Impact>(`/${kind}/${id}/impact`, { staleTime: 0, gcTime: 0 });
  if (!q.data) {
    return (
      <Sheet title="Confirmar" onClose={onClose}>
        {q.error ? <ErrorText error={q.error} /> : <Loading />}
      </Sheet>
    );
  }
  const i = q.data;
  const parts = [
    i.transactions > 0 && plural(i.transactions, 'lançamento', 'lançamentos'),
    (i.transfers ?? 0) > 0 && plural(i.transfers ?? 0, 'transferência', 'transferências'),
    i.installment_plans > 0 && plural(i.installment_plans, 'parcelamento', 'parcelamentos'),
    i.recurrences > 0 && plural(i.recurrences, 'fixa', 'fixas'),
    i.invoice_payments > 0 && plural(i.invoice_payments, 'pagamento de fatura', 'pagamentos de fatura'),
  ].filter((x): x is string => Boolean(x));
  const effect =
    i.invoice_payments === 0 ? '' : kind === 'accounts' ? ' As faturas que esta conta pagou voltam a ficar em aberto.' : ' O dinheiro desses pagamentos volta para as contas.';
  const text = parts.length
    ? `Excluir “${name}” para sempre? Isso apaga também ${join(parts)}.${effect} Não dá para desfazer. Para guardar o histórico, use Arquivar.`
    : `Excluir “${name}”? Não há nenhum lançamento ligado a ${kind === 'cards' ? 'ele' : 'ela'}.`;
  return <Confirm danger text={text} onConfirm={onConfirm} onClose={onClose} />;
}
