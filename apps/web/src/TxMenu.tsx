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

/** A mesma pergunta na fixa e no parcelamento: só esta, ou esta e as seguintes. */
export function FollowingDeleteChoices({
  following,
  text,
  lastText,
  onChoose,
  onClose,
}: {
  following: boolean;
  text: string;
  lastText: string;
  onChoose: (scope: 'one' | 'following') => void;
  onClose: () => void;
}) {
  return (
    <>
      <p style={{ margin: 0, fontWeight: 700 }}>{following ? text : lastText}</p>
      {following && <small>As anteriores ficam. As seguintes saem, mesmo as que já foram pagas.</small>}
      <div className="stack">
        <button type="button" className="btn ghost block" onClick={() => onChoose('one')}>
          Só esta
        </button>
        {following && (
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

export function deleteChoicesFor(tx: Tx) {
  if (tx.plan_id) {
    const last = isLastInstallment(tx.installment_label);
    return {
      following: !last,
      text: tx.installment_label
        ? `A parcela ${tx.installment_label} pode sair sozinha, ou junto com as que vêm depois.`
        : 'Esta parcela pode sair sozinha, ou junto com as que vêm depois.',
      lastText: `Esta é a última parcela${tx.installment_label ? ` (${tx.installment_label})` : ''}. Apagar só ela?`,
    };
  }
  return {
    following: Boolean(tx.has_following),
    text: 'Este mês pode sair sozinho, ou junto com os que vêm depois.',
    lastText: 'Não há outros meses depois deste. Apagar só este?',
  };
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
        (tx.plan_id || tx.recurrence_id ? (
          <Sheet title={tx.plan_id ? 'Excluir parcela' : 'Excluir mês da fixa'} onClose={() => setConfirmDelete(false)}>
            <FollowingDeleteChoices
              {...deleteChoicesFor(tx)}
              onClose={() => setConfirmDelete(false)}
              onChoose={(scope) => {
                setConfirmDelete(false);
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
          </Sheet>
        ) : (
          <Confirm
            danger
            text={`Excluir ${tx.description || (income ? 'esta receita' : 'esta despesa')}?`}
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
