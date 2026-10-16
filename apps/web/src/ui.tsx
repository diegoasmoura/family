import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { addMonths, formatBRL, monthLabel, monthOf, weekdayShort } from '@fin/domain';
import type { Tx } from './api';
import { useAppState } from './state';

export const brl = (cents: number | null | undefined) => formatBRL(cents ?? 0);

export const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
export const dayLabel = (date: string) => `${date.slice(8, 10)} · ${weekdayShort(date)}`;

const MONTHS_LOWER = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthName = (month: string) => MONTHS_LOWER[Number(month.slice(5, 7)) - 1];

const path = (d: string) => <path d={d} />;
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const Icon = {
  home: () => svg(path('M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z')),
  list: () => svg(<>{path('M8 6h13M8 12h13M8 18h13')}{path('M3 6h.01M3 12h.01M3 18h.01')}</>),
  card: () => svg(<><rect x="2" y="5" width="20" height="14" rx="3" />{path('M2 10h20')}</>),
  year: () => svg(<><rect x="3" y="4" width="18" height="17" rx="2" />{path('M3 9h18M8 2v4M16 2v4')}</>),
  kebab: () => svg(<><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></>),
  more: () => svg(<><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>),
  check: () => svg(path('M5 12l5 5 9-10')),
  clock: () => svg(<><circle cx="12" cy="12" r="9" />{path('M12 7v5l3 2')}</>),
  alert: () => svg(<>{path('M12 8v5')}{path('M12 16.5h.01')}<circle cx="12" cy="12" r="9" /></>),
  search: () => svg(<><circle cx="11" cy="11" r="7" />{path('M20 20l-3.5-3.5')}</>),
  close: () => svg(path('M6 6l12 12M18 6L6 18')),
  left: () => svg(path('M15 6l-6 6 6 6')),
  right: () => svg(path('M9 6l6 6-6 6')),
  flame: () => svg(path('M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1.5 1 2 2 2 3 1-2 1-4 1-6z')),
  chart: () => svg(<>{path('M4 20V10M10 20V4M16 20v-7M22 20H2')}</>),
  trend: () => svg(path('M3 16l5-5 4 3 8-9')),
  plus: () => svg(path('M12 5v14M5 12h14')),
  lock: () => svg(<><rect x="5" y="11" width="14" height="10" rx="2" />{path('M8 11V8a4 4 0 0 1 8 0v3')}</>),
  unlock: () => svg(<><rect x="5" y="11" width="14" height="10" rx="2" />{path('M8 11V8a4 4 0 0 1 7.5-2')}</>),
  checkCircle: () => svg(<><circle cx="12" cy="12" r="9" />{path('M8 12.5l3 3 5-6')}</>),
  sun: () => svg(<><circle cx="12" cy="12" r="4" />{path('M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4')}</>),
  moon: () => svg(path('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z')),
  eye: () => svg(<><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: () => svg(<>{path('M3 3l18 18')}{path('M9.9 5.6A10 10 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.4 4')}{path('M6.1 6.7C3.6 8.6 2 12 2 12s4 7 10 7c1.5 0 2.9-.4 4.1-1')}</>),
  grid: () => svg(<><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>),
};

export function StatusIcon({ status, label }: { status: Tx['display_status']; label?: string }) {
  const icon = status === 'paid' ? Icon.check() : status === 'overdue' ? Icon.alert() : status === 'card' ? Icon.card() : Icon.clock();
  return (
    <div className={`o ${status}`} role="img" aria-label={label}>
      {icon}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { today } = useAppState();
  const current = monthOf(today);
  const away = month !== current;
  return (
    <div className="hd month-nav">
      <button type="button" className="ic" aria-label="Mês anterior" onClick={() => onChange(addMonths(month, -1))}>
        <Icon.left />
      </button>
      {away ? (
        <button type="button" className="month-back" aria-label={`Voltar para ${monthLabel(current)}`} onClick={() => onChange(current)}>
          <b>{monthLabel(month)}</b>
          <small>Mês atual</small>
        </button>
      ) : (
        <b>{monthLabel(month)}</b>
      )}
      <button type="button" className="ic" aria-label="Próximo mês" onClick={() => onChange(addMonths(month, 1))}>
        <Icon.right />
      </button>
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <section className="card" aria-hidden>
      <div className="skel" style={{ height: 14, width: '38%' }} />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skel" style={{ height: i === 0 ? 34 : 14, width: i === 0 ? '60%' : `${88 - i * 12}%`, marginTop: 10 }} />
      ))}
    </section>
  );
}

export function Sheet({ title, onClose, children, full }: { title: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const root = ref.current;
    const focusable = () =>
      [...(root?.querySelectorAll<HTMLElement>('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])].filter(
        (el) => !el.hasAttribute('disabled'),
      );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab') return;
      const list = focusable();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    focusable()[0]?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  const drag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const startY = e.clientY;
    const sheet = ref.current;
    const move = (ev: PointerEvent) => {
      const dy = Math.max(0, ev.clientY - startY);
      if (sheet) sheet.style.transform = `translateY(${dy}px)`;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const dy = ev.clientY - startY;
      if (dy > 90) closeRef.current();
      else if (sheet) sheet.style.transform = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${full ? ' full' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="hd" onPointerDown={drag}>
          <h1>{title}</h1>
          <button className="ic" aria-label="Fechar" onClick={onClose}>
            <Icon.close />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Campo de valor com máscara: os dígitos digitados entram como centavos. */
export function MoneyInput({
  value,
  onChange,
  big,
  label = 'Valor',
  allowNegative,
  autoFocus,
  bare,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  big?: boolean;
  label?: string;
  allowNegative?: boolean;
  autoFocus?: boolean;
  bare?: boolean;
}) {
  const [negative, setNegative] = useState(false);
  const formatted = value == null ? '' : formatBRL(Math.abs(value));
  const display = bare ? formatted.replace(/^R\$\s*/, '') : formatted;
  return (
    <label className="f" style={big ? { flex: 'none', alignItems: 'center', padding: '8px 0' } : undefined}>
      <span>{label}</span>
      <input
        className={big ? 'money-big num' : 'num'}
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={bare ? '0,00' : 'R$ 0,00'}
        value={allowNegative && negative && value ? `-${display}` : display}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const neg = allowNegative && e.target.value.includes('-');
          setNegative(Boolean(neg));
          const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
          if (!digits) return onChange(null);
          const cents = Number(digits.slice(0, 13));
          onChange(neg ? -cents : cents);
        }}
      />
    </label>
  );
}

export function Bar({ ratio, kind }: { ratio: number; kind?: 'xp' | 'over' }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className={`bar${kind ? ` ${kind}` : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="err" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

export function Loading() {
  return <p className="empty">Carregando…</p>;
}

export function CategoryTags({ tx }: { tx: Pick<Tx, 'category_name' | 'parent_category_name'> }) {
  if (!tx.category_name) return null;
  return (
    <span className="row" style={{ gap: 6 }}>
      {tx.parent_category_name && <span className="tag purple">{tx.parent_category_name}</span>}
      <span className="tag">{tx.category_name}</span>
    </span>
  );
}

/** Pais seguidos das filhas, na ordem de exibição. */
export function categoryTree<T extends { id: number; parent_id: number | null }>(cats: T[] = []): (T & { depth: number })[] {
  const out: (T & { depth: number })[] = [];
  for (const p of cats.filter((c) => c.parent_id == null)) {
    out.push({ ...p, depth: 0 });
    for (const c of cats.filter((x) => x.parent_id === p.id)) out.push({ ...c, depth: 1 });
  }
  return out;
}

export function CategoryOptions({ categories }: { categories?: { id: number; name: string; parent_id: number | null }[] }) {
  return (
    <>
      {categoryTree(categories).map((c) => (
        <option key={c.id} value={c.id}>
          {c.depth ? `\u00a0\u00a0\u00a0${c.name}` : c.name}
        </option>
      ))}
    </>
  );
}

export function Confirm({ text, onConfirm, onClose, danger }: { text: string; onConfirm: () => void; onClose: () => void; danger?: boolean }) {
  return (
    <Sheet title="Confirmar" onClose={onClose}>
      <p style={{ margin: 0, fontWeight: 700 }}>{text}</p>
      <div className="row">
        <button className="btn ghost grow" onClick={onClose}>
          Voltar
        </button>
        <button className={`btn grow${danger ? ' danger' : ''}`} onClick={onConfirm}>
          Confirmar
        </button>
      </div>
    </Sheet>
  );
}
