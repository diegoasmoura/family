import { useEffect, useState } from 'react';
import { useApi, type Me } from './api';
import { useAppState, type PersonScope } from './state';

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

/** Eu e Nós. A escolha vale no mês inteiro. */
export function PersonFilter() {
  const { person, setPerson } = useAppState();
  useEffect(() => {
    if (person !== 'all' && person !== 'me') setPerson('me');
  }, [person, setPerson]);
  const tab = (id: 'me' | 'all', label: string) => (
    <button type="button" role="tab" aria-selected={person === id} className={`chip sm${person === id ? ' on' : ''}`} onClick={() => setPerson(id)}>
      {label}
    </button>
  );
  return (
    <div className="chips" role="tablist" aria-label="Quem aparece">
      {tab('me', 'Eu')}
      {tab('all', 'Nós')}
    </div>
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
