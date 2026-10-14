import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { MONTHS_SHORT_PT, addMonths, monthLabel } from '@fin/domain';
import { api, useAction, useApi, type Account, type Card, type Invoice, type Tx } from '../api';
import { CATEGORY_COLORS, CategoryIcon, paintColor } from '../categories';
import { useAppState } from '../state';
import { TxSheet } from '../TxSheet';
import { BankMark, BankPicker, bankByName } from '../banks';
import { BrandMark, BrandPicker } from '../brands';
import { Confirm, ErrorText, Icon, Loading, MonthNav, MoneyInput, Sheet, brl, monthName, shortDate } from '../ui';
import { useConfirm } from '../useConfirm';
import { PaySheet } from '../PaySheet';
import { useSwipe } from '../useSwipe';

const CARD_COLORS = ['#8A05BE', '#EC7000', '#CC092F', '#1E1E1E', '#0070AF', '#00A868', '#FFB800', ...CATEGORY_COLORS.slice(3, 6)];
const MONTH_UP = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const dayMonth = (date: string) => `${date.slice(8, 10)}/${MONTH_UP[Number(date.slice(5, 7)) - 1]}.`;
function daysUntil(iso: string, today: string) {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
const when = (n: number) => (n < 0 ? `há ${-n} d` : n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);
const cardColor = (card: Pick<Card, 'id' | 'color'>) => card.color ?? CARD_COLORS[card.id % CARD_COLORS.length];

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
        </label>
        <ErrorText error={save.error} />
        <button className="btn block" disabled={save.isPending || !form.name.trim()}>
          Salvar
        </button>
      </form>
    </Sheet>
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

function DespesasSheet({ card, month, onClose, onTx }: { card: Card; month: string; onClose: () => void; onTx: (t: Tx) => void }) {
  const { toast } = useAppState();
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
  return (
    <>
    <Sheet title={`${card.name} · fatura de ${monthName(month)}`} onClose={onClose}>
      {!inv ? (
        <Loading />
      ) : (
        <>
          <small>
            Fecha em {shortDate(inv.closing_date)} · vence em {shortDate(inv.due_date)}
            {inv.pending_cents > 0 ? ` · ${brl(inv.pending_cents)} pendentes de confirmação` : ''}
          </small>
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
          {(inv.payments.length > 0 || inv.credit_in_cents > 0) && (
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
          )}
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
  ['excluir', 'Excluir', true],
];

function CardMenu({ name, onPick }: { name: string; onPick: (p: Panel) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="kebab" aria-label="Mais ações do cartão" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon.kebab />
      </button>
      {open && (
        <Sheet title={name} onClose={() => setOpen(false)}>
          <div className="list">
            {ACTIONS.map(([panel, label, danger]) => (
              <button
                key={panel}
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

function CardBlock({ card, invoice, accountName, onPanel }: { card: Card; invoice?: Invoice; accountName?: string; onPanel: (p: Panel) => void }) {
  const location = useLocation();
  const { today } = useAppState();
  const pct = Math.round(card.used_ratio * 100);
  const level = pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : 'ok';
  const barColor = level === 'crit' ? 'var(--neg)' : level === 'warn' ? 'var(--warn-text)' : cardColor(card);
  const closeIn = invoice && invoice.state === 'open' ? daysUntil(invoice.closing_date, today) : null;
  const dueIn = invoice && invoice.state !== 'paid' && invoice.state !== 'future' ? daysUntil(invoice.due_date, today) : null;
  return (
    <section className="card cc" aria-label={`Cartão ${card.name}`}>
      <div className="hd">
        <div className="row" style={{ minWidth: 0 }}>
          <CardLogo card={card} />
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 18 }}>{card.name}</b>
            {card.brand && (
              <span className="brand-line">
                <BrandMark name={card.brand} width={28} />
                <small>{card.brand}</small>
              </span>
            )}
          </div>
        </div>
        <div className="row" style={{ gap: 0 }}>
          <Link className="kebab" to="/lancar" state={{ from: location.pathname + location.search, cardId: card.id }} aria-label={`Nova compra no ${card.name}`}>
            <Icon.plus />
          </Link>
          <button type="button" className="kebab" aria-label="Despesas associadas" onClick={() => onPanel('despesas')}>
            <Icon.list />
          </button>
          <button type="button" className="kebab" aria-label={`Gráfico do ${card.name}`} onClick={() => onPanel('evolucao')}>
            <Icon.trend />
          </button>
          <CardMenu name={card.name} onPick={onPanel} />
        </div>
      </div>

      <div className="cc-3">
        <div>
          <small>Limite</small>
          <b className="num">{brl(card.limit_cents)}</b>
        </div>
        <button type="button" className="cc-mid" onClick={() => onPanel('historico')}>
          <small>Em aberto</small>
          <b className="num">
            {brl(card.committed_cents)} <span className="chev"><Icon.right /></span>
          </b>
        </button>
        <div className="right">
          <small>Lim. disponível</small>
          <b className="num pos">{brl(card.available_cents)}</b>
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="bar grow" style={{ height: 14, borderRadius: 7 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Limite usado">
          <i style={{ width: `${Math.min(100, pct)}%`, background: barColor }} />
        </div>
        <b className="num" style={{ fontSize: 13 }}>
          {pct}%
        </b>
      </div>
      {level !== 'ok' && (
        <small className={level === 'crit' ? 'late' : 'soon'}>
          {level === 'crit' ? 'Limite quase no fim' : 'Mais de 80% do limite usado'}
        </small>
      )}

      <div className="cc-3">
        <div>
          <small>Conta</small>
          <b className="bank-inline">
            {accountName && <BankMark name={accountName} size={16} />}
            {accountName ?? 'Escolher na hora'}
          </b>
        </div>
        <div style={{ textAlign: 'center' }}>
          <small>Fechamento</small>
          <b className="num">{invoice ? dayMonth(invoice.closing_date) : '–'}</b>
          {closeIn != null && closeIn >= 0 && <small className={closeIn <= 3 ? 'soon' : undefined}>{when(closeIn)}</small>}
        </div>
        <div className="right">
          <small>Vencimento</small>
          <b className="num">{invoice ? dayMonth(invoice.due_date) : '–'}</b>
          {dueIn != null && <small className={dueIn < 0 ? 'late' : dueIn <= 3 ? 'soon' : undefined}>{when(dueIn)}</small>}
        </div>
      </div>
      <small className="best-day">
        Melhor dia de compra: dia {card.closing_day}
        {card.closing_day > 28 ? ' (ou o último do mês)' : ''}
      </small>

      {invoice && (
        <button type="button" className="cc-inv" aria-label={`Lançamentos da fatura de ${monthName(invoice.reference_month)}`} onClick={() => onPanel('despesas')}>
          <div className="hd">
            <b style={{ fontSize: 18 }}>Fatura</b>
            <b className={`num ${invoice.remaining_cents > 0 ? 'neg' : 'pos'}`} style={{ fontSize: 20 }}>
              {brl(invoice.remaining_cents)}
            </b>
          </div>
          <div className="hd">
            <span>Pagamentos realizados</span>
            <span className={`num${invoice.paid_cents + invoice.credit_in_cents > 0 ? ' pos' : ''}`}>{brl(invoice.paid_cents + invoice.credit_in_cents)}</span>
          </div>
          <div className="hd">
            <span>Despesas do mês</span>
            <span className="num neg">
              {brl(invoice.total_cents)} <span className="chev"><Icon.right /></span>
            </span>
          </div>
        </button>
      )}

      <div className="hd">
        {invoice && invoice.remaining_cents > 0 ? (
          <span className={`badge ${invoice.state === 'overdue' ? 'red' : 'quiet'}`}>
            <span style={{ width: 14, height: 14, display: 'inline-flex' }}>{invoice.state === 'overdue' ? <Icon.alert /> : <Icon.clock />}</span>
            {invoice.state === 'overdue' ? 'Atrasada' : 'A pagar'}
          </span>
        ) : invoice ? (
          <span className={`badge ${stateBadge(invoice.state)}`}>
            {invoice.state === 'paid' && (
              <span style={{ width: 14, height: 14, display: 'inline-flex' }}>
                <Icon.check />
              </span>
            )}
            {invoice.state_label}
          </span>
        ) : (
          <span />
        )}
        <button type="button" className={invoice && invoice.remaining_cents > 0 ? 'btn sm' : 'btn ghost sm'} onClick={() => onPanel('pagar')}>
          {invoice && invoice.remaining_cents > 0 ? `Pagar ${brl(invoice.remaining_cents)}` : 'Pagamento antecipado'}
        </button>
      </div>
      {card.credit_cents > 0 && <small>Crédito de pagamento antecipado: {brl(card.credit_cents)}</small>}
    </section>
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

  const openedFromLink = Number(params.get('card')) || null;
  useEffect(() => {
    if (!openedFromLink || !cards.data) return;
    const c = cards.data.find((x) => x.id === openedFromLink);
    if (c) setPanel({ card: c, kind: 'despesas' });
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
    (r: any) => toast(r.archived ? 'O cartão tem compras, então foi arquivado' : 'Cartão excluído'),
  );

  const invoiceOf = (id: number) => monthInvoices.data?.find((m) => m.card_id === id)?.invoice;
  const totalDue = (monthInvoices.data ?? []).reduce((a, m) => a + m.invoice.remaining_cents, 0);
  const accountName = (id: number | null) => accounts.data?.accounts.find((a) => a.id === id)?.name;
  const archivedCards = (archived.data ?? []).filter((c) => c.archived);
  const setMonth = (m: string) => setParams({ mes: m });
  const swipe = useSwipe(() => setMonth(addMonths(month, -1)), () => setMonth(addMonths(month, 1)));
  const p = panel;
  const selected = selectedTx;

  if (cards.isLoading) return <main className="page"><Loading /></main>;

  return (
    <main className="page" {...swipe}>
      <div className="hd">
        <div>
          <h1>Cartões de crédito</h1>
          <small className="num">
            {brl(totalDue)} a pagar em {monthName(month)}
          </small>
        </div>
        <button className="btn sm" onClick={() => setNewCard(true)}>
          + Cartão
        </button>
      </div>
      <MonthNav month={month} onChange={setMonth} />
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
        cards.data.map((c) => <CardBlock key={c.id} card={c} invoice={invoiceOf(c.id)} accountName={accountName(c.default_pay_account_id)} onPanel={(kind) => setPanel({ card: c, kind })} />)
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
            </div>
          ))}
        </section>
      )}

      <small>Compras no cartão entram na fatura pelo fechamento. Pagar a fatura tira da conta, mas não conta como despesa.</small>

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
        <Confirm text={`Arquivar o ${p.card.name}? Ele some da lista, mas o histórico continua nos relatórios.`} onConfirm={() => {
            archive.mutate(p.card);
            setPanel(null);
          }} onClose={() => setPanel(null)} />
      )}
      {p?.kind === 'excluir' && (
        <Confirm danger text={`Excluir o ${p.card.name}? Se ele já tiver compras, vai ser arquivado para manter o histórico.`} onConfirm={() => {
            remove.mutate(p.card);
            setPanel(null);
          }} onClose={() => setPanel(null)} />
      )}
      {selected && <TxSheet key={selected.id + selected.status} tx={selected} onClose={() => setSelectedTx(null)} />}
    </main>
  );
}
