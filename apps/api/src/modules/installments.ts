import { Router } from 'express';
import { z } from 'zod';
import { addMonthsToDate, dateInMonth, monthOf, splitInstallments } from '@fin/domain';
import { badRequest, findByUuid, idParam, insert, newUuid, nowIso, num, owned, parse, update, zCents, zDate, zFlag, zId, zUuid, type Ctx } from '../core';
import { invoiceForCardPurchase } from './cards';
import { assertCategory } from './categories';
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
  ...contractFields(),
});

/** Campos do contrato (financiamento ou empréstimo). Só valem para parcelamento em conta. */
function contractFields() {
  return {
    is_contract: zFlag.optional(),
    lender: z.string().trim().max(80).nullish(),
    contracted_cents: zCents.nullish(),
    monthly_rate_bp: z.number().int().min(0).max(100000).nullish(),
  };
}
const CARD_NOT_CONTRACT = 'Compra parcelada no cartão não é contrato';

/**
 * Cada parcela vira um lançamento vinculado ao plano.
 * Em conta: uma por mês a partir da compra, planejada até ser paga.
 * No cartão: a compra já aconteceu (efetivada) e cada parcela cai numa fatura seguinte.
 */
export async function createPlan(ctx: Ctx, input: z.input<typeof planBody>) {
  const body = parse(planBody, input);
  const existing = await findByUuid(ctx, 'installment_plans', body.client_uuid);
  if (existing) return { plan: await loadPlan(ctx, existing.id), created: false };
  const { card } = await assertPaymentTarget(ctx, 'expense', body.account_id, body.card_id);
  if (card && body.is_contract) throw badRequest(CARD_NOT_CONTRACT);
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
      is_contract: body.is_contract ?? 0,
      lender: body.lender || null,
      contracted_cents: body.contracted_cents ?? null,
      monthly_rate_bp: body.monthly_rate_bp ?? null,
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
    return planId;
  });
  return { plan: await loadPlan(ctx, result), created: true };
}

export function installmentsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const m = monthOf(req.ctx.today);
    const rows = await req.ctx.db.all(`${SELECT} WHERE p.household_id = ? AND p.deleted_at IS NULL ORDER BY p.purchased_on DESC`, [m, m, req.ctx.householdId]);
    res.json(rows.map((p) => ({ ...p, active_count: num(p.active_count), settled_count: num(p.settled_count), remaining_cents: num(p.remaining_cents) })));
  });

  /**
   * Aba Contratos: os parcelamentos em conta marcados como contrato, com quanto falta,
   * a próxima prestação e quando termina. As prestações em si continuam sendo despesas normais.
   */
  r.get('/contracts', async (req, res) => {
    const ctx = req.ctx;
    const m = monthOf(ctx.today);
    const plans = await ctx.db.all(
      `${SELECT} WHERE p.household_id = ? AND p.deleted_at IS NULL AND p.is_contract = 1 AND p.account_id IS NOT NULL ORDER BY p.purchased_on, p.id`,
      [m, m, ctx.householdId],
    );
    const ids = plans.map((p) => Number(p.id));
    const items = ids.length
      ? await ctx.db.all<{ plan_id: number; installment_no: number; amount_cents: number; paid_on: string | null; due: string; competence_month: string }>(
          `SELECT plan_id, installment_no, amount_cents, paid_on, COALESCE(due_on, occurred_on) AS due, competence_month
             FROM transactions WHERE deleted_at IS NULL AND plan_id IN (${ids.map(() => '?').join(', ')})
            ORDER BY installment_no`,
          ids,
        )
      : [];
    const contracts = plans.map((p) => {
      const mine = items.filter((t) => Number(t.plan_id) === Number(p.id));
      const open = mine.filter((t) => !t.paid_on);
      const next = open[0];
      return {
        id: Number(p.id),
        description: p.description,
        lender: p.lender ?? null,
        account_id: Number(p.account_id),
        account_name: p.account_name,
        category_name: p.category_name ?? null,
        installments: num(p.installments),
        total_cents: num(p.total_cents),
        contracted_cents: p.contracted_cents == null ? null : num(p.contracted_cents),
        monthly_rate_bp: p.monthly_rate_bp == null ? null : num(p.monthly_rate_bp),
        active_count: num(p.active_count),
        paid_count: mine.length - open.length,
        paid_cents: mine.filter((t) => t.paid_on).reduce((a, t) => a + num(t.amount_cents), 0),
        remaining_cents: open.reduce((a, t) => a + num(t.amount_cents), 0),
        month_cents: mine.filter((t) => t.competence_month === m).reduce((a, t) => a + num(t.amount_cents), 0),
        next: next ? { installment_no: num(next.installment_no), due_on: next.due, amount_cents: num(next.amount_cents), overdue: next.due < ctx.today } : null,
        ends_on: mine.length ? mine[mine.length - 1].due : null,
      };
    });
    res.json({
      month: m,
      remaining_cents: contracts.reduce((a, c) => a + c.remaining_cents, 0),
      month_cents: contracts.reduce((a, c) => a + c.month_cents, 0),
      contracts,
    });
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
    res.status(result.created ? 201 : 200).json({ plan: result.plan });
  });

  /** Marca ou desmarca como contrato e guarda credor, valor contratado e juros. */
  r.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const plan = await owned<{ card_id: number | null }>(req.ctx, 'installment_plans', id, 'Parcelamento');
    const body = parse(z.object(contractFields()), req.body);
    if (plan.card_id && body.is_contract) throw badRequest(CARD_NOT_CONTRACT);
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (body.is_contract !== undefined) patch.is_contract = body.is_contract;
    if (body.lender !== undefined) patch.lender = body.lender || null;
    if (body.contracted_cents !== undefined) patch.contracted_cents = body.contracted_cents;
    if (body.monthly_rate_bp !== undefined) patch.monthly_rate_bp = body.monthly_rate_bp;
    await update(req.ctx.db, 'installment_plans', id, patch);
    res.json(await loadPlan(req.ctx, id));
  });

  /**
   * Apaga a parcela indicada e as que vêm depois. As anteriores ficam.
   * Se não sobra nenhuma parcela ativa, o plano sai da lista.
   */
  r.post('/:id/delete-from', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'installment_plans', id, 'Parcelamento');
    const body = parse(z.object({ from_installment: z.number().int().min(1).max(480) }), req.body);
    const now = nowIso();
    const deleted = await req.ctx.db.tx(async (db) => {
      const result = await db.run(
        `UPDATE transactions SET deleted_at = ?, updated_at = ?
          WHERE plan_id = ? AND deleted_at IS NULL AND installment_no >= ?`,
        [now, now, id, body.from_installment],
      );
      const left = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE plan_id = ? AND deleted_at IS NULL', [id]);
      if (num(left?.n) === 0) await update(db, 'installment_plans', id, { deleted_at: now, updated_at: now });
      return result.changes;
    });
    res.json({ deleted, plan: await loadPlan(req.ctx, id) });
  });

  /**
   * Aplica valor e/ou dia nesta parcela e nas seguintes que ainda não foram pagas.
   * No cartão, a data segue a fatura. Parcela de fatura já passada também fica.
   */
  r.post('/:id/apply-from', async (req, res) => {
    const id = idParam(req.params.id);
    const plan = await owned<{ card_id: number | null }>(req.ctx, 'installment_plans', id, 'Parcelamento');
    const body = parse(
      z.object({
        from_installment: z.number().int().min(1).max(480),
        amount_cents: zCents.optional(),
        day_of_month: z.number().int().min(1).max(31).optional(),
        /** O dia novo entra também nas parcelas seguintes já pagas. O valor delas fica. */
        include_settled: z.boolean().optional(),
      }),
      req.body,
    );
    if (body.amount_cents === undefined && body.day_of_month === undefined) throw badRequest('Informe o valor ou o dia');
    if (body.day_of_month !== undefined && plan.card_id) throw badRequest('A data de uma parcela no cartão segue a fatura');
    const currentMonth = monthOf(req.ctx.today);
    const updated = await req.ctx.db.tx(async (db) => {
      const rows = await db.all<{
        id: number;
        installment_no: number;
        account_id: number | null;
        card_id: number | null;
        paid_on: string | null;
        competence_month: string;
      }>(
        `SELECT id, installment_no, account_id, card_id, paid_on, competence_month
           FROM transactions WHERE plan_id = ? AND deleted_at IS NULL AND installment_no >= ?
          ORDER BY installment_no`,
        [id, body.from_installment],
      );
      if (!rows.some((row) => row.installment_no === body.from_installment)) throw badRequest('Parcela não encontrada');
      const now = nowIso();
      let count = 0;
      for (const row of rows) {
        const current = row.installment_no === body.from_installment;
        const paidAccount = row.account_id != null && row.paid_on != null;
        const pastCard = row.card_id != null && row.competence_month < currentMonth;
        const skipAmount = !current && (paidAccount || pastCard);
        const moveDay = body.day_of_month !== undefined && !row.card_id && (!skipAmount || body.include_settled);
        if (skipAmount && !moveDay) continue;
        const patch: Record<string, unknown> = { updated_at: now, overridden: 1 };
        if (body.amount_cents !== undefined && !skipAmount) patch.amount_cents = body.amount_cents;
        if (moveDay && body.day_of_month !== undefined) {
          const date = dateInMonth(row.competence_month, body.day_of_month);
          patch.occurred_on = date;
          patch.due_on = date;
          if (row.paid_on) patch.paid_on = date;
        }
        await update(db, 'transactions', row.id, patch);
        count += 1;
      }
      return count;
    });
    res.json({ updated, plan: await loadPlan(req.ctx, id) });
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
