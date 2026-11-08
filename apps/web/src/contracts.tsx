import { splitByShares } from '@fin/domain';
import { useApi } from './api';
import { BankMark, placeLabel } from './banks';
import { Icon, brl } from './ui';

/**
 * Peças da aba Contratos que o Lançar também usa: tipo (com a ilustração do card),
 * juros em texto e a divisão da prestação entre as pessoas.
 */
export type ContractType = 'car' | 'house' | 'moto' | 'study' | 'loan' | 'other';

export const CONTRACT_TYPES: { key: ContractType; label: string; name: string; icon: () => JSX.Element }[] = [
  { key: 'car', label: 'Carro', name: 'Financiamento do carro', icon: Icon.car },
  { key: 'house', label: 'Casa', name: 'Financiamento da casa', icon: Icon.home },
  { key: 'moto', label: 'Moto', name: 'Financiamento da moto', icon: Icon.moto },
  { key: 'study', label: 'Estudo', name: 'Financiamento estudantil', icon: Icon.study },
  { key: 'loan', label: 'Empréstimo', name: 'Empréstimo', icon: Icon.loan },
  { key: 'other', label: 'Outro', name: 'Contrato', icon: Icon.contract },
];
export const contractTypeOf = (key: string | null | undefined) => CONTRACT_TYPES.find((t) => t.key === key) ?? CONTRACT_TYPES[CONTRACT_TYPES.length - 1];

/** A "imagem" do contrato: ícone do tipo num quadrado arredondado na cor do tipo. */
export function ContractIcon({ type, small }: { type: string | null | undefined; small?: boolean }) {
  const t = contractTypeOf(type);
  return <span className={`ct-ic ct-${t.key}${small ? ' sm' : ''}`} aria-hidden>{t.icon()}</span>;
}

/** Chips de tipo, com o ícone de cada um. */
export function ContractTypePicker({ value, onChange }: { value: ContractType; onChange: (t: ContractType) => void }) {
  return (
    <div className="ct-types" role="radiogroup" aria-label="Tipo de contrato">
      {CONTRACT_TYPES.map((t) => (
        <button key={t.key} type="button" role="radio" aria-checked={value === t.key} className={`ct-type${value === t.key ? ' on' : ''}`} onClick={() => onChange(t.key)}>
          <ContractIcon type={t.key} small />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** 149 → "1,49". */
export const rateText = (bp: number | null | undefined) => (bp == null ? '' : (bp / 100).toFixed(2).replace('.', ','));
/** "1,49" → 149. Vazio vira null; texto inválido vira undefined. */
export const parseRate = (text: string): number | null | undefined => {
  const t = text.trim().replace('%', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) : undefined;
};

interface HouseUser {
  id: number;
  name: string;
}
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * Prévia da divisão na tela. `splitByShares` recusa valor que não fecha em centavos
 * (o primeiro dígito de um valor grande é R$ 0,01). Isso não pode derrubar a página.
 */
export function previewShares(totalCents: number, bps: number[]): number[] | null {
  try {
    return splitByShares(totalCents, bps);
  } catch {
    return null;
  }
}

export function useHouseUsers() {
  return useApi<HouseUser[]>('/users').data ?? [];
}

/** De quem é a prestação: uma pessoa ou dividida (bp = parte da primeira pessoa; 5000 = 50%). Sem "Da casa". */
export type Split = { mode: 'one'; userId: number | null } | { mode: 'split'; bp: number };

export interface PayAccount {
  id: number;
  name: string;
}

/** Corpo para a API: `shares` com divisão (e a conta de cada um, se escolhida), `for_user_id` sem. */
export function splitBody(split: Split, users: HouseUser[], accountsByUser?: Record<number, number | null>) {
  if (split.mode === 'split' && users.length >= 2) {
    const bp = [split.bp, 10000 - split.bp];
    return {
      shares: users.slice(0, 2).map((user, index) => {
        const accountId = accountsByUser?.[user.id];
        return accountId ? { user_id: user.id, bp: bp[index], account_id: accountId } : { user_id: user.id, bp: bp[index] };
      }),
      for_user_id: null,
    };
  }
  return { shares: null, for_user_id: split.mode === 'one' ? split.userId : null };
}

/** Lê a divisão gravada no contrato para o formato da tela. */
export function splitFrom(shares: { user_id: number; bp: number }[] | null | undefined, forUserId: number | null | undefined, users: HouseUser[]): Split {
  if (shares && shares.length >= 2) {
    const first = shares.find((x) => x.user_id === users[0]?.id);
    return { mode: 'split', bp: first?.bp ?? 5000 };
  }
  return { mode: 'one', userId: forUserId ?? null };
}

/** Texto curto da divisão: "Diego 60% · Jhersyka 40%", "Diego" ou "Da casa" (só contrato antigo). */
export function splitLabel(shares: { user_id: number; bp: number }[] | null | undefined, forUserId: number | null | undefined, users: HouseUser[]) {
  const name = (id: number) => firstName(users.find((u) => u.id === id)?.name ?? '?');
  if (shares && shares.length >= 2) return shares.map((x) => `${name(x.user_id)} ${Math.round(x.bp / 100)}%`).join(' · ');
  return forUserId == null ? 'Da casa' : name(forUserId);
}

/** "Diego sai de Bradesco · conta. Jhersyka sai de Nubank · conta." Quando a conta é a mesma, "Sai de Bradesco · conta". */
export function accountPhrase(
  shares: { user_id: number; account_id?: number | null }[] | null | undefined,
  users: HouseUser[],
  accounts: PayAccount[],
  fallbackName?: string | null,
): string | null {
  const who = (id: number) => firstName(users.find((u) => u.id === id)?.name ?? '');
  const account = (id: number | null | undefined) => {
    const name = accounts.find((a) => a.id === id)?.name;
    return name ? placeLabel(name, 'account') : undefined;
  };
  if (shares && shares.length >= 2) {
    const first = account(shares[0].account_id);
    const second = account(shares[1].account_id);
    if (first && second) return `${who(shares[0].user_id)} sai de ${first}. ${who(shares[1].user_id)} sai de ${second}.`;
    if (first) return `Sai de ${first}`;
  }
  return fallbackName ? `Sai de ${placeLabel(fallbackName, 'account')}` : null;
}

function whoHint(value: Split, users: HouseUser[]): string {
  if (value.mode === 'split') return 'No Eu, cada um vê a sua parte. Em Nós, a prestação aparece inteira.';
  const person = users.find((u) => u.id === value.userId);
  if (!person) return 'Escolha de quem é o contrato.';
  return `Aparece no Eu de ${firstName(person.name)}. Em Nós, entra junto com o resto.`;
}

/**
 * Escolha de quem paga: cada pessoa ou "Dividir", com o percentual e a conta de cada um.
 * Contrato antigo sem dono chega com userId vazio e pede uma escolha antes de salvar.
 */
export function SplitPicker({
  value,
  onChange,
  users,
  perInstallment,
  accounts,
  shareAccounts,
  onShareAccount,
  onNewAccount,
}: {
  value: Split;
  onChange: (s: Split) => void;
  users: HouseUser[];
  perInstallment: number | null;
  accounts?: PayAccount[];
  shareAccounts?: Record<number, number | null>;
  onShareAccount?: (userId: number, accountId: number) => void;
  onNewAccount?: (userId: number) => void;
}) {
  const canSplit = users.length >= 2;
  const isOne = (id: number) => value.mode === 'one' && value.userId === id;
  const bp = value.mode === 'split' ? value.bp : 5000;
  const pct = Math.round(bp / 100);
  const setPct = (p: number) => onChange({ mode: 'split', bp: Math.min(99, Math.max(1, Math.round(p))) * 100 });
  const parts = value.mode === 'split' && perInstallment && perInstallment > 0 ? previewShares(perInstallment, [bp, 10000 - bp]) : null;
  return (
    <>
      <div className="chips" role="radiogroup" aria-label="De quem">
        {users.map((u) => (
          <button key={u.id} type="button" role="radio" aria-checked={isOne(u.id)} className={`chip sm${isOne(u.id) ? ' on' : ''}`} onClick={() => onChange({ mode: 'one', userId: u.id })}>
            {firstName(u.name)}
          </button>
        ))}
        {canSplit && (
          <button type="button" role="radio" aria-checked={value.mode === 'split'} className={`chip sm${value.mode === 'split' ? ' on' : ''}`} onClick={() => onChange({ mode: 'split', bp })}>
            Dividir
          </button>
        )}
      </div>
      <small className="who-hint">{whoHint(value, users)}</small>
      {value.mode === 'split' && canSplit && (
        <div className="card soft split-box">
          <div className="chips" aria-label="Divisões comuns">
            {[50, 60, 70].map((p) => (
              <button key={p} type="button" className={`chip sm${pct === p ? ' on' : ''}`} onClick={() => setPct(p)}>
                {p}/{100 - p}
              </button>
            ))}
          </div>
          {users.slice(0, 2).map((user, index) => (
            <div key={user.id} className="split-row">
              <span>{firstName(user.name)}</span>
              {index === 0 ? (
                <>
                  <div className="stepper">
                    <button type="button" aria-label={`Menos 5% para ${firstName(user.name)}`} onClick={() => setPct(pct - 5)}>−</button>
                    <input inputMode="numeric" aria-label={`Percentual de ${firstName(user.name)}`} value={pct} onChange={(e) => setPct(Number(e.target.value.replace(/\D/g, '')) || 1)} />
                    <button type="button" aria-label={`Mais 5% para ${firstName(user.name)}`} onClick={() => setPct(pct + 5)}>+</button>
                  </div>
                  <span className="split-pct">%</span>
                </>
              ) : (
                <b className="split-other">{100 - pct}%</b>
              )}
            </div>
          ))}
          {parts && (
            <small>
              Por prestação: {firstName(users[0].name)} <span className="money">{brl(parts[0])}</span> · {firstName(users[1].name)} <span className="money">{brl(parts[1])}</span>
            </small>
          )}
          {accounts && onShareAccount && users.slice(0, 2).map((user) => (
            <div key={user.id} className="split-pay">
              <small>Sai de · {firstName(user.name)}</small>
              <div className="chips" aria-label={`Conta de ${firstName(user.name)}`}>
                {accounts.map((account) => (
                  <button key={account.id} type="button" className={`chip sm${shareAccounts?.[user.id] === account.id ? ' on' : ''}`} onClick={() => onShareAccount(user.id, account.id)}>
                    <BankMark name={account.name} size={18} />
                    {placeLabel(account.name, 'account')}
                  </button>
                ))}
                {onNewAccount && (
                  <button type="button" className="chip sm add" onClick={() => onNewAccount(user.id)}>
                    <Icon.plus /> Nova conta
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
