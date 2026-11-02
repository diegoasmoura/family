import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatBRL, inkOn } from "@fin/domain";
import { bankByName, BankMark } from "./banks";
import { BrandMark } from "./brands";
import type { Card, Invoice } from "./api";
import { cardColor } from "./pages/CartoesPage";

/** Degradês dos emissores mais comuns. Fora da lista, o cartão usa a cor dele. */
const BANK_GRADIENTS: Record<string, string> = {
  inter: "linear-gradient(135deg, #2a2a2a 0%, #000 100%)",
  nubank: "linear-gradient(135deg, #a119e3 0%, #820ad1 55%, #5c0794 100%)",
  itau: "linear-gradient(135deg, #005ca9 0%, #ec7000 130%)",
  bradesco: "linear-gradient(135deg, #e60014 0%, #8c0000 100%)",
  santander: "linear-gradient(135deg, #ec0000 0%, #8c0000 100%)",
  c6bank: "linear-gradient(135deg, #3a3a3a 0%, #000 100%)",
  caixa: "linear-gradient(135deg, #0054a6 0%, #003870 100%)",
  bancodobrasil: "linear-gradient(135deg, #0a3fa8 0%, #001a4d 100%)",
  picpay: "linear-gradient(135deg, #21c25e 0%, #0e9b45 100%)",
  xp: "linear-gradient(135deg, #2c2c2c 0%, #000 100%)",
  original: "linear-gradient(135deg, #00a868 0%, #00703f 100%)",
};

type Face = { background: string; ink: "light" | "dark"; vars: Record<string, string> };

/**
 * Fundo e cor do texto andam juntos. Banco conhecido: degradê escuro/saturado, texto branco.
 * Cor própria: texto branco se a cor for escura (o degradê só escurece); texto escuro se for
 * clara (o degradê só clareia). Assim nenhum canto do cartão perde contraste.
 */
function faceStyle(card: Pick<Card, "id" | "name" | "color">): Face {
  const bank = bankByName(card.name);
  const preset = bank ? BANK_GRADIENTS[bank.id] : undefined;
  if (preset) return { background: preset, ink: "light", vars: { "--pc-ink": "#ffffff" } };
  const base = card.color ?? (bank ? bank.color : cardColor(card));
  if (inkOn(base) === "#ffffff") {
    return {
      background: `linear-gradient(135deg, ${base} 0%, color-mix(in srgb, ${base} 78%, #000) 55%, color-mix(in srgb, ${base} 55%, #000) 100%)`,
      ink: "light",
      vars: { "--pc-ink": "#ffffff" },
    };
  }
  return {
    background: `linear-gradient(135deg, color-mix(in srgb, ${base} 82%, #fff) 0%, ${base} 55%, color-mix(in srgb, ${base} 88%, #000) 100%)`,
    ink: "dark",
    vars: { "--pc-ink": "#1b2a10" },
  };
}

/** Logo do banco; se não for reconhecido, as iniciais num selo translúcido (legível em qualquer fundo). */
function BankBadge({ name }: { name: string }) {
  if (bankByName(name)) return <BankMark name={name} size={36} />;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="pcard-initials" aria-hidden>
      {initials}
    </span>
  );
}

/** Chip EMV: 8 contatos com gradiente dourado e brilho no topo. */
function Chip() {
  const id = useId();
  return (
    <svg viewBox="0 0 48 36" className="pcard-chip" aria-hidden>
      <rect x={0.5} y={0.5} width={47} height={35} rx={5} fill={`url(#${id}-g)`} stroke="#8a5e24" strokeOpacity={0.35} strokeWidth={0.75} />
      <g stroke="#6b4a1e" strokeOpacity={0.55} strokeWidth={0.6} strokeLinecap="round">
        <line x1={15.5} y1={2} x2={15.5} y2={34} />
        <line x1={32.5} y1={2} x2={32.5} y2={34} />
        <line x1={2} y1={11} x2={15.5} y2={11} />
        <line x1={2} y1={25} x2={15.5} y2={25} />
        <line x1={32.5} y1={11} x2={46} y2={11} />
        <line x1={32.5} y1={25} x2={46} y2={25} />
        <line x1={15.5} y1={18} x2={32.5} y2={18} />
      </g>
      <rect x={0.5} y={0.5} width={47} height={16} rx={5} fill={`url(#${id}-s)`} />
      <defs>
        <linearGradient id={`${id}-g`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f3e2b4" />
          <stop offset="50%" stopColor="#d6a85f" />
          <stop offset="100%" stopColor="#a6773a" />
        </linearGradient>
        <linearGradient id={`${id}-s`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.45} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Pagamento por aproximação: três arcos, sem ponto. */
function Contactless() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="pcard-nfc" aria-hidden>
      <path d="M6.5 15.5a9 9 0 0 1 0-7" opacity={0.55} />
      <path d="M10 17a13 13 0 0 1 0-10" opacity={0.78} />
      <path d="M13.5 18.5a17 17 0 0 1 0-13" />
    </svg>
  );
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

type Money = (cents: number) => ReactNode;

/** Valor com o "R$" menor. A classe .money respeita o olho de ocultar valores. */
const defaultMoney: Money = (cents) => {
  const [sym, rest] = formatBRL(cents).split(" ");
  return (
    <span className="money">
      <span className="rs">{sym}</span> {rest}
    </span>
  );
};

type FaceProps = {
  card: Card;
  month: string;
  money?: Money;
  /** Fatura do mês mostrado. Sem ela, usa a fatura atual do cartão. */
  invoice?: Invoice | null;
  /** Mostra a barra de limite e o fechamento dentro do cartão. */
  detailed?: boolean;
  /** Se informado, o cartão vira botão em vez de link. */
  onOpen?: (card: Card) => void;
};

export function CardFace({ card, month, money = defaultMoney, invoice: given, detailed, onOpen }: FaceProps) {
  const face = faceStyle(card);
  const invoice = given === undefined ? card.current_invoice : given;
  const open = invoice ? (invoice.state === "paid" ? invoice.total_cents : invoice.remaining_cents || invoice.total_cents) : 0;
  const overdue = invoice?.state === "overdue";
  const label = !invoice ? "Sem fatura" : invoice.state === "paid" ? "Fatura paga" : overdue ? "Fatura atrasada" : "Fatura em aberto";
  const pct = Math.round(Math.min(1, Math.max(0, card.used_ratio)) * 100);
  const level = pct >= 95 ? "crit" : pct >= 80 ? "warn" : "ok";
  const body = (
    <>
      <div className="pcard-top">
        <span className="pcard-chips">
          <Chip />
          <Contactless />
        </span>
        <b className="pcard-name">{card.name}</b>
      </div>
      <div className="pcard-main">
        <small className={overdue ? "late" : undefined}>{label}</small>
        <div className="pcard-amt-row">
          <div className="pcard-amt">{money(open)}</div>
          {card.brand && (
            <span className="pcard-brand">
              <BrandMark name={card.brand} width={40} />
            </span>
          )}
        </div>
      </div>
      {detailed && (
        <div className="pcard-use" data-level={level}>
          <span className="pcard-use-bar">
            <i style={{ width: `${pct}%` }} />
          </span>
          <small>
            {pct}% do limite de {money(card.limit_cents)}
          </small>
        </div>
      )}
      <div className="pcard-foot">
        {detailed && (
          <div>
            <small>Fecha</small>
            <b>{invoice ? ddmm(invoice.closing_date) : "—"}</b>
          </div>
        )}
        <div>
          <small>Vence</small>
          <b>{invoice ? ddmm(invoice.due_date) : "—"}</b>
        </div>
        <div>
          <small>Disponível</small>
          <b>{money(card.available_cents)}</b>
        </div>
        <span className="pcard-badge">
          <BankBadge name={card.name} />
        </span>
      </div>
      <span className="pcard-sheen" aria-hidden />
      <span className="pcard-grain" aria-hidden />
    </>
  );
  const props = { className: "pcard", "data-ink": face.ink, style: { background: face.background, ...face.vars } as CSSProperties, "aria-label": `${card.name}: ${label}` };
  if (onOpen) {
    return (
      <button type="button" {...props} onClick={() => onOpen(card)}>
        {body}
      </button>
    );
  }
  return (
    <Link to={`/cartoes?card=${card.id}&mes=${invoice?.reference_month ?? month}`} {...props}>
      {body}
    </Link>
  );
}

/** Cartões lado a lado: arrasta para o lado, usa as setas ou os pontinhos. */
export function CardRail({
  cards,
  month,
  money,
  invoiceOf,
  detailed,
  onOpen,
  onActive,
  initialId,
}: {
  cards: Card[];
  month: string;
  money?: Money;
  invoiceOf?: (card: Card) => Invoice | null | undefined;
  detailed?: boolean;
  onOpen?: (card: Card) => void;
  onActive?: (card: Card) => void;
  initialId?: number;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const start = Math.max(0, cards.findIndex((c) => c.id === initialId));
  const [active, setActive] = useState(start);
  useEffect(() => {
    const el = rail.current;
    if (el && start > 0) el.scrollLeft = (el.scrollWidth / cards.length) * start;
    // só na primeira exibição
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onScroll = () => {
    const el = rail.current;
    if (!el || cards.length < 2) return;
    const slot = el.scrollWidth / cards.length;
    const next = Math.max(0, Math.min(cards.length - 1, Math.round(el.scrollLeft / slot)));
    if (next !== active) {
      setActive(next);
      onActive?.(cards[next]);
    }
  };
  const goTo = (index: number) => {
    const el = rail.current;
    if (el) el.scrollTo({ left: (el.scrollWidth / cards.length) * index, behavior: "smooth" });
  };
  const step = (dir: -1 | 1) => goTo((active + dir + cards.length) % cards.length);
  return (
    <div className="pcard-wrap">
      <div className="pcard-stage">
        <div ref={rail} className={`pcard-rail${cards.length === 1 ? " one" : ""}`} onScroll={onScroll}>
          {cards.map((card) => (
            <CardFace key={card.id} card={card} month={month} money={money} invoice={invoiceOf ? (invoiceOf(card) ?? null) : undefined} detailed={detailed} onOpen={onOpen} />
          ))}
        </div>
      </div>
      {cards.length > 1 && (
        <div className="pcard-nav">
          <button type="button" className="pcard-arrow" aria-label="Cartão anterior" onClick={() => step(-1)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <div className="pcard-dots" role="tablist" aria-label="Escolher cartão">
            {cards.map((card, index) => (
              <button key={card.id} type="button" role="tab" aria-selected={index === active} aria-label={card.name} className={index === active ? "on" : undefined} onClick={() => goTo(index)} />
            ))}
          </div>
          <button type="button" className="pcard-arrow" aria-label="Próximo cartão" onClick={() => step(1)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
