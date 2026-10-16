import { useState } from 'react';
import { api, useAction, useApi } from '../api';
import type { Goal } from '../types';
import { useAppState } from '../state';
import { BackButton, Bar, ErrorText, Loading, MoneyInput, Sheet, brl } from '../ui';
import { useConfirm } from '../useConfirm';

const fullDate = (iso: string) => iso.split('-').reverse().join('/');

function GoalForm({ goal, onClose }: { goal?: { id: number; name: string; target_cents: number; deadline: string | null }; onClose: () => void }) {
  const { toast } = useAppState();
  const [form, setForm] = useState({
    name: goal?.name ?? '',
    target_cents: (goal?.target_cents ?? null) as number | null,
    saved_cents: null as number | null,
    deadline: goal?.deadline ?? '',
  });
  const save = useAction(
    () => {
      const body = { name: form.name, target_cents: form.target_cents, deadline: form.deadline || null, ...(goal ? {} : { saved_cents: form.saved_cents ?? 0 }) };
      return goal ? api(`/goals/${goal.id}`, { method: 'PATCH', body }) : api('/goals', { body });
    },
    () => {
      toast(goal ? 'Meta atualizada' : 'Meta criada');
      onClose();
    },
  );
  return (
    <Sheet title={goal ? 'Editar meta' : 'Nova meta'} onClose={onClose}>
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
        {!goal && <MoneyInput label="Já guardado" value={form.saved_cents} onChange={(v) => setForm((f) => ({ ...f, saved_cents: v }))} />}
        <label className="f">
          <span>Prazo</span>
          <input type="date" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
        </label>
        <ErrorText error={save.error} />
        <button className="btn big" disabled={!form.target_cents || save.isPending}>
          {goal ? 'Salvar' : 'Criar meta'}
        </button>
      </form>
    </Sheet>
  );
}

function DepositSheet({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { celebrate, toast } = useAppState();
  const [amount, setAmount] = useState<number | null>(null);
  const [withdraw, setWithdraw] = useState(false);
  const [editing, setEditing] = useState(false);
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
  const { confirm, dialog } = useConfirm();
  return (
    <>
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
        {!withdraw && (
          <div className="chips" aria-label="Valores rápidos">
            {[5_000, 10_000, 20_000, 50_000].map((v) => (
              <button key={v} type="button" className="chip sm" onClick={() => setAmount((a) => (a ?? 0) + v)}>+{brl(v)}</button>
            ))}
            {Math.max(0, goal.target_cents - goal.saved_cents) > 0 && (
              <button type="button" className="chip sm" onClick={() => setAmount(Math.max(0, goal.target_cents - goal.saved_cents))}>
                Completar ({brl(Math.max(0, goal.target_cents - goal.saved_cents))})
              </button>
            )}
            <button type="button" className="chip sm" onClick={() => setAmount(null)}>Limpar</button>
          </div>
        )}
        <label className="toggle">
          <span>Retirar em vez de guardar</span>
          <input type="checkbox" checked={withdraw} onChange={(e) => setWithdraw(e.target.checked)} />
        </label>
        <ErrorText error={deposit.error ?? remove.error} />
        <button type="button" className="btn ghost block" onClick={() => setEditing(true)}>
          Editar
        </button>
        <button className="btn big" disabled={!amount || deposit.isPending}>
          {withdraw ? 'Retirar' : 'Guardar'}
        </button>
        <button
          type="button"
          className="btn danger block"
          onClick={() => confirm(`Excluir a meta “${goal.name}”? Você tinha guardado ${brl(goal.saved_cents)} nela.`, () => remove.mutate(undefined))}
        >
          Excluir meta
        </button>
      </form>
    </Sheet>
    {editing && <GoalForm goal={goal} onClose={() => setEditing(false)} />}
    {dialog}
    </>
  );
}

export function MetasPage() {
  const { today } = useAppState();
  const q = useApi<Goal[]>('/goals');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  return (
    <main className="page">
      <div className="hd">
        <div className="title-row">
          <BackButton />
          <h1>Metas</h1>
        </div>
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
              <div className="goal-foot">
                <small className="num">
                  {brl(g.saved_cents)} de {brl(g.target_cents)}
                </small>
                {g.deadline && (
                  <small>
                    até {fullDate(g.deadline)}
                    {g.target_cents > g.saved_cents ? (g.deadline < today ? ' · Prazo vencido' : ` · Guarde ${brl(Math.ceil((g.target_cents - g.saved_cents) / Math.max(1, (Number(g.deadline.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + (Number(g.deadline.slice(5, 7)) - Number(today.slice(5, 7))) + 1)))} por mês`) : ''}
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
