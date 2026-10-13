import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AVATAR_ITEMS, monthOf } from '@fin/domain';
import type { XpResult } from './api';

interface Toast {
  id: number;
  text: string;
  level?: number;
}

export type PersonScope = 'all' | 'me' | number;

interface AppState {
  month: string;
  setMonth: (m: string) => void;
  /** Começa em Eu. all soma a casa. me e um id mostram só essa pessoa. */
  person: PersonScope;
  setPerson: (person: PersonScope) => void;
  today: string;
  toast: (text: string, level?: number) => void;
  celebrate: (xp: XpResult | null | undefined, fallback?: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ today, children }: { today: string; children: ReactNode }) {
  const [month, setMonth] = useState(monthOf(today));
  const [person, setPerson] = useState<PersonScope>('me');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, level?: number) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, level }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const celebrate = useCallback(
    (xp: XpResult | null | undefined, fallback = 'Lançado') => {
      toast(fallback);
      if (!xp?.level_up) return;
      const item = AVATAR_ITEMS.find((i) => i.level === xp.level_up);
      toast(`Seu avatar subiu para o nível ${xp.level_up}${item ? `: ${item.name.toLowerCase()} liberado` : ''}`, xp.level_up);
    },
    [toast],
  );

  const value = useMemo(() => ({ month, setMonth, person, setPerson, today, toast, celebrate }), [month, person, today, toast, celebrate]);
  const current = toasts[0];
  return (
    <Ctx.Provider value={value}>
      {children}
      {current && (
        <div className="toast" role="status" key={current.id}>
          {current.text}
          {current.level ? <span className="badge">Nível {current.level}</span> : null}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AppStateProvider ausente');
  return ctx;
}