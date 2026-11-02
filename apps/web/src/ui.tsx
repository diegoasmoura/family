import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  House, List, CreditCard, Calendar, EllipsisVertical, Ellipsis, Check, Clock,
  CircleAlert, Search, X, ChevronLeft, ChevronRight, Flame, ChartColumn,
  TrendingUp, Plus, Lock, LockOpen, CircleCheckBig, Sun, Moon, Eye, EyeOff,
  LayoutGrid, ArrowDown, ArrowUpRight, ArrowDownLeft, UnfoldVertical, FoldVertical,
} from 'lucide-react';
import { addMonths, formatBRL, monthLabel, monthOf, weekdayShort } from '@fin/domain';
import type { Tx } from './api';
import { useAppState } from './state';
import type { usePullToRefresh } from './usePullToRefresh';

export const brl = (cents: number | null | undefined) => formatBRL(cents ?? 0);

export const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
export const dayLabel = (date: string) => `${date.slice(8, 10)} · ${weekdayShort(date)}`;

const MONTHS_LOWER = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthName = (month: string) => MONTHS_LOWER[Number(month.slice(5, 7)) - 1];

/** Volta à tela anterior. No computador a coluna já tem Mais, então o botão some. */
export function BackButton({ fallback = '/mais' }: { fallback?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="ic back"
      aria-label="Voltar"
      onClick={() => {
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else navigate(fallback);
      }}
    >
      <Icon.left />
    </button>
  );
}

// Lucide (lucide-react): traço uniforme de verdade em todo o conjunto, em vez
// do SVG caseiro de antes (que tinha peso visual desigual entre ícones).
// Mantém a mesma API (`Icon.xxx()`, sem args) pra não mudar nenhum call site.
export const Icon = {
  home: () => <House aria-hidden />,
  list: () => <List aria-hidden />,
  card: () => <CreditCard aria-hidden />,
  year: () => <Calendar aria-hidden />,
  kebab: () => <EllipsisVertical aria-hidden />,
  more: () => <Ellipsis aria-hidden />,
  check: () => <Check aria-hidden />,
  clock: () => <Clock aria-hidden />,
  alert: () => <CircleAlert aria-hidden />,
  search: () => <Search aria-hidden />,
  close: () => <X aria-hidden />,
  left: () => <ChevronLeft aria-hidden />,
  right: () => <ChevronRight aria-hidden />,
  flame: () => <Flame aria-hidden />,
  chart: () => <ChartColumn aria-hidden />,
  trend: () => <TrendingUp aria-hidden />,
  plus: () => <Plus aria-hidden />,
  lock: () => <Lock aria-hidden />,
  unlock: () => <LockOpen aria-hidden />,
  checkCircle: () => <CircleCheckBig aria-hidden />,
  sun: () => <Sun aria-hidden />,
  moon: () => <Moon aria-hidden />,
  eye: () => <Eye aria-hidden />,
  eyeOff: () => <EyeOff aria-hidden />,
  grid: () => <LayoutGrid aria-hidden />,
  arrowDown: () => <ArrowDown aria-hidden />,
  expense: () => <ArrowUpRight aria-hidden />,
  income: () => <ArrowDownLeft aria-hidden />,
  expand: () => <UnfoldVertical aria-hidden />,
  collapse: () => <FoldVertical aria-hidden />,
};

/** Indicador de "puxar pra atualizar", a partir do estado de usePullToRefresh. */
export function PullToRefresh({ ptr }: { ptr: ReturnType<typeof usePullToRefresh> }) {
  return (
    <div
      className={`ptr${ptr.busy ? ' busy' : ''}`}
      style={{
        height: ptr.busy ? 44 : Math.min(60, ptr.pull * 0.65),
        transition: ptr.busy || ptr.pull === 0 ? 'height 220ms cubic-bezier(.22,1,.36,1)' : 'none',
      }}
      aria-hidden
    >
      <span className={`ptr-icon${ptr.busy ? ' busy' : ptr.ready ? ' ready' : ''}`}>
        {ptr.busy ? <span className="ptr-spinner" /> : <Icon.arrowDown />}
      </span>
      {(ptr.busy || ptr.pull > 8) && <small>{ptr.busy ? 'Atualizando…' : ptr.ready ? 'Solte para atualizar' : 'Puxe para atualizar'}</small>}
    </div>
  );
}

export function StatusIcon({ status, label }: { status: Tx['display_status']; label?: string }) {
  const icon = status === 'paid' ? Icon.check() : status === 'overdue' ? Icon.alert() : status === 'card' ? Icon.card() : Icon.clock();
  return (
    <div className={`o ${status}`} role="img" aria-label={label}>
      {icon}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; label: string }) {
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
