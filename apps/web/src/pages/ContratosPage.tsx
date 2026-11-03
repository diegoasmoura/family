import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { monthLabel, monthOf } from '@fin/domain';
import { api, useAction, useApi } from '../api';
import { useAppState } from '../state';
import { Bar, ErrorText, Loading, MoneyInput, NewButton, Sheet, brl, shortDate } from '../ui';
import type { InstallmentPlan } from '../types';

/**
 * Contratos: financiamentos e empréstimos. Cada contrato é um parcelamento em conta marcado
 * (premissas.md). As prestações já são despesas normais de cada mês; esta tela só mostra
 * quanto falta, em que parcela está e quando termina.
 */
interface Contract {
  id: number;
  description: string;
  lender: string | null;
  account_name: string;
  installments: number;
  total_cents: number;
  contracted_cents: number | null;
  monthly_rate_bp: number | null;
  active_count: number;
  paid_count: number;
  paid_cents: number;
  remaining_cents: number;
  month_cents: number;
  next: { installment_no: number; due_on: string; amount_cents: number; overdue: boolean } | null;
  ends_on: string | null;
}
interface ContractsView {
  month: string;
  remaining_cents: number;
  month_cents: number;
  contracts: Contract[];
}

/** 149 → "1,49". */
const rateText = (bp: number | null) => (bp == null ? '' : (bp / 100).toFixed(2).replace('.', ','));
/** "1,49" → 149. Vazio vira null; texto inválido vira undefined. */
const parseRate = (text: string): number | null | undefined => {
  const t = text.trim().replace('%', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

function ContractForm({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const { toast } = useAppState();
  const [lender, setLender] = useState(contract.lender ?? '');
  const [contracted, setContracted] = useState<number | null>(contract.contracted_cents);
  const [rate, setRate] = useState(rateText(contract.monthly_rate_bp));
  const rateBp = parseRate(rate);
  const save = useAction(
    () => api(`/installments/${contract.id}`, { method: 'PATCH', body: { lender: lender.trim() || null, contracted_cents: contracted, monthly_rate_bp: rateBp } }),
    () => {
      toast('Contrato atualizado');
      onClose();
    },
  );
  const unmark = useAction(
    () => api(`/installments/${contract.id}`, { method: 'PATCH', body: { is_contract: false } }),
    () => {
      toast('Voltou a ser um parcelamento comum');
      onClose();
    },
  );
  return (
    <Sheet title={contract.description} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <label className="f">
          <span>Credor</span>
          <input value={lender} onChange={(e) => setLender(e.target.value)} maxLength={80} placeholder="Ex.: Bradesco, Fies" />
        </label>
        <MoneyInput label="Valor contratado" value={contracted} onChange={setContracted} />
        <label className="f">
          <span>Juros ao mês (%)</span>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Ex.: 1,49" />
        </label>
        {rateBp === undefined && <small className="err">Use só número, por exemplo 1,49.</small>}
        <ErrorText error={save.error ?? unmark.error} />
        <button className="btn big" disabled={rateBp === undefined || save.isPending}>
          Salvar
        </button>
        <button type="button" className="btn ghost block" disabled={unmark.isPending} onClick={() => unmark.mutate(undefined)}>
          Deixar de ser contrato
        </button>
        <small className="muted">As prestações continuam lançadas; só saem desta aba e voltam a aparecer apenas em Parcelamentos.</small>
      </form>
    </Sheet>
  );
}

/** O + da aba: contrato novo (abre o Lançar já em Parcelada e marcado) ou marcar um parcelamento em conta que já existe. */
function AddSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { toast } = useAppState();
  const plans = useApi<(InstallmentPlan & { account_id: number | null; is_contract: number })[]>('/installments');
  const candidates = (plans.data ?? []).filter((p) => p.account_id && !Number(p.is_contract) && p.remaining_cents > 0);
  const mark = useAction(
    (id: number) => api(`/installments/${id}`, { method: 'PATCH', body: { is_contract: true } }),
    () => {
      toast('Marcado como contrato');
      onClose();
    },
  );
  return (
    <Sheet title="Adicionar contrato" onClose={onClose}>
      <div className="stack">
        <button type="button" className="btn block" onClick={() => navigate('/lancar', { state: { from: '/contratos', mode: 'installment', contract: true } })}>
          Novo financiamento ou empréstimo
        </button>
        {candidates.length > 0 && (
          <>
            <small>Já está lançado como parcelamento? Marque aqui:</small>
            {candidates.map((p) => (
              <button key={p.id} type="button" className="btn ghost block" disabled={mark.isPending} onClick={() => mark.mutate(p.id)}>
                {p.description} · {p.settled_count}/{p.installments} · {p.account_name}
              </button>
            ))}
          </>
        )}
        <ErrorText error={plans.error ?? mark.error} />
      </div>
    </Sheet>
  );
}

export function ContratosPage() {
  const q = useApi<ContractsView>('/installments/contracts');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Contract | null>(null);
  const d = q.data;
  return (
    <main className="page">
      <div className="hd">
        <h1>Contratos</h1>
        <NewButton label="Adicionar contrato" onClick={() => setAdding(true)} />
      </div>
      <p className="page-desc">Financiamentos e empréstimos. As prestações já contam nas despesas de cada mês.</p>
      <ErrorText error={q.error} />
      {!d ? (
        <Loading />
      ) : d.contracts.length === 0 ? (
        <section className="card dashed">
          <b>Nenhum contrato ainda</b>
          <small>Lance um financiamento ou empréstimo, ou marque um parcelamento em conta que já existe (o carro, o Fies…).</small>
          <button className="btn" onClick={() => setAdding(true)}>
            Adicionar contrato
          </button>
        </section>
      ) : (
        <>
          <section className="card contract-sum">
            <div>
              <small>Falta pagar</small>
              <b className="num">{brl(d.remaining_cents)}</b>
            </div>
            <div>
              <small>Prestações em {monthLabel(d.month).split(' ')[0].toLowerCase()}</small>
              <b className="num">{brl(d.month_cents)}</b>
            </div>
          </section>
          <div className="stack">
            {d.contracts.map((c) => (
              <button key={c.id} type="button" className="card click contract" onClick={() => setOpen(c)}>
                <div className="hd">
                  <div>
                    <b>{c.description}</b>
                    <br />
                    <small>{[c.lender, c.account_name].filter(Boolean).join(' · ')}</small>
                  </div>
                  <b className="num">Falta {brl(c.remaining_cents)}</b>
                </div>
                <Bar ratio={c.active_count ? c.paid_count / c.active_count : 0} />
                <div className="hd">
                  <small>
                    {c.paid_count} de {c.active_count} pagas
                    {c.ends_on ? ` · termina em ${monthLabel(monthOf(c.ends_on)).toLowerCase()}` : ''}
                  </small>
                  {c.next && (
                    <small className={c.next.overdue ? 'neg' : undefined}>
                      {c.next.overdue ? 'Atrasada' : 'Próxima'} {shortDate(c.next.due_on)} · <span className="money">{brl(c.next.amount_cents)}</span>
                    </small>
                  )}
                </div>
                {(c.contracted_cents != null || c.monthly_rate_bp != null) && (
                  <small className="muted">
                    {[
                      c.contracted_cents != null ? `Contratado ${brl(c.contracted_cents)}` : null,
                      c.monthly_rate_bp != null ? `${rateText(c.monthly_rate_bp)}% ao mês` : null,
                      `total das prestações ${brl(c.total_cents)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {adding && <AddSheet onClose={() => setAdding(false)} />}
      {open && <ContractForm contract={open} onClose={() => setOpen(null)} />}
    </main>
  );
}
