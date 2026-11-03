import { num, type Ctx } from '../core';

/**
 * Filtro por pessoa (o "Eu"): só o que tem for_user_id dela. "Da casa" (vazio) fica de fora.
 * Sem pessoa (o "Nós"), não filtra. `alias` é o prefixo da tabela, ex.: 't.'.
 */
export function personWhere(personId: number | null, alias = ''): { sql: string; params: unknown[] } {
  if (personId == null) return { sql: '', params: [] };
  return { sql: ` AND ${alias}for_user_id = ?`, params: [personId] };
}

/**
 * Valor que conta para a pessoa: o inteiro no que é dela; no Nosso, só a parte dela.
 * Mesma conta de `personPart` (@fin/domain). Use com `personWhere`, que já tira o que é da outra pessoa.
 */
export function personAmount(personId: number | null, alias = ''): { sql: string; params: unknown[] } {
  const a = alias;
  if (personId == null) return { sql: `${a}amount_cents`, params: [] };
  const lead = `(CAST(${a}amount_cents AS BIGINT) * COALESCE(${a}split_bp, 5000) + 9999) / 10000`;
  return {
    sql: `(CASE WHEN ${a}for_user_id IS NULL THEN CASE WHEN COALESCE(${a}split_user_id, ${a}created_by) = ? THEN ${lead} ELSE ${a}amount_cents - ${lead} END ELSE ${a}amount_cents END)`,
    params: [personId],
  };
}

/** Gasto efetivado por categoria no mês, respeitando "não somadas". */
export async function spentByCategory(ctx: Ctx, month: string): Promise<Map<number, number>> {
  const rows = await ctx.db.all<{ category_id: number; total: number }>(
    `SELECT category_id, SUM(amount_cents) AS total FROM transactions
      WHERE household_id = ? AND competence_month = ? AND kind = 'expense' AND status = 'posted'
        AND include_in_reports = 1 AND deleted_at IS NULL AND category_id IS NOT NULL
      GROUP BY category_id`,
    [ctx.householdId, month],
  );
  return new Map(rows.map((r) => [Number(r.category_id), num(r.total)]));
}

/** Soma o gasto da categoria e de suas filhas. */
export async function spentWithChildren(ctx: Ctx, month: string): Promise<Map<number, number>> {
  const spent = await spentByCategory(ctx, month);
  const cats = await ctx.db.all<{ id: number; parent_id: number | null }>('SELECT id, parent_id FROM categories WHERE household_id = ?', [ctx.householdId]);
  const out = new Map<number, number>();
  for (const c of cats) {
    const own = spent.get(c.id) ?? 0;
    out.set(c.id, (out.get(c.id) ?? 0) + own);
    if (c.parent_id) out.set(c.parent_id, (out.get(c.parent_id) ?? 0) + own);
  }
  return out;
}

export interface MonthTotals {
  income_posted: number;
  income_planned: number;
  expense_posted: number;
  expense_planned: number;
}

/** Totais por competência, só com lançamentos que entram nos relatórios. */
export async function monthTotals(ctx: Ctx, month: string, personId: number | null = null): Promise<MonthTotals> {
  const amount = personAmount(personId);
  const who = personWhere(personId);
  const rows = await ctx.db.all<{ kind: string; status: string; total: number }>(
    `SELECT kind, status, SUM(${amount.sql}) AS total FROM transactions
      WHERE household_id = ? AND competence_month = ? AND include_in_reports = 1 AND deleted_at IS NULL${who.sql}
      GROUP BY kind, status`,
    [...amount.params, ctx.householdId, month, ...who.params],
  );
  const t: MonthTotals = { income_posted: 0, income_planned: 0, expense_posted: 0, expense_planned: 0 };
  for (const r of rows) (t as any)[`${r.kind}_${r.status}`] = num(r.total);
  return t;
}
