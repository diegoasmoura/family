import { useState } from 'react';
import { Link } from 'react-router-dom';
import { monthLabel, monthOf } from '@fin/domain';
import { api, useAction, useApi } from '../api';
import { useAppState } from '../state';
import { Bar, Confirm, ErrorText, Loading, MoneyInput, Sheet, brl, shortDate } from '../ui';
import { useConfirm } from '../useConfirm';
import type { InstallmentPlan, Recurrence } from '../types';

function RecurrenceForm({ rec, onClose }: { rec: Recurrence; onClose: () => void }) {
  const { today, toast } = useAppState();
  const [form, setForm] = useState({ description: rec.description, amount_cents: rec.amount_cents as number | null, day_of_month: rec.day_of_month });
  const [endMonth, setEndMonth] = useState(monthOf(today));
  const save = useAction(
    () => api(`/recurrences/${rec.id}`, { method: 'PATCH', body: form }),
    () => {
      toast('Fixa atualizada');
      onClose();
    },
  );
  const end = useAction(
    () => api(`/recurrences/${rec.id}/end`, { body: { end_month: endMonth } }),
    () => {
      toast('Fixa encerrada');
      onClose();
    },
  );
  const remove = useAction(
    () => api(`/recurrences/${rec.id}`, { method: 'DELETE' }),
    () => {
      toast('Fixa excluída; o que já aconteceu ficou');
      onClose();
    },
  );
  const { confirm, dialog } = useConfirm();
  return (
    <>
    <Sheet title={rec.description} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <MoneyInput value={form.amount_cents} onChange={(v) => setForm((f) => ({ ...f, amount_cents: v }))} />
        <label className="f">
          <span>Descrição</span>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required />
        </label>
        <label className="f">
          <span>Dia do mês</span>
          <input type="number" min={1} max={31} value={form.day_of_month} onChange={(e) => setForm((f) => ({ ...f, day_of_month: Number(e.target.value) }))} />
        </label>
        <small>Muda as próximas ocorrências ainda não efetivadas. O que já foi pago, recebido ou editado à mão continua igual.</small>
        <button className="btn block" disabled={!form.amount_cents || save.isPending}>
          Salvar
        </button>
      </form>
      <section className="card">
        <b>Encerrar</b>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="f">
            <span>Último mês</span>
            <input type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
          </label>
          <button
            className="btn ghost"
            onClick={() =>
              confirm(
                `Encerrar “${rec.description}” em ${monthLabel(endMonth).toLowerCase()}? Os previstos depois disso que você não editou à mão serão apagados.`,
                () => end.mutate(undefined),
                false,
              )
            }
            disabled={!endMonth}
          >
            Encerrar
          </button>
        </div>
      </section>
      <button
        className="btn danger block"
        onClick={() =>
          confirm(
            `Excluir a fixa “${rec.description}”? Os previstos a partir deste mês somem; o que já aconteceu fica.`,
            () => remove.mutate(undefined),
          )
        }
      >
        Excluir fixa
      </button>
      <ErrorText error={save.error ?? end.error ?? remove.error} />
    </Sheet>
    {dialog}
    </>
  );
}

export function RecorrenciasPage() {
  const q = useApi<Recurrence[]>('/recurrences');
  const [editing, setEditing] = useState<Recurrence | null>(null);
  const group = (kind: string) => (q.data ?? []).filter((r) => r.kind === kind);
  return (
    <main className="page">
      <h1>Fixas</h1>
      <small>Cada fixa gera um lançamento previsto por mês. Crie novas pelo botão + escolhendo "Fixa".</small>
      <ErrorText error={q.error} />
      {!q.data ? (
        <Loading />
      ) : (
        (['income', 'expense'] as const).map((kind) => (
          <section key={kind} className="stack">
            <h2>{kind === 'income' ? 'Receitas' : 'Despesas'}</h2>
            <div className="list">
              {group(kind).map((r) => (
                <button key={r.id} className={`r${r.active ? '' : ' dim'}`} onClick={() => setEditing(r)}>
                  <div className="m">
                    <small>{r.account_name ?? r.card_name}</small>
                    <span className="t">{r.description}</span>
                    <small>
                      Todo dia {r.day_of_month} · desde {monthLabel(r.start_month).toLowerCase()}
                      {r.end_month ? ` até ${monthLabel(r.end_month).toLowerCase()}` : ''}
                    </small>
                  </div>
                  <div className="v num">{brl(r.amount_cents)}</div>
                </button>
              ))}
              {group(kind).length === 0 && <p className="empty">Nenhuma.</p>}
            </div>
          </section>
        ))
      )}
      {editing && <RecurrenceForm rec={editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

export function ParcelamentosPage() {
  const { toast } = useAppState();
  const q = useApi<InstallmentPlan[]>('/installments');
  const [confirm, setConfirm] = useState<{ plan: InstallmentPlan; action: 'cancel' | 'delete' } | null>(null);
  const act = useAction(
    ({ plan, action }: { plan: InstallmentPlan; action: 'cancel' | 'delete' }) =>
      action === 'cancel' ? api(`/installments/${plan.id}/cancel`, { body: {} }) : api(`/installments/${plan.id}`, { method: 'DELETE' }),
    (_r, v) => {
      toast(v.action === 'cancel' ? 'Parcelas restantes canceladas' : 'Parcelamento excluído');
      setConfirm(null);
    },
  );
  return (
    <main className="page">
      <h1>Parcelamentos</h1>
      <small>Em conta, cada parcela vira um lançamento a pagar. No cartão, cada parcela cai numa fatura seguinte.</small>
      <ErrorText error={q.error ?? act.error} />
      {!q.data ? (
        <Loading />
      ) : (
        <div className="stack">
          {q.data.map((p) => (
            <section key={p.id} className="card">
              <div className="hd">
                <div>
                  <b>{p.description}</b>
                  <br />
                  <small>
                    {p.card_name ? `Cartão ${p.card_name}` : p.account_name} · compra {shortDate(p.purchased_on)}
                  </small>
                </div>
                <b className="num">{brl(p.total_cents)}</b>
              </div>
              <Bar ratio={p.installments ? p.settled_count / p.installments : 0} />
              <div className="hd">
                <small>
                  {p.settled_count}/{p.installments} {p.card_name ? 'faturadas' : 'pagas'}
                  {p.active_count < p.installments ? ` · ${p.installments - p.active_count} canceladas` : ''}
                </small>
                <small className="num">Falta {brl(p.remaining_cents)}</small>
              </div>
              <div className="row">
                {p.remaining_cents > 0 && (
                  <button className="btn ghost sm" onClick={() => setConfirm({ plan: p, action: 'cancel' })}>
                    Cancelar restante
                  </button>
                )}
                <button className="btn danger sm" onClick={() => setConfirm({ plan: p, action: 'delete' })}>
                  Excluir
                </button>
              </div>
            </section>
          ))}
          {q.data.length === 0 && (
            <p className="empty">
              Nenhum parcelamento. <Link to="/lancar" className="link">Lançar uma compra parcelada</Link>
            </p>
          )}
        </div>
      )}
      {confirm && (
        <Confirm
          danger
          text={
            confirm.action === 'cancel'
              ? `Cancelar as parcelas ainda não pagas de "${confirm.plan.description}"? As já efetivadas continuam.`
              : `Excluir "${confirm.plan.description}" e todas as parcelas? Use só para lançamento feito por engano.`
          }
          onConfirm={() => act.mutate(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </main>
  );
}
