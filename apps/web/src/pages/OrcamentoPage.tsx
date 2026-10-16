import { useState } from 'react';
import { addMonths, daysInMonth } from '@fin/domain';
import { api, useAction, useApi } from '../api';
import { useAppState } from '../state';
import { useSwipe } from '../useSwipe';
import { BackButton, Bar, ErrorText, Loading, MoneyInput, MonthNav, Sheet, brl, categoryTree } from '../ui';
import type { BudgetItem } from '../types';

export function OrcamentoPage() {
  const { month, setMonth, toast, today } = useAppState();
  const swipe = useSwipe(() => setMonth(addMonths(month, -1)), () => setMonth(addMonths(month, 1)));
  const q = useApi<{ items: BudgetItem[]; planned_cents: number; spent_cents: number }>(`/budgets?month=${month}`);
  const [editing, setEditing] = useState<(BudgetItem & { id: number }) | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const save = useAction(
    () => {
      if (!editing) return Promise.reject(new Error('Nada para salvar'));
      return value == null && editing.budget_id
        ? api(`/budgets/${editing.budget_id}`, { method: 'DELETE' })
        : api('/budgets', { method: 'PUT', body: { category_id: editing.category_id, month, planned_cents: value ?? 0 } });
    },
    () => {
      toast('Orçamento salvo');
      setEditing(null);
    },
  );
  const copy = useAction(
    () => api('/budgets/copy', { body: { from: addMonths(month, -1), to: month } }),
    (r: any) => toast(r.copied ? `${r.copied} categorias copiadas` : 'Nada novo para copiar'),
  );

  const items = categoryTree((q.data?.items ?? []).map((i) => ({ ...i, id: i.category_id })));

  return (
    <main className="page" {...swipe}>
      <div className="title-row">
        <BackButton />
        <h1>Orçamento</h1>
      </div>
      <MonthNav month={month} onChange={setMonth} />
      <ErrorText error={q.error ?? copy.error} />
      {!q.data ? (
        <Loading />
      ) : (
        <>
          <section className="card soft">
            <div className="hd">
              <small>Gasto nas categorias orçadas</small>
              <b className="num">
                {brl(q.data.spent_cents)} / {brl(q.data.planned_cents)}
              </b>
            </div>
            <Bar ratio={q.data.planned_cents ? q.data.spent_cents / q.data.planned_cents : 0} kind={q.data.spent_cents > q.data.planned_cents && q.data.planned_cents ? 'over' : undefined} />
            <small>A missão "ficar abaixo do orçamento" usa esse total.</small>
            {month === today.slice(0, 7) && Number(today.slice(8, 10)) > 0 && q.data.planned_cents > 0 && (
              <small className={Math.round((q.data.spent_cents / Number(today.slice(8, 10))) * daysInMonth(month)) > q.data.planned_cents ? 'late' : undefined}>
                No ritmo atual, fecha em {brl(Math.round((q.data.spent_cents / Number(today.slice(8, 10))) * daysInMonth(month)))} (orçado {brl(q.data.planned_cents)}). Estimativa simples.
              </small>
            )}
          </section>
          <button className="btn ghost block" onClick={() => copy.mutate(undefined)}>
            Copiar do mês anterior
          </button>
          <div className="list">
            {items.map((i) => {
              const ratio = i.planned_cents ? i.spent_cents / i.planned_cents : 0;
              const remaining = i.planned_cents != null ? i.planned_cents - i.spent_cents : null;
              const tone = ratio >= 1 ? 'var(--neg)' : ratio >= 0.8 ? 'var(--warn-text)' : undefined;
              return (
                <button
                  key={i.category_id}
                  className="r"
                  style={{ paddingLeft: i.depth ? 20 : 0 }}
                  onClick={() => {
                    setEditing(i);
                    setValue(i.planned_cents);
                  }}
                >
                  <div className="m">
                    <span className="t" style={{ fontWeight: i.depth ? 700 : 800 }}>
                      {i.name}
                    </span>
                    {i.planned_cents != null && <Bar ratio={ratio} kind={ratio >= 1 ? 'over' : undefined} />}
                  </div>
                  <div className="v num" style={tone ? { color: tone } : undefined}>
                    {brl(i.spent_cents)}
                    <small>
                      {remaining == null ? 'sem orçamento' : remaining >= 0 ? `restam ${brl(remaining)}` : `estourou ${brl(-remaining)}`}
                    </small>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
      {editing && (
        <Sheet title={`Orçamento · ${editing.name}`} onClose={() => setEditing(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined);
            }}
          >
            <MoneyInput big label="Planejado no mês" value={value} onChange={setValue} />
            <small>Deixe vazio para remover o orçamento desta categoria.</small>
            <ErrorText error={save.error} />
            <button className="btn big" disabled={save.isPending || (value == null && !editing.budget_id)}>
              Salvar
            </button>
          </form>
        </Sheet>
      )}
    </main>
  );
}
