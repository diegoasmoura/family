import { Router } from 'express';
import { z } from 'zod';
import { XP_VALUES, monthOf } from '@fin/domain';
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
import { awardXp } from './gamification';
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
    res.json({
      month,
      items,
      planned_cents: budgeted.reduce((a, i) => a + (i.planned_cents ?? 0), 0),
      spent_cents: budgeted.reduce((a, i) => a + i.spent_cents, 0),
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
    await owned(req.ctx, 'goals', id, 'Meta');
    const body = parse(goalBody.partial().omit({ client_uuid: true }), req.body);
    await update(req.ctx.db, 'goals', id, { ...body, updated_at: nowIso() });
    res.json(decorate(await req.ctx.db.get('SELECT * FROM goals WHERE id = ?', [id])));
  });

  /** Guardar (valor positivo) ou retirar (negativo). Bater a meta dá XP uma vez. */
  r.post('/:id/deposit', async (req, res) => {
    const id = idParam(req.params.id);
    const goal = await owned<any>(req.ctx, 'goals', id, 'Meta');
    const body = parse(z.object({ amount_cents: z.number().int().refine((v) => v !== 0, 'Informe um valor') }), req.body);
    const saved = num(goal.saved_cents) + body.amount_cents;
    if (saved < 0) throw badRequest('Não dá para retirar mais do que está guardado');
    const result = await req.ctx.db.tx(async (db) => {
      const ctx = { ...req.ctx, db };
      const reached = saved >= num(goal.target_cents);
      await update(db, 'goals', id, {
        saved_cents: saved,
        completed_at: reached ? (goal.completed_at ?? nowIso()) : null,
        updated_at: nowIso(),
      });
      const xp = reached ? await awardXp(ctx, 'goal_done', XP_VALUES.goal_done, { refId: id, refKey: `goal:${id}` }) : null;
      return { xp };
    });
    res.json({ goal: decorate(await req.ctx.db.get('SELECT * FROM goals WHERE id = ?', [id])), xp: result.xp });
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
