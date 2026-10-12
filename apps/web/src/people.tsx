import { useState } from 'react';
import { useApi, type Me } from './api';
import { useAppState, type PersonScope } from './state';
import { Seg } from './ui';

interface HouseUser {
  id: number;
  name: string;
}

export function personParam(person: PersonScope): string {
  return person === 'all' ? 'all' : person === 'me' ? 'me' : String(person);
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Eu, cada outra pessoa da casa e Nós. A escolha vale no mês inteiro. */
export function PersonFilter() {
  const { person, setPerson } = useAppState();
  const me = useApi<Me>('/auth/me');
  const users = useApi<HouseUser[]>('/users');
  const others = (users.data ?? []).filter((user) => user.id !== me.data?.id);
  const options: [string, string][] = [
    ['me', 'Eu'],
    ...others.map((user) => [String(user.id), firstName(user.name)] as [string, string]),
    ['all', 'Nós'],
  ];
  const value = person === 'all' ? 'all' : person === 'me' ? 'me' : String(person);
  const known = options.some(([id]) => id === value);
  return (
    <Seg
      label="Quem aparece"
      value={known ? value : 'all'}
      onChange={(next) => setPerson(next === 'all' ? 'all' : next === 'me' ? 'me' : Number(next))}
      options={options}
    />
  );
}

/** De quem é este lançamento. Vazio é da casa. */
export function ForWhom({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const users = useApi<HouseUser[]>('/users');
  return (
    <div className="chips" role="radiogroup" aria-label="De quem">
      {users.data?.map((user) => (
        <button key={user.id} type="button" role="radio" aria-checked={value === user.id} className={`chip sm${value === user.id ? ' on' : ''}`} onClick={() => onChange(user.id)}>
          {firstName(user.name)}
        </button>
      ))}
      <button type="button" role="radio" aria-checked={value === null} className={`chip sm${value === null ? ' on' : ''}`} onClick={() => onChange(null)}>
        Da casa
      </button>
    </div>
  );
}

/** Começa em quem está logado e deixa escolher outra pessoa ou a casa. */
export function useForWhom() {
  const me = useApi<Me>('/auth/me');
  const [override, setOverride] = useState<number | null>();
  const value = override !== undefined ? override : (me.data?.id ?? null);
  return [value, setOverride] as const;
}
