import { useState } from 'react';
import { api, useAction, useApi } from '../api';
import { useAppState } from '../state';
import { Bar, ErrorText, Loading, MoneyInput, Sheet, brl, shortDate } from '../ui';

function GoalForm({ onClose }: { onClose: () => void }) {
  const { toast } = useAppState();
  const [form, setForm] = useState({ name: '', target_cents: null as number | null, saved_cents: null as number | null, deadline: '' });
  const save = useAction(
    () => api('/goals', { body: { name: form.name, target_cents: form.target_cents, saved_cents: form.saved_cents ?? 0, deadline: form.deadline || null } }),
    () => {
      toast('Meta criada');
      onClose();
    },
  );
  return (
    <Sheet title="Nova meta" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <label className="f">
          <span>Nome</span>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Ex.: Viagem" />
        </label>
        <MoneyInput label="Meta" value={form.target_cents} onChange={(v) => setForm((f) => ({ ...f, target_cents: v }))} />
        <MoneyInput label="Já guardado" value={form.saved_cents} onChange={(v) => setForm((f) => ({ ...f, saved_cents: v }))} />
        <label className="f">
          <span>Prazo</span>
          <input type="date" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
        </label>
        <ErrorText error={save.error} />
        <button className="btn big" disabled={!form.target_cents || save.isPending}>
          Criar meta
        </button>
      </form>
    </Sheet>
  );
}

function DepositSheet({ goal, onClose }: { goal: any; onClose: () => void }) {
  const { celebrate, toast } = useAppState();
  const [amount, setAmount] = useState<number | null>(null);
  const [withdraw, setWithdraw] = useState(false);
  const deposit = useAction(
    () => api(`/goals/${goal.id}/deposit`, { body: { amount_cents: withdraw ? -(amount ?? 0) : amount } }),
    (r: any) => {
      if (r.xp?.xp) celebrate(r.xp, 'Meta concluída!');
      else toast(withdraw ? 'Valor retirado' : 'Valor guardado');
      onClose();
    },
  );
  const remove = useAction(
    () => api(`/goals/${goal.id}`, { method: 'DELETE' }),
    () => {
      toast('Meta excluída');
      onClose();
    },
  );
  return (
    <Sheet title={goal.name} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          deposit.mutate(undefined);
        }}
      >
        <small>
          Guardado {brl(goal.saved_cents)} de {brl(goal.target_cents)}
        </small>
        <MoneyInput big label={withdraw ? 'Retirar' : 'Guardar'} value={amount} onChange={setAmount} />
        <label className="toggle">
          <span>Retirar em vez de guardar</span>
          <input type="checkbox" checked={withdraw} onChange={(e) => setWithdraw(e.target.checked)} />
        </label>
        <ErrorText error={deposit.error ?? remove.error} />
        <button className="btn big" disabled={!amount || deposit.isPending}>
          {withdraw ? 'Retirar' : 'Guardar'}
        </button>
        <button type="button" className="btn danger block" onClick={() => remove.mutate(undefined)}>
          Excluir meta
        </button>
      </form>
    </Sheet>
  );
}

export function MetasPage() {
  const q = useApi<any[]>('/goals');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  return (
    <main className="page">
      <div className="hd">
        <h1>Metas</h1>
        <button className="btn sm" onClick={() => setCreating(true)}>
          + Meta
        </button>
      </div>
      <ErrorText error={q.error} />
      {!q.data ? (
        <Loading />
      ) : (
        <div className="stack">
          {q.data.map((g) => (
            <button key={g.id} className="card click" onClick={() => setSelected(g)}>
              <div className="hd">
                <b>{g.name}</b>
                {g.completed_at ? <span className="badge green">Concluída</span> : <span className="badge">{Math.round(g.progress * 100)}%</span>}
              </div>
              <Bar ratio={g.progress} kind="xp" />
              <div className="hd">
                <small className="num">
                  {brl(g.saved_cents)} de {brl(g.target_cents)}
                </small>
                {g.deadline && (
                  <small>
                    até {shortDate(g.deadline)}/{g.deadline.slice(0, 4)}
                  </small>
                )}
              </div>
            </button>
          ))}
          {q.data.length === 0 && <p className="empty">Crie uma meta para acompanhar quanto já guardaram.</p>}
        </div>
      )}
      {creating && <GoalForm onClose={() => setCreating(false)} />}
      {selected && <DepositSheet goal={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
