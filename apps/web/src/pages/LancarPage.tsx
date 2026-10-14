import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { addDays, dayOf, invoiceForPurchase, monthOf, splitInstallments } from '@fin/domain';
import { api, clientUuid, useAction, useApi, type Account, type Card, type Category } from '../api';
import { CategoryPicker } from '../categories';
import { useAppState } from '../state';
import { BankMark } from '../banks';
import { ForWhom, useForWhom } from '../people';
import { ErrorText, Icon, MoneyInput, Seg, brl, monthName } from '../ui';

type Kind = 'expense' | 'income';
type Mode = 'single' | 'fixed' | 'installment';
type Target = { type: 'account' | 'card'; id: number } | null;

const PARCELA_ATALHOS = [2, 3, 6, 12, 24, 36, 48, 60];
const LAST_TARGET_KEY = 'fin-last-target';

function readLastTarget(): Target {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_TARGET_KEY) || 'null');
    return v && (v.type === 'card' || v.type === 'account') && Number.isInteger(v.id) ? v : null;
  } catch {
    return null;
  }
}
function rememberTarget(t: NonNullable<Target>) {
  try {
    localStorage.setItem(LAST_TARGET_KEY, JSON.stringify(t));
  } catch {
    /* ignora */
  }
}

export function LancarPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { today, celebrate } = useAppState();
  const back = () => navigate((location.state as any)?.from ?? '/', { replace: true });

  const [kind, setKind] = useState<Kind>('expense');
  const [mode, setMode] = useState<Mode>('single');
  const [amount, setAmount] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [target, setTarget] = useState<Target>(() => {
    const cardId = (location.state as any)?.cardId;
    return cardId ? { type: 'card', id: Number(cardId) } : null;
  });
  const [installments, setInstallments] = useState<number | null>(2);
  const [amountBasis, setAmountBasis] = useState<'total' | 'installment'>('total');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [paidOverride, setPaidOverride] = useState<boolean | null>(null);
  const [forUser, setForUser] = useForWhom();
  const [uuid, setUuid] = useState(clientUuid);
  const again = useRef(false);
  const dateRef = useRef<HTMLInputElement>(null);

  const cats = useApi<Category[]>(`/categories?kind=${kind}`);
  const frequent = useApi<Category[]>(`/categories/frequent?kind=${kind}`);
  const sugg = useApi<{ description: string; category_id: number | null }[]>(`/transactions/suggestions?kind=${kind}`);
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const cards = useApi<Card[]>('/cards');

  const card = target?.type === 'card' ? cards.data?.find((c) => c.id === target.id) : undefined;
  const effectiveMode: Mode = kind === 'income' && mode === 'installment' ? 'single' : mode;

  const defaultTarget: Target = useMemo(() => {
    const last = readLastTarget();
    if (last?.type === 'card' && kind === 'expense' && cards.data?.some((c) => c.id === last.id)) return last;
    if (last?.type === 'account' && accounts.data?.accounts.some((a) => a.id === last.id)) return last;
    if (kind === 'expense' && cards.data?.length) return { type: 'card', id: cards.data[0].id };
    if (accounts.data?.accounts.length) return { type: 'account', id: accounts.data.accounts[0].id };
    return null;
  }, [kind, cards.data, accounts.data]);
  const chosen = target && !(kind === 'income' && target.type === 'card') ? target : defaultTarget;
  const chosenCard = chosen?.type === 'card' ? cards.data?.find((c) => c.id === chosen.id) : card;
  const paid = paidOverride ?? date <= today;
  const countOk = installments != null && installments >= 2 && installments <= 480;
  const perInstallment = effectiveMode === 'installment' && amountBasis === 'installment';
  const totalCents = amount == null ? null : perInstallment ? (countOk ? amount * installments : null) : amount;

  const hint = useMemo(() => {
    if (!totalCents) return null;
    if (effectiveMode === 'installment') {
      if (!countOk || installments == null || totalCents < installments) return null;
      const parts = splitInstallments(totalCents, installments);
      const first = chosenCard ? `a partir da fatura de ${monthName(invoiceForPurchase(chosenCard, date).reference_month)}` : `todo dia ${dayOf(date)}`;
      const each = parts[0] === parts[parts.length - 1] ? brl(parts[0]) : `${brl(parts[parts.length - 1])} a ${brl(parts[0])}`;
      return `Total ${brl(totalCents)} · ${installments}x de ${each} ${first}`;
    }
    if (effectiveMode === 'fixed') return `Todo dia ${dayOf(date)}, a partir de ${monthName(monthOf(date))}`;
    if (chosenCard) return `Entra na fatura que vence em ${monthName(invoiceForPurchase(chosenCard, date).reference_month)}`;
    return null;
  }, [totalCents, effectiveMode, installments, countOk, chosenCard, date]);

  const createCategory = useAction(
    (body: { name: string; parent_id: number | null; color: string }) => api<Category>('/categories', { body: { ...body, kind } }),
    (cat) => setCategoryId(cat.id),
  );

  const submit = useAction(
    async () => {
      if (!totalCents || !chosen) throw new Error('Informe o valor e onde pagar');
      if (effectiveMode === 'installment' && (!countOk || installments == null || totalCents < installments)) throw new Error('O total precisa cobrir todas as parcelas');
      const where = chosen.type === 'card' ? { card_id: chosen.id } : { account_id: chosen.id };
      const base = { description: description.trim(), category_id: categoryId, for_user_id: forUser, ...where };
      if (effectiveMode === 'installment' && installments != null) {
        return (await api('/installments', { body: { ...base, description: base.description || 'Parcelado', total_cents: totalCents, installments, purchased_on: date, first_paid: chosen.type === 'account' && paid } })).xp;
      }
      if (effectiveMode === 'fixed') {
        return (
          await api('/recurrences', {
            body: { ...base, kind, description: base.description || (kind === 'income' ? 'Receita fixa' : 'Despesa fixa'), amount_cents: amount, day_of_month: dayOf(date), start_month: monthOf(date), first_paid: paid },
          })
        ).xp;
      }
      return (await api('/transactions', { body: { ...base, kind, amount_cents: amount, occurred_on: date, paid: chosen.type === 'account' ? paid : undefined, client_uuid: uuid } })).xp;
    },
    (xp) => {
      if (chosen) rememberTarget(chosen);
      celebrate(xp, kind === 'income' ? 'Receita lançada' : 'Despesa lançada');
      if (again.current) {
        again.current = false;
        setAmount(null);
        setDescription('');
        setCategoryId(null);
        setUuid(clientUuid());
      } else {
        back();
      }
    },
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    again.current = false;
    submit.mutate(undefined);
  };

  const canSubmit = !!totalCents && !!chosen && !(effectiveMode === 'installment' && (!countOk || installments == null || totalCents < installments)) && !submit.isPending;
  const yesterday = addDays(today, -1);
  const openPicker = () => {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };
  const targetName = chosen?.type === 'card' ? cards.data?.find((c) => c.id === chosen.id)?.name : chosen?.type === 'account' ? accounts.data?.accounts.find((a) => a.id === chosen.id)?.name : undefined;

  const noTargets = accounts.data && cards.data && !accounts.data.accounts.length && !(kind === 'expense' && cards.data.length);

  return (
    <div className="overlay">
      <form className="sheet full" onSubmit={onSubmit} aria-label="Novo lançamento">
        <div className="hd">
          <button type="button" className="ic" aria-label="Fechar" onClick={back}>
            <Icon.close />
          </button>
          <h1>Novo lançamento</h1>
          <span style={{ width: 44 }} aria-hidden />
        </div>
        <Seg
          label="Despesa ou receita"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setCategoryId(null);
          }}
          options={[
            ['expense', 'Despesa'],
            ['income', 'Receita'],
          ]}
        />
        <MoneyInput big autoFocus value={amount} onChange={setAmount} label={effectiveMode === 'installment' ? (perInstallment ? 'Cada parcela' : 'Valor total') : 'Valor'} />

        <div className="chips" role="radiogroup" aria-label="Tipo">
          {(
            [
              ['single', 'Única'],
              ['fixed', 'Fixa'],
              ...(kind === 'expense' ? [['installment', 'Parcelada']] : []),
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={effectiveMode === m} className={`chip sm${effectiveMode === m ? ' on' : ''}`} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>

        {effectiveMode === 'installment' && (
          <section className="card parcel-box">
            <div className="chips" role="radiogroup" aria-label="Como informar o valor">
              {(
                [
                  ['total', 'Valor total'],
                  ['installment', 'Cada parcela'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={amountBasis === id} className={`chip sm${amountBasis === id ? ' on' : ''}`} onClick={() => setAmountBasis(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="parcel-count">
              <span>Parcelas</span>
              <div className="stepper">
                <button type="button" aria-label="Menos uma parcela" onClick={() => setInstallments((n) => Math.max(2, (n ?? 3) - 1))}>
                  −
                </button>
                <input
                  inputMode="numeric"
                  aria-label="Quantidade de parcelas"
                  value={installments ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, '');
                    setInstallments(raw ? Math.min(480, Number(raw)) : null);
                  }}
                />
                <button type="button" aria-label="Mais uma parcela" onClick={() => setInstallments((n) => Math.min(480, (n ?? 1) + 1))}>
                  +
                </button>
              </div>
            </div>
            <div className="chips" aria-label="Quantidades comuns">
              {PARCELA_ATALHOS.map((n) => (
                <button key={n} type="button" className={`chip sm${installments === n ? ' on' : ''}`} onClick={() => setInstallments(n)}>
                  {n}x
                </button>
              ))}
            </div>
            {hint && <p className="parcel-hint">{hint}</p>}
          </section>
        )}

        {frequent.data && frequent.data.length > 0 && (
          <>
            <small>Mais usadas</small>
            <div className="chips" role="radiogroup" aria-label="Categorias mais usadas">
              {frequent.data.slice(0, 5).map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={categoryId === c.id} className={`chip sm${categoryId === c.id ? ' on' : ''}`} onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          </>
        )}
        <CategoryPicker
          categories={cats.data}
          value={categoryId}
          onChange={setCategoryId}
          onCreate={(name, parent_id, color) => createCategory.mutate({ name, parent_id, color })}
          creating={createCategory.isPending}
        />

        <small>De quem</small>
        <ForWhom value={forUser} onChange={setForUser} />

        <small>{kind === 'income' ? 'Receber em' : 'Pagar com'}</small>
        <div className="chips">
          {kind === 'expense' &&
            cards.data?.map((c) => (
              <button key={`c${c.id}`} type="button" className={`chip${chosen?.type === 'card' && chosen.id === c.id ? ' on' : ''}`} onClick={() => setTarget({ type: 'card', id: c.id })}>
                <BankMark name={c.name} size={22} />
                {c.name}
              </button>
            ))}
          {accounts.data?.accounts.map((a) => (
            <button key={`a${a.id}`} type="button" className={`chip${chosen?.type === 'account' && chosen.id === a.id ? ' on' : ''}`} onClick={() => setTarget({ type: 'account', id: a.id })}>
              <BankMark name={a.name} size={22} />
              {a.name}
            </button>
          ))}
        </div>
        {noTargets && <p className="err">Cadastre uma conta em Mais → Contas antes de lançar.</p>}

        <div className="chips" role="radiogroup" aria-label="Data rápida">
          <button type="button" role="radio" aria-checked={date === today} className={`chip sm${date === today ? ' on' : ''}`} onClick={() => setDate(today)}>Hoje</button>
          <button type="button" role="radio" aria-checked={date === yesterday} className={`chip sm${date === yesterday ? ' on' : ''}`} onClick={() => setDate(yesterday)}>Ontem</button>
          <button type="button" role="radio" aria-checked={date !== today && date !== yesterday} className={`chip sm${date !== today && date !== yesterday ? ' on' : ''}`} onClick={openPicker}>Outra</button>
        </div>
        <label className="f" style={{ flex: 'none' }}>
          <span>{effectiveMode === 'fixed' ? 'Primeira data' : effectiveMode === 'installment' ? 'Data da compra' : 'Data'}</span>
          <input ref={dateRef} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} required />
        </label>
        <label className="f" style={{ flex: 'none' }}>
          <span>Descrição</span>
          <input
            list="desc-sugg"
            placeholder="Opcional"
            value={description}
            maxLength={120}
            onChange={(e) => {
              const value = e.target.value;
              setDescription(value);
              const match = sugg.data?.find((s) => s.description === value);
              if (match && categoryId == null && match.category_id != null) setCategoryId(match.category_id);
            }}
          />
          <datalist id="desc-sugg">
            {sugg.data?.map((s) => <option key={s.description} value={s.description} />)}
          </datalist>
        </label>
        {chosen?.type === 'account' && (
          <label className="toggle">
            <span>
              {effectiveMode === 'single' ? (kind === 'income' ? 'Já recebido' : 'Já pago') : kind === 'income' ? 'Primeira já recebida' : 'Primeira já paga'}
            </span>
            <input type="checkbox" checked={paid} onChange={(e) => setPaidOverride(e.target.checked)} />
          </label>
        )}
        {hint && effectiveMode !== 'installment' && (
          <div className="card soft" style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700 }}>
            {hint}
          </div>
        )}
        <ErrorText error={submit.error ?? createCategory.error} />
        {chosen && targetName && (
          <div className="dest-line">
            <BankMark name={targetName} size={20} />
            <span>
              {kind === 'income' ? 'Entra em ' : 'Sai de '}
              <b>{targetName}</b>
              {chosen.type === 'card' ? ' (cartão)' : ''}
            </span>
          </div>
        )}
        <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
          <button type="submit" className="btn big grow" disabled={!canSubmit}>Lançar</button>
          <button
            type="button"
            className="btn big ghost"
            disabled={!canSubmit}
            onClick={() => {
              again.current = true;
              submit.mutate(undefined, { onError: () => { again.current = false; } });
            }}
          >
            Lançar e novo
          </button>
        </div>
      </form>
    </div>
  );
}
