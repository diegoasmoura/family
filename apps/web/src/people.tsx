import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AVATAR_TONES, type Avatar } from '@fin/domain';
import { useApi, type Me } from './api';
import { useAppState, type PersonScope } from './state';

interface HouseUser {
  id: number;
  name: string;
  avatar?: Avatar;
}

/**
 * Cada pessoa tem uma cor só, a do avatar dela, em todo o Nós (resumo, quem gastou, extrato,
 * contratos). "Da casa" é sempre o cinza neutro. Se as duas escolheram o mesmo tom, a segunda
 * pega o tom seguinte, para nunca ficarem iguais lado a lado.
 */
export interface HousePerson {
  id: number;
  name: string;
  first: string;
  color: string;
}

export const HOUSE_COLOR = '#8E9AAF';

export function useHousePeople(): HousePerson[] {
  const users = useApi<HouseUser[]>('/users');
  return useMemo(() => {
    const used = new Set<number>();
    return (users.data ?? []).map((user) => {
      let tone = user.avatar?.tone ?? 0;
      for (let i = 0; used.has(tone) && i < AVATAR_TONES.length; i++) tone = (tone + 1) % AVATAR_TONES.length;
      used.add(tone);
      return { id: user.id, name: user.name, first: firstName(user.name), color: AVATAR_TONES[tone].bg };
    });
  }, [users.data]);
}

/** Cor e primeiro nome de quem é (id vazio = Da casa). */
export function personOf(people: HousePerson[], userId: number | null | undefined, name?: string | null) {
  const found = userId != null ? people.find((p) => p.id === userId) : name ? people.find((p) => p.name === name) : undefined;
  if (found) return { label: found.first, color: found.color };
  if (userId == null && !name) return { label: 'Da casa', color: HOUSE_COLOR };
  return { label: firstName(name ?? 'Pessoa'), color: HOUSE_COLOR };
}

/** Etiqueta de pessoa: bolinha na cor dela e o primeiro nome. */
export function PersonTag({ color, label, className = '' }: { color: string; label: string; className?: string }) {
  return (
    <span className={`ptag ${className}`.trim()} style={{ '--who': color } as CSSProperties}>
      <i className="ptag-dot" aria-hidden />
      {label}
    </span>
  );
}

export function personParam(person: PersonScope): string {
  return person === 'all' ? 'all' : person === 'me' ? 'me' : String(person);
}

export function withPerson(path: string, person: PersonScope): string {
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}person=${personParam(person)}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Eu e Nós. A escolha vale no mês inteiro. */
export function PersonFilter() {
  const { person, setPerson } = useAppState();
  useEffect(() => {
    if (person !== 'all' && person !== 'me') setPerson('me');
  }, [person, setPerson]);
  const tab = (id: 'me' | 'all', label: string) => (
    <button type="button" role="tab" aria-selected={person === id} onClick={() => setPerson(id)}>
      {label}
    </button>
  );
  return (
    <div className="who" role="tablist" aria-label="Quem aparece">
      {tab('me', 'Eu')}
      {tab('all', 'Nós')}
    </div>
  );
}

/** De quem é este lançamento. Vazio é da casa. No cartão, `peopleOnly` tira a casa: o cartão é de uma pessoa. */
export function ForWhom({ value, onChange, peopleOnly = false }: { value: number | null; onChange: (id: number | null) => void; peopleOnly?: boolean }) {
  const users = useApi<HouseUser[]>('/users');
  const selected = users.data?.find((user) => user.id === value);
  const hint = peopleOnly
    ? selected
      ? `Só ${firstName(selected.name)} vê este cartão.`
      : 'Escolha de quem é o cartão.'
    : value == null
      ? 'Não entra no Eu. Só aparece em Nós.'
      : selected
        ? `Aparece no Eu de ${firstName(selected.name)}. Em Nós, entra junto com o resto.`
        : null;
  return (
    <>
      <div className="chips" role="radiogroup" aria-label="De quem">
        {users.data?.map((user) => (
          <button key={user.id} type="button" role="radio" aria-checked={value === user.id} className={`chip sm${value === user.id ? ' on' : ''}`} onClick={() => onChange(user.id)}>
            {firstName(user.name)}
          </button>
        ))}
        {!peopleOnly && (
          <button type="button" role="radio" aria-checked={value === null} className={`chip sm${value === null ? ' on' : ''}`} onClick={() => onChange(null)}>
            Da casa
          </button>
        )}
      </div>
      {hint && <small className="who-hint">{hint}</small>}
    </>
  );
}

/** Começa em quem está logado e deixa escolher outra pessoa ou a casa. */
export function useForWhom() {
  const me = useApi<Me>('/auth/me');
  const [override, setOverride] = useState<number | null>();
  const value = override !== undefined ? override : (me.data?.id ?? null);
  return [value, setOverride] as const;
}
