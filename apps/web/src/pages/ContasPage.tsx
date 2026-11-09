import { useState } from 'react';
import { api, useAction, useApi, type Account, type Me, type MonthFlow } from '../api';
import { useAppState } from '../state';
import { BankMark } from '../banks';
import { BackButton, ErrorText, Icon, Loading, MoneyInput, MonthNav, Sheet, brl, shortDate } from '../ui';
import { useConfirm } from '../useConfirm';
import { useSwipe } from '../useSwipe';
import type { Transfer } from '../types';
import { AccountForm, typeLabel } from '../AccountForm';
import { DeleteConfirm } from '../DeleteConfirm';
import { addMonths, monthOf } from '@fin/domain';

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

const ZERO: MonthFlow = { in_cents: 0, out_cents: 0, planned_in_cents: 0, planned_out_cents: 0 };

/** Resultado com sinal: "+R$ 10,00" / "−R$ 10,00". */
function signed(cents: number) {
  return `${cents < 0 ? '−' : '+'}${brl(Math.abs(cents))}`;
}

/**
 * Topo da tela: só o mês escolhido. O que já entrou e saiu das contas, o resultado e, se ainda
 * houver algo previsto, como o mês fecha. Transferência entre contas não entra (só muda o lugar).
 */
function MonthFlowStats({ flow = ZERO, future, past }: { flow?: MonthFlow; future: boolean; past: boolean }) {
  const real = flow.in_cents - flow.out_cents;
  const planned = real + flow.planned_in_cents - flow.planned_out_cents;
  const pending = flow.planned_in_cents > 0 || flow.planned_out_cents > 0;
  return (
    <>
      <div className="stats">
        <div className="st ok">
          <small>Entrou no mês</small>
          <b className="num">{brl(flow.in_cents)}</b>
        </div>
        <div className="st">
          <small>Saiu no mês</small>
          <b className="num">{brl(flow.out_cents)}</b>
        </div>
      </div>
      <div className="kv acc-result">
        <span>{future ? 'Previsto para o mês' : past ? 'Resultado do mês' : 'Resultado do mês até hoje'}</span>
        <b className={`num ${(future ? planned : real) < 0 ? 'neg' : 'pos'}`}>{signed(future ? planned : real)}</b>
      </div>
      {!future && pending && (
        <div className="kv acc-result sub">
          <span>Com o que ainda está previsto</span>
          <b className="num">{signed(planned)}</b>
        </div>
      )}
    </>
  );
}

/** Na linha da conta: o resultado do mês e, embaixo, quanto entrou e saiu dela. */
function AccountFlow({ flow = ZERO }: { flow?: MonthFlow }) {
  const real = flow.in_cents - flow.out_cents;
  const quiet = flow.in_cents === 0 && flow.out_cents === 0;
  return (
    <div className="v">
      <span className={`money${quiet ? '' : real < 0 ? ' neg' : ' pos'}`}>{quiet ? '–' : signed(real)}</span>
      <small>
        entrou <span className="money">{brl(flow.in_cents)}</span> · saiu <span className="money">{brl(flow.out_cents)}</span>
      </small>
    </div>
  );
}

export function ContasPage({ me }: { me: Me }) {
  const { month, setMonth, toast, today } = useAppState();
  const q = useApi<{ accounts: Account[]; month_flow: MonthFlow }>(`/accounts?month=${month}`);
  const transfers = useApi<Transfer[]>(`/transfers?month=${month}`);
  const withArchived = useApi<{ accounts: Account[] }>(`/accounts?month=${month}&archived=1`);
  const archivedAccounts = (withArchived.data?.accounts ?? []).filter((a) => a.archived);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
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
        <button type="button" className="hd-add" aria-label="Nova conta" onClick={() => setEditing('new')}>
          <Icon.plus /> Conta
        </button>
      </div>
      <MonthNav month={month} onChange={setMonth} />
      <ErrorText error={q.error} />
      {!q.data ? (
        <Loading />
      ) : (
        <>
          <MonthFlowStats flow={q.data.month_flow} future={month > monthOf(today)} past={month < monthOf(today)} />
          <div className="list">
            {q.data.accounts.map((a) => (
              <div className="rw" key={a.id}>
                <button className="r" onClick={() => setEditing(a)}>
                  <BankMark name={a.name} size={40} fallback />
                  <div className="m">
                    <span className="t">{a.name}</span>
                    <small>{typeLabel(a.type)}</small>
                  </div>
                  <AccountFlow flow={a.month_flow} />
                </button>
              </div>
            ))}
            {q.data.accounts.length === 0 && <p className="empty">Cadastre a primeira conta.</p>}
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
          {transfers.data && transfers.data.length > 0 && (
            <section className="card">
              <h2>Transferências do mês</h2>
              {transfers.data.map((t) => (
                <div className="kv" key={t.id}>
                  <span>
                    {shortDate(t.occurred_on)} · {t.from_account_name} <span className="inline-ic" aria-hidden><Icon.right /></span> {t.to_account_name}
                  </span>
                  <span className="row">
                    <b className="num">{brl(t.amount_cents)}</b>
                    <button
                      className="link"
                      onClick={() =>
                        confirm(
                          `Remover a transferência de ${brl(t.amount_cents)} (${t.from_account_name} → ${t.to_account_name})? As duas contas voltam ao que eram.`,
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
      {transferring && q.data && <TransferForm accounts={q.data.accounts} onClose={() => setTransferring(false)} />}
      {dialog}
    </main>
  );
}
