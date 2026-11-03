import { Router } from 'express';
import { z } from 'zod';
import { monthOf } from '@fin/domain';
import {
  badRequest,
  findByUuid,
  idParam,
  insert,
  newUuid,
  notFound,
  nowIso,
  num,
  owned,
  parse,
  update,
  zCents,
  zCentsOrZero,
  zDate,
  zId,
  zMonth,
  zUuid,
} from '../core';
import { assertCategory } from './categories';
import { spentWithChildren } from './queries';

export function budgetsRouter(): Router {
  const r = Router();

  /** Orçamento x gasto efetivado por categoria (a categoria pai soma as filhas). */
  r.get('/', async (req, res) => {
    const month = parse(zMonth.optional(), req.query.month) ?? monthOf(req.ctx.today);
    const cats = await req.ctx.db.all(
      `SELECT c.id, c.name, c.parent_id, c.color, c.sort_order, b.id AS budget_id, b.planned_cents
         FROM categories c LEFT JOIN budgets b ON b.category_id = c.id AND b.month = ?
        WHERE c.household_id = ? AND c.kind = 'expense' AND c.deleted_at IS NULL AND (c.archived = 0 OR b.id IS NOT NULL)
        ORDER BY c.sort_order, c.name`,
      [month, req.ctx.householdId],
    );
    const spent = await spentWithChildren(req.ctx, month);
    const items = cats.map((c) => ({
      category_id: c.id,
      name: c.name,
      parent_id: c.parent_id,
      color: c.color,
      budget_id: c.budget_id ?? null,
      planned_cents: c.budget_id ? num(c.planned_cents) : null,
      spent_cents: spent.get(c.id) ?? 0,
    }));
    const budgeted = items.filter((i) => i.planned_cents != null);
    const budgetedIds = new Set(budgeted.map((i) => i.category_id));
    const top = budgeted.filter((i) => i.parent_id == null || !budgetedIds.has(i.parent_id));
    res.json({
      month,
      items,
      planned_cents: top.reduce((a, i) => a + (i.planned_cents ?? 0), 0),
      spent_cents: top.reduce((a, i) => a + i.spent_cents, 0),
    });
  });

  /**
   * Orçamento x gasto efetivado, mês a mês, no ano inteiro. Mesma regra da tela do mês:
   * a categoria pai soma as filhas, e o total não conta a filha de novo quando o pai tem orçamento.
   * O gasto de cada categoria só entra nos meses em que ela tem orçamento.
   */
  r.get('/year', async (req, res) => {
    const year = parse(z.coerce.number().int().min(2000).max(2100), req.query.year);
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const cats = await req.ctx.db.all(
      `SELECT id, name, parent_id, color FROM categories
        WHERE household_id = ? AND kind = 'expense' AND deleted_at IS NULL ORDER BY sort_order, name`,
      [req.ctx.householdId],
    );
    const rows = await req.ctx.db.all(
      'SELECT category_id, month, planned_cents FROM budgets WHERE household_id = ? AND month >= ? AND month <= ?',
      [req.ctx.householdId, months[0], months[11]],
    );
    const planned = new Map<string, number>();
    for (const b of rows) planned.set(`${b.category_id}|${b.month}`, num(b.planned_cents));
    const spentByMonth = await Promise.all(months.map((m) => spentWithChildren(req.ctx, m)));

    const items = cats
      .map((c) => {
        const perMonth = months.map((m, i) => {
          const p = planned.get(`${c.id}|${m}`);
          return { month: m, planned_cents: p ?? null, spent_cents: spentByMonth[i].get(c.id) ?? 0 };
        });
        const budgeted = perMonth.filter((x) => x.planned_cents != null);
        return {
          category_id: c.id,
          name: c.name,
          parent_id: c.parent_id,
          color: c.color,
          months: perMonth,
          planned_cents: budgeted.reduce((a, x) => a + (x.planned_cents ?? 0), 0),
          spent_cents: budgeted.reduce((a, x) => a + x.spent_cents, 0),
          has_budget: budgeted.length > 0,
        };
      })
      .filter((i) => i.has_budget);

    const monthTotals = months.map((m, i) => {
      const budgeted = cats.filter((c) => planned.has(`${c.id}|${m}`));
      const ids = new Set(budgeted.map((c) => c.id));
      const top = budgeted.filter((c) => c.parent_id == null || !ids.has(c.parent_id));
      return {
        month: m,
        planned_cents: top.reduce((a, c) => a + (planned.get(`${c.id}|${m}`) ?? 0), 0),
        spent_cents: top.reduce((a, c) => a + (spentByMonth[i].get(c.id) ?? 0), 0),
      };
    });
    res.json({
      year,
      months: monthTotals,
      planned_cents: monthTotals.reduce((a, m) => a + m.planned_cents, 0),
      spent_cents: monthTotals.reduce((a, m) => a + m.spent_cents, 0),
      items,
    });
  });

  r.put('/', async (req, res) => {
    const body = parse(z.object({ client_uuid: zUuid.optional(), category_id: zId, month: zMonth, planned_cents: zCentsOrZero }), req.body);
    await assertCategory(req.ctx, body.category_id, 'expense');
    const now = nowIso();
    const existing = await req.ctx.db.get('SELECT id FROM budgets WHERE category_id = ? AND month = ?', [body.category_id, body.month]);
    if (existing) await update(req.ctx.db, 'budgets', existing.id, { planned_cents: body.planned_cents, updated_at: now });
    else
      await insert(req.ctx.db, 'budgets', {
        client_uuid: body.client_uuid ?? newUuid(),
        household_id: req.ctx.householdId,
        category_id: body.category_id,
        month: body.month,
        planned_cents: body.planned_cents,
        created_at: now,
        updated_at: now,
      });
    res.json(await req.ctx.db.get('SELECT * FROM budgets WHERE category_id = ? AND month = ?', [body.category_id, body.month]));
  });

  r.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const row = await req.ctx.db.get('SELECT id FROM budgets WHERE id = ? AND household_id = ?', [id, req.ctx.householdId]);
    if (!row) throw notFound('Orçamento');
    await req.ctx.db.run('DELETE FROM budgets WHERE id = ?', [id]);
    res.status(204).end();
  });

  /** Copia o orçamento de um mês para outro sem sobrescrever o que já existe. */
  r.post('/copy', async (req, res) => {
    const body = parse(z.object({ from: zMonth, to: zMonth }), req.body);
    if (body.from === body.to) throw badRequest('Escolha meses diferentes');
    const source = await req.ctx.db.all('SELECT category_id, planned_cents FROM budgets WHERE household_id = ? AND month = ?', [req.ctx.householdId, body.from]);
    let copied = 0;
    await req.ctx.db.tx(async (db) => {
      const now = nowIso();
      for (const b of source) {
        const exists = await db.get('SELECT id FROM budgets WHERE category_id = ? AND month = ?', [b.category_id, body.to]);
        if (exists) continue;
        await insert(db, 'budgets', {
          client_uuid: newUuid(),
          household_id: req.ctx.householdId,
          category_id: b.category_id,
          month: body.to,
          planned_cents: b.planned_cents,
          created_at: now,
          updated_at: now,
        });
        copied++;
      }
    });
    res.json({ copied });
  });

  return r;
}

const goalBody = z.object({
  client_uuid: zUuid.optional(),
  name: z.string().trim().min(1).max(80),
  target_cents: zCents,
  saved_cents: zCentsOrZero.optional(),
  deadline: zDate.nullish(),
});

export function goalsRouter(): Router {
  const r = Router();
  const decorate = (g: any) => ({
    ...g,
    target_cents: num(g.target_cents),
    saved_cents: num(g.saved_cents),
    progress: Math.min(1, num(g.saved_cents) / num(g.target_cents)),
  });

  r.get('/', async (req, res) => {
    const rows = await req.ctx.db.all('SELECT * FROM goals WHERE household_id = ? AND deleted_at IS NULL ORDER BY completed_at IS NOT NULL, deadline, id', [
      req.ctx.householdId,
    ]);
    res.json(rows.map(decorate));
  });

  r.post('/', async (req, res) => {
    const body = parse(goalBody, req.body);
    const existing = await findByUuid(req.ctx, 'goals', body.client_uuid);
    if (existing) return void res.json(decorate(existing));
    const now = nowIso();
    const id = await insert(req.ctx.db, 'goals', {
      client_uuid: body.client_uuid ?? newUuid(),
      household_id: req.ctx.householdId,
      name: body.name,
      target_cents: body.target_cents,
      saved_cents: body.saved_cents ?? 0,
      deadline: body.deadline ?? null,
      created_at: now,
      updated_at: now,
    });
    res.status(201).json(decorate(await req.ctx.db.get('SELECT * FROM goals WHERE id = ?', [id])));
  });

  r.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const goal = await owned<any>(req.ctx, 'goals', id, 'Meta');
    const body = parse(goalBody.partial().omit({ client_uuid: true, saved_cents: true }), req.body);
    const target = body.target_cents ?? num(goal.target_cents);
    const saved = num(goal.saved_cents);
    const reached = saved >= target;
    await req.ctx.db.tx(async (db) => {
      await update(db, 'goals', id, {
        ...body,
        completed_at: reached ? (goal.completed_at ?? nowIso()) : null,
        updated_at: nowIso(),
      });
    });
    res.json(decorate(await req.ctx.db.get('SELECT * FROM goals WHERE id = ?', [id])));
  });

  /** Guardar (valor positivo) ou retirar (negativo). Atingir o alvo conclui a meta. */
  r.post('/:id/deposit', async (req, res) => {
    const id = idParam(req.params.id);
    const goal = await owned<any>(req.ctx, 'goals', id, 'Meta');
    const body = parse(z.object({ amount_cents: z.number().int().refine((v) => v !== 0, 'Informe um valor') }), req.body);
    const saved = num(goal.saved_cents) + body.amount_cents;
    if (saved < 0) throw badRequest('Não dá para retirar mais do que está guardado');
    await req.ctx.db.tx(async (db) => {
      const reached = saved >= num(goal.target_cents);
      await update(db, 'goals', id, {
        saved_cents: saved,
        completed_at: reached ? (goal.completed_at ?? nowIso()) : null,
        updated_at: nowIso(),
      });
    });
    res.json({ goal: decorate(await req.ctx.db.get('SELECT * FROM goals WHERE id = ?', [id])) });
  });

  r.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'goals', id, 'Meta');
    const now = nowIso();
    await update(req.ctx.db, 'goals', id, { deleted_at: now, updated_at: now });
    res.status(204).end();
  });

  return r;
}
