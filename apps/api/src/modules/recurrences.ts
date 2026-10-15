import { Router } from 'express';
import { z } from 'zod';
import { addMonths, dateInMonth, monthOf, recurringChargeDate } from '@fin/domain';
import {
  badRequest,
  findByUuid,
  idParam,
  insert,
  newUuid,
  nowIso,
  num,
  owned,
  parse,
  update,
  zCents,
  zId,
  zMonth,
  zUuid,
  type Ctx,
} from '../core';
import { ensureInvoice, type Card } from './cards';
import { assertCategory } from './categories';
import { awardXp } from './gamification';
import { XP_VALUES } from '@fin/domain';
import { assertHouseholdUser, assertPaymentTarget } from './transactions';

/** Quantos meses à frente as recorrências ficam materializadas. */
export const HORIZON_MONTHS = 2;
const MAX_AHEAD = 24;

interface Recurrence {
  id: number;
  kind: 'income' | 'expense';
  description: string;
  amount_cents: number;
  category_id: number | null;
  account_id: number | null;
  card_id: number | null;
  day_of_month: number;
  start_month: string;
  end_month: string | null;
  active: number;
  created_by: number;
  for_user_id: number | null;
}

/** Datas e fatura de uma ocorrência. No cartão, a competência é o mês da fatura. */
async function occurrenceFields(ctx: Ctx, rec: Recurrence, month: string, card?: Card) {
  if (rec.card_id && card) {
    const date = recurringChargeDate(card, month, rec.day_of_month);
    return { occurred_on: date, due_on: null, invoice_id: await ensureInvoice(ctx.db, card, month) };
  }
  const date = dateInMonth(month, rec.day_of_month);
  return { occurred_on: date, due_on: date };
}

/**
 * Gera o lançamento planejado de cada competência até `untilMonth`.
 * Idempotente: uma recorrência + uma competência = no máximo um lançamento,
 * inclusive se a ocorrência foi excluída de propósito (não volta).
 */
export async function ensureRecurrences(ctx: Ctx, untilMonth: string, onlyId?: number) {
  const limit = addMonths(monthOf(ctx.today), MAX_AHEAD);
  const until = untilMonth > limit ? limit : untilMonth < addMonths(monthOf(ctx.today), HORIZON_MONTHS) ? addMonths(monthOf(ctx.today), HORIZON_MONTHS) : untilMonth;
  const params: unknown[] = [ctx.householdId];
  let where = 'household_id = ? AND active = 1 AND deleted_at IS NULL';
  if (onlyId) {
    where += ' AND id = ?';
    params.push(onlyId);
  }
  const recs = await ctx.db.all<Recurrence>(`SELECT * FROM recurrences WHERE ${where}`, params);
  let created = 0;
  for (const rec of recs) {
    const last = rec.end_month && rec.end_month < until ? rec.end_month : until;
    if (rec.start_month > last) continue;
    const existing = new Set(
      (await ctx.db.all<{ competence_month: string }>('SELECT competence_month FROM transactions WHERE recurrence_id = ?', [rec.id])).map((r) => r.competence_month),
    );
    const card = rec.card_id ? await ctx.db.get<Card>('SELECT * FROM credit_cards WHERE id = ?', [rec.card_id]) : undefined;
    for (let m = rec.start_month; m <= last; m = addMonths(m, 1)) {
      if (existing.has(m)) continue;
      const now = nowIso();
      try {
        await insert(ctx.db, 'transactions', {
          client_uuid: newUuid(),
          household_id: ctx.householdId,
          kind: rec.kind,
          description: rec.description,
          amount_cents: rec.amount_cents,
          competence_month: m,
          category_id: rec.category_id,
          account_id: rec.account_id,
          card_id: rec.card_id,
          recurrence_id: rec.id,
          status: 'planned',
          paid_on: null,
          for_user_id: rec.for_user_id ?? null,
          created_by: rec.created_by,
          created_at: now,
          updated_at: now,
          ...(await occurrenceFields(ctx, rec, m, card)),
        });
        created++;
      } catch (err) {
        // Outra requisição gerou a mesma competência ao mesmo tempo.
        if (!/unique/i.test(String(err))) throw err;
      }
    }
  }
  return created;
}

const recBody = z.object({
  client_uuid: zUuid.optional(),
  kind: z.enum(['income', 'expense']),
  description: z.string().trim().min(1).max(120),
  amount_cents: zCents,
  category_id: zId.nullish(),
  account_id: zId.nullish(),
  card_id: zId.nullish(),
  day_of_month: z.number().int().min(1).max(31),
  start_month: zMonth,
  end_month: zMonth.nullish(),
  first_paid: z.boolean().optional(),
  for_user_id: zId.nullable().optional(),
});

const SELECT = `SELECT r.*, a.name AS account_name, cc.name AS card_name, c.name AS category_name FROM recurrences r
  LEFT JOIN accounts a ON a.id = r.account_id LEFT JOIN credit_cards cc ON cc.id = r.card_id LEFT JOIN categories c ON c.id = r.category_id`;

export function recurrencesRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    res.json(await req.ctx.db.all(`${SELECT} WHERE r.household_id = ? AND r.deleted_at IS NULL ORDER BY r.active DESC, r.kind, r.day_of_month`, [req.ctx.householdId]));
  });

  r.post('/', async (req, res) => {
    const body = parse(recBody, req.body);
    const existing = await findByUuid(req.ctx, 'recurrences', body.client_uuid);
    if (existing) return void res.json({ recurrence: existing, xp: null });
    if (body.end_month && body.end_month < body.start_month) throw badRequest('O fim precisa ser depois do início');
    await assertPaymentTarget(req.ctx, body.kind, body.account_id, body.card_id);
    await assertCategory(req.ctx, body.category_id, body.kind);
    const forUserId = await assertHouseholdUser(req.ctx, body.for_user_id ?? null);

    const result = await req.ctx.db.tx(async (db) => {
      const ctx = { ...req.ctx, db };
      const now = nowIso();
      const id = await insert(db, 'recurrences', {
        client_uuid: body.client_uuid ?? newUuid(),
        household_id: ctx.householdId,
        kind: body.kind,
        description: body.description,
        amount_cents: body.amount_cents,
        category_id: body.category_id ?? null,
        account_id: body.account_id ?? null,
        card_id: body.card_id ?? null,
        day_of_month: body.day_of_month,
        start_month: body.start_month,
        end_month: body.end_month ?? null,
        for_user_id: forUserId,
        created_by: ctx.userId,
        created_at: now,
        updated_at: now,
      });
      await ensureRecurrences(ctx, body.start_month, id);
      if (body.first_paid) {
        const first = await db.get('SELECT id, card_id, occurred_on FROM transactions WHERE recurrence_id = ? AND competence_month = ?', [id, body.start_month]);
        if (first) {
          await update(db, 'transactions', first.id, first.card_id ? { status: 'posted' } : { status: 'posted', paid_on: first.occurred_on });
        }
      }
      const xp = await awardXp(ctx, 'tx_logged', XP_VALUES.tx_logged, { refKey: `recurrence:${id}`, refId: id });
      return { id, xp };
    });
    res.status(201).json({ recurrence: await req.ctx.db.get(`${SELECT} WHERE r.id = ?`, [result.id]), xp: result.xp });
  });

  /**
   * Valor, nome e categoria seguem para as ocorrências ainda não efetivadas.
   * Com `include_settled`, o dia de pagamento também entra nas que já foram pagas:
   * muda o dia dentro de cada mês, sem trocar o mês.
   */
  r.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const rec = await owned<Recurrence>(req.ctx, 'recurrences', id, 'Recorrência');
    const body = parse(
      z.object({
        description: z.string().trim().min(1).max(120).optional(),
        amount_cents: zCents.optional(),
        category_id: zId.nullable().optional(),
        day_of_month: z.number().int().min(1).max(31).optional(),
        end_month: zMonth.nullable().optional(),
        for_user_id: zId.nullable().optional(),
        /** Aplica a mudança a partir deste mês. Sem isso, vale do mês de hoje em diante. */
        from_month: zMonth.optional(),
        /** O dia novo entra também nas ocorrências já pagas ou recebidas. */
        include_settled: z.boolean().optional(),
      }),
      req.body,
    );
    const { from_month, include_settled, ...changes } = body;
    if (changes.category_id !== undefined) await assertCategory(req.ctx, changes.category_id, rec.kind);
    if (changes.for_user_id !== undefined) changes.for_user_id = await assertHouseholdUser(req.ctx, changes.for_user_id);
    if (changes.end_month && changes.end_month < rec.start_month) throw badRequest('O fim precisa ser depois do início');
    const currentMonth = monthOf(req.ctx.today);
    const fromMonth = from_month ?? currentMonth;

    await req.ctx.db.tx(async (db) => {
      const ctx = { ...req.ctx, db };
      await update(db, 'recurrences', id, { ...changes, updated_at: nowIso() });
      const next = { ...rec, ...changes } as Recurrence;
      const future = await db.all(
        `SELECT id, competence_month FROM transactions WHERE recurrence_id = ? AND status = 'planned' AND overridden = 0
          AND deleted_at IS NULL AND competence_month >= ?`,
        [id, fromMonth],
      );
      const card = next.card_id ? await db.get<Card>('SELECT * FROM credit_cards WHERE id = ?', [next.card_id]) : undefined;
      for (const occ of future) {
        if (next.end_month && occ.competence_month > next.end_month) {
          await update(db, 'transactions', occ.id, { deleted_at: nowIso(), updated_at: nowIso() });
          continue;
        }
        await update(db, 'transactions', occ.id, {
          description: next.description,
          amount_cents: next.amount_cents,
          category_id: next.category_id,
          for_user_id: next.for_user_id ?? null,
          ...(changes.day_of_month ? await occurrenceFields(ctx, next, occ.competence_month, card) : {}),
          updated_at: nowIso(),
        });
      }
      if (include_settled && changes.day_of_month && !next.card_id) {
        const settled = await db.all<{ id: number; competence_month: string; paid_on: string | null }>(
          `SELECT id, competence_month, paid_on FROM transactions
            WHERE recurrence_id = ? AND deleted_at IS NULL AND competence_month >= ?`,
          [id, fromMonth],
        );
        for (const occ of settled) {
          const date = dateInMonth(occ.competence_month, changes.day_of_month);
          await update(db, 'transactions', occ.id, {
            occurred_on: date,
            due_on: date,
            ...(occ.paid_on ? { paid_on: date } : {}),
            updated_at: nowIso(),
          });
        }
      }
      await ensureRecurrences(ctx, fromMonth, id);
    });
    res.json(await req.ctx.db.get(`${SELECT} WHERE r.id = ?`, [id]));
  });

  /** Encerrar: para de gerar depois de `end_month`; o passado fica. */
  r.post('/:id/end', async (req, res) => {
    const id = idParam(req.params.id);
    const rec = await owned<Recurrence>(req.ctx, 'recurrences', id, 'Recorrência');
    const body = parse(z.object({ end_month: zMonth.optional() }), req.body ?? {});
    const end = body.end_month ?? monthOf(req.ctx.today);
    if (end < rec.start_month) throw badRequest('O fim precisa ser depois do início');
    await req.ctx.db.tx(async (db) => {
      const now = nowIso();
      await update(db, 'recurrences', id, { end_month: end, active: end < monthOf(req.ctx.today) ? 0 : 1, updated_at: now });
      await db.run(
        `UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE recurrence_id = ? AND competence_month > ?
           AND status = 'planned' AND overridden = 0 AND deleted_at IS NULL`,
        [now, now, id, end],
      );
    });
    res.json(await req.ctx.db.get(`${SELECT} WHERE r.id = ?`, [id]));
  });

  /** Apaga esta ocorrência e as seguintes, pagas ou não, e para de gerar. As anteriores ficam. */
  r.post('/:id/delete-from', async (req, res) => {
    const id = idParam(req.params.id);
    const rec = await owned<Recurrence>(req.ctx, 'recurrences', id, 'Recorrência');
    const body = parse(z.object({ from_month: zMonth }), req.body);
    if (body.from_month < rec.start_month) throw badRequest('Esse mês é anterior ao início da fixa');
    const now = nowIso();
    const previous = addMonths(body.from_month, -1);
    const removed = await req.ctx.db.tx(async (db) => {
      const result = await db.run(
        `UPDATE transactions SET deleted_at = ?, updated_at = ?
          WHERE recurrence_id = ? AND deleted_at IS NULL AND competence_month >= ?`,
        [now, now, id, body.from_month],
      );
      if (previous < rec.start_month) {
        await update(db, 'recurrences', id, { deleted_at: now, active: 0, updated_at: now });
      } else {
        const currentMonth = monthOf(req.ctx.today);
        await update(db, 'recurrences', id, { end_month: previous, active: previous < currentMonth ? 0 : 1, updated_at: now });
      }
      return result.changes;
    });
    res.json({ deleted: num(removed), recurrence: await req.ctx.db.get(`${SELECT} WHERE r.id = ?`, [id]) });
  });

  r.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'recurrences', id, 'Recorrência');
    const fromMonth = monthOf(req.ctx.today);
    const removed = await req.ctx.db.tx(async (db) => {
      const now = nowIso();
      await update(db, 'recurrences', id, { deleted_at: now, active: 0, updated_at: now });
      const result = await db.run(
        `UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE recurrence_id = ? AND competence_month >= ?
           AND status = 'planned' AND overridden = 0 AND deleted_at IS NULL`,
        [now, now, id, fromMonth],
      );
      return result.changes;
    });
    res.json({ deleted: true, removed_occurrences: num(removed) });
  });

  return r;
}
