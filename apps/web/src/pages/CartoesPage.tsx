import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { MONTHS_SHORT_PT, addMonths, monthLabel } from '@fin/domain';
import { api, useAction, useApi, type Account, type Card, type Invoice, type Tx } from '../api';
import { CATEGORY_COLORS, CategoryIcon, paintColor } from '../categories';
import { useAppState } from '../state';
import { TxSheet } from '../TxSheet';
import { BankMark, BankPicker, bankByName } from '../banks';
import { BrandPicker } from '../brands';
import { Confirm, ErrorText, Icon, Loading, MonthNav, MoneyInput, PullToRefresh, Sheet, brl, monthName, shortDate } from '../ui';
import { useConfirm } from '../useConfirm';
import { PaySheet } from '../PaySheet';
import { AccountForm } from '../AccountForm';
import { DeleteConfirm } from '../DeleteConfirm';
import { CardRail } from '../CardFace';
import { useSwipe } from '../useSwipe';
import { usePullToRefresh } from '../usePullToRefresh';

const CARD_COLORS = ['#8A05BE', '#EC7000', '#CC092F', '#1E1E1E', '#0070AF', '#00A868', '#FFB800', ...CATEGORY_COLORS.slice(3, 6)];
const MONTH_UP = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const dayMonth = (date: string) => `${date.slice(8, 10)}/${MONTH_UP[Number(date.slice(5, 7)) - 1]}.`;
function daysUntil(iso: string, today: string) {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
const when = (n: number) => (n < 0 ? `há ${-n} d` : n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);
export const cardColor = (card: Pick<Card, 'id' | 'color'>) => card.color ?? CARD_COLORS[card.id % CARD_COLORS.length];

type Panel = 'despesas' | 'historico' | 'categorias' | 'evolucao' | 'reajustar' | 'pagar' | 'editar' | 'arquivar' | 'excluir';

export function CardLogo({ card, size = 48 }: { card: Pick<Card, 'id' | 'name' | 'color'>; size?: number }) {
  if (bankByName(card.name)) return <BankMark name={card.name} size={size} />;
  const initials = card.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toLowerCase();
  return (
    <span className="card-logo" style={{ width: size, height: size, background: cardColor(card), fontSize: size * 0.42 }} aria-hidden>
      {initials}
    </span>
  );
}

function CardForm({ card, onClose }: { card?: Card; onClose: () => void }) {
  const { toast } = useAppState();
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const [newAccount, setNewAccount] = useState(false);
  const [form, setForm] = useState({
    name: card?.name ?? '',
    brand: card?.brand ?? '',
    closing_day: card?.closing_day ?? 1,
    due_day: card?.due_day ?? 10,
    limit_cents: card?.limit_cents ?? (null as number | null),
    default_pay_account_id: card?.default_pay_account_id ?? null,
    color: card?.color ?? null,
  });
  const save = useAction(
    () => (card ? api(`/cards/${card.id}`, { method: 'PATCH', body: form }) : api('/cards', { body: form })),
    () => {
      toast(card ? 'Cartão atualizado' : 'Cartão criado');
      onClose();
    },
  );
  const day = (k: 'closing_day' | 'due_day', label: string) => (
    <label className="f">
      <span>{label}</span>
      <select value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }))}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            Dia {d}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
    <Sheet title={card ? 'Editar cartão' : 'Novo cartão'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <label className="f">
          <span>Banco</span>
          <BankPicker name={form.name} onChange={(name, color) => setForm((f) => ({ ...f, name, ...(color ? { color } : {}) }))} />
        </label>
        <label className="f">
          <span>Bandeira</span>
          <BrandPicker name={form.brand} onChange={(brand) => setForm((f) => ({ ...f, brand }))} />
        </label>
        <div className="row">
          {day('closing_day', 'Fechamento')}
          {day('due_day', 'Vencimento')}
        </div>
        <MoneyInput label="Limite" value={form.limit_cents} onChange={(v) => setForm((f) => ({ ...f, limit_cents: v }))} />
        <label className="f">
          <span>Conta padrão para pagar a fatura</span>
          <select value={form.default_pay_account_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, default_pay_account_id: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">Escolher na hora</option>
            {accounts.data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="button" className="link" onClick={() => setNewAccount(true)}>
            + Nova conta
          </button>
        </label>
        <ErrorText error={save.error} />
        <button className="btn block" disabled={save.isPending || !form.name.trim()}>
          Salvar
        </button>
      </form>
    </Sheet>
    {newAccount && <AccountForm onClose={() => setNewAccount(false)} onSaved={(saved) => setForm((f) => ({ ...f, default_pay_account_id: saved.id }))} />}
    </>
  );
}

function useInvoiceDetail(card: Card, month: string) {
  return useApi(`/cards/${card.id}/invoices/${month}`);
}

function untilLabel(t: Tx) {
  if (!t.installment_label) return '';
  const [current, total] = t.installment_label.split('/').map(Number);
  if (!current || !total) return '';
  const end = addMonths(t.competence_month, total - current);
  return ` · até ${monthName(end)} ${end.slice(0, 4)}`;
}

type Purchase = Tx & { category_icon: string | null };

function PurchaseRow({ t, onTx }: { t: Purchase; onTx: (t: Tx) => void }) {
  return (
    <button className="r" style={{ minHeight: 56 }} onClick={() => onTx(t)}>
      <CategoryIcon
        cat={{
          id: t.category_id ?? 0,
          name: t.category_name ?? t.description ?? 'Compra',
          icon: t.category_icon,
          color: paintColor(t.category_color, t.parent_category_color, t.category_name ?? t.description ?? 'Compra'),
        }}
        size={34}
      />
      <div className="m">
        <span className="t">
          {t.description || t.category_name || 'Compra'}
          {t.installment_label ? ` ${t.installment_label}` : ''}
        </span>
        <small>
          {shortDate(t.occurred_on)}
          {t.category_name ? ` · ${t.parent_category_name ? `${t.parent_category_name} › ` : ''}${t.category_name}` : ''}
          {untilLabel(t)}
          {t.status === 'planned' ? ' · pendente' : ''}
        </small>
      </div>
      <b className="num">{brl(t.amount_cents)}</b>
    </button>
  );
}

function DespesasSheet({ card, month: startMonth, onClose, onTx }: { card: Card; month: string; onClose: () => void; onTx: (t: Tx) => void }) {
  const { toast } = useAppState();
  const [month, setMonth] = useState(startMonth);
  const detail = useInvoiceDetail(card, month);
  const removePayment = useAction((id: number) => api(`/invoice-payments/${id}`, { method: 'DELETE' }), () => toast('Pagamento removido'));
  const { confirm, dialog } = useConfirm();
  const inv = detail.data;
  const txs = (inv?.transactions ?? []) as Purchase[];
  const groups = [
    ['Parcelas', txs.filter((t) => t.plan_id)],
    ['Fixas', txs.filter((t) => t.recurrence_id && !t.plan_id)],
    ['Avulsas', txs.filter((t) => !t.plan_id && !t.recurrence_id)],
  ].filter((entry): entry is [string, Purchase[]] => entry[1].length > 0);
  const paymentsSection = inv && (inv.payments.length > 0 || inv.credit_in_cents > 0) && (
    <section className="card">
      <h2>Pagamentos</h2>
      {inv.credit_in_cents > 0 && (
        <div className="kv">
          <span>Crédito da fatura anterior</span>
          <b className="num">{brl(inv.credit_in_cents)}</b>
        </div>
      )}
      {inv.payments.map((p: any) => (
        <div className="kv" key={p.id}>
          <span>
            {shortDate(p.paid_on)} · {p.account_name}
          </span>
          <span className="row">
            <b className="num">{brl(p.amount_cents)}</b>
            <button
              className="link"
              aria-label="Remover pagamento"
              onClick={() =>
                confirm(
                  `Remover o pagamento de ${brl(p.amount_cents)} feito em ${shortDate(p.paid_on)}? O valor volta para a conta, mas as compras que ele já efetivou continuam efetivadas.`,
                  () => removePayment.mutate(p.id),
                )
              }
            >
              remover
            </button>
          </span>
        </div>
      ))}
    </section>
  );
  return (
    <>
    <Sheet title={`${card.name} · lançamentos`} onClose={onClose}>
      <div className="hd month-nav">
        <button type="button" className="ic" aria-label="Fatura anterior" onClick={() => setMonth(addMonths(month, -1))}>
          <Icon.left />
        </button>
        <b>Fatura de {monthName(month)}</b>
        <button type="button" className="ic" aria-label="Próxima fatura" onClick={() => setMonth(addMonths(month, 1))}>
          <Icon.right />
        </button>
      </div>
      {!inv ? (
        <Loading />
      ) : (
        <>
          <small>
            Fecha em {shortDate(inv.closing_date)} · vence em {shortDate(inv.due_date)}
            {inv.pending_cents > 0 ? ` · ${brl(inv.pending_cents)} pendentes de confirmação` : ''}
          </small>
          {inv.state === 'paid' && paymentsSection}
          {txs.length === 0 && <p className="empty">Nenhuma compra nesta fatura.</p>}
          {groups.map(([title, items]) => (
            <div key={title} className="stack" style={{ gap: 4 }}>
              <h3 className="inv-grp">{title}</h3>
              <div className="list">
                {items.map((t) => (
                  <PurchaseRow key={t.id} t={t} onTx={onTx} />
                ))}
              </div>
            </div>
          ))}
          <div className="kv">
            <span>Total da fatura</span>
            <b className="num">{brl(inv.total_cents)}</b>
          </div>
          {inv.state !== 'paid' && paymentsSection}
          <ErrorText error={removePayment.error} />
        </>
      )}
    </Sheet>
    {dialog}
    </>
  );
}

function CategoriasSheet({ card, month, onClose }: { card: Card; month: string; onClose: () => void }) {
  const detail = useInvoiceDetail(card, month);
  const inv = detail.data;
  const groups = new Map<string, { name: string; icon: string | null; color: string | null; total: number }>();
  for (const t of (inv?.transactions ?? []) as any[]) {
    const name = t.parent_category_name ?? t.category_name ?? 'Sem categoria';
    const g = groups.get(name) ?? {
      name,
      icon: t.parent_category_name ? t.parent_category_icon : t.category_icon,
      color: t.parent_category_name ? t.parent_category_color : t.category_color,
      total: 0,
    };
    g.total += t.amount_cents;
    groups.set(name, g);
  }
  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  const total = list.reduce((a, g) => a + g.total, 0);
  return (
    <Sheet title={`Categorias · ${monthName(month)}`} onClose={onClose}>
      {!inv ? (
        <Loading />
      ) : list.length === 0 ? (
        <p className="empty">Nenhuma compra nesta fatura.</p>
      ) : (
        <>
          <div className="donut-bar" aria-hidden>
            {list.map((g, i) => (
              <i key={g.name} style={{ flex: g.total, background: g.color ?? CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
            ))}
          </div>
          <div className="list">
            {list.map((g, i) => (
              <div key={g.name} className="r" style={{ minHeight: 52 }}>
                <CategoryIcon cat={{ id: i, name: g.name, icon: g.icon, color: g.color ?? CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} size={32} />
                <div className="m">
                  <span className="t">{g.name}</span>
                  <small>{Math.round((g.total / total) * 100)}% da fatura</small>
                </div>
                <b className="num">{brl(g.total)}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function curve(pts: { x: number; y: number }[]) {
  if (!pts.length) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
  }
  return d;
}

function visible(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#8A05BE';
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (r * 0.299 + g * 0.587 + b * 0.114 > 50) return hex;
  const mix = (c: number) => Math.round(c + (176 - c) * 0.7);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function inkOn(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  return lum > 150 ? '#12330a' : '#fff';
}

function axisMoney(cents: number) {
  if (cents <= 0) return '0';
  const v = cents / 100;
  if (v < 1000) return brl(cents);
  const mil = v / 1000;
  return `${mil.toLocaleString('pt-BR', { maximumFractionDigits: mil >= 10 ? 0 : 1 })} mil`;
}

function EvolucaoSheet({ card, month, onPick, onClose }: { card: Card; month: string; onPick: (m: string) => void; onClose: () => void }) {
  const { today } = useAppState();
  const q = useApi<Invoice[]>(`/cards/${card.id}/invoices?from=${addMonths(month, -11)}&to=${month}`);
  const [picked, setPicked] = useState<string | null>(null);
  const [W, setW] = useState(320);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [q.data]);
  const rows = q.data ?? [];
  const peak = Math.max(0, ...rows.map((i) => i.total_cents));
  const avg = rows.length ? rows.reduce((a, i) => a + i.total_cents, 0) / rows.length : 0;
  const sel = rows.find((i) => i.reference_month === (picked ?? month)) ?? rows.at(-1);
  const color = visible(cardColor(card));
  const future = (m: string) => m > today.slice(0, 7);
  const H = 210;
  const L = 8;
  const R = 16;
  const T = 22;
  const B = 30;
  const scale = Math.max(1, peak);
  const y = (v: number) => T + ((scale - v) / scale) * (H - T - B);
  const base = y(0);
  const slot = rows.length ? (W - L - R) / rows.length : 0;
  const cx = (i: number) => L + slot * i + slot / 2;
  const wide = slot >= 34;
  const pts = rows.map((inv, i) => ({ inv, i, x: cx(i), y: y(inv.total_cents) }));
  const cut = pts.findIndex((p) => future(p.inv.reference_month));
  const solid = cut === -1 ? pts : pts.slice(0, cut);
  const dashed = cut <= 0 ? [] : pts.slice(cut - 1);
  return (
    <Sheet title={`Evolução · ${card.name}`} onClose={onClose}>
      {!q.data ? (
        <Loading />
      ) : (
        <>
          <small>Total de cada fatura nos últimos 12 meses. Toque num mês para ver o valor.</small>
          <div ref={box}>
            <svg className="cchart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Total das faturas nos últimos 12 meses" style={{ ['--cc' as string]: color, ['--cc-ink' as string]: inkOn(color) }}>
              <defs>
                <linearGradient id={`evo-${card.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={color} stopOpacity="0.28" />
                  <stop offset="1" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {peak > 0 && (
                <>
                  <line x1={L} x2={W - R} y1={y(scale)} y2={y(scale)} className="grid" />
                  <text x={L + 2} y={y(scale) - 5} className="ax">{axisMoney(peak)}</text>
                </>
              )}
              <line x1={L} x2={W - R} y1={base} y2={base} className="zero" />
              {pts.length > 1 && <path d={`${curve(pts)}L${pts[pts.length - 1].x},${base}L${pts[0].x},${base}Z`} fill={`url(#evo-${card.id})`} className="area" />}
              {pts.map(({ inv, i, x }) => {
                const label = wide ? MONTHS_SHORT_PT[Number(inv.reference_month.slice(5, 7)) - 1] : MONTHS_SHORT_PT[Number(inv.reference_month.slice(5, 7)) - 1][0];
                const on = inv.reference_month === sel?.reference_month;
                const pillW = wide ? 34 : 18;
                return (
                  <g key={inv.reference_month} className={`mon${future(inv.reference_month) ? ' fut' : ''}${on ? ' on' : ''}`} onClick={() => setPicked(inv.reference_month)}>
                    <rect x={L + slot * i + 1} y={8} width={Math.max(0, slot - 2)} height={base - 8} rx={10} className="hit" />
                    {on && <rect x={x - pillW / 2} y={H - 22} width={pillW} height={18} rx={9} className="pill" />}
                    <text x={x} y={H - 9} textAnchor="middle" className="ax mo-l">{label}</text>
                  </g>
                );
              })}
              <path d={curve(solid)} className="line" />
              <path d={curve(dashed)} className="line fut" />
              {pts.map(({ inv, x, y: py }) => (
                <g key={inv.reference_month} className={future(inv.reference_month) ? 'fut' : undefined}>
                  {inv.reference_month === sel?.reference_month && <circle cx={x} cy={py} r={9} className="halo" />}
                  <circle cx={x} cy={py} r={inv.reference_month === sel?.reference_month ? 4.5 : 3.2} className="dot" />
                </g>
              ))}
            </svg>
          </div>
          {sel && (
            <div className="ysel">
              <div className="row">
                <b>{monthName(sel.reference_month)}</b>
                {future(sel.reference_month) && <span className="tag">Previsto</span>}
              </div>
              <div className="ysel3">
                <div>
                  <small>Fatura</small>
                  <b className="num" style={{ color }}>{brl(sel.total_cents)}</b>
                </div>
                <div>
                  <small>Média</small>
                  <b className="num">{brl(Math.round(avg))}</b>
                </div>
                <div>
                  <small>Maior</small>
                  <b className="num">{brl(peak)}</b>
                </div>
              </div>
              <button type="button" className="btn ghost" onClick={() => onPick(sel.reference_month)}>Ver as compras</button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

function HistoricoSheet({ card, month, onPick, onClose }: { card: Card; month: string; onPick: (m: string) => void; onClose: () => void }) {
  const q = useApi<Invoice[]>(`/cards/${card.id}/invoices?from=${addMonths(month, -12)}&to=${addMonths(month, 3)}`);
  return (
    <Sheet title={`Faturas · ${card.name}`} onClose={onClose}>
      {!q.data ? (
        <Loading />
      ) : (
        <div className="list">
          {[...q.data].reverse().map((i) => (
            <button key={i.reference_month} className={`r${i.reference_month === month ? ' sel' : ''}`} style={{ minHeight: 56 }} onClick={() => onPick(i.reference_month)}>
              <div className="m">
                <span className="t">{monthLabel(i.reference_month)}</span>
                <small>Vence em {shortDate(i.due_date)}</small>
              </div>
              <div className="v">
                <span className="num">{brl(i.total_cents)}</span>
                <span className={`badge ${stateBadge(i.state)}`}>{i.state_label}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function ReajustarSheet({ card, month, onClose }: { card: Card; month: string; onClose: () => void }) {
  const { toast } = useAppState();
  const detail = useInvoiceDetail(card, month);
  const [value, setValue] = useState<number | null>(null);
  const inv = detail.data;
  const parcel = inv?.installment_cents ?? 0;
  const looseNow = inv?.loose_cents ?? 0;
  const loose = value ?? (inv ? looseNow : null);
  const diff = inv && loose != null ? loose - looseNow : 0;
  const save = useAction(
    (looseCents: number) => api(`/invoices/${inv.id}/adjust`, { body: { loose_cents: looseCents } }),
    () => {
      toast('Fatura reajustada');
      onClose();
    },
  );
  return (
    <Sheet title={`Reajustar fatura de ${monthName(month)}`} onClose={onClose}>
      {!inv ? (
        <Loading />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (loose != null) save.mutate(loose);
          }}
        >
          <small>As parcelas ficam como estão. Corrija aqui o resto: compras avulsas, fixas e a diferença do app do banco.</small>
          <div className="kv">
            <span>Parcelas</span>
            <b className="num">{brl(parcel)}</b>
          </div>
          <MoneyInput allowNegative label="O que não é parcela" value={loose} onChange={setValue} />
          <div className="kv">
            <span>Fatura</span>
            <b className="num">{brl(parcel + (loose ?? 0))}</b>
          </div>
          {diff !== 0 && <div className="card soft" style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700 }}>{diff > 0 ? 'Sobe' : 'Desce'} {brl(Math.abs(diff))} no que não é parcela.</div>}
          <ErrorText error={save.error} />
          <button className="btn big" disabled={loose == null || diff === 0 || save.isPending}>
            Reajustar
          </button>
          {inv.adjustment_cents ? (
            <button type="button" className="btn ghost" disabled={save.isPending} onClick={() => save.mutate(looseNow - (inv.adjustment_cents ?? 0))}>
              Desfazer correção
            </button>
          ) : null}
        </form>
      )}
    </Sheet>
  );
}

const stateBadge = (s: Invoice['state']) => (s === 'paid' ? 'green' : s === 'overdue' || s === 'closed' ? 'red' : s === 'future' ? 'gray' : '');

const ACTIONS: [Panel, string, boolean?][] = [
  ['editar', 'Editar cartão'],
  ['reajustar', 'Reajustar fatura'],
  ['historico', 'Histórico de faturas'],
  ['despesas', 'Despesas associadas'],
  ['categorias', 'Gráfico por categorias'],
  ['evolucao', 'Evolução mensal'],
  ['arquivar', 'Arquivar'],
  ['excluir', 'Excluir cartão e lançamentos', true],
];

function CardMenu({ name, invoicePaid, onPick }: { name: string; invoicePaid?: boolean; onPick: (p: Panel) => void }) {
  const [open, setOpen] = useState(false);
  const actions = invoicePaid ? [['despesas', 'Desfazer pagamento'] as [Panel, string, boolean?], ...ACTIONS] : ACTIONS;
  return (
    <>
      <button type="button" className="pcd-act" aria-label="Mais ações do cartão" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon.kebab />
        <span>Mais</span>
      </button>
      {open && (
        <Sheet title={name} onClose={() => setOpen(false)}>
          <div className="list">
            {actions.map(([panel, label, danger]) => (
              <button
                key={label}
                type="button"
                className={`r${danger ? ' danger' : ''}`}
                style={{ minHeight: 52 }}
                onClick={() => {
                  setOpen(false);
                  onPick(panel);
                }}
              >
                <div className="m"><span className="t">{label}</span></div>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

function CardDetails({ card, invoice, accountName, onPanel }: { card: Card; invoice?: Invoice; accountName?: string; onPanel: (p: Panel) => void }) {
  const location = useLocation();
  const { today } = useAppState();
  const detail = useApi<any>(invoice?.id ? `/cards/${card.id}/invoices/${invoice.reference_month}` : null);
  const users = useApi<{ id: number; name: string }[]>('/users');
  const [dataOpen, setDataOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [bank, setBank] = useState<number | null>(null);

  const pct = Math.round(card.used_ratio * 100);
  const dueIn = invoice && invoice.state !== 'paid' && invoice.state !== 'future' ? daysUntil(invoice.due_date, today) : null;
  const closeIn = invoice && invoice.state === 'open' ? daysUntil(invoice.closing_date, today) : null;
  const owing = Boolean(invoice && invoice.remaining_cents > 0);
  const empty = !invoice || invoice.total_cents === 0;
  const txs = (detail.data?.transactions ?? []) as Tx[];
  const payments = (detail.data?.payments ?? []) as { paid_on: string; account_name?: string }[];
  const lastPaid = payments.reduce<string | null>((max, p) => (!max || p.paid_on > max ? p.paid_on : max), null);

  const who = new Map<string, number>();
  for (const t of txs) {
    const name = t.for_user_id ? (users.data?.find((u) => u.id === t.for_user_id)?.name.trim().split(/\s+/)[0] ?? 'Outro') : 'Da casa';
    who.set(name, (who.get(name) ?? 0) + t.amount_cents);
  }
  const whoRows = [...who.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents);
  const whoTotal = whoRows.reduce((sum, r) => sum + r.cents, 0);
  const COLORS = ['var(--chart-inc)', 'var(--chart-cum)', 'var(--chart-prev)'];

  const diff = bank != null && invoice ? bank - invoice.total_cents : null;

  return (
    <div className="pcd" aria-label={`Detalhes do ${card.name}`}>
      <div className="pcd-actions">
        <Link className="pcd-act" to="/lancar" state={{ from: location.pathname + location.search, cardId: card.id }}>
          <Icon.plus />
          <span>Compra</span>
        </Link>
        <button type="button" className="pcd-act" onClick={() => onPanel('despesas')}>
          <Icon.list />
          <span>Lançamentos</span>
        </button>
        <button type="button" className="pcd-act" onClick={() => onPanel('evolucao')}>
          <Icon.trend />
          <span>Evolução</span>
        </button>
        <CardMenu name={card.name} onPick={onPanel} />
      </div>

      {/* O que pede atenção depende da situação da fatura. */}
      {invoice && invoice.state === 'overdue' && owing && (
        <section className="pcd-status late" aria-label="Fatura atrasada">
          <Icon.alert />
          <span>
            Venceu {dayMonth(invoice.due_date)} · {when(dueIn ?? 0)}
          </span>
        </section>
      )}
      {invoice && owing && invoice.state !== 'overdue' && (
        <section className="pcd-status info" aria-label="Vencimento">
          <Icon.clock />
          <span>
            Vence {dayMonth(invoice.due_date)}
            {dueIn != null ? ` · ${when(dueIn)}` : ''}
            {closeIn != null && closeIn >= 0 ? ` · fecha ${when(closeIn)}` : ''}
          </span>
        </section>
      )}
      {invoice && owing && (
        <button type="button" className="btn block" onClick={() => onPanel('pagar')}>
          Pagar {brl(invoice.remaining_cents)}
        </button>
      )}
      {invoice && !owing && invoice.state === 'paid' && !empty && (
        <section className="pcd-status ok" aria-label="Fatura paga">
          <Icon.check />
          <span>
            Paga{lastPaid ? ` em ${shortDate(lastPaid)}` : ''} · {brl(invoice.total_cents)}
            {payments[0]?.account_name ? ` · ${payments[0].account_name}` : ''}
          </span>
        </section>
      )}
      {empty && (
        <section className="pcd-status info" aria-label="Sem compras">
          <Icon.clock />
          <span>
            Sem compras nesta fatura. Compras até o dia {card.closing_day} entram nela; depois, na próxima.
          </span>
        </section>
      )}
      {invoice && !owing && !empty && (
        <div className="pcd-links">
          <button type="button" className="pcd-link" onClick={() => onPanel('pagar')}>
            Adiantar pagamento
          </button>
          {invoice.state === 'paid' && (
            <button type="button" className="pcd-link" onClick={() => onPanel('despesas')}>
              Desfazer pagamento
            </button>
          )}
        </div>
      )}

      {!empty && invoice && (
        <section className="card pcd-month" aria-label="Compras da fatura">
          <button type="button" className="pcd-row" onClick={() => onPanel('despesas')}>
            <span>
              <b>{txs.length ? `${txs.length} ${txs.length === 1 ? 'compra' : 'compras'}` : 'Compras'}</b>
              <small>em {monthName(invoice.reference_month)}</small>
            </span>
            <b className="num">
              {brl(invoice.total_cents)} <span className="chev"><Icon.right /></span>
            </b>
          </button>
          {whoTotal > 0 && (
            <div className="who-split">
              <small>Quem gastou</small>
              <div className="who-bar" role="img" aria-label={whoRows.map((r) => `${r.name} ${Math.round((r.cents / whoTotal) * 100)}%`).join(', ')}>
                {whoRows.map((r, i) => (
                  <i key={r.name} style={{ width: `${(r.cents / whoTotal) * 100}%`, background: COLORS[Math.min(i, COLORS.length - 1)] }} />
                ))}
              </div>
              <div className="who-legend">
                {whoRows.map((r, i) => (
                  <span key={r.name}>
                    <i className="sw" style={{ background: COLORS[Math.min(i, COLORS.length - 1)] }} />
                    {r.name} <b>{Math.round((r.cents / whoTotal) * 100)}%</b> · {brl(r.cents)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button type="button" className="info-btn" aria-expanded={checking} onClick={() => setChecking((v) => !v)}>
            <span className={`chev${checking ? ' open' : ''}`} aria-hidden>
              <Icon.right />
            </span>
            Conferir com o banco
          </button>
          {checking && (
            <div className="pcd-confer">
              <MoneyInput label="Valor da fatura no app do banco" value={bank} onChange={setBank} />
              {diff != null && (
                <small className={diff === 0 ? 'ok' : 'late'}>
                  {diff === 0
                    ? <><Icon.check /> Confere com o app</>
                    : diff > 0
                      ? `O banco cobra ${brl(diff)} a mais que o app. Pode faltar lançar uma compra.`
                      : `O app tem ${brl(-diff)} a mais que o banco. Pode haver um lançamento a mais.`}
                </small>
              )}
              {diff != null && diff !== 0 && (
                <button type="button" className="btn ghost sm" onClick={() => onPanel('reajustar')}>
                  Reajustar fatura
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card pcd-data" aria-label="Dados do cartão">
        <button type="button" className="pcd-row" aria-expanded={dataOpen} onClick={() => setDataOpen((v) => !v)}>
          <b>Dados do cartão</b>
          <span className={`chev${dataOpen ? ' open' : ''}`} aria-hidden>
            <Icon.right />
          </span>
        </button>
        {dataOpen && (
          <div className="pcd-info">
            <div className="pcd-tile">
              <small>Fecha / vence</small>
              <b className="num">
                dia {card.closing_day} / dia {card.due_day}
              </b>
            </div>
            <div className="pcd-tile">
              <small>Melhor dia de compra</small>
              <b className="num">Dia {card.closing_day}</b>
              {card.closing_day > 28 && <small>ou o último do mês</small>}
            </div>
            <div className="pcd-tile">
              <small>Paga com</small>
              <b className="bank-inline">
                {accountName && <BankMark name={accountName} size={16} />}
                {accountName ?? 'Escolher na hora'}
              </b>
            </div>
            <button type="button" className="pcd-tile click" onClick={() => onPanel('historico')}>
              <small>Total comprometido</small>
              <b className="num">
                {brl(card.committed_cents)} <span className="chev"><Icon.right /></span>
              </b>
            </button>
          </div>
        )}
      </section>

      {pct >= 80 && <small className={pct >= 95 ? 'late' : 'soon'}>{pct >= 95 ? 'Limite quase no fim' : 'Mais de 80% do limite usado'}</small>}
      {card.credit_cents > 0 && <small>Crédito de pagamento antecipado: {brl(card.credit_cents)}</small>}
      <div className="lanc-note">
        <button type="button" className="info-btn" aria-expanded={noteOpen} onClick={() => setNoteOpen((v) => !v)}>
          <Icon.info /> Como o cartão conta
        </button>
        {noteOpen && <small>Compras no cartão entram na fatura pelo fechamento. Pagar a fatura tira da conta, mas não conta como despesa.</small>}
      </div>
    </div>
  );
}

export function CartoesPage() {
  const { toast, month: appMonth } = useAppState();
  const [params, setParams] = useSearchParams();
  const month = params.get('mes') ?? appMonth;
  const cards = useApi<Card[]>('/cards');
  const archived = useApi<Card[]>('/cards?archived=1');
  const monthInvoices = useApi<{ card_id: number; invoice: Invoice }[]>(`/cards/month/${month}`);
  const accounts = useApi<{ accounts: Account[] }>('/accounts');
  const [newCard, setNewCard] = useState(false);
  const [panel, setPanel] = useState<{ card: Card; kind: Panel } | null>(null);
  const [selectedTx, setSelectedTx] = useState<Tx | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [railKey, setRailKey] = useState(0);

  const openedFromLink = Number(params.get('card')) || null;
  useEffect(() => {
    if (!openedFromLink || !cards.data) return;
    const c = cards.data.find((x) => x.id === openedFromLink);
    if (c) {
      setPanel({ card: c, kind: 'despesas' });
      setActiveId(c.id);
      setRailKey((k) => k + 1);
    }
    const next = new URLSearchParams(params);
    next.delete('card');
    setParams(next, { replace: true });
  }, [openedFromLink, cards.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const archive = useAction(
    (card: Card) => api(`/cards/${card.id}`, { method: 'PATCH', body: { archived: 1 } }),
    () => toast('Cartão arquivado'),
  );
  const unarchive = useAction(
    (card: Card) => api(`/cards/${card.id}`, { method: 'PATCH', body: { archived: 0 } }),
    () => toast('Cartão reativado'),
  );
  const remove = useAction(
    (card: Card) => api(`/cards/${card.id}`, { method: 'DELETE' }),
    () => toast('Cartão excluído'),
  );

  const invoiceOf = (id: number) => monthInvoices.data?.find((m) => m.card_id === id)?.invoice;
  const totalDue = (monthInvoices.data ?? []).reduce((a, m) => a + m.invoice.remaining_cents, 0);
  const accountName = (id: number | null) => accounts.data?.accounts.find((a) => a.id === id)?.name;
  const archivedCards = (archived.data ?? []).filter((c) => c.archived);
  const setMonth = (m: string) => setParams({ mes: m });
  const swipe = useSwipe(() => setMonth(addMonths(month, -1)), () => setMonth(addMonths(month, 1)));
  const ptr = usePullToRefresh();
  const p = panel;
  const activeCard = cards.data?.find((c) => c.id === activeId) ?? cards.data?.[0];
  const selected = selectedTx;

  if (cards.isLoading) return <main className="page"><Loading /></main>;

  return (
    <main className="page" {...swipe}>
      <div className="hd">
        <h1>Cartões</h1>
        <button type="button" className="hd-add" aria-label="Novo cartão" onClick={() => setNewCard(true)}>
          <Icon.plus /> Cartão
        </button>
      </div>
      <MonthNav month={month} onChange={setMonth} />
      <PullToRefresh ptr={ptr} />
      <small className="num pc-due">
        {brl(totalDue)} a pagar em {monthName(month)}
      </small>
      <ErrorText error={cards.error ?? archive.error ?? remove.error ?? unarchive.error} />

      {!cards.data?.length ? (
        <section className="card dashed">
          <b>Nenhum cartão ainda</b>
          <small>Cadastre um cartão para que as compras entrem na fatura certa pelo fechamento.</small>
          <button className="btn" onClick={() => setNewCard(true)}>
            Adicionar cartão
          </button>
        </section>
      ) : (
        <>
          <CardRail
            key={railKey}
            cards={cards.data}
            month={month}
            detailed
            initialId={activeId ?? undefined}
            invoiceOf={(c) => invoiceOf(c.id)}
            onActive={(c) => setActiveId(c.id)}
            onOpen={(c) => setPanel({ card: c, kind: 'despesas' })}
          />
          {activeCard && <CardDetails key={activeCard.id} card={activeCard} invoice={invoiceOf(activeCard.id)} accountName={accountName(activeCard.default_pay_account_id)} onPanel={(kind) => setPanel({ card: activeCard, kind })} />}
        </>
      )}

      {archivedCards.length > 0 && (
        <section className="card">
          <h2>Arquivados</h2>
          {archivedCards.map((c) => (
            <div key={c.id} className="r" style={{ minHeight: 52 }}>
              <CardLogo card={c} size={34} />
              <div className="m">
                <span className="t">{c.name}</span>
              </div>
              <button className="btn ghost sm" onClick={() => unarchive.mutate(c)}>
                Reativar
              </button>
              <button className="btn ghost sm danger-text" onClick={() => setPanel({ card: c, kind: 'excluir' })}>
                Excluir
              </button>
            </div>
          ))}
        </section>
      )}


      {newCard && <CardForm onClose={() => setNewCard(false)} />}
      {p?.kind === 'editar' && <CardForm card={p.card} onClose={() => setPanel(null)} />}
      {p?.kind === 'pagar' && <PaySheet card={p.card} month={month} onClose={() => setPanel(null)} />}
      {p?.kind === 'despesas' && <DespesasSheet card={p.card} month={month} onClose={() => setPanel(null)} onTx={setSelectedTx} />}
      {p?.kind === 'categorias' && <CategoriasSheet card={p.card} month={month} onClose={() => setPanel(null)} />}
      {p?.kind === 'evolucao' && (
        <EvolucaoSheet
          card={p.card}
          month={month}
          onClose={() => setPanel(null)}
          onPick={(m) => {
            setMonth(m);
            setPanel({ card: p.card, kind: 'despesas' });
          }}
        />
      )}
      {p?.kind === 'reajustar' && <ReajustarSheet card={p.card} month={month} onClose={() => setPanel(null)} />}
      {p?.kind === 'historico' && (
        <HistoricoSheet
          card={p.card}
          month={month}
          onClose={() => setPanel(null)}
          onPick={(m) => {
            setMonth(m);
            setPanel({ card: p.card, kind: 'despesas' });
          }}
        />
      )}
      {p?.kind === 'arquivar' && (
        <Confirm text={`Arquivar o ${p.card.name}? Ele some da lista, mas o histórico continua nos relatórios. Só dá para arquivar com todas as faturas pagas.`} onConfirm={() => {
            archive.mutate(p.card, { onError: (e) => toast(e.message) });
            setPanel(null);
          }} onClose={() => setPanel(null)} />
      )}
      {p?.kind === 'excluir' && (
        <DeleteConfirm kind="cards" id={p.card.id} name={p.card.name} onConfirm={() => {
            remove.mutate(p.card);
            setPanel(null);
          }} onClose={() => setPanel(null)} />
      )}
      {selected && <TxSheet key={selected.id + selected.status} tx={selected} onClose={() => setSelectedTx(null)} />}
    </main>
  );
}
