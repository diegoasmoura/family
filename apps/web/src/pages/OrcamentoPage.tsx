import { useState } from 'react';
import { addMonths } from '@fin/domain';
import { api, useAction, useApi } from '../api';
import { useAppState } from '../state';
import { Bar, ErrorText, Loading, MoneyInput, MonthNav, Sheet, brl, categoryTree } from '../ui';

export function OrcamentoPage() {
  const { month, setMonth, toast } = useAppState();
  const q = useApi(`/budgets?month=${month}`);
  const [editing, setEditing] = useState<any>(null);
  const [value, setValue] = useState<number | null>(null);
  const save = useAction(
    () =>
      value == null && editing.budget_id
        ? api(`/budgets/${editing.budget_id}`, { method: 'DELETE' })
        : api('/budgets', { method: 'PUT', body: { category_id: editing.category_id, month, planned_cents: value ?? 0 } }),
    () => {
      toast('Orçamento salvo');
      setEditing(null);
    },
  );
  const copy = useAction(
    () => api('/budgets/copy', { body: { from: addMonths(month, -1), to: month } }),
    (r: any) => toast(r.copied ? `${r.copied} categorias copiadas` : 'Nada novo para copiar'),
  );

  const items = categoryTree((q.data?.items ?? []).map((i: any) => ({ ...i, id: i.category_id })));

  return (
    <main className="page">
      <h1>Orçamento</h1>
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
          </section>
          <button className="btn ghost block" onClick={() => copy.mutate(undefined)}>
            Copiar do mês anterior
          </button>
          <div className="list">
            {items.map((i: any) => {
              const ratio = i.planned_cents ? i.spent_cents / i.planned_cents : 0;
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
                    {i.planned_cents != null && <Bar ratio={ratio} kind={ratio > 1 ? 'over' : undefined} />}
                  </div>
                  <div className="v num">
                    {brl(i.spent_cents)}
                    <small>{i.planned_cents != null ? `de ${brl(i.planned_cents)}` : 'sem orçamento'}</small>
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
