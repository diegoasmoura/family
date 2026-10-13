import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '@fin/db';
import {
  INVOICE_STATE_LABEL,
  addMonths,
  cardLimit,
  computeInvoiceBalances,
  cycleForReference,
  invoiceForPurchase,
  monthOf,
  type InvoiceBalance,
} from '@fin/domain';
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
  requireAdmin,
  update,
  zCents,
  zCentsOrZero,
  zDate,
  zFlag,
  zId,
  zMonth,
  zUuid,
  type Ctx,
} from '../core';
import { decorateTransactions } from './transactions';

export interface Card {
  id: number;
  household_id: number;
  name: string;
  brand: string | null;
  closing_day: number;
  due_day: number;
  limit_cents: number | null;
  default_pay_account_id: number | null;
  color: string | null;
  archived: number;
}

/** Cria ou localiza a fatura do cartão para o mês de vencimento. */
export async function ensureInvoice(db: Db, card: Card, referenceMonth: string): Promise<number> {
  const found = await db.get<{ id: number }>('SELECT id FROM invoices WHERE card_id = ? AND reference_month = ?', [card.id, referenceMonth]);
  if (found) return Number(found.id);
  const cycle = cycleForReference(card, referenceMonth);
  const now = nowIso();
  return insert(db, 'invoices', { card_id: card.id, ...cycle, created_at: now, updated_at: now });
}

export async function invoiceForCardPurchase(db: Db, card: Card, date: string, shiftMonths = 0) {
  const cycle = invoiceForPurchase(card, date);
  const ref = addMonths(cycle.reference_month, shiftMonths);
  return { invoiceId: await ensureInvoice(db, card, ref), referenceMonth: ref };
}

/** Saldos de todas as faturas do cartão, com crédito carregado entre elas. */
export async function cardInvoiceBalances(ctx: Ctx, cardId: number): Promise<(InvoiceBalance & { adjustment_cents: number })[]> {
  const rows = await ctx.db.all(
    `SELECT i.id, i.reference_month, i.closing_date, i.due_date,
            COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.invoice_id = i.id AND t.deleted_at IS NULL), 0) + COALESCE(i.adjustment_cents, 0) AS total_cents,
            COALESCE(i.adjustment_cents, 0) AS adjustment_cents,
            COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.deleted_at IS NULL), 0) AS paid_cents
       FROM invoices i WHERE i.card_id = ? ORDER BY i.reference_month`,
    [cardId],
  );
  const inputs = rows.map((r) => ({
    ...r,
    id: Number(r.id),
    total_cents: num(r.total_cents),
    paid_cents: num(r.paid_cents),
    adjustment_cents: num(r.adjustment_cents),
  }));
  return computeInvoiceBalances(inputs, ctx.today).map((b) => ({
    ...b,
    adjustment_cents: inputs.find((i) => i.id === b.id)?.adjustment_cents ?? 0,
  }));
}

async function cardTotals(ctx: Ctx, card: Card) {
  const row = await ctx.db.get(
    `SELECT
       COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE card_id = ? AND status = 'posted' AND deleted_at IS NULL), 0)
         + COALESCE((SELECT SUM(adjustment_cents) FROM invoices WHERE card_id = ?), 0) AS posted,
       COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE card_id = ? AND status = 'planned' AND deleted_at IS NULL), 0) AS planned,
       COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
                  WHERE i.card_id = ? AND p.deleted_at IS NULL), 0) AS paid`,
    [card.id, card.id, card.id, card.id],
  );
  return { posted: num(row.posted), planned: num(row.planned), paid: num(row.paid) };
}

/** Fatura mais relevante: a mais antiga com saldo em aberto já fechada, senão a aberta. */
export function relevantInvoice(balances: InvoiceBalance[]): InvoiceBalance | undefined {
  return (
    balances.find((b) => (b.state === 'closed' || b.state === 'overdue') && b.remaining_cents > 0) ??
    balances.find((b) => b.state === 'open') ??
    balances.find((b) => b.state === 'future')
  );
}

export async function cardSummary(ctx: Ctx, card: Card) {
  const totals = await cardTotals(ctx, card);
  const balances = await cardInvoiceBalances(ctx, card.id);
  const current = relevantInvoice(balances);
  const month = monthOf(ctx.today);
  const monthInvoice = balances.find((b) => b.reference_month === month);
  const last = balances[balances.length - 1];
  return {
    ...card,
    ...cardLimit(card.limit_cents, totals.posted, totals.paid),
    posted_cents: totals.posted,
    pending_cents: totals.planned,
    paid_total_cents: totals.paid,
    credit_cents: last?.credit_out_cents ?? 0,
    current_invoice: current ? withLabel(current) : null,
    month_invoice: monthInvoice ? withLabel(monthInvoice) : null,
  };
}

const withLabel = (b: InvoiceBalance) => ({ ...b, state_label: INVOICE_STATE_LABEL[b.state] });

async function invoiceWindow(ctx: Ctx, card: Card, from: string, to: string) {
  const balances = await cardInvoiceBalances(ctx, card.id);
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    const b = balances.find((x) => x.reference_month === m);
    const cycle = cycleForReference(card, m);
    out.push(
      b
        ? withLabel(b)
        : {
            id: null,
            ...cycle,
            total_cents: 0,
            paid_cents: 0,
            credit_in_cents: 0,
            due_cents: 0,
            remaining_cents: 0,
            credit_out_cents: 0,
            state: ctx.today < cycle.closing_date ? 'future' : 'paid',
            state_label: ctx.today < cycle.closing_date ? 'Futura' : 'Sem compras',
          },
    );
  }
  return out;
}

async function loadCard(ctx: Ctx, id: number): Promise<Card> {
  return owned<Card>(ctx, 'credit_cards', id, 'Cartão');
}

async function invoiceWithCard(ctx: Ctx, invoiceId: number) {
  const inv = await ctx.db.get(
    `SELECT i.*, c.household_id FROM invoices i JOIN credit_cards c ON c.id = i.card_id WHERE i.id = ? AND c.household_id = ?`,
    [invoiceId, ctx.householdId],
  );
  if (!inv) throw notFound('Fatura');
  return inv;
}

async function invoiceDetail(ctx: Ctx, invoiceId: number) {
  const inv = await invoiceWithCard(ctx, invoiceId);
  const card = await loadCard(ctx, inv.card_id);
  const balance = (await cardInvoiceBalances(ctx, card.id)).find((b) => b.id === Number(invoiceId))!;
  const txs = await ctx.db.all(
    `SELECT t.*, c.name AS category_name, pc.name AS parent_category_name, p.installments AS plan_installments,
            c.icon AS category_icon, COALESCE(c.color, pc.color) AS category_color, pc.icon AS parent_category_icon, pc.color AS parent_category_color
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_id
       LEFT JOIN installment_plans p ON p.id = t.plan_id
      WHERE t.invoice_id = ? AND t.deleted_at IS NULL ORDER BY t.occurred_on DESC, t.id DESC`,
    [invoiceId],
  );
  const payments = await ctx.db.all(
    `SELECT p.*, a.name AS account_name FROM invoice_payments p JOIN accounts a ON a.id = p.account_id
      WHERE p.invoice_id = ? AND p.deleted_at IS NULL ORDER BY p.paid_on, p.id`,
    [invoiceId],
  );
  const transactions = decorateTransactions(txs, ctx.today);
  const installmentCents = transactions.filter((t) => t.plan_id).reduce((a, t) => a + num(t.amount_cents), 0);
  return {
    ...withLabel(balance),
    adjustment_cents: balance.adjustment_cents,
    installment_cents: installmentCents,
    loose_cents: balance.total_cents - installmentCents,
    card: { id: card.id, name: card.name, brand: card.brand, color: card.color, default_pay_account_id: card.default_pay_account_id },
    posted_cents: txs.filter((t) => t.status === 'posted').reduce((a, t) => a + num(t.amount_cents), 0),
    pending_cents: txs.filter((t) => t.status === 'planned').reduce((a, t) => a + num(t.amount_cents), 0),
    transactions,
    payments,
  };
}

const cardBody = z.object({
  client_uuid: zUuid.optional(),
  name: z.string().trim().min(1).max(60),
  brand: z.string().trim().max(30).nullish(),
  closing_day: z.number().int().min(1).max(31),
  due_day: z.number().int().min(1).max(31),
  limit_cents: zCentsOrZero.nullish(),
  default_pay_account_id: zId.nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
});

export function cardsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const where = req.query.archived === '1' ? '' : 'AND archived = 0';
    const cards = await req.ctx.db.all<Card>(`SELECT * FROM credit_cards WHERE household_id = ? AND deleted_at IS NULL ${where} ORDER BY name`, [
      req.ctx.householdId,
    ]);
    res.json(await Promise.all(cards.map((c) => cardSummary(req.ctx, c))));
  });

  /** Totais agregados de todos os cartões ativos. */
  r.get('/summary', async (req, res) => {
    const cards = await req.ctx.db.all<Card>('SELECT * FROM credit_cards WHERE household_id = ? AND deleted_at IS NULL AND archived = 0', [
      req.ctx.householdId,
    ]);
    const list = await Promise.all(cards.map((c) => cardSummary(req.ctx, c)));
    const sum = (f: (c: (typeof list)[number]) => number) => list.reduce((a, c) => a + f(c), 0);
    res.json({
      reference_month: monthOf(req.ctx.today),
      limit_cents: sum((c) => c.limit_cents),
      committed_cents: sum((c) => c.committed_cents),
      available_cents: sum((c) => c.available_cents),
      posted_cents: sum((c) => c.posted_cents),
      pending_cents: sum((c) => c.pending_cents),
      invoice_total_cents: sum((c) => c.current_invoice?.total_cents ?? 0),
      credit_cents: sum((c) => c.credit_cents),
    });
  });

  r.post('/', async (req, res) => {
    const body = parse(cardBody, req.body);
    const existing = await findByUuid(req.ctx, 'credit_cards', body.client_uuid);
    if (existing) return void res.json(existing);
    if (body.default_pay_account_id) await owned(req.ctx, 'accounts', body.default_pay_account_id, 'Conta');
    const now = nowIso();
    const id = await insert(req.ctx.db, 'credit_cards', {
      client_uuid: body.client_uuid ?? newUuid(),
      household_id: req.ctx.householdId,
      name: body.name,
      brand: body.brand ?? null,
      closing_day: body.closing_day,
      due_day: body.due_day,
      limit_cents: body.limit_cents ?? null,
      default_pay_account_id: body.default_pay_account_id ?? null,
      color: body.color ?? null,
      created_at: now,
      updated_at: now,
    });
    res.status(201).json(await cardSummary(req.ctx, await loadCard(req.ctx, id)));
  });

  r.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    await loadCard(req.ctx, id);
    const body = parse(cardBody.partial().omit({ client_uuid: true }).extend({ archived: zFlag.optional() }), req.body);
    if (body.archived !== undefined) requireAdmin(req.ctx);
    if (body.default_pay_account_id) await owned(req.ctx, 'accounts', body.default_pay_account_id, 'Conta');
    await update(req.ctx.db, 'credit_cards', id, { ...body, updated_at: nowIso() });
    res.json(await cardSummary(req.ctx, await loadCard(req.ctx, id)));
  });

  /** Cartão com histórico é arquivado; sem histórico, excluído logicamente. */
  r.delete('/:id', async (req, res) => {
    requireAdmin(req.ctx);
    const id = idParam(req.params.id);
    await loadCard(req.ctx, id);
    const used = await req.ctx.db.get('SELECT id FROM transactions WHERE card_id = ? LIMIT 1', [id]);
    const now = nowIso();
    await update(req.ctx.db, 'credit_cards', id, used ? { archived: 1, updated_at: now } : { deleted_at: now, updated_at: now });
    res.json({ archived: Boolean(used), deleted: !used });
  });

  /** Fatura do mês de cada cartão ativo, sem criar faturas vazias. */
  r.get('/month/:month', async (req, res) => {
    const month = parse(zMonth, req.params.month);
    const cards = await req.ctx.db.all<Card>('SELECT * FROM credit_cards WHERE household_id = ? AND deleted_at IS NULL AND archived = 0 ORDER BY name', [
      req.ctx.householdId,
    ]);
    const out = [];
    for (const card of cards) out.push({ card_id: Number(card.id), invoice: (await invoiceWindow(req.ctx, card, month, month))[0] });
    res.json(out);
  });

  /** Faturas de uma janela de meses; meses sem fatura aparecem zerados. */
  r.get('/:id/invoices', async (req, res) => {
    const card = await loadCard(req.ctx, idParam(req.params.id));
    const month = monthOf(req.ctx.today);
    const from = parse(zMonth.optional(), req.query.from) ?? addMonths(month, -1);
    const to = parse(zMonth.optional(), req.query.to) ?? addMonths(month, 3);
    res.json(await invoiceWindow(req.ctx, card, from, to));
  });

  /** Localiza (ou cria) a fatura de um mês para permitir pagamento antecipado. */
  r.get('/:id/invoices/:month', async (req, res) => {
    const card = await loadCard(req.ctx, idParam(req.params.id));
    const month = parse(zMonth, req.params.month);
    const invoiceId = await ensureInvoice(req.ctx.db, card, month);
    res.json(await invoiceDetail(req.ctx, invoiceId));
  });

  return r;
}

export function invoicesRouter(): Router {
  const r = Router();

  r.get('/:id', async (req, res) => {
    res.json(await invoiceDetail(req.ctx, idParam(req.params.id)));
  });

  r.get('/:id/payments', async (req, res) => {
    const id = idParam(req.params.id);
    await invoiceWithCard(req.ctx, id);
    res.json(
      await req.ctx.db.all(
        `SELECT p.*, a.name AS account_name FROM invoice_payments p JOIN accounts a ON a.id = p.account_id
          WHERE p.invoice_id = ? AND p.deleted_at IS NULL ORDER BY p.paid_on, p.id`,
        [id],
      ),
    );
  });

  /**
   * Pagamento é saída de caixa da conta. As compras continuam sendo as
   * despesas originais; nenhuma despesa nova é criada aqui.
   */
  r.post('/:id/payments', async (req, res) => {
    const id = idParam(req.params.id);
    const inv = await invoiceWithCard(req.ctx, id);
    const card = await loadCard(req.ctx, inv.card_id);
    const body = parse(
      z.object({ client_uuid: zUuid.optional(), amount_cents: zCents.optional(), account_id: zId.optional(), paid_on: zDate.optional() }),
      req.body,
    );
    const existing = body.client_uuid
      ? await req.ctx.db.get('SELECT * FROM invoice_payments WHERE client_uuid = ? AND invoice_id = ?', [body.client_uuid, id])
      : undefined;
    if (existing) return void res.json(existing);
    const accountId = body.account_id ?? card.default_pay_account_id;
    if (!accountId) throw badRequest('Escolha a conta de onde sai o pagamento');
    await owned(req.ctx, 'accounts', accountId, 'Conta');
    const balance = (await cardInvoiceBalances(req.ctx, card.id)).find((b) => b.id === id)!;
    const amount = body.amount_cents ?? balance.remaining_cents;
    if (!amount || amount <= 0) throw badRequest('Esta fatura não tem saldo a pagar; informe o valor do pagamento antecipado');
    const now = nowIso();
    const paymentId = await insert(req.ctx.db, 'invoice_payments', {
      client_uuid: body.client_uuid ?? newUuid(),
      invoice_id: id,
      account_id: accountId,
      amount_cents: amount,
      paid_on: body.paid_on ?? req.ctx.today,
      created_by: req.ctx.userId,
      created_at: now,
      updated_at: now,
    });
    const settled = (await cardInvoiceBalances(req.ctx, card.id)).find((b) => b.id === id)!;
    // Quitar a fatura lança tudo que está nela. Pagamento parcial só confirma o que já venceu.
    await req.ctx.db.run(
      settled.remaining_cents <= 0
        ? `UPDATE transactions SET status = 'posted', updated_at = ? WHERE invoice_id = ? AND status = 'planned' AND deleted_at IS NULL`
        : `UPDATE transactions SET status = 'posted', updated_at = ? WHERE invoice_id = ? AND status = 'planned' AND occurred_on <= ? AND deleted_at IS NULL`,
      settled.remaining_cents <= 0 ? [now, id] : [now, id, req.ctx.today],
    );
    res.status(201).json({ id: paymentId, invoice: await invoiceDetail(req.ctx, id) });
  });

  /**
   * Corrige só o que não é parcela. O valor informado é o restante da fatura
   * (avulsas, fixas e o ajuste). Parcelas ficam como estão.
   */
  r.post('/:id/adjust', async (req, res) => {
    const id = idParam(req.params.id);
    const inv = await invoiceWithCard(req.ctx, id);
    const body = parse(z.object({ loose_cents: z.number().int() }), req.body);
    const now = nowIso();
    await req.ctx.db.run(
      `UPDATE transactions SET deleted_at = ?, updated_at = ?
        WHERE invoice_id = ? AND deleted_at IS NULL AND plan_id IS NULL AND recurrence_id IS NULL AND description = 'Ajuste de fatura'`,
      [now, now, id],
    );
    const row = await req.ctx.db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN plan_id IS NULL THEN amount_cents ELSE 0 END), 0) AS loose
         FROM transactions WHERE invoice_id = ? AND deleted_at IS NULL`,
      [id],
    );
    await update(req.ctx.db, 'invoices', id, { adjustment_cents: body.loose_cents - num(row.loose), updated_at: now });
    res.json(await invoiceDetail(req.ctx, id));
  });

  return r;
}

export function invoicePaymentsRouter(): Router {
  const r = Router();
  r.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const row = await req.ctx.db.get(
      `SELECT p.id, p.invoice_id FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id JOIN credit_cards c ON c.id = i.card_id
        WHERE p.id = ? AND c.household_id = ? AND p.deleted_at IS NULL`,
      [id, req.ctx.householdId],
    );
    if (!row) throw notFound('Pagamento');
    const now = nowIso();
    await update(req.ctx.db, 'invoice_payments', id, { deleted_at: now, updated_at: now });
    res.json(await invoiceDetail(req.ctx, row.invoice_id));
  });
  return r;
}
