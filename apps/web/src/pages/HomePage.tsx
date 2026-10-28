import { useContext, createContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays, addMonths, daysInMonth, formatBRL, weekdayShort } from "@fin/domain";
import { Donut, EvolutionChart, YearBarChart, type YearRow } from "../charts";
import { AvatarFigure } from "../Avatar";
import { TxSheet } from "../TxSheet";
import { setHidden, useHidden } from "../privacy";
import { useInView } from "../useInView";
import { usePullToRefresh } from "../usePullToRefresh";
import { Bar, ErrorText, Icon, Loading, MonthNav, Sheet, brl, shortDate } from "../ui";
import { api, useAction, useApi, type Card, type Category, type Invoice, type Me, type Member, type Tx } from "../api";
import { BankMark } from "../banks";
import { CategoryIcon } from "../categories";
import { PersonFilter, personParam } from "../people";
import { useAppState, type PersonScope } from "../state";

const HiddenMoney = createContext(false);
const LAYOUT_KEY = "fin-home-layout";

const BLOCKS = [
  ["summary", "Resumo"],
  ["goal", "Meta: gastar menos que recebe"],
  ["upcoming", "Próximos vencimentos"],
  ["invoices", "Faturas dos cartões"],
  ["categories", "Despesas por categoria"],
  ["evolution", "Evolução das despesas"],
  ["recurrence", "Despesas por recorrência"],
  ["year", "Mês a mês"],
] as const;

type BlockId = (typeof BLOCKS)[number][0];
const DEFAULT_ORDER = BLOCKS.map(([id]) => id);

function loadLayout(): { order: BlockId[]; hidden: BlockId[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null");
    const saved: BlockId[] = Array.isArray(raw?.order) ? raw.order : [];
    const order = saved
      .filter((id, i) => DEFAULT_ORDER.includes(id) && saved.indexOf(id) === i)
      .concat(DEFAULT_ORDER.filter((id) => !saved.includes(id)));
    const hidden = (Array.isArray(raw?.hidden) ? raw.hidden : []).filter((id: string) => DEFAULT_ORDER.includes(id as BlockId));
    return { order, hidden };
  } catch {
    return { order: DEFAULT_ORDER, hidden: [] };
  }
}

const EMPTY_TXS: Tx[] = [];

function MoneyText({ cents, sign }: { cents: number; sign?: boolean }) {
  const hidden = useContext(HiddenMoney);
  if (hidden) return <span className="money">R$ ••••</span>;
  const text = formatBRL(cents, { sign });
  const neg = text.startsWith("-");
  const pos = text.startsWith("+");
  const [sym, rest] = text.replace(/^[+-]/, "").split(" ");
  return (
    <span className="money">
      {neg ? "-" : pos ? "+" : ""}
      <span className="rs">{sym}</span> {rest}
    </span>
  );
}

/** Revela cada card com um leve fade+subida na primeira vez que entra na tela. */
function RevealItem({ index, forwardRef, children }: { index: number; forwardRef?: (node: HTMLDivElement | null) => void; children: ReactNode }) {
  const [setEl, seen] = useInView<HTMLDivElement>("0px 0px -72px 0px");
  return (
    <div
      ref={(node) => {
        setEl(node);
        forwardRef?.(node);
      }}
      className={`reveal${seen ? " in" : ""}`}
      style={{ transitionDelay: `${Math.min(index, 6) * 40}ms` }}
    >
      {children}
    </div>
  );
}

function cumulative(items: Tx[], month: string) {
  const days = daysInMonth(month);
  const byDay = Array.from({ length: days }, () => 0);
  for (const tx of items) {
    if (!tx.include_in_reports || tx.kind !== "expense") continue;
    if (tx.competence_month && tx.competence_month !== month) continue;
    const raw = tx.card_id ? tx.invoice_due_on || "" : tx.due_on || tx.occurred_on;
    const date = raw.startsWith(month) ? raw : `${month}-01`;
    byDay[Number(date.slice(8, 10)) - 1] += tx.amount_cents;
  }
  let run = 0;
  return byDay.map((value) => {
    run += value;
    return run;
  });
}

function dayTitle(date: string, today: string) {
  const wd = weekdayShort(date);
  const day = Number(date.slice(8, 10));
  const sameMonth = date.slice(0, 7) === today.slice(0, 7);
  const label = sameMonth ? `${wd} ${day}` : `${wd} ${day}/${date.slice(5, 7)}`;
  if (date === today) return `Hoje · ${label}`;
  if (date === addDays(today, 1)) return `Amanhã · ${label}`;
  return label;
}

export function HomePage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const { month, setMonth, today, person } = useAppState();
  const q = useApi(`/dashboard?month=${month}&person=${personParam(person)}`);
  const budgets = useApi(`/budgets?month=${month}`);
  const cards = useApi<Card[]>("/cards");
  const monthInvoices = useApi<{ card_id: number; invoice: Invoice }[]>(`/cards/month/${month}`);
  const [catName, setCatName] = useState<string | null>(null);
  const [classify, setClassify] = useState<string | null>(null);
  const [evoRef, evoSeen] = useInView<HTMLDivElement>();
  const [yearRef, yearSeen] = useInView<HTMLDivElement>();
  const needTxs = catName !== null || classify !== null || evoSeen;
  const expNow = useApi(needTxs ? `/transactions?month=${month}&kind=expense&person=${personParam(person)}` : null);
  const expPrev = useApi(evoSeen ? `/transactions?month=${addMonths(month, -1)}&kind=expense&person=${personParam(person)}` : null);
  const hiddenMoney = useHidden();
  const toggleHide = () => setHidden(!hiddenMoney);
  const ptr = usePullToRefresh();
  const [layout, setLayout] = useState(loadLayout);
  const [config, setConfig] = useState(false);
  const [showCum, setShowCum] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [txId, setTxId] = useState<number | null>(null);
  const txQ = useApi<Tx>(txId ? `/transactions/${txId}` : null);
  const yearScroll = useRef<HTMLDivElement>(null);
  const d = q.data;

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > window.innerHeight * 1.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const saveLayout = (order: BlockId[], hidden: BlockId[]) => {
    const next = { order, hidden };
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* sem persistência, mas não quebra */
    }
  };

  const moveBlock = (id: BlockId, dir: -1 | 1) => {
    const order = [...layout.order];
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    saveLayout(order, layout.hidden);
  };

  const txs: Tx[] = expNow.data?.items ?? EMPTY_TXS;
  const prevTxs: Tx[] = expPrev.data?.items ?? EMPTY_TXS;
  const nowSeries = useMemo((): number[] => (d?.evolution?.current?.length ? d.evolution.current : cumulative(txs, month)), [d, txs, month]);
  const prevSeries = useMemo((): number[] => (d?.evolution?.previous?.length ? d.evolution.previous : cumulative(prevTxs, addMonths(month, -1))), [d, prevTxs, month]);
  const todayDay = today.startsWith(month) ? Number(today.slice(8, 10)) : daysInMonth(month);
  const evolution = nowSeries.map((total, index) => {
    const day = index + 1;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const past = date <= today;
    return {
      day,
      atual: past ? total : null,
      proj: !past || day === todayDay ? total : null,
      anterior: prevSeries[index] ?? prevSeries.at(-1) ?? null,
    };
  });
  const spentToday = nowSeries[Math.min(todayDay, nowSeries.length) - 1] ?? 0;
  const spentPrev = prevSeries[Math.min(todayDay, prevSeries.length) - 1] ?? 0;

  const year = Number(month.slice(0, 4));
  const yearQ = useApi(yearSeen ? `/reports/year?year=${year}&mode=planned&person=${personParam(person)}` : null);
  const sel = Number(month.slice(5, 7)) - 1;

  if (!d) {
    return (
      <main className="page home">
        <HomeHeader me={me} members={[]} person={person} hidden={hiddenMoney} onToggle={toggleHide} />
        <MonthNav month={month} onChange={setMonth} />
        <PersonFilter />
        <ErrorText error={q.error} />
        {!q.error && (
        <div className="home-empty" style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)' }}>
          <Icon.alert />
          <p style={{ margin: 0 }}>Carregando seus dados financeiros...</p>
        </div>
      )}
      </main>
    );
  }

  const expenseTotal = d.expense.total_cents;
  const incomeTotal = d.income.total_cents;
  const resultCents = incomeTotal - expenseTotal;
  const cats: { category_id: number | null; name: string; color: string | null; total_cents: number }[] = d.categories;
  const top = cats.slice(0, 5);
  const restCents = cats.slice(5).reduce((sum, item) => sum + item.total_cents, 0);
  const outros = cats.find((item) => /outros|sem categoria/i.test(item.name || ""));
  const budgetOf = (id: number | null, name: string) =>
    (budgets.data?.items ?? []).find((item: { category_id: number; name: string }) => item.category_id === id || item.name === name);
  const childrenOf = (name: string) => {
    const map = new Map<string, { name: string; total_cents: number; color: string | null }>();
    for (const tx of txs) {
      if (!tx.include_in_reports) continue;
      const parent = tx.parent_category_name || tx.category_name || "Sem categoria";
      if (parent !== name) continue;
      const child = tx.parent_category_name ? tx.category_name || "Geral" : "Geral";
      const color = tx.category_color;
      const row = map.get(child) ?? { name: child, total_cents: 0, color };
      row.total_cents += tx.amount_cents;
      map.set(child, row);
    }
    return [...map.values()].sort((a, b) => b.total_cents - a.total_cents);
  };

  const allUpcoming = d.upcoming as Upcoming[];
  const cardDue = allUpcoming.filter((item) => item.type === "invoice");
  const bills = allUpcoming.filter((item) => item.type !== "invoice").slice(0, 5);
  const upcoming = [...cardDue, ...bills].sort((a, b) => a.due_on.localeCompare(b.due_on) || a.id - b.id);
  const groups = new Map<string, Upcoming[]>();
  for (const item of upcoming) {
    const list = groups.get(item.due_on) ?? [];
    list.push(item);
    groups.set(item.due_on, list);
  }

  const invoiceRows = (cards.data ?? [])
    .map((card) => ({ card, invoice: monthInvoices.data?.find((row) => row.card_id === card.id)?.invoice }))
    .filter((row) => row.invoice && row.invoice.total_cents > 0);
  const invoiceTotal = invoiceRows.reduce((sum, row) => sum + (row.invoice?.remaining_cents ?? 0), 0);

  const blocks: Record<BlockId, ReactNode> = {
    summary: (
      <section className="card soft" aria-label="Resumo">
        <small>Saldo atual nas contas</small>
        <div className="home-balance">
          <MoneyText cents={d.balance.current_cents} />
        </div>
        <div className={`forecast${d.balance.forecast_cents < 0 ? " neg" : " pos"}`}>
          {d.balance.forecast_cents < 0 ? <Icon.alert /> : <Icon.check />}
          <span>
            Previsto no fim do mês: <MoneyText cents={d.balance.forecast_cents} />
          </span>
        </div>
        <div className="sum-grid">
          <Link to="/lancamentos?tipo=receitas" className="sum-col">
            <small>Receitas</small>
            <b className="sum-val pos">
              <MoneyText cents={d.income.total_cents} />
            </b>
            <Bar ratio={d.income.total_cents ? d.income.realized_cents / d.income.total_cents : 0} />
            <small>{d.income.planned_cents > 0 ? <><MoneyText cents={d.income.planned_cents} /> a receber</> : "recebidas"}</small>
          </Link>
          <Link to="/lancamentos" className="sum-col">
            <small>Despesas</small>
            <b className="sum-val exp">
              <MoneyText cents={expenseTotal} />
            </b>
            <Bar ratio={expenseTotal ? d.expense.realized_cents / expenseTotal : 0} />
            <small>{d.expense.to_pay_cents > 0 ? <><MoneyText cents={d.expense.to_pay_cents} /> a pagar</> : "pagas"}</small>
          </Link>
        </div>
        {d.expense.planned_cents > 0 && (
          <p className="sum-desc">
            Orçamento: <MoneyText cents={d.expense.realized_cents} /> de <MoneyText cents={d.expense.planned_cents} />
            {d.expense.realized_cents / d.expense.planned_cents >= 1 ? " · meta ultrapassada" : d.expense.realized_cents / d.expense.planned_cents >= 0.8 ? " · perto da meta" : ""}
          </p>
        )}
      </section>
    ),
    goal: (
      <section className="card goal-card" aria-label="Meta: gastar menos que recebe">
        <h2>Meta: gastar menos que recebe</h2>
        <div className={`goal-head${resultCents >= 0 ? " pos" : " neg"}`}>
          {resultCents >= 0 ? <Icon.check /> : <Icon.alert />}
          <span>
            {resultCents >= 0 ? "Sobra" : "Falta"} <MoneyText cents={Math.abs(resultCents)} /> {resultCents >= 0 ? "neste mês" : "pra fechar o mês no azul"}
          </span>
        </div>
        <div className="cmp-bars">
          <div className="cmp-row">
            <span className="cmp-label">Receitas</span>
            <span className="cmp-track">
              <i style={{ width: `${Math.min(100, (incomeTotal / Math.max(incomeTotal, expenseTotal, 1)) * 100)}%`, background: "var(--pos)" }} />
            </span>
            <b className="num"><MoneyText cents={incomeTotal} /></b>
          </div>
          <div className="cmp-row">
            <span className="cmp-label">Despesas</span>
            <span className="cmp-track">
              <i style={{ width: `${Math.min(100, (expenseTotal / Math.max(incomeTotal, expenseTotal, 1)) * 100)}%`, background: "var(--exp)" }} />
            </span>
            <b className="num"><MoneyText cents={expenseTotal} /></b>
          </div>
        </div>
      </section>
    ),
    upcoming: (
      <section className="card" aria-label="Próximos vencimentos">
        <div className="hd">
          <div className="hd-title">
            <h2>Próximos vencimentos</h2>
            <p className="hd-desc">Próximos 30 dias</p>
          </div>
          <Link className="home-jump" to="/calendario">
            Calendário <Icon.right />
          </Link>
        </div>
        {upcoming.length === 0 && <p className="empty">Nada vencendo nos próximos 30 dias.</p>}
        {[...groups.entries()].map(([date, items]) => {
          const subtotal = items.reduce((sum, item) => sum + (item.kind === "income" ? item.amount_cents : -item.amount_cents), 0);
          return (
            <div key={date} className="due-day">
              <div className="due-head">
                <small>{dayTitle(date, today)}</small>
                <small className="num">
                  <MoneyText cents={subtotal} sign />
                </small>
              </div>
              {items.map((item) => {
                const isInvoice = item.type === "invoice";
                const body = (
                  <>
                    {isInvoice ? (
                      <BankMark name={item.card_name || item.description} size={40} fallback />
                    ) : (
                      <CategoryIcon cat={{ id: item.id, name: item.category_name || item.description, color: item.category_color, icon: item.category_icon, parent_id: item.category_parent_id }} size={40} />
                    )}
                    <span className="due-main">
                      <span className="due-title">
                        <span>{item.description}</span>
                        {item.installment_label && <span className="tx-parcel">{item.installment_label}</span>}
                      </span>
                      <small className={item.overdue ? "late" : item.due_on === today ? "soon" : undefined}>
                        {isInvoice
                          ? item.overdue
                            ? "Atrasada"
                            : item.due_on === today
                              ? "Vence hoje"
                              : "A pagar"
                          : item.overdue
                            ? "Atrasado"
                            : item.due_on === today
                              ? item.kind === "income"
                                ? "Recebe hoje"
                                : "Vence hoje"
                              : item.kind === "income"
                                ? "A receber"
                                : "Previsto"}
                      </small>
                    </span>
                    <b className={`num due-amt${item.kind === "income" ? " pos" : ""}`}>
                      <MoneyText cents={item.amount_cents} sign={item.kind === "income"} />
                    </b>
                  </>
                );
                return (
                  <div key={`${item.type}-${item.id}`} className="due-row">
                    {isInvoice ? (
                      <Link className="due-hit" to={`/cartoes?card=${item.card_id}&mes=${item.reference_month}`}>
                        {body}
                      </Link>
                    ) : (
                      <button type="button" className="due-hit" onClick={() => setTxId(item.id)}>
                        {body}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {upcoming.length > 0 && (
          <Link className="home-jump" to="/lancamentos">
            Ver todos <Icon.right />
          </Link>
        )}
      </section>
    ),
    categories: (
      <section className="card" aria-label="Despesas por categoria">
        <div className="hd">
          <h2>Despesas por categoria</h2>
          <Link className="home-jump" to="/orcamento">
            Orçamento <Icon.right />
          </Link>
        </div>
        {cats.length === 0 ? (
          <p className="empty">Nenhuma despesa neste mês.</p>
        ) : (
          <>
            <Donut
              slices={(restCents > 0 ? [...top, { name: "Demais categorias", total_cents: restCents, color: "#8E9AAF" }] : top).map((item) => ({ name: item.name, value: item.total_cents, color: item.color }))}
              centerValue={hiddenMoney ? "R$ ••••" : brl(expenseTotal)}
              centerCaption="Despesas"
              ariaLabel={`Despesas, ${brl(expenseTotal)}`}
              onPick={(name) => {
                if (name === "Demais categorias") return;
                if (isCatchAll(name)) setClassify(name);
                else setCatName(name);
              }}
            />
            <div className="cat-rows">
              {top.map((item) => {
                const budget = budgetOf(item.category_id, item.name);
                const ratio = budget?.planned_cents ? item.total_cents / budget.planned_cents : 0;
                const barColor = ratio >= 1 ? "var(--neg)" : ratio >= 0.8 ? "var(--warn-text)" : item.color || "#8E9AAF";
                return (
                  <button key={item.category_id ?? item.name} type="button" className="cat-row" onClick={() => (isCatchAll(item.name) ? setClassify(item.name) : setCatName(item.name))}>
                    <CategoryIcon cat={{ id: item.category_id ?? 0, name: item.name, color: item.color, parent_id: null }} size={40} />
                    <span className="due-main">
                      <span className="due-title">
                        <span>{item.name}</span>
                      </span>
                      <small className="num">
                        <MoneyText cents={item.total_cents} />
                      </small>
                      {budget?.planned_cents > 0 && (
                        <>
                          <span className="mini-bar" style={{ color: barColor }}>
                            <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                          </span>
                          <small>
                            <MoneyText cents={item.total_cents} /> de <MoneyText cents={budget.planned_cents} />
                          </small>
                        </>
                      )}
                    </span>
                    <b className="num">{expenseTotal ? `${Math.round((item.total_cents / expenseTotal) * 100)}%` : ""}</b>
                  </button>
                );
              })}
              {restCents > 0 && (
                <div className="cat-row">
                  <CategoryIcon cat={{ id: 0, name: "Demais categorias", color: "#8E9AAF", parent_id: null }} size={40} />
                  <span className="due-main">
                    <span className="due-title">
                      <span>Demais categorias</span>
                    </span>
                    <small className="num">
                      <MoneyText cents={restCents} />
                    </small>
                  </span>
                  <b className="num">{expenseTotal ? `${Math.round((restCents / expenseTotal) * 100)}%` : ""}</b>
                </div>
              )}
            </div>
            {outros && expenseTotal > 0 && outros.total_cents / expenseTotal > 0.2 && (
              <div className="hint-box">
                <p>{outros.name} está entre as maiores deste mês. Classificar abre cada gasto para você escolher a categoria.</p>
                <button type="button" className="home-jump" onClick={() => setClassify(outros.name)}>
                  Classificar <Icon.right />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    ),
    evolution: (
      <section className="card" aria-label="Evolução das despesas">
        <h2>Evolução das despesas</h2>
        <p className="hd-desc">Comparado ao mês anterior</p>
        {spentToday === 0 ? (
          <div className="home-empty sm" style={{ padding: '20px 0', textAlign: 'center' }}>
            <Icon.alert />
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>Nenhuma despesa neste mês.<br/>Use o botão "+" para registrar seus lançamentos.</p>
          </div>
        ) : (
          <>
            <EvolutionChart data={evolution} todayDay={todayDay} formatValue={(cents) => (hiddenMoney ? "R$ ••••" : brl(cents))} />
            <p className="evo-note">
              Até hoje você gastou <MoneyText cents={spentToday} />
              {spentPrev > 0 && (
                <>
                  , {Math.abs(Math.round(((spentToday - spentPrev) / spentPrev) * 100))}% {spentToday <= spentPrev ? "a menos" : "a mais"} que no mesmo ponto do mês passado
                </>
              )}
              .{" "}
              <Link className="home-jump" to="/lancamentos">
                Ver <Icon.right />
              </Link>
            </p>
          </>
        )}
      </section>
    ),
    recurrence: (
      <section className="card" aria-label="Despesas por recorrência">
        <h2>Despesas por recorrência</h2>
        <p className="hd-desc">Se repetem todo mês e comprometem meses futuros</p>
        {expenseTotal === 0 ? (
          <div className="home-empty sm" style={{ padding: '20px 0', textAlign: 'center' }}>
            <Icon.alert />
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>Nenhuma despesa recorrente neste mês.<br/>Use o botão "+" para criar suas primeiras parcelamentos.</p>
          </div>
        ) : (
          <>
            <Donut
              slices={d.recurrence.map((item: { name: string; color: string; total_cents: number }) => ({ name: item.name, value: item.total_cents, color: item.color }))}
              centerValue={hiddenMoney ? "R$ ••••" : brl(expenseTotal)}
              centerCaption="No mês"
              ariaLabel={`Despesas por recorrência, ${brl(expenseTotal)}`}
              onPick={(name) => {
                const item = d.recurrence.find((row: { name: string }) => row.name === name);
                if (!item) return;
                navigate(item.key === "fixed" ? "/recorrencias" : item.key === "installment" ? "/parcelamentos" : "/lancamentos");
              }}
            />
            <div className="rec-rows">
              {d.recurrence.map((item: { key: string; name: string; color: string; total_cents: number }) => (
                <Link key={item.key} className="rec-row" to={item.key === "fixed" ? "/recorrencias" : item.key === "installment" ? "/parcelamentos" : "/lancamentos"}>
                  <i className="sw" style={{ background: item.color }} />
                  <span>{item.name}</span>
                  <b className="num">
                    <MoneyText cents={item.total_cents} />
                  </b>
                  <Icon.right />
                </Link>
              ))}
            </div>
            <p className="evo-note">
              Parcelas futuras comprometidas: <MoneyText cents={d.future_installments_cents ?? 0} />
            </p>
          </>
        )}
      </section>
    ),
    invoices: (
      <section className="card" aria-label="Faturas dos cartões">
        <div className="hd">
          <h2>Faturas dos cartões</h2>
          <Link className="home-jump" to="/cartoes">
            Cartões <Icon.right />
          </Link>
        </div>
        {invoiceRows.length === 0 ? (
          <p className="empty">Nenhuma fatura neste mês.</p>
        ) : (
          invoiceRows.map(({ card, invoice }) => (
            <Link key={card.id} to={`/cartoes?card=${card.id}&mes=${month}`} className="inv-line">
              <BankMark name={card.name} size={36} fallback />
              <span className="due-main">
                <span className="due-title">
                  <span>{card.name}</span>
                </span>
                <small>Vence {shortDate(invoice!.due_date)}</small>
              </span>
              <span className={`badge ${invoice!.state === "paid" ? "green" : invoice!.state === "overdue" ? "red" : "quiet"}`}>
                {invoice!.state === "overdue" ? "Atrasada" : invoice!.remaining_cents > 0 ? "A pagar" : invoice!.state_label}
              </span>
              <b className="num">
                <MoneyText cents={invoice!.remaining_cents || invoice!.total_cents} />
              </b>
            </Link>
          ))
        )}
        {invoiceRows.length > 0 && (
          <div className="due-head">
            <small>Total das faturas</small>
            <b className="num">
              <MoneyText cents={invoiceTotal} />
            </b>
          </div>
        )}
      </section>
    ),
    year: <YearBlock year={year} monthIndex={sel} data={yearQ.data} showCum={showCum} onToggle={() => setShowCum((v) => !v)} onPick={(index) => setMonth(`${year}-${String(index + 1).padStart(2, "0")}`)} scroller={yearScroll} />,
  };

  const selectedCat = catName ? cats.find((item) => item.name === catName) : null;
  const childParts = catName ? childrenOf(catName) : [];

  return (
    <HiddenMoney.Provider value={hiddenMoney}>
      <main className="page home">
        <HomeHeader me={me} members={d.members} person={person} hidden={hiddenMoney} onToggle={toggleHide} />
        <MonthNav month={month} onChange={setMonth} />
        <PersonFilter />
        <div
          className={`ptr${ptr.busy ? " busy" : ""}`}
          style={{
            height: ptr.busy ? 44 : Math.min(60, ptr.pull * 0.65),
            transition: ptr.busy || ptr.pull === 0 ? "height 220ms cubic-bezier(.22,1,.36,1)" : "none",
          }}
          aria-hidden
        >
          <span className={`ptr-icon${ptr.busy ? " busy" : ptr.ready ? " ready" : ""}`}>
            {ptr.busy ? <span className="ptr-spinner" /> : <Icon.arrowDown />}
          </span>
          {(ptr.busy || ptr.pull > 8) && <small>{ptr.busy ? "Atualizando…" : ptr.ready ? "Solte para atualizar" : "Puxe para atualizar"}</small>}
        </div>
        <ErrorText error={q.error} />
        <div className="home-stack">
          {layout.order.filter((id) => !layout.hidden.includes(id)).map((id, index) => {
            const block = blocks[id];
            // Só renderiza o bloco se tiver conteúdo relevante
            const hasData =
              id === 'summary' ? true : // Resumo sempre mostra algo
              id === 'goal' ? true :
              id === 'upcoming' ? upcoming.length > 0 :
              id === 'invoices' ? invoiceRows.length > 0 :
              id === 'categories' ? cats.length > 0 :
              id === 'evolution' ? spentToday !== 0 :
              id === 'recurrence' ? expenseTotal !== 0 :
              id === 'year' ? yearQ.data ? true : false : false;

            if (!hasData) return null;
            // evolution/year também carregam a ref do observer que antecipa o carregamento do gráfico.
            return (
              <RevealItem key={id} index={index} forwardRef={id === "evolution" ? evoRef : id === "year" ? yearRef : undefined}>
                {block}
              </RevealItem>
            );
          })}
        </div>
        <button type="button" className="config-home" style={{ color: 'var(--green)', borderColor: 'var(--green)' }} onClick={() => setConfig(true)}>
          <Icon.grid /> Configurar resumo
        </button>
        {showTop && (
          <button type="button" className="to-top" aria-label="Voltar ao topo" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </main>
      {config && (
        <Sheet title="Configurar resumo" onClose={() => setConfig(false)}>
          <p className="empty">Use as setas para reordenar. “Ocultar” esconde o card da tela inicial.</p>
          <div className="layout-list">
            {layout.order.map((id, index) => {
              const label = BLOCKS.find(([key]) => key === id)?.[1];
              const off = layout.hidden.includes(id);
              return (
                <div key={id} className={`layout-row${off ? " off" : ""}`}>
                  <span className="layout-name">{label}</span>
                  <span className="layout-tools">
                    <button type="button" className="mv" aria-label={`Subir ${label}`} disabled={index === 0} onClick={() => moveBlock(id, -1)}>↑</button>
                    <button type="button" className="mv" aria-label={`Descer ${label}`} disabled={index === layout.order.length - 1} onClick={() => moveBlock(id, 1)}>↓</button>
                    <button
                      type="button"
                      className="link"
                      onClick={() => saveLayout(layout.order, off ? layout.hidden.filter((item) => item !== id) : [...layout.hidden, id])}
                    >
                      {off ? "Mostrar" : "Ocultar"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn ghost block" onClick={() => saveLayout(DEFAULT_ORDER, [])}>
            Restaurar padrão
          </button>
        </Sheet>
      )}
      {classify && <ClassifySheet name={classify} items={bucketTxs(txs, classify)} onClose={() => setClassify(null)} />}
      {txQ.data && <TxSheet key={`${txQ.data.id}-${txQ.data.status}`} tx={txQ.data} onClose={() => setTxId(null)} />}
      {selectedCat && (
        <Sheet title={selectedCat.name} onClose={() => setCatName(null)}>
          <button type="button" className="home-jump" onClick={() => setCatName(null)}>
            <Icon.left /> Voltar
          </button>
          {childParts.length === 0 ? (
            <p className="empty">Sem subcategorias neste mês.</p>
          ) : (
            <>
              <Donut
                slices={childParts.map((item) => ({ name: item.name, value: item.total_cents, color: item.color }))}
                centerValue={hiddenMoney ? "R$ ••••" : brl(childParts.reduce((sum, item) => sum + item.total_cents, 0))}
                centerCaption={selectedCat.name}
                ariaLabel={`${selectedCat.name}, ${brl(childParts.reduce((sum, item) => sum + item.total_cents, 0))}`}
              />
              <div className="rec-rows">
                {childParts.map((item) => (
                  <div key={item.name} className="rec-row">
                    <i className="sw" style={{ background: item.color || selectedCat.color || "#8E9AAF" }} />
                    <span>{item.name}</span>
                    <b className="num">
                      <MoneyText cents={item.total_cents} />
                    </b>
                  </div>
                ))}
              </div>
            </>
          )}
        </Sheet>
      )}
    </HiddenMoney.Provider>
  );
}

type Upcoming = {
  type: string;
  id: number;
  description: string;
  amount_cents: number;
  due_on: string;
  kind: string;
  overdue: boolean;
  installment_label?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  category_icon?: string | null;
  category_parent_id?: number | null;
  card_id?: number;
  card_name?: string;
  reference_month?: string;
};

function isCatchAll(name: string) {
  return /^(outros|sem categoria)$/i.test(name.trim());
}

function bucketTxs(txs: Tx[], name: string) {
  return txs.filter((tx) => {
    if (!tx.include_in_reports) return false;
    const parent = tx.parent_category_name || tx.category_name || "Sem categoria";
    return parent === name;
  });
}

function ClassifySheet({ name, items, onClose }: { name: string; items: Tx[]; onClose: () => void }) {
  const cats = useApi<Category[]>("/categories?kind=expense");
  const { toast } = useAppState();
  const [pending, setPending] = useState<number | null>(null);
  const move = useAction(
    ({ id, category_id }: { id: number; category_id: number }) => api(`/transactions/${id}`, { method: "PATCH", body: { category_id } }),
    (_res, vars) => {
      const cat = (cats.data ?? []).find((item) => item.id === vars.category_id);
      toast(cat ? `Foi para ${cat.name}` : "Categoria atualizada");
    },
  );
  const options = useMemo(() => {
    const all = (cats.data ?? []).filter((item) => !item.archived);
    const parents = all.filter((item) => item.parent_id == null);
    return parents.flatMap((parent) => {
      const kids = all.filter((item) => item.parent_id === parent.id);
      return [{ id: parent.id, label: parent.name }, ...kids.map((item) => ({ id: item.id, label: `${parent.name} · ${item.name}` }))];
    });
  }, [cats.data]);

  return (
    <Sheet title={`Classificar ${name}`} onClose={onClose}>
      <p className="empty">Escolha a categoria de cada gasto deste mês. A mudança vale só para esse lançamento.</p>
      {items.length === 0 ? (
        <p className="empty">Nada deste mês está em {name}.</p>
      ) : (
        items.map((tx) => (
          <label key={tx.id} className="classify-row">
            <span className="classify-top">
              <span>{tx.description || tx.category_name || "Despesa"}</span>
              <b className="num">
                <MoneyText cents={tx.amount_cents} />
              </b>
            </span>
            <select
              className="inp"
              aria-label={`Categoria de ${tx.description || "despesa"}`}
              value={tx.category_id ?? ""}
              disabled={pending === tx.id}
              onChange={(event) => {
                const category_id = Number(event.target.value);
                if (!category_id || category_id === tx.category_id) return;
                setPending(tx.id);
                move.mutate({ id: tx.id, category_id }, { onSettled: () => setPending(null) });
              }}
            >
              {!tx.category_id && <option value="">Sem categoria</option>}
              {options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ))
      )}
    </Sheet>
  );
}

function HomeHeader({ me, members, person, hidden, onToggle }: { me: Me; members: Member[]; person: PersonScope; hidden: boolean; onToggle: () => void }) {
  const shown = person === "all" ? members : members.filter((member) => member.me);
  return (
    <div className="hd home-top">
      <div className="home-greet">
        <small className="home-kicker">{me.household_name}</small>
        <h1>Olá, {me.name.split(" ")[0]}</h1>
      </div>
      <nav className="home-actions" aria-label="Ferramentas rápidas">
        {shown.length > 0 && (
          <Link to="/progresso" className="avatars" aria-label="Ver progresso dos membros">
            {shown.map((member) => (
              <AvatarFigure key={member.id} avatar={member.avatar} size={32} level={member.level} label={`${member.name}, nível ${member.level}`} />
            ))}
          </Link>
        )}
        <button type="button" className="ic eye" aria-pressed={hidden} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} onClick={onToggle}>
          {hidden ? <Icon.eyeOff /> : <Icon.eye />}
        </button>
      </nav>
    </div>
  );
}

function YearBlock({
  year,
  monthIndex,
  data,
  showCum,
  onToggle,
  onPick,
  scroller,
}: {
  year: number;
  monthIndex: number;
  data: { income: { months: number[] }; expense: { months: number[] }; balance: { months: number[] } } | undefined;
  showCum: boolean;
  onToggle: () => void;
  onPick: (index: number) => void;
  scroller: React.RefObject<HTMLDivElement>;
}) {
  useEffect(() => {
    const el = scroller.current;
    if (!el || !data) return;
    const slot = el.scrollWidth / 12;
    el.scrollLeft = Math.max(0, slot * monthIndex - el.clientWidth / 2 + slot / 2);
  }, [monthIndex, scroller, data]);
  if (!data) return <section className="card"><h2>{year} mês a mês</h2><Loading /></section>;
  const cum = data.balance.months.reduce((acc: number[], value: number) => [...acc, (acc.at(-1) ?? 0) + value], []);
  const rows = data.income.months.map((income: number, index: number) => ({
    name: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][index],
    inc: income,
    exp: data.expense.months[index],
    cum: cum[index],
  }));
  const picked = rows[monthIndex];
  return (
    <section className="card" aria-label="Ano em gráfico">
      <div className="hd">
        <h2>{year} mês a mês</h2>
        <Link className="home-jump" to="/ano">
          Visão anual <Icon.right />
        </Link>
      </div>
      <div className="legend">
        <span><i className="sw inc" />Receitas</span>
        <span><i className="sw exp" />Despesas</span>
        <button type="button" className={`cum-toggle${showCum ? " on" : ""}`} aria-pressed={showCum} onClick={onToggle}>
          Sobra acumulada
        </button>
      </div>
      <div className="year-scroll" ref={scroller}>
        <YearBarChart rows={rows as YearRow[]} monthIndex={monthIndex} showCum={showCum} onPick={onPick} />
      </div>
      <div className="ysel">
        <b>{picked?.name}</b>
        <div className="year-lines">
          <span><i className="sw inc" />Receitas <b className="num pos"><MoneyText cents={picked?.inc ?? 0} /></b></span>
          <span><i className="sw exp" />Despesas <b className="num exp"><MoneyText cents={picked?.exp ?? 0} /></b></span>
          <span><i className="sw cum" />Sobra no ano <b className="num"><MoneyText cents={picked?.cum ?? 0} /></b></span>
        </div>
      </div>
    </section>
  );
}
