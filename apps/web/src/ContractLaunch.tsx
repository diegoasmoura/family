import { useMemo, useState, type FormEvent } from 'react';
import { addMonthsToDate, dayOf, monthOf, splitInstallments } from '@fin/domain';
import { api, useAction, useApi, type Account, type Category } from './api';
import { AccountForm } from './AccountForm';
import { BankMark, placeLabel } from './banks';
import { CategoryPicker } from './categories';
import { ContractTypePicker, SplitPicker, accountPhrase, contractTypeOf, parseRate, splitBody, splitFrom, useHouseUsers, type ContractType, type Split } from './contracts';
import { useAppState } from './state';
import { ErrorText, Icon, MoneyInput, Seg, brl, monthName } from './ui';
import type { InstallmentPlan } from './types';

const PRESTACAO_ATALHOS = [12, 24, 36, 48, 60, 72, 120];

type Candidate = InstallmentPlan & {
  account_id: number | null;
  is_contract: number;
  shares: { user_id: number; bp: number; account_id?: number | null }[] | null;
  for_user_id: number | null;
};

/**
 * "Novo contrato" (financiamento ou empréstimo): o Lançar só com o que faz sentido aqui.
 * Sempre despesa, sempre parcelado e sempre em conta; tem tipo, credor, juros e a divisão
 * entre as pessoas. "Já lançado" transforma um parcelamento em conta que já existe.
 */
export function ContractLaunch({ onClose }: { onClose: () => void }) {
  const { today, toast } = useAppState();
  const users = useHouseUsers();
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const cats = useApi<Category[]>('/categories?kind=expense');
  const plans = useApi<Candidate[]>('/installments');
  const candidates = (plans.data ?? []).filter((p) => p.account_id && !p.is_contract && p.remaining_cents > 0);

  const [origin, setOrigin] = useState<'new' | 'existing'>('new');
  const [type, setType] = useState<ContractType>('car');
  const [amount, setAmount] = useState<number | null>(null);
  const [basis, setBasis] = useState<'installment' | 'total'>('installment');
  const [count, setCount] = useState<number | null>(60);
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [firstPaid, setFirstPaid] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [split, setSplit] = useState<Split | null>(null);
  const [shareAccounts, setShareAccounts] = useState<Record<number, number | null>>({});
  const [contracted, setContracted] = useState<number | null>(null);
  const [rate, setRate] = useState('');
  const [planId, setPlanId] = useState<number | null>(null);
  const [newAccountFor, setNewAccountFor] = useState<number | 'one' | null>(null);

  const accountList = accounts.data?.accounts ?? [];
  const account = accountId ?? accountList[0]?.id ?? null;
  const accountName = accountList.find((a) => a.id === account)?.name;
  const picked0 = candidates.find((p) => p.id === planId) ?? null;
  // Novo: começa em meio a meio quando a casa tem duas pessoas. Já lançado: começa como o parcelamento está hoje.
  const who: Split =
    split ??
    (origin === 'existing'
      ? splitFrom(picked0?.shares, picked0?.for_user_id ?? null, users)
      : users.length >= 2
        ? { mode: 'split', bp: 5000 }
        : { mode: 'one', userId: users[0]?.id ?? null });
  const rateBp = parseRate(rate);
  const countOk = count != null && count >= 2 && count <= 480;
  const total = amount == null || !countOk ? null : basis === 'installment' ? amount * count : amount;
  const parts = total != null && countOk && total >= count ? splitInstallments(total, count) : null;
  const picked = picked0;
  const perInstallment = origin === 'existing' ? (picked ? Math.round(picked.remaining_cents / Math.max(1, picked.installments - picked.settled_count)) : null) : (parts?.[0] ?? null);
  // No Dividir, a primeira pessoa começa na conta já escolhida. A segunda só entra quando alguém escolhe.
  const accountOf = (userId: number, index: number) => {
    if (userId in shareAccounts) return shareAccounts[userId];
    const saved = origin === 'existing' ? picked0?.shares?.find((share) => share.user_id === userId)?.account_id : null;
    if (saved) return saved;
    return index === 0 ? account : null;
  };
  const accountsByUser = Object.fromEntries(users.slice(0, 2).map((user, index) => [user.id, accountOf(user.id, index)]));
  const bothAccounts = who.mode !== 'split' || users.slice(0, 2).every((user, index) => accountOf(user.id, index));
  const personReady = who.mode === 'split' || who.userId != null;
  const footer = who.mode === 'split'
    ? bothAccounts
      ? accountPhrase(
          users.slice(0, 2).map((user) => ({ user_id: user.id, account_id: accountsByUser[user.id] })),
          users,
          accountList,
        )
      : null
    : accountName
      ? `Sai de ${placeLabel(accountName, 'account')}, todo mês`
      : null;

  const hint = useMemo(() => {
    if (!parts || count == null) return null;
    const end = addMonthsToDate(date, count - 1);
    return (
      <>
        Total <span className="money">{brl(total)}</span> · {count}x de <span className="money">{brl(parts[0])}</span> · todo dia {dayOf(date)}, até {monthName(monthOf(end))} de {end.slice(0, 4)}
      </>
    );
  }, [parts, count, date, total]);

  const submit = useAction(
    async () => {
      const base = { is_contract: true, contract_type: type, lender: lender.trim() || null, contracted_cents: contracted, monthly_rate_bp: rateBp ?? null };
      // Já lançado: a divisão só muda se a pessoa mexeu nela (senão as prestações ficam como estão).
      const payFrom = who.mode === 'split' ? accountsByUser[users[0]?.id] : account;
      const details = origin === 'existing' && !split ? base : { ...base, ...splitBody(who, users, accountsByUser) };
      if (origin === 'existing') {
        if (!picked) throw new Error('Escolha o parcelamento');
        await api(`/installments/${picked.id}`, { method: 'PATCH', body: details });
        return;
      }
      if (!parts || total == null || count == null) throw new Error('Informe a prestação e o número de parcelas');
      if (who.mode === 'split' && !bothAccounts) throw new Error('Escolha a conta de cada um');
      if (!payFrom) throw new Error('Escolha a conta de onde sai a prestação');
      await api('/installments', {
        body: {
          ...details,
          description: name.trim() || contractTypeOf(type).name,
          total_cents: total,
          installments: count,
          account_id: payFrom,
          category_id: categoryId,
          purchased_on: date,
          first_paid: firstPaid,
        },
      });
    },
    () => {
      toast(origin === 'existing' ? 'Agora é um contrato' : 'Contrato criado');
      onClose();
    },
  );
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate(undefined);
  };
  const canSubmit = rateBp !== undefined && !submit.isPending && personReady && bothAccounts && (origin === 'existing' ? !!picked : !!parts && (who.mode === 'split' || !!account));

  return (
    <div className="overlay">
      <form className="sheet full" onSubmit={onSubmit} aria-label="Novo contrato">
        <div className="hd">
          <button type="button" className="ic" aria-label="Fechar" onClick={onClose}>
            <Icon.close />
          </button>
          <h1>Novo contrato</h1>
          <span style={{ width: 44 }} aria-hidden />
        </div>

        {candidates.length > 0 && (
          <Seg
            label="Contrato novo ou já lançado"
            value={origin}
            onChange={setOrigin}
            options={[
              ['new', 'Novo'],
              ['existing', 'Já lançado'],
            ]}
          />
        )}

        <small>Tipo</small>
        <ContractTypePicker value={type} onChange={setType} />

        {origin === 'existing' ? (
          <>
            <label className="f">
              <span>Parcelamento</span>
              <select
                value={planId ?? ''}
                onChange={(e) => {
                  setPlanId(e.target.value ? Number(e.target.value) : null);
                  setSplit(null);
                  setShareAccounts({});
                }}
                required
              >
                <option value="">Escolher…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.description} · {p.settled_count}/{p.installments} · {p.account_name}
                  </option>
                ))}
              </select>
            </label>
            {picked && (
              <p className="parcel-hint">
                Faltam {picked.installments - picked.settled_count} prestações, <span className="money">{brl(picked.remaining_cents)}</span> no total. As prestações já lançadas continuam iguais; se mudar o “De quem”, a divisão nova vale para as que estão em aberto.
              </p>
            )}
          </>
        ) : (
          <>
            <MoneyInput big autoFocus value={amount} onChange={setAmount} label={basis === 'installment' ? 'Cada prestação' : 'Valor total'} />
            <section className="card parcel-box">
              <div className="chips" role="radiogroup" aria-label="Como informar o valor">
                {(
                  [
                    ['installment', 'Cada prestação'],
                    ['total', 'Valor total'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={basis === id} className={`chip sm${basis === id ? ' on' : ''}`} onClick={() => setBasis(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="parcel-count">
                <span>Prestações</span>
                <div className="stepper">
                  <button type="button" aria-label="Menos uma prestação" onClick={() => setCount((n) => Math.max(2, (n ?? 3) - 1))}>
                    −
                  </button>
                  <input
                    inputMode="numeric"
                    aria-label="Quantidade de prestações"
                    value={count ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '');
                      setCount(raw ? Math.min(480, Number(raw)) : null);
                    }}
                  />
                  <button type="button" aria-label="Mais uma prestação" onClick={() => setCount((n) => Math.min(480, (n ?? 1) + 1))}>
                    +
                  </button>
                </div>
              </div>
              <div className="chips" aria-label="Prazos comuns">
                {PRESTACAO_ATALHOS.map((n) => (
                  <button key={n} type="button" className={`chip sm${count === n ? ' on' : ''}`} onClick={() => setCount(n)}>
                    {n}x
                  </button>
                ))}
              </div>
              {hint && <p className="parcel-hint">{hint}</p>}
            </section>

            <label className="f">
              <span>Nome</span>
              <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={`Ex.: ${contractTypeOf(type).name}`} />
            </label>
          </>
        )}

        <label className="f">
          <span>Credor</span>
          <input value={lender} maxLength={80} onChange={(e) => setLender(e.target.value)} placeholder="Ex.: Bradesco, Caixa, Fies" />
        </label>

        <small>De quem</small>
        <SplitPicker
          value={who}
          onChange={setSplit}
          users={users}
          perInstallment={perInstallment}
          accounts={accountList}
          shareAccounts={accountsByUser}
          onShareAccount={(userId, id) => {
            setShareAccounts((current) => ({ ...current, [userId]: id }));
            setSplit(who.mode === 'split' ? who : { mode: 'split', bp: 5000 });
          }}
          onNewAccount={setNewAccountFor}
        />

        {origin === 'new' && who.mode !== 'split' && (
          <>
            <small>Pagar com</small>
            <div className="chips">
              {accountList.map((a) => (
                <button key={a.id} type="button" className={`chip${account === a.id ? ' on' : ''}`} onClick={() => setAccountId(a.id)}>
                  <BankMark name={a.name} size={22} />
                  {placeLabel(a.name, 'account')}
                </button>
              ))}
              <button type="button" className="chip add" onClick={() => setNewAccountFor('one')}>
                <Icon.plus /> Nova conta
              </button>
            </div>
          </>
        )}

        {origin === 'new' && footer && (
          <div className="dest-line">
            {who.mode !== 'split' && accountName && <BankMark name={accountName} size={20} />}
            <span>{footer}</span>
          </div>
        )}

        {origin === 'new' && (
          <>
            <label className="f" style={{ flex: 'none' }}>
              <span>Primeira prestação</span>
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} required />
            </label>
            <label className="toggle">
              <span>Primeira já paga</span>
              <input type="checkbox" checked={firstPaid} onChange={(e) => setFirstPaid(e.target.checked)} />
            </label>
            <CategoryPicker categories={cats.data} value={categoryId} onChange={setCategoryId} />
          </>
        )}

        <details className="ct-more">
          <summary>Valor contratado e juros (opcional)</summary>
          <MoneyInput label="Valor contratado" value={contracted} onChange={setContracted} />
          <label className="f">
            <span>Juros ao mês (%)</span>
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Ex.: 1,49" />
          </label>
          {rateBp === undefined && <small className="err">Use só número, por exemplo 1,49.</small>}
          <small>Com o valor contratado, o card mostra quanto as prestações somam a mais.</small>
        </details>

        <ErrorText error={submit.error} />
        <div className="launch-actions">
          <button type="submit" className="btn big" disabled={!canSubmit}>
            {origin === 'existing' ? 'Transformar em contrato' : 'Criar contrato'}
          </button>
        </div>
      </form>
      {newAccountFor != null && (
        <AccountForm
          onClose={() => setNewAccountFor(null)}
          onSaved={(saved) => {
            if (newAccountFor === 'one') setAccountId(saved.id);
            else {
              const userId = newAccountFor;
              setShareAccounts((current) => ({ ...current, [userId]: saved.id }));
              setSplit(who.mode === 'split' ? who : { mode: 'split', bp: 5000 });
            }
          }}
        />
      )}
    </div>
  );
}
