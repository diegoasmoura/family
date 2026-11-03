import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { addMonths, daysInMonth, formatBRL } from "@fin/domain";
import { Donut, EvolutionChart, YearBarChart, type YearRow } from "../charts";
import { AvatarFigure } from "../Avatar";
import { setHidden, useHidden } from "../privacy";
import { useInView } from "../useInView";
import { usePullToRefresh } from "../usePullToRefresh";
import { ErrorText, Icon, MonthNav, NewButton, PullToRefresh, Sheet, SkeletonCard, brl, monthName } from "../ui";
import { api, useAction, useApi, type Card, type Category, type Invoice, type Me, type Member, type Tx } from "../api";
import { CardRail } from "../CardFace";
import { CategoryIcon } from "../categories";
import { PersonFilter, personParam, withPerson } from "../people";
import { useAppState, type PersonScope } from "../state";

const LAYOUT_KEY = "fin-home-layout";

const BLOCKS = [
  ["summary", "Resumo"],
  ["cards", "Cartões"],
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

function MoneyText({ cents, sign, abs }: { cents: number; sign?: boolean; abs?: boolean }) {
  const text = formatBRL(abs ? Math.abs(cents) : cents, { sign });
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

export function HomePage({ me }: { me: Me }) {
  const { month, setMonth, today, person } = useAppState();
  const q = useApi(`/dashboard?month=${month}&person=${personParam(person)}`);
  const budgets = useApi(`/budgets?month=${month}`);
  const cards = useApi<Card[]>(withPerson("/cards", person));
  // A fatura de cada cartão é a do mês escolhido, não a "atual" do cartão.
  const monthInvoices = useApi<{ card_id: number; invoice: Invoice }[]>(withPerson(`/cards/month/${month}`, person));
  const [catName, setCatName] = useState<string | null>(null);
  const [classify, setClassify] = useState<string | null>(null);
  const [evoRef, evoSeen] = useInView<HTMLDivElement>();
  const [yearRef, yearSeen] = useInView<HTMLDivElement>();
  const needTxs = classify !== null || evoSeen;
  const expNow = useApi(needTxs ? `/transactions?month=${month}&kind=expense&person=${personParam(person)}` : null);
  const expPrev = useApi(evoSeen ? `/transactions?month=${addMonths(month, -1)}&kind=expense&person=${personParam(person)}` : null);
  const hiddenMoney = useHidden();
  const toggleHide = () => setHidden(!hiddenMoney);
  const ptr = usePullToRefresh();
  const [layout, setLayout] = useState(loadLayout);
  const [showCum, setShowCum] = useState(false);
  const [showTop, setShowTop] = useState(false);
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
  // Evolução: o mês atual mostra o que já foi e a projeção; o passado só o que foi; o futuro só o programado.
  const thisMonth = today.slice(0, 7);
  const isCurrentMonth = month === thisMonth;
  const isFutureMonth = month > thisMonth;
  const monthTotal = nowSeries.at(-1) ?? 0;
  const prevTotal = prevSeries.at(-1) ?? 0;
  const evoNow = isCurrentMonth ? spentToday : monthTotal;
  const evoBefore = isCurrentMonth ? spentPrev : prevTotal;
  const evoDiff =
    evoBefore > 0 && evoNow > 0
      ? `${Math.abs(Math.round(((evoNow - evoBefore) / evoBefore) * 100))}% ${evoNow <= evoBefore ? "a menos" : "a mais"} que ${isCurrentMonth ? "no mesmo ponto do mês passado" : `em ${monthName(addMonths(month, -1))}`}`
      : null;

  const year = Number(month.slice(0, 4));
  const yearQ = useApi(yearSeen ? `/reports/year?year=${year}&mode=planned&person=${personParam(person)}` : null);
  const sel = Number(month.slice(5, 7)) - 1;

  if (!d) {
    return (
      <main className="page home">
        <HomeHeader me={me} members={[]} person={person} hidden={hiddenMoney} onToggle={toggleHide} />
        <PersonFilter />
        <MonthNav month={month} onChange={setMonth} />
        <ErrorText error={q.error} />
        {!q.error && (
          <div className="home-stack" aria-busy="true" aria-label="Carregando">
            <SkeletonCard lines={4} />
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </div>
        )}
      </main>
    );
  }

  const expenseTotal = d.expense.total_cents;
  const incomeTotal = d.income.total_cents;
  const resultCents = incomeTotal - expenseTotal;
  const noData = incomeTotal === 0 && expenseTotal === 0;
  const tone: "pos" | "neg" | "idle" = noData ? "idle" : resultCents < 0 ? "neg" : "pos";
  const toneLabel = tone === "idle" ? "Sem lançamentos" : tone === "neg" ? "No vermelho" : "No azul";
  const pastMonth = month < today.slice(0, 7);
  const heroLabel = pastMonth ? (tone === "neg" ? "Faltou no mês" : "Sobrou no mês") : tone === "neg" ? "Falta cobrir no mês" : "Sobra prevista no mês";
  const cats: { category_id: number | null; name: string; color: string | null; total_cents: number }[] = d.categories;
  const top = cats.slice(0, 5);
  const restCents = cats.slice(5).reduce((sum, item) => sum + item.total_cents, 0);
  const outros = cats.find((item) => /outros|sem categoria/i.test(item.name || ""));
  const budgetOf = (id: number | null, name: string) =>
    (budgets.data?.items ?? []).find((item: { category_id: number; name: string }) => item.category_id === id || item.name === name);
  // Subcategorias e "quem gastou" vêm do painel (já somando o cartão), então fecham com o total de Despesas.
  const childrenOf = (name: string) => {
    const map = new Map<string, { name: string; total_cents: number; color: string | null }>();
    for (const row of (d.category_breakdown ?? []) as { parent: string; name: string; color: string | null; total_cents: number }[]) {
      if (row.parent !== name) continue;
      const item = map.get(row.name) ?? { name: row.name, total_cents: 0, color: row.color };
      item.total_cents += row.total_cents;
      map.set(row.name, item);
    }
    return [...map.values()].sort((a, b) => b.total_cents - a.total_cents);
  };

  const whoMap = new Map<string, number>();
  for (const row of (d.spent_by_person ?? []) as { name: string | null; total_cents: number }[]) {
    const who = row.name ? row.name.trim().split(/\s+/)[0] : "Da casa";
    whoMap.set(who, (whoMap.get(who) ?? 0) + row.total_cents);
  }
  const whoRows = [...whoMap.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents);
  const whoTotal = whoRows.reduce((sum, row) => sum + row.cents, 0);
  const WHO_COLORS = ["var(--chart-inc)", "var(--chart-cum)", "var(--chart-prev)"];

  const cardList = (cards.data ?? []).filter((card) => !card.archived);

  const blocks: Record<BlockId, ReactNode> = {
    cards: (
      <section className="card" aria-label="Cartões">
        <div className="hd">
          <h2>Cartões</h2>
          <Link className="home-jump" to="/cartoes">
            Ver todos <Icon.right />
          </Link>
        </div>
        {monthInvoices.data ? (
          <CardRail
            cards={cardList}
            month={month}
            money={(cents) => <MoneyText cents={cents} />}
            invoiceOf={(card) => monthInvoices.data?.find((row) => row.card_id === card.id)?.invoice}
          />
        ) : (
          <SkeletonCard lines={2} />
        )}
      </section>
    ),
    summary: (
      <section className={`card sum-card ${tone}`} aria-label="Como estamos">
        <div className="sum-top">
          <small>{monthName(month)}</small>
          <span className={`sum-pill ${tone}`}>
            {tone === "neg" ? <Icon.alert /> : <Icon.check />}
            {toneLabel}
          </span>
        </div>
        <div className="sum-hero">
          <small>{heroLabel}</small>
          <div className="sum-amt">
            <MoneyText cents={resultCents} abs />
          </div>
        </div>
        <div className="sum-tiles">
          <Link to="/lancamentos?tipo=receitas" className="sum-tile in">
            <span className="sum-tile-hd">
              <i aria-hidden><Icon.income /></i>Entrou
            </span>
            <b>
              <MoneyText cents={d.income.realized_cents} />
            </b>
            {d.income.planned_cents > 0 && (
              <small>
                <MoneyText cents={d.income.planned_cents} /> a receber
              </small>
            )}
          </Link>
          <Link to="/lancamentos" className="sum-tile out">
            <span className="sum-tile-hd">
              <i aria-hidden><Icon.expense /></i>Saiu
            </span>
            <b>
              <MoneyText cents={d.expense.paid_cents} />
            </b>
            {d.expense.to_pay_cents > 0 && (
              <small>
                <MoneyText cents={d.expense.to_pay_cents} /> a pagar
              </small>
            )}
          </Link>
        </div>
        <div className="sum-foot">
          {month === today.slice(0, 7) && (
            <div className="sum-foot-row">
              <span>Saldo nas contas hoje</span>
              <b>
                <MoneyText cents={d.balance.current_cents} />
              </b>
            </div>
          )}
          <div className="sum-foot-row">
            <span>{month === today.slice(0, 7) ? "Previsto no fim do mês" : month < today.slice(0, 7) ? `Saldo no fim de ${monthName(month)}` : `Previsto para o fim de ${monthName(month)}`}</span>
            <b className={d.balance.forecast_cents < 0 ? "neg" : undefined}>
              <MoneyText cents={d.balance.forecast_cents} />
            </b>
          </div>
        </div>
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
            {person === "all" && whoTotal > 0 && (
              <div className="who-split">
                <small>Quem gastou</small>
                <div className="who-bar" role="img" aria-label={whoRows.map((row) => `${row.name} ${Math.round((row.cents / whoTotal) * 100)}%`).join(", ")}>
                  {whoRows.map((row, i) => (
                    <i key={row.name} style={{ width: `${(row.cents / whoTotal) * 100}%`, background: WHO_COLORS[Math.min(i, WHO_COLORS.length - 1)] }} />
                  ))}
                </div>
                <div className="who-legend">
                  {whoRows.map((row, i) => (
                    <span key={row.name}>
                      <i className="sw" style={{ background: WHO_COLORS[Math.min(i, WHO_COLORS.length - 1)] }} />
                      {row.name} <b>{Math.round((row.cents / whoTotal) * 100)}%</b> · <MoneyText cents={row.cents} />
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="cat-rows">
              {top.map((item) => {
                const budget = budgetOf(item.category_id, item.name);
                const ratio = budget?.planned_cents ? item.total_cents / budget.planned_cents : 0;
                const share = expenseTotal ? item.total_cents / expenseTotal : 0;
                const budgetTone = ratio >= 1 ? "over" : ratio >= 0.8 ? "near" : "";
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
                      <span className="mini-bar" style={{ color: item.color || "#8E9AAF" }}>
                        <i style={{ width: `${Math.min(100, share * 100)}%` }} />
                      </span>
                      {budget?.planned_cents > 0 && (
                        <small className={`cat-budget ${budgetTone}`}>
                          {ratio >= 1 ? "Passou do orçamento de " : ratio >= 0.8 ? "Perto do limite de " : "Orçamento de "}
                          <MoneyText cents={budget.planned_cents} />
                        </small>
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
                    <span className="mini-bar" style={{ color: "#8E9AAF" }}>
                      <i style={{ width: `${expenseTotal ? Math.min(100, (restCents / expenseTotal) * 100) : 0}%` }} />
                    </span>
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
      <section className="card" aria-label={isFutureMonth ? "Despesas previstas" : "Evolução das despesas"}>
        <div className="hd">
          <h2>{isFutureMonth ? "Despesas previstas" : "Evolução das despesas"}</h2>
          <Link className="home-jump" to="/lancamentos">
            Ver <Icon.right />
          </Link>
        </div>
        {monthTotal === 0 ? (
          <p className="empty">
            {isFutureMonth ? "Nada programado para este mês." : 'Nenhuma despesa neste mês. Use o botão "+" para registrar o primeiro gasto.'}
          </p>
        ) : (
          <>
            <EvolutionChart data={evolution} todayDay={isCurrentMonth ? todayDay : 0} formatValue={(cents) => (hiddenMoney ? "R$ ••••" : brl(cents))} />
            <p className="evo-note">
              {isCurrentMonth ? (
                <>
                  Até hoje você gastou <MoneyText cents={spentToday} />
                  {evoDiff && <>, {evoDiff}</>}.
                  {monthTotal > spentToday && (
                    <>
                      {" "}
                      Previsto para fechar o mês: <MoneyText cents={monthTotal} />, só com o que já está programado.
                    </>
                  )}
                </>
              ) : isFutureMonth ? (
                <>
                  Previsto para {monthName(month)}: <MoneyText cents={monthTotal} />, só com o que já está programado
                  {evoDiff && <>, {evoDiff}</>}.
                </>
              ) : (
                <>
                  Você gastou <MoneyText cents={monthTotal} /> em {monthName(month)}
                  {evoDiff && <>, {evoDiff}</>}.
                </>
              )}
            </p>
          </>
        )}
      </section>
    ),
    recurrence: (
      <section className="card" aria-label="Despesas por recorrência">
        <h2>Despesas por recorrência</h2>
        {expenseTotal === 0 ? (
          <p className="empty">Nenhuma despesa neste mês.</p>
        ) : (
          <>
            <div className="rec-bar" role="img" aria-label={`Despesas por recorrência, ${hiddenMoney ? "valores ocultos" : brl(expenseTotal)}`}>
              {d.recurrence
                .filter((item: { total_cents: number }) => item.total_cents > 0)
                .map((item: { key: string; color: string; total_cents: number }) => (
                  <i key={item.key} style={{ flexGrow: item.total_cents, background: item.color }} />
                ))}
            </div>
            <div className="rec-rows">
              {d.recurrence.map((item: { key: string; name: string; color: string; total_cents: number }) => (
                <Link
                  key={item.key}
                  className="rec-row"
                  to={`/lancamentos?recorrencia=${item.key}`}
                >
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
    year: <YearBlock year={year} monthIndex={sel} data={yearQ.data} showCum={showCum} onToggle={() => setShowCum((v) => !v)} onPick={(index) => setMonth(`${year}-${String(index + 1).padStart(2, "0")}`)} />,
  };

  const selectedCat = catName ? cats.find((item) => item.name === catName) : null;
  const childParts = catName ? childrenOf(catName) : [];

  return (
    <>
      <main className="page home" style={{ borderRadius: '24px 24px 0 0', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <HomeHeader me={me} members={d.members} person={person} hidden={hiddenMoney} onToggle={toggleHide} />
        <PersonFilter />
        <MonthNav month={month} onChange={setMonth} />
        <PullToRefresh ptr={ptr} />
        <ErrorText error={q.error} />
        <div className="home-stack">
          {layout.order.filter((id) => !layout.hidden.includes(id)).map((id, index) => {
            const block = blocks[id];
            // Só renderiza o bloco se tiver conteúdo relevante
            const hasData =
              id === "summary" ? true : // Resumo sempre mostra algo
              id === "cards" ? cardList.length > 0 :
              id === "categories" ? true :
              id === "evolution" ? true :
              id === "recurrence" ? true :
              id === "year" ? true : false;

            if (!hasData) return null;
            // evolution/year também carregam a ref do observer que antecipa o carregamento do gráfico.
            return (
              <RevealItem key={id} index={index} forwardRef={id === "evolution" ? evoRef : id === "year" ? yearRef : undefined}>
                {block}
              </RevealItem>
            );
          })}
        </div>
        <LayoutCard layout={layout} moveBlock={moveBlock} saveLayout={saveLayout} />
        {showTop && (
          <button type="button" className="to-top" aria-label="Voltar ao topo" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </main>
      {classify && <ClassifySheet name={classify} items={bucketTxs(txs, classify)} onClose={() => setClassify(null)} />}
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
    </>
  );
}

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

function LayoutCard({
  layout,
  moveBlock,
  saveLayout,
}: {
  layout: { order: BlockId[]; hidden: BlockId[] };
  moveBlock: (id: BlockId, dir: -1 | 1) => void;
  saveLayout: (order: BlockId[], hidden: BlockId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const hiddenCount = layout.hidden.length;
  const hiddenLabel = hiddenCount === 0 ? null : hiddenCount === 1 ? "1 oculto" : `${hiddenCount} ocultos`;
  return (
    <section className={`card home-layout${open ? " open" : ""}`}>
      <button type="button" className="layout-toggle" aria-expanded={open} aria-controls="home-layout-panel" onClick={() => setOpen((value) => !value)}>
        <span className="layout-toggle-text">
          <span>Ordem dos cards</span>
          {hiddenLabel && <small>{hiddenLabel}</small>}
        </span>
        <Icon.down />
      </button>
      {open && (
        <div id="home-layout-panel" className="layout-panel">
          <p>As setas mudam a ordem. Ocultar tira o card desta tela.</p>
          <div className="layout-list">
            {layout.order.map((id, index) => {
              const label = BLOCKS.find(([key]) => key === id)?.[1];
              const off = layout.hidden.includes(id);
              return (
                <div key={id} className={`layout-row${off ? " off" : ""}`}>
                  <span className="layout-name">{label}</span>
                  <span className="layout-tools">
                    <button type="button" className="mv" aria-label={`Subir ${label}`} disabled={index === 0} onClick={() => moveBlock(id, -1)}>
                      <Icon.arrowUp />
                    </button>
                    <button type="button" className="mv" aria-label={`Descer ${label}`} disabled={index === layout.order.length - 1} onClick={() => moveBlock(id, 1)}>
                      <Icon.arrowDown />
                    </button>
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
        </div>
      )}
    </section>
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
          <Link to="/progresso" className="avatars" aria-label="Abrir o avatar">
            {shown.map((member) => (
              <AvatarFigure key={member.id} name={member.name} avatar={member.avatar} size={44} label={member.name} />
            ))}
          </Link>
        )}
        <button type="button" className="ic eye" aria-pressed={hidden} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} onClick={onToggle}>
          {hidden ? <Icon.eyeOff /> : <Icon.eye />}
        </button>
        {/* No celular a barra de baixo tem cinco itens; o Mais (Contas, Categorias, Orçamento, tema…) fica aqui. */}
        <Link to="/mais" className="ic mob-only" aria-label="Mais">
          <Icon.more />
        </Link>
        <NewButton />
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
}: {
  year: number;
  monthIndex: number;
  data: { income: { months: number[] }; expense: { months: number[] }; balance: { months: number[] } } | undefined;
  showCum: boolean;
  onToggle: () => void;
  onPick: (index: number) => void;
}) {
  if (!data) {
    return (
      <section className="card" aria-label="Ano em gráfico">
        <h2>{year} mês a mês</h2>
        <div className="year-skel" />
      </section>
    );
  }
  const cum = data.balance.months.reduce((acc: number[], value: number) => [...acc, (acc.at(-1) ?? 0) + value], []);
  const rows: YearRow[] = data.income.months.map((income: number, index: number) => ({
    name: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][index],
    inc: income,
    exp: data.expense.months[index],
    cum: cum[index],
  }));
  const picked = rows[monthIndex];
  const pickedMonth = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return (
    <section className="card year-card" aria-label="Ano em gráfico">
      <div className="hd">
        <h2>{year} mês a mês</h2>
        <Link className="home-jump" to="/ano">
          Visão anual <Icon.right />
        </Link>
      </div>
      <div className="legend year-legend">
        <span><i className="sw inc" />Receitas</span>
        <span><i className="sw exp" />Despesas</span>
        <button type="button" className={`cum-toggle${showCum ? " on" : ""}`} aria-pressed={showCum} onClick={onToggle}>
          Acumulado
        </button>
      </div>
      <div className="year-chart chart-pick">
        <YearBarChart rows={rows} monthIndex={monthIndex} showCum={showCum} onPick={onPick} />
      </div>
      <div className="year-sel">
        <small>{monthName(pickedMonth)}</small>
        <div className="year-stats">
          <div>
            <small>Receitas</small>
            <b className="num pos"><MoneyText cents={picked?.inc ?? 0} /></b>
          </div>
          <div>
            <small>Despesas</small>
            <b className="num exp"><MoneyText cents={picked?.exp ?? 0} /></b>
          </div>
          <div>
            <small>Acumulado</small>
            <b className={`num ${(picked?.cum ?? 0) < 0 ? "exp" : "pos"}`}><MoneyText cents={picked?.cum ?? 0} /></b>
          </div>
        </div>
      </div>
    </section>
  );
}
