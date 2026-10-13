import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addMonthsToDate } from '@fin/domain';
import { ApiError, api, clientUuid, useAction, type Tx } from './api';
import { useAppState } from './state';
import { Confirm, Icon, Sheet } from './ui';

export type TxSheetMode = 'view' | 'edit' | 'amount';

function isLastInstallment(label: string | null) {
  const [current, total] = label?.split('/') ?? [];
  return Boolean(current && total && current === total);
}

/** Pergunta se a exclusão vale só para a parcela aberta ou também para as seguintes. */
export function InstallmentDeleteChoices({
  label,
  onChoose,
  onClose,
}: {
  label: string | null;
  onChoose: (scope: 'one' | 'following') => void;
  onClose: () => void;
}) {
  const last = isLastInstallment(label);
  return (
    <>
      <p style={{ margin: 0, fontWeight: 700 }}>
        {last
          ? `Esta é a última parcela${label ? ` (${label})` : ''}. Apagar só ela?`
          : label
            ? `A parcela ${label} pode sair sozinha, ou junto com as que vêm depois.`
            : 'Esta parcela pode sair sozinha, ou junto com as que vêm depois.'}
      </p>
      {!last && <small>As parcelas anteriores continuam.</small>}
      <div className="stack">
        <button type="button" className="btn ghost block" onClick={() => onChoose('one')}>
          Só esta parcela
        </button>
        {!last && (
          <button type="button" className="btn danger block" onClick={() => onChoose('following')}>
            Esta e as seguintes
          </button>
        )}
        <button type="button" className="btn ghost block" onClick={onClose}>
          Voltar
        </button>
      </div>
    </>
  );
}

/** Menu de três pontos de uma linha de lançamento. */
export function TxMenu({ tx, onOpen }: { tx: Tx; onOpen: (mode: TxSheetMode) => void }) {
  const navigate = useNavigate();
  const { toast, celebrate } = useAppState();
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const income = tx.kind === 'income';

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const act = useAction((fn: () => Promise<unknown>) => fn());
  const run = (fn: () => Promise<unknown>, message: string) => {
    setOpen(false);
    act.mutate(fn, {
      onSuccess: (res: any) => (res?.xp?.xp ? celebrate(res.xp, message) : toast(message)),
      onError: (err) => toast(err instanceof ApiError ? err.message : 'Não foi possível concluir'),
    });
  };

  const duplicate = (months: number) =>
    run(
      () =>
        api('/transactions', {
          body: {
            client_uuid: clientUuid(),
            kind: tx.kind,
            description: tx.description || undefined,
            amount_cents: tx.amount_cents,
            occurred_on: addMonthsToDate(tx.occurred_on, months),
            category_id: tx.category_id,
            ...(tx.card_id ? { card_id: tx.card_id } : { account_id: tx.account_id, paid: false }),
          },
        }),
      months ? 'Cópia criada no próximo mês' : 'Cópia criada neste mês',
    );

  const settled = tx.card_id ? tx.status === 'posted' : Boolean(tx.paid_on);
  const toggleSettled = () =>
    run(
      () => api(`/transactions/${tx.id}/${settled ? 'unpay' : 'pay'}`, { body: {} }),
      settled ? 'Voltou para previsto' : tx.card_id ? 'Compra confirmada' : income ? 'Recebimento registrado' : 'Pagamento registrado',
    );

  const item = (label: string, onClick: () => void, className = '') => (
    <button
      type="button"
      role="menuitem"
      className={className}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="kebab-wrap" ref={wrap}>
      <button
        type="button"
        className="kebab"
        aria-label={`Ações de ${tx.description || (income ? 'receita' : 'despesa')}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setUp(window.innerHeight - rect.bottom < 360);
          setDupOpen(false);
          setOpen(!open);
        }}
      >
        <Icon.kebab />
      </button>
      {open && (
        <div className={`menu${up ? ' up' : ''}`} role="menu">
          {item('Editar', () => onOpen('edit'))}
          {item('Alterar valor', () => onOpen('amount'))}
          <button type="button" role="menuitem" aria-expanded={dupOpen} onClick={() => setDupOpen(!dupOpen)}>
            Duplicar <span aria-hidden>{dupOpen ? '▾' : '▸'}</span>
          </button>
          {dupOpen && (
            <>
              <button type="button" role="menuitem" className="sub" onClick={() => duplicate(0)}>
                Neste mês
              </button>
              <button type="button" role="menuitem" className="sub" onClick={() => duplicate(1)}>
                No próximo mês
              </button>
            </>
          )}
          {tx.plan_id && item('Ver parcelas', () => navigate('/parcelamentos'))}
          {tx.recurrence_id && item(income ? 'Ver receita fixa' : 'Ver despesa fixa', () => navigate('/recorrencias'))}
          {!(tx.card_id && settled) && (
            <label className="menu-check">
              <span>{tx.card_id ? 'Confirmada' : income ? 'Recebida' : 'Paga'}</span>
              <input type="checkbox" checked={settled} onChange={toggleSettled} />
            </label>
          )}
          {item('Excluir', () => setConfirmDelete(true), 'danger')}
        </div>
      )}
      {confirmDelete &&
        (tx.plan_id ? (
          <Sheet title="Excluir parcela" onClose={() => setConfirmDelete(false)}>
            <InstallmentDeleteChoices
              label={tx.installment_label}
              onClose={() => setConfirmDelete(false)}
              onChoose={(scope) => {
                setConfirmDelete(false);
                if (scope === 'following' && tx.installment_no) {
                  run(
                    () => api(`/installments/${tx.plan_id}/delete-from`, { body: { from_installment: tx.installment_no } }),
                    'Esta parcela e as seguintes foram excluídas',
                  );
                } else {
                  run(() => api(`/transactions/${tx.id}`, { method: 'DELETE' }), 'Parcela excluída');
                }
              }}
            />
          </Sheet>
        ) : (
          <Confirm
            danger
            text={
              tx.recurrence_id
                ? 'Excluir só este mês? A fixa continua nos outros meses.'
                : `Excluir ${tx.description || (income ? 'esta receita' : 'esta despesa')}?`
            }
            onClose={() => setConfirmDelete(false)}
            onConfirm={() => {
              setConfirmDelete(false);
              run(() => api(`/transactions/${tx.id}`, { method: 'DELETE' }), 'Lançamento excluído');
            }}
          />
        ))}
    </div>
  );
}
