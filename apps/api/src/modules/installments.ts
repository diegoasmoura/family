import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '@fin/db';
import { addMonthsToDate, dateInMonth, monthOf, splitByShares, splitInstallments } from '@fin/domain';
import { badRequest, findByUuid, idParam, insert, newUuid, nowIso, num, owned, parse, update, zCents, zDate, zFlag, zId, zUuid, type Ctx } from '../core';
import { invoiceForCardPurchase } from './cards';
import { assertCategory } from './categories';
import { normalizeSplit, splitFields } from './split';
import { assertHouseholdUser, assertPaymentTarget, decorateTransactions, TX_SELECT } from './transactions';

/** Tipos de contrato (a ilustração do card na aba Contratos). */
const CONTRACT_TYPES = ['car', 'house', 'moto', 'study', 'loan', 'other'] as const;

const SELECT = `SELECT p.*, a.name AS account_name, cc.name AS card_name, c.name AS category_name,
    (SELECT COUNT(DISTINCT t.installment_no) FROM transactions t WHERE t.plan_id = p.id AND t.deleted_at IS NULL) AS active_count,
    (SELECT COUNT(*) FROM (
        SELECT t.installment_no FROM transactions t
         WHERE t.plan_id = p.id AND t.deleted_at IS NULL
         GROUP BY t.installment_no
        HAVING MIN(CASE
          WHEN (t.account_id IS NOT NULL AND t.paid_on IS NOT NULL) OR (t.card_id IS NOT NULL AND t.competence_month <= ?) THEN 1
          ELSE 0 END) = 1
    ) settled_inst) AS settled_count,
    (SELECT COALESCE(SUM(t.amount_cents), 0) FROM transactions t WHERE t.plan_id = p.id AND t.deleted_at IS NULL
        AND NOT ((t.account_id IS NOT NULL AND t.paid_on IS NOT NULL) OR (t.card_id IS NOT NULL AND t.competence_month <= ?))) AS remaining_cents
    , (SELECT t.for_user_id FROM transactions t WHERE t.plan_id = p.id AND t.deleted_at IS NULL ORDER BY t.installment_no DESC, t.id LIMIT 1) AS for_user_id
    , (SELECT t.split_user_id FROM transactions t WHERE t.plan_id = p.id AND t.deleted_at IS NULL ORDER BY t.installment_no DESC, t.id LIMIT 1) AS split_user_id
    , (SELECT t.split_bp FROM transactions t WHERE t.plan_id = p.id AND t.deleted_at IS NULL ORDER BY t.installment_no DESC, t.id LIMIT 1) AS split_bp
  FROM installment_plans p
  LEFT JOIN accounts a ON a.id = p.account_id
  LEFT JOIN credit_cards cc ON cc.id = p.card_id
  LEFT JOIN categories c ON c.id = p.category_id`;

function decoratePlan(row: any) {
  return {
    ...row,
    active_count: num(row.active_count),
    settled_count: num(row.settled_count),
    remaining_cents: num(row.remaining_cents),
    is_contract: num(row.is_contract),
    shares: null as Share[] | null,
  };
}

type Share = { user_id: number; bp: number; account_id?: number | null };
type ShareLine = {
  id: number;
  plan_id: number;
  installment_no: number;
  for_user_id: number | null;
  amount_cents: number;
  split_bp: number | null;
  paid_on: string | null;
  account_id: number | null;
};

function templateAccount(row: Record<string, unknown>): number | null {
  return row.account_id == null ? null : num(row.account_id);
}

function shareOf(row: ShareLine, bp: number): Share {
  return { user_id: num(row.for_user_id), bp, account_id: row.account_id == null ? null : num(row.account_id) };
}

/** Duas linhas com dono viram a divisão gravada, cada uma com a conta de onde sai. Uma linha só não tem divisão. */
function sharesFromGroup(rows: ShareLine[]): Share[] | null {
  const people = rows.filter((row) => row.for_user_id != null).sort((a, b) => num(a.id) - num(b.id));
  if (people.length < 2) return null;
  if (people.every((row) => row.split_bp != null) && people.reduce((sum, row) => sum + num(row.split_bp), 0) === 10000) {
    return people.map((row) => shareOf(row, num(row.split_bp)));
  }
  const total = people.reduce((sum, row) => sum + num(row.amount_cents), 0);
  const bps = people.map((row) => Math.round((num(row.amount_cents) * 10000) / Math.max(1, total)));
  bps[bps.length - 1] = 10000 - bps.slice(0, -1).reduce((sum, bp) => sum + bp, 0);
  return people.map((row, index) => shareOf(row, bps[index]));
}

/** A divisão que vale agora: a da próxima prestação em aberto, ou a da última se todas já foram pagas. */
async function attachShares(db: Db, plans: any[]) {
  if (!plans.length) return;
  const ids = plans.map((plan) => Number(plan.id));
  const rows = await db.all<ShareLine>(
    `SELECT id, plan_id, installment_no, for_user_id, amount_cents, split_bp, paid_on,
            COALESCE(settlement_previous_account_id, account_id) AS account_id
       FROM transactions
      WHERE deleted_at IS NULL AND plan_id IN (${ids.map(() => '?').join(', ')})
      ORDER BY installment_no, id`,
    ids,
  );
  for (const plan of plans) {
    const mine = rows.filter((row) => Number(row.plan_id) === Number(plan.id));
    const openNo = mine.find((row) => !row.paid_on)?.installment_no;
    const no = openNo ?? mine.at(-1)?.installment_no;
    plan.shares = no == null ? null : sharesFromGroup(mine.filter((row) => Number(row.installment_no) === Number(no)));
  }
}

const shareList = z
  .array(z.object({ user_id: zId, bp: z.number().int().min(1).max(9999), account_id: zId.nullish() }))
  .min(2)
  .max(2);

/** Só parcelamento em conta, e as duas fatias precisam fechar 100%. A conta de cada fatia, se vier, é da casa. */
async function resolveShares(ctx: Ctx, shares: Share[] | null | undefined, onCard: boolean): Promise<Share[] | null> {
  if (shares == null) return null;
  if (onCard) throw badRequest('Compra parcelada no cartão não pode ser dividida');
  if (shares[0].user_id === shares[1].user_id) throw badRequest('A divisão é entre as duas pessoas');
  if (shares.reduce((sum, share) => sum + share.bp, 0) !== 10000) throw badRequest('A divisão precisa fechar 100%');
  for (const share of shares) {
    await assertHouseholdUser(ctx, share.user_id);
    if (share.account_id != null) {
      const acc = await owned<{ archived: number }>(ctx, 'accounts', share.account_id, 'Conta');
      if (num(acc.archived)) throw badRequest('Esta conta está arquivada');
    }
  }
  return shares;
}

/** Troca as linhas em aberto: uma por pessoa, ou uma só quando a divisão sai. O que já foi pago fica. */
async function rewriteOpenShares(db: Db, planId: number, shares: Share[] | null, forUserId: number | null, today: string, userId: number) {
  const currentMonth = monthOf(today);
  const rows = await db.all<Record<string, unknown>>(
    'SELECT * FROM transactions WHERE plan_id = ? AND deleted_at IS NULL ORDER BY installment_no, id',
    [planId],
  );
  const groups = new Map<number, Record<string, unknown>[]>();
  for (const row of rows) {
    const no = num(row.installment_no);
    groups.set(no, [...(groups.get(no) ?? []), row]);
  }
  const now = nowIso();
  for (const group of groups.values()) {
    const settled = group.some(
      (row) => (row.account_id != null && row.paid_on != null) || (row.card_id != null && String(row.competence_month) < currentMonth),
    );
    if (settled) continue;
    const total = group.reduce((sum, row) => sum + num(row.amount_cents), 0);
    let slices: { amount: number; for_user_id: number | null; split_bp: number | null; account_id: number | null }[];
    try {
      slices = shares
        ? splitByShares(total, shares.map((share) => share.bp)).map((amount, index) => ({
            amount,
            for_user_id: shares[index].user_id,
            split_bp: shares[index].bp,
            account_id: shares[index].account_id ?? (templateAccount(group[0])),
          }))
        : [{ amount: total, for_user_id: forUserId, split_bp: null, account_id: templateAccount(group[0]) }];
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    for (const row of group) await update(db, 'transactions', num(row.id), { deleted_at: now, updated_at: now });
    const template = group[0];
    for (const slice of slices) {
      await insert(db, 'transactions', {
        client_uuid: newUuid(),
        household_id: template.household_id,
        kind: template.kind,
        description: template.description,
        amount_cents: slice.amount,
        occurred_on: template.occurred_on,
        due_on: template.due_on,
        paid_on: null,
        competence_month: template.competence_month,
        category_id: template.category_id,
        account_id: slice.account_id,
        card_id: template.card_id,
        invoice_id: template.invoice_id,
        plan_id: planId,
        installment_no: template.installment_no,
        status: template.account_id != null ? 'planned' : template.status,
        include_in_reports: num(template.include_in_reports) ? 1 : 0,
        overridden: num(template.overridden) ? 1 : 0,
        for_user_id: slice.for_user_id,
        split_user_id: null,
        split_bp: slice.split_bp,
        created_by: template.created_by ?? userId,
        created_at: now,
        updated_at: now,
      });
    }
  }
}

async function loadPlan(ctx: Ctx, id: number) {
  const m = monthOf(ctx.today);
  const row = await ctx.db.get(`${SELECT} WHERE p.id = ? AND p.household_id = ?`, [m, m, id, ctx.householdId]);
  if (!row || row.deleted_at) return row && decoratePlan(row);
  const plan = decoratePlan(row);
  await attachShares(ctx.db, [plan]);
  return plan;
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
  ...splitFields,
  ...contractFields(),
});

/** Campos do contrato (financiamento ou empréstimo). Só valem para parcelamento em conta. */
function contractFields() {
  return {
    is_contract: zFlag.optional(),
    lender: z.string().trim().max(80).nullish(),
    contracted_cents: zCents.nullish(),
    monthly_rate_bp: z.number().int().min(0).max(100000).nullish(),
    contract_type: z.enum(CONTRACT_TYPES).nullish(),
    shares: shareList.nullable().optional(),
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
  const shares = await resolveShares(ctx, body.shares, !!card);
  await assertCategory(ctx, body.category_id, 'expense');
  const forUserId = await assertHouseholdUser(ctx, body.for_user_id ?? null);
  // Sem `shares`, "Nosso" continua numa linha só, com a parte de cada um calculada na leitura.
  const split = await normalizeSplit(ctx, forUserId, body.split_user_id, body.split_bp);
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
      account_id: card ? null : (shares?.[0]?.account_id ?? body.account_id),
      category_id: body.category_id ?? null,
      purchased_on: purchasedOn,
      is_contract: body.is_contract ?? 0,
      lender: body.lender || null,
      contracted_cents: body.contracted_cents ?? null,
      monthly_rate_bp: body.monthly_rate_bp ?? null,
      contract_type: body.contract_type ?? null,
      created_by: ctx.userId,
      created_at: now,
      updated_at: now,
    });
    for (let k = 1; k <= parts.length; k++) {
      let slices: number[];
      try {
        slices = shares ? splitByShares(parts[k - 1], shares.map((share) => share.bp)) : [parts[k - 1]];
      } catch (err) {
        throw badRequest((err as Error).message);
      }
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
      for (let i = 0; i < slices.length; i++) {
        const share = shares?.[i];
        await insert(db, 'transactions', {
          client_uuid: newUuid(),
          household_id: ctx.householdId,
          kind: 'expense',
          description: body.description,
          amount_cents: slices[i],
          category_id: body.category_id ?? null,
          plan_id: planId,
          installment_no: k,
          for_user_id: share ? share.user_id : forUserId,
          split_user_id: share ? null : split.split_user_id,
          split_bp: share ? share.bp : split.split_bp,
          created_by: ctx.userId,
          created_at: now,
          updated_at: now,
          ...fields,
          ...(!card && share?.account_id ? { account_id: share.account_id } : {}),
        });
      }
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
    const plans = rows.map(decoratePlan);
    await attachShares(req.ctx.db, plans);
    res.json(plans);
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
      ? await ctx.db.all<ShareLine & { due: string; competence_month: string }>(
          `SELECT id, plan_id, installment_no, amount_cents, paid_on, for_user_id, split_bp,
                  COALESCE(settlement_previous_account_id, account_id) AS account_id,
                  COALESCE(due_on, occurred_on) AS due, competence_month
             FROM transactions WHERE deleted_at IS NULL AND plan_id IN (${ids.map(() => '?').join(', ')})
            ORDER BY installment_no, id`,
          ids,
        )
      : [];
    const contracts = plans.map((p) => {
      const mine = items.filter((t) => Number(t.plan_id) === Number(p.id));
      const byNo = new Map<number, typeof mine>();
      for (const line of mine) {
        const no = num(line.installment_no);
        byNo.set(no, [...(byNo.get(no) ?? []), line]);
      }
      const inst = [...byNo.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([no, lines]) => ({
          no,
          amount: lines.reduce((sum, line) => sum + num(line.amount_cents), 0),
          paidAmount: lines.filter((line) => line.paid_on).reduce((sum, line) => sum + num(line.amount_cents), 0),
          remainingAmount: lines.filter((line) => !line.paid_on).reduce((sum, line) => sum + num(line.amount_cents), 0),
          paid: lines.every((line) => line.paid_on),
          due: lines[0].due,
          month: lines[0].competence_month,
        }));
      const open = inst.filter((item) => !item.paid);
      const next = open[0];
      const openNo = mine.find((line) => !line.paid_on)?.installment_no ?? mine.at(-1)?.installment_no;
      const currentCents = inst.reduce((sum, item) => sum + item.amount, 0);
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
        contract_type: p.contract_type ?? 'other',
        for_user_id: p.for_user_id == null ? null : num(p.for_user_id),
        shares: openNo == null ? null : sharesFromGroup(mine.filter((line) => Number(line.installment_no) === Number(openNo))),
        active_count: inst.length,
        paid_count: inst.length - open.length,
        months_left: open.length,
        paid_cents: inst.reduce((sum, item) => sum + item.paidAmount, 0),
        remaining_cents: inst.reduce((sum, item) => sum + item.remainingAmount, 0),
        // Só compara com o plano inicial quando nenhuma prestação foi cancelada.
        saved_cents: inst.length === num(p.installments) ? num(p.total_cents) - currentCents : null,
        month_cents: inst.filter((item) => item.month === m).reduce((sum, item) => sum + item.amount, 0),
        next: next ? { installment_no: next.no, due_on: next.due, amount_cents: next.amount, overdue: next.due < ctx.today } : null,
        ends_on: inst.length ? inst[inst.length - 1].due : null,
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
    const rows = await req.ctx.db.all(
      `${TX_SELECT} WHERE t.plan_id = ? AND t.household_id = ? ORDER BY t.installment_no, t.id`,
      [id, req.ctx.householdId],
    );
    const items = decorateTransactions(rows, req.ctx.today);
    res.json({ ...plan, items });
  });

  r.post('/', async (req, res) => {
    const result = await createPlan(req.ctx, req.body);
    res.status(result.created ? 201 : 200).json({ plan: result.plan });
  });

  /**
   * Marca ou desmarca como contrato, guarda tipo, credor, valor contratado e juros e,
   * se vier, troca o "de quem" (e a divisão do Nosso) das parcelas ainda em aberto.
   */
  r.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const plan = await owned<{ card_id: number | null }>(req.ctx, 'installment_plans', id, 'Parcelamento');
    const body = parse(z.object({ ...contractFields(), for_user_id: zId.nullable().optional(), ...splitFields }), req.body);
    if (plan.card_id && body.is_contract) throw badRequest(CARD_NOT_CONTRACT);
    const owner = body.for_user_id === undefined ? undefined : await assertHouseholdUser(req.ctx, body.for_user_id);
    const split = owner === undefined ? null : await normalizeSplit(req.ctx, owner, body.split_user_id, body.split_bp);
    const shares = body.shares === undefined ? undefined : await resolveShares(req.ctx, body.shares, !!plan.card_id);
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (body.is_contract !== undefined) patch.is_contract = body.is_contract;
    if (body.lender !== undefined) patch.lender = body.lender || null;
    if (body.contracted_cents !== undefined) patch.contracted_cents = body.contracted_cents;
    if (body.monthly_rate_bp !== undefined) patch.monthly_rate_bp = body.monthly_rate_bp;
    if (body.contract_type !== undefined) patch.contract_type = body.contract_type;
    // A conta do plano é só a âncora do cadastro. O saldo usa a conta de cada linha.
    if (shares?.[0]?.account_id && !plan.card_id) patch.account_id = shares[0].account_id;
    await req.ctx.db.tx(async (db) => {
      await update(db, 'installment_plans', id, patch);
      if (shares !== undefined) {
        // `shares` reescreve as prestações em aberto: uma linha por pessoa, ou uma só quando a divisão sai.
        await rewriteOpenShares(db, id, shares, owner ?? null, req.ctx.today, req.ctx.userId);
      } else if (owner !== undefined && split) {
        // O que já foi pago (em conta) ou já está em fatura passada fica como está.
        await db.run(
          `UPDATE transactions SET for_user_id = ?, split_user_id = ?, split_bp = ?, updated_at = ?
            WHERE plan_id = ? AND deleted_at IS NULL AND paid_on IS NULL AND (card_id IS NULL OR competence_month >= ?)`,
          [owner, split.split_user_id, split.split_bp, nowIso(), id, monthOf(req.ctx.today)],
        );
      }
    });
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
   * Quita de uma vez todas as partes ainda abertas de uma prestação em conta.
   * "De quem é" não muda: só o dinheiro sai da conta escolhida e fica registrado
   * quem efetivamente fez o pagamento.
   */
  r.post('/:id/settle-installment', async (req, res) => {
    const id = idParam(req.params.id);
    const plan = await owned<{ card_id: number | null; is_contract: number }>(req.ctx, 'installment_plans', id, 'Contrato');
    if (!num(plan.is_contract)) throw badRequest('Esta operação é exclusiva de contratos');
    if (plan.card_id) throw badRequest('Compra no cartão é quitada pelo pagamento da fatura');
    const body = parse(
      z.object({
        installment_no: z.number().int().min(1).max(480),
        amount_cents: zCents,
        paid_on: zDate.optional(),
        payer_user_id: zId,
        account_id: zId,
      }),
      req.body,
    );
    await assertHouseholdUser(req.ctx, body.payer_user_id);
    await assertPaymentTarget(req.ctx, 'expense', body.account_id, null);
    const settled = await req.ctx.db.tx(async (db) => {
      const rows = await db.all<{
        id: number;
        amount_cents: number;
        account_id: number | null;
        card_id: number | null;
        paid_on: string | null;
        split_bp: number | null;
        overridden: number;
      }>(
        `SELECT id, amount_cents, account_id, card_id, paid_on, split_bp, overridden
           FROM transactions
          WHERE household_id = ? AND plan_id = ? AND installment_no = ? AND deleted_at IS NULL
          ORDER BY id`,
        [req.ctx.householdId, id, body.installment_no],
      );
      if (!rows.length) throw badRequest('Parcela não encontrada');
      if (rows.some((row) => row.card_id != null)) throw badRequest('Compra no cartão é quitada pelo pagamento da fatura');
      const open = rows.filter((row) => !row.paid_on);
      if (!open.length) throw badRequest('Esta parcela já está paga');

      let parts: number[];
      if (open.length === 1) {
        parts = [body.amount_cents];
      } else {
        const saved = open.every((row) => row.split_bp != null) && open.reduce((sum, row) => sum + num(row.split_bp), 0) === 10000;
        const total = open.reduce((sum, row) => sum + num(row.amount_cents), 0);
        const bps = saved
          ? open.map((row) => num(row.split_bp))
          : open.map((row) => Math.round((num(row.amount_cents) * 10000) / Math.max(1, total)));
        if (!saved) bps[bps.length - 1] = 10000 - bps.slice(0, -1).reduce((sum, bp) => sum + bp, 0);
        try {
          parts = splitByShares(body.amount_cents, bps);
        } catch (err) {
          throw badRequest((err as Error).message);
        }
      }

      const settlementUuid = newUuid();
      const now = nowIso();
      for (let index = 0; index < open.length; index++) {
        const row = open[index];
        await update(db, 'transactions', row.id, {
          amount_cents: parts[index],
          account_id: body.account_id,
          status: 'posted',
          paid_on: body.paid_on ?? req.ctx.today,
          paid_by_user_id: body.payer_user_id,
          settlement_expected_cents: num(row.amount_cents),
          settlement_previous_account_id: row.account_id,
          settlement_previous_overridden: num(row.overridden),
          settlement_uuid: settlementUuid,
          overridden: 1,
          updated_at: now,
        });
      }
      return {
        settlement_uuid: settlementUuid,
        installment_no: body.installment_no,
        expected_cents: open.reduce((sum, row) => sum + num(row.amount_cents), 0),
        paid_cents: body.amount_cents,
        lines: open.length,
      };
    });
    res.json({ ...settled, plan: await loadPlan(req.ctx, id) });
  });

  /** Desfaz uma quitação conjunta inteira, sem deixar a prestação pela metade. */
  r.post('/:id/unsettle-installment', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'installment_plans', id, 'Contrato');
    const body = parse(z.object({ settlement_uuid: zUuid }), req.body);
    const restored = await req.ctx.db.tx(async (db) => {
      const rows = await db.all<{
        id: number;
        paid_on: string | null;
        settlement_expected_cents: number | null;
        settlement_previous_account_id: number | null;
        settlement_previous_overridden: number | null;
      }>(
        `SELECT id, paid_on, settlement_expected_cents, settlement_previous_account_id, settlement_previous_overridden
           FROM transactions
          WHERE household_id = ? AND plan_id = ? AND settlement_uuid = ? AND deleted_at IS NULL
          ORDER BY id`,
        [req.ctx.householdId, id, body.settlement_uuid],
      );
      if (!rows.length) throw badRequest('Quitação não encontrada');
      if (rows.some((row) => !row.paid_on || row.settlement_expected_cents == null || row.settlement_previous_account_id == null)) {
        throw badRequest('Esta quitação não pode mais ser desfeita');
      }
      const now = nowIso();
      for (const row of rows) {
        await update(db, 'transactions', row.id, {
          amount_cents: num(row.settlement_expected_cents),
          account_id: num(row.settlement_previous_account_id),
          status: 'planned',
          paid_on: null,
          paid_by_user_id: null,
          settlement_expected_cents: null,
          settlement_previous_account_id: null,
          settlement_previous_overridden: null,
          settlement_uuid: null,
          overridden: num(row.settlement_previous_overridden),
          updated_at: now,
        });
      }
      return rows.length;
    });
    res.json({ restored, plan: await loadPlan(req.ctx, id) });
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
        /** Muda só a linha dessa pessoa. Sem isso, o valor é o total da prestação e se reparte. */
        line_tx_id: zId.optional(),
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
        for_user_id: number | null;
        amount_cents: number;
        split_bp: number | null;
      }>(
        `SELECT id, installment_no, account_id, card_id, paid_on, competence_month, for_user_id, amount_cents, split_bp
           FROM transactions WHERE plan_id = ? AND deleted_at IS NULL AND installment_no >= ?
          ORDER BY installment_no, id`,
        [id, body.from_installment],
      );
      if (!rows.some((row) => Number(row.installment_no) === body.from_installment)) throw badRequest('Parcela não encontrada');
      const anchor = body.line_tx_id == null ? null : rows.find((row) => Number(row.id) === body.line_tx_id);
      if (body.line_tx_id != null && !anchor) throw badRequest('Parcela não encontrada');
      const skipAmount = (row: (typeof rows)[number]) => {
        const current = Number(row.installment_no) === body.from_installment;
        const paidAccount = row.account_id != null && row.paid_on != null;
        const pastCard = row.card_id != null && row.competence_month < currentMonth;
        return paidAccount || (!current && pastCard);
      };
      const groups = new Map<number, typeof rows>();
      for (const row of rows) {
        const no = Number(row.installment_no);
        groups.set(no, [...(groups.get(no) ?? []), row]);
      }
      const amounts = new Map<number, number>();
      if (body.amount_cents !== undefined) {
        for (const group of groups.values()) {
          const eligible = group.filter((row) => !skipAmount(row));
          if (!eligible.length) continue;
          if (anchor) {
            for (const row of eligible) {
              const same = anchor.for_user_id == null ? row.for_user_id == null : Number(row.for_user_id) === Number(anchor.for_user_id);
              if (same) amounts.set(Number(row.id), body.amount_cents);
            }
          } else if (group.length > 1 && eligible.length === group.length) {
            const saved = group.every((row) => row.split_bp != null) && group.reduce((sum, row) => sum + num(row.split_bp), 0) === 10000;
            const bps = saved
              ? group.map((row) => num(row.split_bp))
              : group.map((row) => Math.round((num(row.amount_cents) * 10000) / Math.max(1, group.reduce((sum, item) => sum + num(item.amount_cents), 0))));
            if (!saved) bps[bps.length - 1] = 10000 - bps.slice(0, -1).reduce((sum, bp) => sum + bp, 0);
            let parts: number[];
            try {
              parts = splitByShares(body.amount_cents, bps);
            } catch (err) {
              throw badRequest((err as Error).message);
            }
            group.forEach((row, index) => amounts.set(Number(row.id), parts[index]));
          } else {
            for (const row of eligible) amounts.set(Number(row.id), body.amount_cents);
          }
        }
      }
      const now = nowIso();
      let count = 0;
      for (const row of rows) {
        const skip = skipAmount(row);
        const current = Number(row.installment_no) === body.from_installment;
        const moveDay = body.day_of_month !== undefined && !row.card_id && (current || !skip || body.include_settled);
        const nextAmount = amounts.get(Number(row.id));
        if (nextAmount === undefined && !moveDay) continue;
        const patch: Record<string, unknown> = { updated_at: now, overridden: 1 };
        if (nextAmount !== undefined) patch.amount_cents = nextAmount;
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
