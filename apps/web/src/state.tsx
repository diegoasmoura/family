import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { monthOf } from '@fin/domain';

interface Toast {
  id: number;
  text: string;
  level?: number;
  action?: { label: string; onClick: () => void };
}

export type PersonScope = 'all' | 'me' | number;

interface AppState {
  month: string;
  setMonth: (m: string) => void;
  /** Começa em Eu. all soma a casa. me e um id mostram só essa pessoa. */
  person: PersonScope;
  setPerson: (person: PersonScope) => void;
  today: string;
  toast: (text: string, level?: number, action?: Toast['action']) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ today, children }: { today: string; children: ReactNode }) {
  const [month, setMonth] = useState(monthOf(today));
  const [person, setPerson] = useState<PersonScope>('me');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, level?: number, action?: Toast['action']) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, level, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 5000 : 2800);
  }, []);

  const value = useMemo(() => ({ month, setMonth, person, setPerson, today, toast }), [month, person, today, toast]);
  const current = toasts[0];
  return (
    <Ctx.Provider value={value}>
      {children}
      {current && (
        <div className="toast" role="status" key={current.id}>
          {current.text}
          {current.level ? <span className="badge">Nível {current.level}</span> : null}
          {current.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                setToasts((t) => t.filter((x) => x.id !== current.id));
                current.action!.onClick();
              }}
            >
              {current.action.label}
            </button>
          )}
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