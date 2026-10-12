import { Router } from 'express';
import { z } from 'zod';
import { XP_VALUES, addMonthsToDate, monthOf, splitInstallments } from '@fin/domain';
import { badRequest, findByUuid, idParam, insert, newUuid, nowIso, num, owned, parse, update, zCents, zDate, zId, zUuid, type Ctx } from '../core';
import { invoiceForCardPurchase } from './cards';
import { assertCategory } from './categories';
import { awardXp } from './gamification';
import { assertHouseholdUser, assertPaymentTarget } from './transactions';

const SELECT = `SELECT p.*, a.name AS account_name, cc.name AS card_name, c.name AS category_name,
    (SELECT COUNT(*) FROM transactions t WHERE t.plan_id = p.id AND t.deleted_at IS NULL) AS active_count,
    (SELECT COUNT(*) FROM transactions t WHERE t.plan_id = p.id AND t.deleted_at IS NULL
        AND ((t.account_id IS NOT NULL AND t.paid_on IS NOT NULL) OR (t.card_id IS NOT NULL AND t.competence_month <= ?))) AS settled_count,
    (SELECT COALESCE(SUM(t.amount_cents), 0) FROM transactions t WHERE t.plan_id = p.id AND t.deleted_at IS NULL
        AND NOT ((t.account_id IS NOT NULL AND t.paid_on IS NOT NULL) OR (t.card_id IS NOT NULL AND t.competence_month <= ?))) AS remaining_cents
  FROM installment_plans p
  LEFT JOIN accounts a ON a.id = p.account_id
  LEFT JOIN credit_cards cc ON cc.id = p.card_id
  LEFT JOIN categories c ON c.id = p.category_id`;

async function loadPlan(ctx: Ctx, id: number) {
  const m = monthOf(ctx.today);
  const row = await ctx.db.get(`${SELECT} WHERE p.id = ? AND p.household_id = ?`, [m, m, id, ctx.householdId]);
  return row && { ...row, active_count: num(row.active_count), settled_count: num(row.settled_count), remaining_cents: num(row.remaining_cents) };
}

export const planBody = z.object({
  client_uuid: zUuid.optional(),
  description: z.string().trim().min(1).max(120),
  total_cents: zCents,
  installments: z.number().int().min(2).max(480),
  card_id: zId.nullish(),
  account_id: zId.nullish(),
  category_id: zId.nullish(),
  purchased_on: zDate.optional(),
  first_paid: z.boolean().optional(),
  for_user_id: zId.nullable().optional(),
});

/**
 * Cada parcela vira um lançamento vinculado ao plano.
 * Em conta: uma por mês a partir da compra, planejada até ser paga.
 * No cartão: a compra já aconteceu (efetivada) e cada parcela cai numa fatura seguinte.
 */
export async function createPlan(ctx: Ctx, input: z.input<typeof planBody>) {
  const body = parse(planBody, input);
  const existing = await findByUuid(ctx, 'installment_plans', body.client_uuid);
  if (existing) return { plan: await loadPlan(ctx, existing.id), xp: null };
  const { card } = await assertPaymentTarget(ctx, 'expense', body.account_id, body.card_id);
  await assertCategory(ctx, body.category_id, 'expense');
  const forUserId = await assertHouseholdUser(ctx, body.for_user_id ?? null);
  let parts: number[];
  try {
    parts = splitInstallments(body.total_cents, body.installments);
  } catch (err) {
    throw badRequest((err as Error).message);
  }
  const purchasedOn = body.purchased_on ?? ctx.today;

  const result = await ctx.db.tx(async (db) => {
    const tctx = { ...ctx, db };
    const now = nowIso();
    const planId = await insert(db, 'installment_plans', {
      client_uuid: body.client_uuid ?? newUuid(),
      household_id: ctx.householdId,
      description: body.description,
      total_cents: body.total_cents,
      installments: body.installments,
      card_id: card ? card.id : null,
      account_id: card ? null : body.account_id,
      category_id: body.category_id ?? null,
      purchased_on: purchasedOn,
      created_by: ctx.userId,
      created_at: now,
      updated_at: now,
    });
    for (let k = 1; k <= parts.length; k++) {
      let fields: Record<string, unknown>;
      if (card) {
        const { invoiceId, referenceMonth } = await invoiceForCardPurchase(db, card, purchasedOn, k - 1);
        fields = { card_id: card.id, invoice_id: invoiceId, competence_month: referenceMonth, occurred_on: purchasedOn, status: 'posted', paid_on: null };
      } else {
        const date = addMonthsToDate(purchasedOn, k - 1);
        const paid = k === 1 && body.first_paid;
        fields = {
          account_id: body.account_id,
          competence_month: monthOf(date),
          occurred_on: date,
          due_on: date,
          status: paid ? 'posted' : 'planned',
          paid_on: paid ? date : null,
        };
      }
      await insert(db, 'transactions', {
        client_uuid: newUuid(),
        household_id: ctx.householdId,
        kind: 'expense',
        description: body.description,
        amount_cents: parts[k - 1],
        category_id: body.category_id ?? null,
        plan_id: planId,
        installment_no: k,
        for_user_id: forUserId,
        created_by: ctx.userId,
        created_at: now,
        updated_at: now,
        ...fields,
      });
    }
    const xp = await awardXp(tctx, 'tx_logged', XP_VALUES.tx_logged, { refKey: `plan:${planId}`, refId: planId });
    return { planId, xp };
  });
  return { plan: await loadPlan(ctx, result.planId), xp: result.xp };
}

export function installmentsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const m = monthOf(req.ctx.today);
    const rows = await req.ctx.db.all(`${SELECT} WHERE p.household_id = ? AND p.deleted_at IS NULL ORDER BY p.purchased_on DESC`, [m, m, req.ctx.householdId]);
    res.json(rows.map((p) => ({ ...p, active_count: num(p.active_count), settled_count: num(p.settled_count), remaining_cents: num(p.remaining_cents) })));
  });

  r.get('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const plan = await loadPlan(req.ctx, id);
    if (!plan || plan.deleted_at) throw badRequest('Parcelamento não encontrado');
    const items = await req.ctx.db.all('SELECT * FROM transactions WHERE plan_id = ? ORDER BY installment_no, id', [id]);
    res.json({ ...plan, items });
  });

  r.post('/', async (req, res) => {
    const result = await createPlan(req.ctx, req.body);
    res.status(result.xp ? 201 : 200).json(result);
  });

  /**
   * Cancela o restante: em conta, só parcelas ainda não pagas; no cartão,
   * só as que caem em faturas que ainda não fecharam. O que já foi efetivado fica.
   */
  r.post('/:id/cancel', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'installment_plans', id, 'Parcelamento');
    const now = nowIso();
    const result = await req.ctx.db.run(
      `UPDATE transactions SET deleted_at = ?, updated_at = ?
        WHERE plan_id = ? AND deleted_at IS NULL AND (
          (account_id IS NOT NULL AND paid_on IS NULL) OR
          (card_id IS NOT NULL AND invoice_id IN (SELECT id FROM invoices WHERE closing_date > ?)))`,
      [now, now, id, req.ctx.today],
    );
    res.json({ cancelled: result.changes, plan: await loadPlan(req.ctx, id) });
  });

  /** Exclusão do plano inteiro (lançamento feito por engano). */
  r.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'installment_plans', id, 'Parcelamento');
    const now = nowIso();
    await req.ctx.db.tx(async (db) => {
      await update(db, 'installment_plans', id, { deleted_at: now, updated_at: now });
      await db.run('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE plan_id = ? AND deleted_at IS NULL', [now, now, id]);
    });
    res.status(204).end();
  });

  return r;
}
