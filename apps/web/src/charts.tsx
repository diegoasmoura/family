import { useMemo, type CSSProperties } from "react";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { Pie, LinePath, AreaClosed, Bar as VxBar } from "@visx/shape";
import { scaleLinear, scaleBand } from "@visx/scale";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";

/**
 * Motor de gráficos do app: @visx (primitivas de baixo nível, SVG, bem pequenas).
 * Trocou o Recharts porque: (1) o Recharts não mede bem a largura dentro de um
 * card flexível — cada gráfico precisava de um ResizeObserver manual por fora; o
 * @visx/responsive (`ParentSize`) resolve isso de fábrica; (2) cada gráfico aqui
 * usa só o que precisa (sem eixo, sem grade, sem legenda automática), o que
 * mantém o JS carregado no celular no mínimo possível.
 *
 * Cores sempre pelas variáveis do tema (nunca hex fixo), pra herdar claro/escuro
 * automaticamente: var(--pos) é receita, var(--exp) é despesa, var(--chart-cum)
 * é a linha de acumulado, var(--bar-empty) é "sem valor no mês".
 */

/** Formata centavos para o eixo: "12 mil", "850", "-3 mil". */
export function compactAxis(cents: number) {
  const v = Math.abs(cents) / 100;
  const text = v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : Math.round(v).toLocaleString("pt-BR");
  return cents < 0 ? `-${text}` : text;
}

const tick = { fontSize: 11, fill: "var(--faint)" } as const;

/** Sombra escura da própria cor da fatia, pra contornar o número sem depender de preto/branco fixo. */
function shadeOf(hex: string, amount: number) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "rgba(0,0,0,0.55)";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const d = (c: number) => Math.max(0, Math.round(c * (1 - amount)));
  return `rgb(${d(r)}, ${d(g)}, ${d(b)})`;
}

function ResponsiveSvg({ height, pad = 12, children }: { height: number; pad?: number; children: (width: number) => React.ReactNode }) {
  return (
    <div className="chart-fit">
      <ParentSize>{({ width }) => (width > 0 ? <svg width="100%" height={height + pad} viewBox={`0 0 ${width} ${height + pad}`}>{children(width)}</svg> : null)}</ParentSize>
    </div>
  );
}

// ───────────────────────── Donut (categorias, recorrência) ─────────────────────────

export type DonutSlice = { name: string; value: number; color?: string | null };

export function Donut({
  slices,
  centerValue,
  centerCaption,
  ariaLabel,
  onPick,
}: {
  slices: DonutSlice[];
  centerValue: string;
  centerCaption: string;
  ariaLabel: string;
  onPick?: (name: string) => void;
}) {
  const parts = useMemo(() => slices.filter((item) => item.value > 0), [slices]);
  const total = parts.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className={`chart-fit${onPick ? " chart-pick" : ""}`} role="img" aria-label={ariaLabel}>
      <ParentSize>
        {({ width }) => {
          if (!width) return null;
          const outer = Math.max(78, Math.min(104, Math.round(width * 0.3)));
          const inner = Math.round(outer * 0.68);
          const size = outer * 2;
          return (
            <svg className="donut-svg" width="100%" height={size + 12} viewBox={`0 0 ${width} ${size + 12}`}>
              <Group top={size / 2 + 6} left={width / 2}>
                <Pie data={parts} pieValue={(d) => d.value} outerRadius={outer} innerRadius={inner} padAngle={parts.length > 1 ? 0.035 : 0}>
                  {(pie) =>
                    pie.arcs.map((arc) => {
                      const slice = arc.data;
                      const fraction = total ? (arc.endAngle - arc.startAngle) / (2 * Math.PI) : 0;
                      const [labelX, labelY] = pie.path.centroid(arc);
                      const fill = slice.color || "#8E9AAF";
                      const path = pie.path(arc);
                      if (!path) return null;
                      const dist = Math.hypot(labelX, labelY) || 1;
                      const lift = parts.length > 1 ? 6 : 0;
                      const tx = (labelX / dist) * lift;
                      const ty = (labelY / dist) * lift;
                      return (
                        <g
                          key={slice.name}
                          className="donut-slice"
                          style={{ "--tx": `${tx}px`, "--ty": `${ty}px`, cursor: onPick ? "pointer" : undefined } as CSSProperties}
                          onClick={onPick ? () => onPick(slice.name) : undefined}
                        >
                          <path d={path} fill={fill} />
                          {fraction >= 0.08 && (
                            <text
                              x={labelX}
                              y={labelY}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize={13}
                              fontWeight={700}
                              letterSpacing={0.2}
                              fill="#fff"
                              stroke={shadeOf(fill, 0.45)}
                              strokeWidth={3}
                              strokeLinejoin="round"
                              paintOrder="stroke"
                            >
                              {Math.round(fraction * 100)}%
                            </text>
                          )}
                        </g>
                      );
                    })
                  }
                </Pie>
                <text y={-8} textAnchor="middle" fontSize={18} fontWeight={700} fill="var(--ink)">
                  {centerValue}
                </text>
                <text y={12} textAnchor="middle" fontSize={12} fontWeight={500} fill="var(--muted)">
                  {centerCaption}
                </text>
              </Group>
            </svg>
          );
        }}
      </ParentSize>
    </div>
  );
}

// ───────────────────────── Evolução das despesas (linha + área) ─────────────────────────

export type EvoPoint = { day: number; atual: number | null; proj: number | null; anterior: number | null };

const EVO_MARGIN = { top: 8, right: 8, bottom: 20, left: 44 };

export function EvolutionChart({ data, todayDay, formatValue }: { data: EvoPoint[]; todayDay: number; formatValue: (cents: number) => string }) {
  const height = 190;
  const { tooltipData, tooltipOpen, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<EvoPoint>();
  return (
    <div className="chart-fit" style={{ position: "relative" }}>
      <ParentSize>
        {({ width }) => {
          if (!width) return null;
          const innerW = Math.max(1, width - EVO_MARGIN.left - EVO_MARGIN.right);
          const innerH = height - EVO_MARGIN.top - EVO_MARGIN.bottom;
          const days = data.map((d) => d.day);
          const xScale = scaleLinear({ domain: [Math.min(...days), Math.max(...days)], range: [0, innerW] });
          const values = data.flatMap((d) => [d.atual, d.proj, d.anterior]).filter((v): v is number => v != null);
          const yScale = scaleLinear({ domain: [0, Math.max(1, ...values) * 1.08], range: [innerH, 0], nice: true });
          const xTicks = [1, 8, 15, 22, 29].filter((t) => t <= Math.max(...days));
          const yAt = (d: EvoPoint) => d.atual ?? d.proj ?? d.anterior ?? 0;

          const onPoint = (event: React.MouseEvent | React.TouchEvent) => {
            const point = localPoint(event);
            if (!point) return;
            const x = point.x - EVO_MARGIN.left;
            if (x < -8 || x > innerW + 8) {
              hideTooltip();
              return;
            }
            const day = xScale.invert(Math.max(0, Math.min(innerW, x)));
            let closest = data[0];
            let bestDist = Infinity;
            for (const row of data) {
              const dist = Math.abs(row.day - day);
              if (dist < bestDist) {
                bestDist = dist;
                closest = row;
              }
            }
            showTooltip({ tooltipData: closest, tooltipLeft: EVO_MARGIN.left + xScale(closest.day), tooltipTop: EVO_MARGIN.top + yScale(yAt(closest)) });
          };

          return (
            <>
              <svg
                width="100%"
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                onMouseMove={onPoint}
                onMouseLeave={hideTooltip}
                onTouchStart={onPoint}
                onTouchMove={onPoint}
                onTouchEnd={hideTooltip}
              >
                <defs>
                  <linearGradient id="evo-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--exp)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--exp)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Group left={EVO_MARGIN.left} top={EVO_MARGIN.top}>
                  <AreaClosed
                    data={data.filter((d) => d.atual != null)}
                    x={(d) => xScale(d.day)}
                    y={(d) => yScale(d.atual ?? 0)}
                    yScale={yScale}
                    curve={curveMonotoneX}
                    fill="url(#evo-fill)"
                  />
                  <LinePath
                    data={data.filter((d) => d.anterior != null)}
                    x={(d) => xScale(d.day)}
                    y={(d) => yScale(d.anterior ?? 0)}
                    curve={curveMonotoneX}
                    stroke="var(--faint)"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                  />
                  <LinePath
                    data={data.filter((d) => d.atual != null)}
                    x={(d) => xScale(d.day)}
                    y={(d) => yScale(d.atual ?? 0)}
                    curve={curveMonotoneX}
                    stroke="var(--exp)"
                    strokeWidth={2.5}
                  />
                  <LinePath
                    data={data.filter((d) => d.proj != null)}
                    x={(d) => xScale(d.day)}
                    y={(d) => yScale(d.proj ?? 0)}
                    curve={curveMonotoneX}
                    stroke="var(--exp)"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                  />
                  {data
                    .filter((d) => d.day === todayDay)
                    .map((d) => (
                      <circle key={d.day} cx={xScale(d.day)} cy={yScale(yAt(d))} r={5} fill="var(--surface)" stroke="var(--exp)" strokeWidth={2.5} />
                    ))}
                  {tooltipOpen && tooltipData && <line x1={xScale(tooltipData.day)} x2={xScale(tooltipData.day)} y1={0} y2={innerH} stroke="var(--line)" strokeWidth={1} />}
                  {xTicks.map((t) => (
                    <text key={t} x={xScale(t)} y={innerH + 16} textAnchor="middle" {...tick}>
                      {t}
                    </text>
                  ))}
                  {yScale.ticks(4).map((t) => (
                    <text key={t} x={-8} y={yScale(t)} textAnchor="end" dominantBaseline="middle" className="ax" {...tick}>
                      {compactAxis(t)}
                    </text>
                  ))}
                </Group>
              </svg>
              {tooltipOpen && tooltipData && (
                <TooltipWithBounds
                  left={tooltipLeft}
                  top={tooltipTop}
                  style={{ ...defaultStyles, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink)", fontSize: 13, padding: "6px 10px" }}
                >
                  <div>Dia {tooltipData.day}</div>
                  <div>Este mês: {formatValue(yAt(tooltipData))}</div>
                  {tooltipData.anterior != null && <div>Mês anterior: {formatValue(tooltipData.anterior)}</div>}
                </TooltipWithBounds>
              )}
            </>
          );
        }}
      </ParentSize>
    </div>
  );
}

// ───────────────────────── Ano mês a mês (barras pareadas + acumulado) ─────────────────────────

export type YearRow = { name: string; inc: number; exp: number; cum: number };

export function YearBarChart({
  rows,
  monthIndex,
  showCum,
  onPick,
}: {
  rows: YearRow[];
  monthIndex: number;
  showCum: boolean;
  onPick: (index: number) => void;
}) {
  const height = 180;
  const margin = { top: 8, right: 8, bottom: 20, left: 44 };
  return (
    <div className="year-wide chart-pick">
      <ParentSize>
        {({ width }) => {
          if (!width) return null;
          const innerW = Math.max(1, width - margin.left - margin.right);
          const innerH = height - margin.top - margin.bottom;
          const xScale = scaleBand({ domain: rows.map((r) => r.name), range: [0, innerW], padding: 0.35 });
          const groupScale = scaleBand({ domain: ["inc", "exp"], range: [0, xScale.bandwidth()], padding: 0.15 });
          const maxVal = Math.max(1, ...rows.flatMap((r) => [r.inc, r.exp]));
          const yScale = scaleLinear({ domain: [0, maxVal * 1.08], range: [innerH, 0], nice: true });
          const cumVals = rows.map((r) => r.cum);
          const cumScale = scaleLinear({ domain: [Math.min(0, ...cumVals), Math.max(1, ...cumVals)], range: [innerH, 0], nice: true });
          const cumX = (r: YearRow) => (xScale(r.name) ?? 0) + xScale.bandwidth() / 2;
          return (
            <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
              <Group left={margin.left} top={margin.top}>
                {rows.map((row, index) => {
                  const bx = xScale(row.name) ?? 0;
                  const incX = groupScale("inc") ?? 0;
                  const expX = groupScale("exp") ?? 0;
                  return (
                    <Group left={bx} key={row.name} style={{ cursor: "pointer" }} onClick={() => onPick(index)}>
                      <VxBar x={incX} y={yScale(row.inc)} width={groupScale.bandwidth()} height={innerH - yScale(row.inc)} rx={3} fill={row.inc ? "var(--pos)" : "var(--bar-empty)"} />
                      <VxBar x={expX} y={yScale(row.exp)} width={groupScale.bandwidth()} height={innerH - yScale(row.exp)} rx={3} fill={row.exp ? "var(--exp)" : "var(--bar-empty)"} />
                      <rect x={0} y={0} width={xScale.bandwidth()} height={innerH} fill="transparent" />
                    </Group>
                  );
                })}
                {showCum && (
                  <>
                    <LinePath data={rows} x={cumX} y={(r) => cumScale(r.cum)} curve={curveMonotoneX} stroke="var(--chart-cum)" strokeWidth={2} />
                    {rows.map((r) => (
                      <circle key={r.name} cx={cumX(r)} cy={cumScale(r.cum)} r={3} fill="var(--chart-cum)" />
                    ))}
                  </>
                )}
                {rows.map((row, index) => (
                  <text
                    key={row.name}
                    x={cumX(row)}
                    y={innerH + 16}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={index === monthIndex ? 700 : 500}
                    fill={index === monthIndex ? "var(--ink)" : "var(--faint)"}
                  >
                    {row.name}
                  </text>
                ))}
                {yScale.ticks(4).map((t) => (
                  <text key={t} x={-8} y={yScale(t)} textAnchor="end" dominantBaseline="middle" className="ax" {...tick}>
                    {compactAxis(t)}
                  </text>
                ))}
              </Group>
            </svg>
          );
        }}
      </ParentSize>
    </div>
  );
}

// ───────────────────────── Histórico de parcelas/recorrência (barras empilhadas) ─────────────────────────

export function StackedMonthBars({ rows }: { rows: { label: string; paid_cents: number; open_cents: number }[] }) {
  const height = 140;
  const margin = { top: 4, right: 4, bottom: 20, left: 4 };
  return (
    <ResponsiveSvg height={height} pad={0}>
      {(width) => {
        const innerW = Math.max(1, width - margin.left - margin.right);
        const innerH = height - margin.top - margin.bottom;
        const xScale = scaleBand({ domain: rows.map((r) => r.label), range: [0, innerW], padding: 0.3 });
        const maxVal = Math.max(1, ...rows.map((r) => r.paid_cents + r.open_cents));
        const yScale = scaleLinear({ domain: [0, maxVal], range: [innerH, 0], nice: true });
        const barW = Math.min(28, xScale.bandwidth());
        return (
          <Group left={margin.left} top={margin.top}>
            {rows.map((row) => {
              const bx = (xScale(row.label) ?? 0) + (xScale.bandwidth() - barW) / 2;
              const paidTop = yScale(row.paid_cents);
              const totalTop = yScale(row.paid_cents + row.open_cents);
              return (
                <Group key={row.label}>
                  <VxBar x={bx} y={totalTop} width={barW} height={Math.max(0, paidTop - totalTop)} rx={6} fill="var(--line)" />
                  <VxBar x={bx} y={paidTop} width={barW} height={Math.max(0, innerH - paidTop)} rx={6} fill="var(--green)" />
                  <text x={bx + barW / 2} y={innerH + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">
                    {row.label}
                  </text>
                </Group>
              );
            })}
          </Group>
        );
      }}
    </ResponsiveSvg>
  );
}
