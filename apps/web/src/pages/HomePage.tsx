import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, monthOf } from "@fin/domain";
import { AvatarFigure } from "../Avatar";
import { useApi, type Me, type Member } from "../api";
import { CategoryIcon } from "../categories";
import { PersonFilter, personParam } from "../people";
import { useAppState } from "../state";
import {
  Bar,
  ErrorText,
  Icon,
  Loading,
  MonthNav,
  brl,
  monthName,
  shortDate,
} from "../ui";

function dueLabel(
  due: string,
  today: string,
  overdue: boolean,
  income: boolean,
) {
  if (overdue)
    return `${income ? "Atrasado" : "Atrasada"} desde ${shortDate(due)}`;
  const verb = income ? "Recebe" : "Vence";
  if (due === today) return `${verb} hoje`;
  if (due === addDays(today, 1)) return `${verb} amanhã`;
  return `${verb} em ${shortDate(due)}`;
}

function incomeHint(income: {
  realized_cents: number;
  planned_cents: number;
  total_cents: number;
}) {
  if (income.total_cents === 0) return "nenhuma";
  if (income.planned_cents <= 0) return "recebidas";
  if (income.realized_cents <= 0) return "a receber";
  return `${brl(income.planned_cents)} a receber`;
}

function expenseHint(expense: { total_cents: number; to_pay_cents: number }) {
  if (expense.total_cents === 0 && expense.to_pay_cents === 0) return "nenhuma";
  if (expense.to_pay_cents <= 0) return "pagas";
  if (expense.to_pay_cents === expense.total_cents) return "a pagar";
  return `${brl(expense.to_pay_cents)} a pagar`;
}

const MONTH_SHORT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

function compact(cents: number) {
  const v = Math.abs(cents) / 100;
  const s =
    v >= 1000
      ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: v >= 10000 ? 0 : 1 })} mil`
      : Math.round(v).toLocaleString("pt-BR");
  return cents < 0 ? `-${s}` : s;
}

function smooth(pts: { x: number; y: number }[]) {
  if (pts.length === 0) return "";
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

function barPath(x: number, top: number, w: number, base: number) {
  const h = base - top;
  if (h < 0.8) return "";
  const lifted = h < 4 ? base - 4 : top;
  const r = Math.min(7, w / 2, base - lifted);
  top = lifted;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

function YearChart({ month, today }: { month: string; today: string }) {
  const year = Number(month.slice(0, 4));
  const q = useApi(`/reports/year?year=${year}&mode=planned`);
  const [picked, setPicked] = useState<number | null>(null);
  const [W, setW] = useState(320);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setW(Math.max(240, Math.round(el.clientWidth))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [q.data]);
  const sel = picked ?? Number(month.slice(5, 7)) - 1;
  const d = q.data;
  if (!d) return null;

  const inc: number[] = d.income.months;
  const exp: number[] = d.expense.months;
  const cum = d.balance.months.reduce(
    (acc: number[], v: number) => [...acc, (acc.at(-1) ?? 0) + v],
    [],
  );
  const first = Math.max(
    0,
    inc.findIndex((v, i) => v || exp[i]),
  );
  const thisMonth = today.slice(0, 7);
  const future = (i: number) =>
    `${year}-${String(i + 1).padStart(2, "0")}` > thisMonth;

  const H = 232;
  const L = 8;
  const R = 20;
  const T = 22;
  const B = 32;
  const max = Math.max(1, ...inc, ...exp, ...cum);
  const min = Math.min(0, ...cum);
  const y = (v: number) => T + ((max - v) / (max - min)) * (H - T - B);
  const base = y(0);
  const slot = (W - L - R) / 12;
  const bw = Math.min(16, Math.max(4, (slot - 14) / 2));
  const cx = (i: number) => L + slot * i + slot / 2;
  const wide = slot >= 42;
  const ticks = min < 0 ? [max, 0, min] : [max, 0];
  const pts = cum
    .map((v: number, i: number) => ({ v, i, x: cx(i), y: y(v) }))
    .filter(({ i }: { i: number }) => i >= first);
  const linePts =
    first > 0
      ? [{ v: 0, i: first - 1, x: cx(first - 1), y: base }, ...pts]
      : pts;
  const cut = linePts.findIndex(({ i }: { i: number }) => future(i));
  const solid = cut === -1 ? linePts : linePts.slice(0, cut);
  const dashed = cut <= 0 ? [] : linePts.slice(cut - 1);
  const gid = `yc${year}`;

  return (
    <section className="card home-chart" aria-label="Ano em gráfico">
      <div className="hd">
        <h2>{year} mês a mês</h2>
        <Link className="link" to="/ano">
          Visão anual
        </Link>
      </div>
      <div className="legend">
        <span>
          <i className="sw inc" />
          Receitas
        </span>
        <span>
          <i className="sw exp" />
          Despesas
        </span>
        <span>
          <i className="sw cum" />
          Sobra acumulada
        </span>
      </div>
      <div ref={box}>
        <svg
          className="ychart"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Receitas e despesas de ${year} por mês`}
        >
          <defs>
            <linearGradient id={`${gid}-inc`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="stop-inc" />
              <stop offset="1" className="stop-inc2" />
            </linearGradient>
            <linearGradient id={`${gid}-exp`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="stop-exp" />
              <stop offset="1" className="stop-exp2" />
            </linearGradient>
            <linearGradient id={`${gid}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="stop-area" />
              <stop offset="1" className="stop-area2" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={L}
                x2={W - R}
                y1={y(t)}
                y2={y(t)}
                className={t === 0 ? "zero" : "grid"}
              />
              <text x={L + 2} y={y(t) - 5} className="ax">
                {compact(t)}
              </text>
            </g>
          ))}
          {linePts.length > 1 && (
            <path
              d={`${smooth(linePts)}L${linePts[linePts.length - 1].x},${base}L${linePts[0].x},${base}Z`}
              fill={`url(#${gid}-area)`}
              className="area"
            />
          )}
          {inc.map((v, i) => {
            const label = wide ? MONTH_SHORT[i] : MONTH_SHORT[i][0];
            const pillW = wide ? 34 : 18;
            return (
              <g
                key={i}
                className={`mon${future(i) ? " fut" : ""}${i === sel ? " on" : ""}`}
                onClick={() => setPicked(i)}
              >
                <rect
                  x={L + slot * i + 2}
                  y={8}
                  width={slot - 4}
                  height={base - 8}
                  rx={12}
                  className="hit"
                />
                <path
                  d={barPath(cx(i) - bw - 1.5, y(v), bw, base)}
                  fill={`url(#${gid}-inc)`}
                  className="b inc"
                />
                <path
                  d={barPath(cx(i) + 1.5, y(exp[i]), bw, base)}
                  fill={`url(#${gid}-exp)`}
                  className="b exp"
                />
                {i === sel && (
                  <rect
                    x={cx(i) - pillW / 2}
                    y={H - 22}
                    width={pillW}
                    height={18}
                    rx={9}
                    className="pill"
                  />
                )}
                <text
                  x={cx(i)}
                  y={H - 9}
                  textAnchor="middle"
                  className="ax mo-l"
                >
                  {label}
                </text>
              </g>
            );
          })}
          <path d={smooth(solid)} className="cum" />
          <path d={smooth(dashed)} className="cum fut" />
          {pts.map(
            ({
              v,
              i,
              x,
              y: py,
            }: {
              v: number;
              i: number;
              x: number;
              y: number;
            }) => (
              <g key={i} className={future(i) ? "fut" : undefined}>
                {i === sel && <circle cx={x} cy={py} r={9} className="halo" />}
                <circle
                  cx={x}
                  cy={py}
                  r={i === sel ? 4.5 : 3.2}
                  className="dot"
                >
                  <title>
                    {MONTH_SHORT[i]}: sobra {brl(v)}
                  </title>
                </circle>
              </g>
            ),
          )}
        </svg>
      </div>
      <div className="ysel">
        <div className="row">
          <b>{monthName(`${year}-${String(sel + 1).padStart(2, "0")}`)}</b>
          {future(sel) && <span className="tag">Previsto</span>}
        </div>
        <div className="ysel3">
          <div>
            <small>
              <i className="sw inc" />
              Receitas
            </small>
            <b className="num pos">{brl(inc[sel])}</b>
          </div>
          <div>
            <small>
              <i className="sw exp" />
              Despesas
            </small>
            <b className="num exp">{brl(exp[sel])}</b>
          </div>
          <div>
            <small>
              <i className="sw cum" />
              Sobra no ano
            </small>
            <b className={`num ${cum[sel] < 0 ? "neg" : "cum"}`}>
              {brl(cum[sel])}
            </b>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HomePage({ me }: { me: Me }) {
  const { month, setMonth, today, person } = useAppState();
  const q = useApi(`/dashboard?month=${month}&person=${personParam(person)}`);
  const d = q.data;

  return (
    <main className="page home">
      <div className="hd">
        <div>
          <small>{me.household_name}</small>
          <h1>Olá, {me.name.split(" ")[0]}</h1>
        </div>
        {d && (
          <Link to="/progresso" className="avatars" aria-label="Ver avatares">
            {(person === "all" ? d.members : d.members.filter((m: Member) => m.me)).map((m: Member) => (
              <AvatarFigure
                key={m.id}
                avatar={m.avatar}
                size={person === "all" && !m.me ? 38 : 48}
                level={m.level}
                label={`${m.name}, nível ${m.level}`}
              />
            ))}
          </Link>
        )}
      </div>
      <MonthNav month={month} onChange={setMonth} />
      <PersonFilter />
      <ErrorText error={q.error} />
      {!d ? (
        <Loading />
      ) : (
        <div className="home-grid">
          <div className="stack home-main">
            <section className="card soft saldo" aria-label="Saldo">
              <small>Saldo atual nas contas</small>
              <div className="big-value num">
                {brl(d.balance.current_cents)}
              </div>
              <div className="saldo-split">
                <Link to="/lancamentos?tipo=receitas">
                  <small>Receitas</small>
                  <b className="num pos">{brl(d.income.total_cents)}</b>
                  <small className="hint">{incomeHint(d.income)}</small>
                </Link>
                <Link to="/lancamentos">
                  <small>Despesas</small>
                  <b className="num exp">{brl(d.expense.total_cents)}</b>
                  <small className="hint">{expenseHint(d.expense)}</small>
                </Link>
                <div>
                  <small>Previsto</small>
                  <b
                    className={`num ${d.balance.forecast_cents < 0 ? "neg" : ""}`}
                  >
                    {brl(d.balance.forecast_cents)}
                  </b>
                  <small className="hint">
                    {d.balance.forecast_cents === d.result_cents
                      ? "no fim do mês"
                      : `sobra ${brl(d.result_cents)}`}
                  </small>
                </div>
              </div>
            </section>

            {d.invoice && (
              <Link
                to={`/cartoes?card=${d.invoice.card_id}&mes=${d.invoice.reference_month}`}
                className="card click"
              >
                <div className="hd">
                  <b>{d.invoice.card_name}</b>
                  <span
                    className={`badge ${d.invoice.state === "overdue" ? "red" : d.invoice.state === "paid" ? "green" : ""}`}
                  >
                    {d.invoice.state_label}
                  </span>
                </div>
                <small>Fatura de {monthName(d.invoice.reference_month)}</small>
                <div className="big-value num" style={{ fontSize: 26 }}>
                  {brl(d.invoice.remaining_cents || d.invoice.total_cents)}
                </div>
                <small>Vence em {shortDate(d.invoice.due_date)}</small>
              </Link>
            )}
          </div>

          <YearChart key={month} month={month} today={today} />
          <div className="stack home-side">
            <section className="card" aria-label="Próximos vencimentos">
              <div className="hd">
                <h2>Próximos vencimentos</h2>
                <Link className="link" to="/calendario">
                  Calendário
                </Link>
              </div>
              {d.upcoming.length === 0 && (
                <p className="empty">Nada vencendo nos próximos 30 dias.</p>
              )}
              <div className="list">
                {d.upcoming.map((u: any) => (
                  <Link
                    key={`${u.type}-${u.id}`}
                    to={
                      u.type === "invoice"
                        ? `/cartoes?card=${u.card_id}&mes=${u.reference_month}`
                        : `/lancamentos${u.kind === "income" ? "?tipo=receitas" : ""}`
                    }
                    onClick={() =>
                      u.type === "tx" && setMonth(monthOf(u.due_on))
                    }
                    className="r"
                    style={{ minHeight: 56 }}
                  >
                    {u.type === "invoice" ? (
                      <span
                        className="cat-ic"
                        style={{ width: 32, height: 32, background: "#8E9AAF" }}
                        aria-hidden
                      >
                        <Icon.card />
                      </span>
                    ) : (
                      <CategoryIcon
                        cat={{
                          id: u.id,
                          name: u.category_name ?? u.description,
                          icon: u.category_icon,
                          color: u.category_color ?? "#8E9AAF",
                          parent_id: u.category_parent_id,
                        }}
                        size={32}
                      />
                    )}
                    <div className="m">
                      <span className="t">
                        {u.description}
                        {u.installment_label ? ` ${u.installment_label}` : ""}
                      </span>
                      <small className={u.overdue ? "err" : undefined}>
                        {dueLabel(
                          u.due_on,
                          today,
                          u.overdue,
                          u.kind === "income",
                        )}
                      </small>
                    </div>
                    <b
                      className="num"
                      style={{
                        color: u.kind === "income" ? "var(--pos)" : undefined,
                      }}
                    >
                      {u.kind === "income" ? "+" : ""}
                      {brl(u.amount_cents)}
                    </b>
                  </Link>
                ))}
              </div>
            </section>

            <section className="card" aria-label="Despesas por categoria">
              <div className="hd">
                <h2>Categorias</h2>
                <Link className="link" to="/orcamento">
                  Orçamento
                </Link>
              </div>
              {d.categories.length === 0 && (
                <p className="empty">Nenhuma despesa neste mês.</p>
              )}
              {d.categories.slice(0, 6).map((c: any) => (
                <div
                  key={c.category_id ?? "none"}
                  className="stack"
                  style={{ gap: 4 }}
                >
                  <div className="hd">
                    <span style={{ fontWeight: 700 }}>{c.name}</span>
                    <b className="num">{brl(c.total_cents)}</b>
                  </div>
                  <Bar
                    ratio={
                      d.expense.total_cents
                        ? c.total_cents / d.expense.total_cents
                        : 0
                    }
                  />
                </div>
              ))}
            </section>

            {d.goals.length > 0 && (
              <section className="card" aria-label="Metas">
                <div className="hd">
                  <h2>Metas</h2>
                  <Link className="link" to="/metas">
                    Ver todas
                  </Link>
                </div>
                {d.goals.map((g: any) => (
                  <div key={g.id} className="stack" style={{ gap: 4 }}>
                    <div className="hd">
                      <span style={{ fontWeight: 700 }}>{g.name}</span>
                      <small className="num">
                        {brl(g.saved_cents)} / {brl(g.target_cents)}
                      </small>
                    </div>
                    <Bar ratio={g.saved_cents / g.target_cents} kind="xp" />
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
