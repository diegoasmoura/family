import { num, type Ctx } from '../core';

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
  const params: unknown[] = [ctx.householdId, month];
  if (personId != null) params.push(personId);
  const rows = await ctx.db.all<{ kind: string; status: string; total: number }>(
    `SELECT kind, status, SUM(amount_cents) AS total FROM transactions
      WHERE household_id = ? AND competence_month = ? AND include_in_reports = 1 AND deleted_at IS NULL
        ${personId == null ? '' : 'AND for_user_id = ?'}
      GROUP BY kind, status`,
    params,
  );
  const t: MonthTotals = { income_posted: 0, income_planned: 0, expense_posted: 0, expense_planned: 0 };
  for (const r of rows) (t as any)[`${r.kind}_${r.status}`] = num(r.total);
  return t;
}
