import { useEffect, useState } from 'react';
import { daysInMonth } from '@fin/domain';
import { api, useAction, useApi, type Category, type Tx } from './api';
import { useAppState } from './state';
import { FollowingDeleteChoices, deleteChoicesFor, type TxSheetMode } from './TxMenu';
import { CategoryPicker } from './categories';
import { ForWhom } from './people';
import { CategoryTags, ErrorText, MoneyInput, Sheet, brl, shortDate } from './ui';

/** Detalhe de um lançamento: efetivar, editar, "não somar" e excluir. */
export function TxSheet({ tx, onClose, mode = 'view' }: { tx: Tx; onClose: () => void; mode?: TxSheetMode }) {
  const { toast, today } = useAppState();
  const [editing, setEditing] = useState(mode !== 'view');
  const amountOnly = mode === 'amount';
  const [ask, setAsk] = useState(false);
  const [form, setForm] = useState({
    description: tx.description,
    amount_cents: tx.amount_cents as number | null,
    category_id: tx.category_id,
    occurred_on: tx.occurred_on,
    for_user_id: tx.for_user_id ?? null,
  });
  const cats = useApi<Category[]>(`/categories?kind=${tx.kind}`);
  const createCategory = useAction(
    (body: { name: string; parent_id: number | null; color: string }) => api<Category>('/categories', { body: { ...body, kind: tx.kind } }),
    (cat) => setForm((f) => ({ ...f, category_id: cat.id })),
  );
  const income = tx.kind === 'income';
  const [counted, setCounted] = useState(Boolean(tx.include_in_reports));
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setCounted(Boolean(tx.include_in_reports)), [tx.id, tx.include_in_reports]);

  const act = useAction(
    (fn: () => Promise<unknown>) => fn(),
    () => undefined,
  );
  const run = (fn: () => Promise<unknown>, message: string, close = true) =>
    act.mutate(fn, {
      onSuccess: () => {
        toast(message);
        if (close) onClose();
      },
    });

  const generated = tx.recurrence_id ? 'recorrência' : tx.plan_id ? 'parcelamento' : null;
  const amountChanged = form.amount_cents != null && form.amount_cents !== tx.amount_cents;
  const dateChanged = !amountOnly && form.occurred_on !== tx.occurred_on;
  const localChanged =
    !amountOnly &&
    ((form.description ?? '') !== (tx.description ?? '') || form.category_id !== tx.category_id || (form.for_user_id ?? null) !== (tx.for_user_id ?? null));
  const dayName = income ? 'dia de recebimento' : 'dia de pagamento';
  const question = dateChanged
    ? amountChanged
      ? `O ${dayName} pode ir para as seguintes, mesmo as já pagas. O valor novo não mexe no que já foi pago. O mês de cada uma fica.`
      : `O ${dayName} pode valer só para esta, ou também para as que vêm depois, mesmo as já pagas. O mês de cada uma fica.`
    : 'O valor pode valer só para esta, ou também para as que vêm depois. O que já foi pago fica.';

  const save = (scope: 'one' | 'following') => {
    const body = amountOnly ? { amount_cents: form.amount_cents } : { ...form };
    const series = scope === 'following' && Boolean(tx.has_following) && (amountChanged || dateChanged);
    run(
      async () => {
        if (series && tx.recurrence_id) {
          await api(`/recurrences/${tx.recurrence_id}`, {
            method: 'PATCH',
            body: {
              ...(amountChanged ? { amount_cents: form.amount_cents } : {}),
              ...(dateChanged ? { day_of_month: Number(form.occurred_on.slice(8, 10)), include_settled: true } : {}),
              from_month: tx.competence_month,
            },
          });
          const covered = !tx.overridden && tx.status === 'planned' && tx.competence_month >= today.slice(0, 7);
          if (!covered || localChanged) await api(`/transactions/${tx.id}`, { method: 'PATCH', body });
          return;
        }
        if (series && tx.plan_id && tx.installment_no) {
          await api(`/installments/${tx.plan_id}/apply-from`, {
            body: {
              from_installment: tx.installment_no,
              ...(amountChanged ? { amount_cents: form.amount_cents } : {}),
              ...(dateChanged ? { day_of_month: Number(form.occurred_on.slice(8, 10)), include_settled: true } : {}),
            },
          });
          if (localChanged) {
            await api(`/transactions/${tx.id}`, {
              method: 'PATCH',
              body: { description: form.description, category_id: form.category_id, for_user_id: form.for_user_id },
            });
          }
          return;
        }
        await api(`/transactions/${tx.id}`, { method: 'PATCH', body });
      },
      series ? 'Esta e as seguintes foram atualizadas' : amountOnly ? 'Valor alterado' : 'Lançamento atualizado',
    );
  };

  return (
    <Sheet title={tx.description || (income ? 'Receita' : 'Despesa')} onClose={onClose}>
      <div className="card">
        <div className="hd">
          <span className="big-value num" style={{ fontSize: 28 }}>
            {brl(tx.amount_cents)}
          </span>
          <span className={`badge ${tx.display_status === 'paid' ? 'green' : tx.display_status === 'overdue' ? 'red' : 'gray'}`}>{tx.status_label}</span>
        </div>
        <CategoryTags tx={tx} />
        <div className="kv">
          <span>De quem</span>
          <b>{tx.for_user_name ?? 'Da casa'}</b>
        </div>
        <div className="kv">
          <span>{tx.card_id ? 'Cartão' : 'Conta'}</span>
          <b>{tx.card_name ?? tx.account_name}</b>
        </div>
        <div className="kv">
          <span>Data</span>
          <b>{shortDate(tx.occurred_on)}</b>
        </div>
        {tx.due_on && tx.due_on !== tx.occurred_on && (
          <div className="kv">
            <span>Vencimento</span>
            <b>{shortDate(tx.due_on)}</b>
          </div>
        )}
        {tx.paid_on && (
          <div className="kv">
            <span>{income ? 'Recebido em' : 'Pago em'}</span>
            <b>{shortDate(tx.paid_on)}</b>
          </div>
        )}
        {tx.installment_label && (
          <div className="kv">
            <span>Parcela</span>
            <b>{tx.installment_label}</b>
          </div>
        )}
        {generated && (
          <small>
            Gerado por {generated}
            {tx.overridden ? ' · editado nesta ocorrência' : ''}
          </small>
        )}
      </div>

      {confirmDelete && (tx.plan_id || tx.recurrence_id) ? (
        <FollowingDeleteChoices
          {...deleteChoicesFor(tx)}
          onClose={() => setConfirmDelete(false)}
          onChoose={(scope) => {
            if (scope === 'following' && tx.plan_id && tx.installment_no) {
              run(
                () => api(`/installments/${tx.plan_id}/delete-from`, { body: { from_installment: tx.installment_no } }),
                'Esta e as seguintes foram excluídas',
              );
            } else if (scope === 'following' && tx.recurrence_id) {
              run(
                () => api(`/recurrences/${tx.recurrence_id}/delete-from`, { body: { from_month: tx.competence_month } }),
                'Este mês e os seguintes foram excluídos',
              );
            } else {
              run(() => api(`/transactions/${tx.id}`, { method: 'DELETE' }), tx.plan_id ? 'Parcela excluída' : 'Lançamento excluído');
            }
          }}
        />
      ) : !editing ? (
        <div className="stack">
          {!tx.card_id && !tx.paid_on && (
            <button className="btn block" onClick={() => run(() => api(`/transactions/${tx.id}/pay`, { body: {} }), income ? 'Recebimento registrado' : 'Pagamento registrado')}>
              {income ? 'Marcar como recebido' : 'Marcar como pago'}
            </button>
          )}
          {tx.card_id && tx.status === 'planned' && (
            <button className="btn block" onClick={() => run(() => api(`/transactions/${tx.id}/pay`, { body: {} }), 'Compra confirmada')}>
              Confirmar compra no cartão
            </button>
          )}
          {!tx.card_id && tx.paid_on && (
            <button className="btn ghost block" onClick={() => run(() => api(`/transactions/${tx.id}/unpay`, { body: {} }), 'Voltou para previsto')}>
              Desfazer {income ? 'recebimento' : 'pagamento'}
            </button>
          )}
          <button className="btn ghost block" onClick={() => setEditing(true)}>
            Editar
          </button>
          <label className="toggle card">
            <span>
              Contar na soma
              <br />
              <small>Desligado, continua na lista e na fatura, mas sai do total do mês e do ano.</small>
            </span>
            <input
              type="checkbox"
              checked={counted}
              onChange={(e) => {
                const next = e.target.checked;
                setCounted(next);
                act.mutate(() => api(`/transactions/${tx.id}`, { method: 'PATCH', body: { include_in_reports: next } }), {
                  onSuccess: () => toast(next ? 'Voltou para a soma' : 'Saiu da soma do mês e do ano'),
                  onError: () => setCounted(!next),
                });
              }}
            />
          </label>
          <button
            className="btn danger block"
            onClick={() =>
              tx.plan_id || tx.recurrence_id ? setConfirmDelete(true) : run(() => api(`/transactions/${tx.id}`, { method: 'DELETE' }), 'Lançamento excluído')
            }
          >
            Excluir
          </button>
        </div>
      ) : ask ? (
        <div className="stack">
          <p style={{ margin: 0, fontWeight: 700 }}>{question}</p>
          <small>{dateChanged ? 'As anteriores ficam. O mês de cada uma continua o mesmo.' : 'As anteriores ficam. O que já foi pago também fica.'}</small>
          <button type="button" className="btn ghost block" disabled={act.isPending} onClick={() => save('one')}>
            Só esta
          </button>
          <button type="button" className="btn block" disabled={act.isPending} onClick={() => save('following')}>
            Esta e as seguintes
          </button>
          <button type="button" className="btn ghost block" onClick={() => setAsk(false)}>
            Voltar
          </button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if ((amountChanged || dateChanged) && tx.has_following) {
              setAsk(true);
              return;
            }
            save('one');
          }}
        >
          <MoneyInput value={form.amount_cents} onChange={(v) => setForm((f) => ({ ...f, amount_cents: v }))} />
          {!amountOnly && (
            <>
              <label className="f">
                <span>Descrição</span>
                <input value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </label>
              <CategoryPicker
                categories={cats.data}
                value={form.category_id}
                onChange={(category_id) => setForm((f) => ({ ...f, category_id }))}
                onCreate={(name, parent_id, color) => createCategory.mutate({ name, parent_id, color })}
                creating={createCategory.isPending}
              />
              <ForWhom value={form.for_user_id} onChange={(for_user_id) => setForm((f) => ({ ...f, for_user_id }))} />
            </>
          )}
          {!amountOnly && !(generated && tx.card_id) && (
            <label className="f">
              <span>{income ? 'Data de recebimento' : 'Data de pagamento'}</span>
              <input
                type="date"
                value={form.occurred_on}
                min={generated ? `${tx.competence_month}-01` : undefined}
                max={generated ? `${tx.competence_month}-${String(daysInMonth(tx.competence_month)).padStart(2, '0')}` : undefined}
                onChange={(e) => setForm((f) => ({ ...f, occurred_on: e.target.value }))}
                required
              />
            </label>
          )}
          {Boolean(tx.has_following) && (
            <small>
              {generated && !tx.card_id
                ? 'Mudar o dia pergunta se vale só para esta ou também para as seguintes. O mês de cada uma fica.'
                : 'Se o valor ou a data mudar, a tela pergunta se vale só para esta ou também para as seguintes.'}
            </small>
          )}
          <div className="row">
            <button type="button" className="btn ghost grow" onClick={() => (mode === 'view' ? setEditing(false) : onClose())}>
              Cancelar
            </button>
            <button className="btn grow" disabled={!form.amount_cents || act.isPending}>
              Salvar
            </button>
          </div>
        </form>
      )}
      <ErrorText error={act.error ?? createCategory.error} />
    </Sheet>
  );
}
