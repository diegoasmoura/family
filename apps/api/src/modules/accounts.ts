import { Router } from 'express';
import { z } from 'zod';
import { currentBalance, forecastBalance, lastDayOfMonth, monthOf, type Movement } from '@fin/domain';
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
  requireAdmin,
  update,
  zCents,
  zDate,
  zFlag,
  zId,
  zMonth,
  zUuid,
  type Ctx,
} from '../core';
import { cardInvoiceBalances, type Card } from './cards';

const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'wallet', 'investment'] as const;

interface AccountRow {
  id: number;
  name: string;
  type: string;
  initial_balance_cents: number;
  initial_balance_on: string;
  archived: number;
}

/** Movimentos de caixa de todas as contas do household, já com sinal. */
async function loadMovements(ctx: Ctx) {
  const db = ctx.db;
  const hid = ctx.householdId;
  const byAccount = new Map<number, Movement[]>();
  const push = (accountId: number, m: Movement) => {
    const list = byAccount.get(accountId) ?? [];
    list.push(m);
    byAccount.set(accountId, list);
  };

  const txs = await db.all(
    `SELECT account_id, kind, amount_cents, status, paid_on, due_on, occurred_on FROM transactions
      WHERE household_id = ? AND account_id IS NOT NULL AND deleted_at IS NULL`,
    [hid],
  );
  for (const t of txs) {
    const sign = t.kind === 'income' ? 1 : -1;
    push(t.account_id, {
      date: t.paid_on ?? t.due_on ?? t.occurred_on,
      signed_cents: sign * num(t.amount_cents),
      realized: t.status === 'posted',
      source: t.kind,
    });
  }

  const payments = await db.all(
    `SELECT p.account_id, p.amount_cents, p.paid_on FROM invoice_payments p
       JOIN invoices i ON i.id = p.invoice_id JOIN credit_cards c ON c.id = i.card_id
      WHERE c.household_id = ? AND p.deleted_at IS NULL`,
    [hid],
  );
  for (const p of payments) push(p.account_id, { date: p.paid_on, signed_cents: -num(p.amount_cents), realized: true, source: 'invoice_payment' });

  const transfers = await db.all('SELECT from_account_id, to_account_id, amount_cents, occurred_on FROM transfers WHERE household_id = ? AND deleted_at IS NULL', [hid]);
  for (const t of transfers) {
    push(t.from_account_id, { date: t.occurred_on, signed_cents: -num(t.amount_cents), realized: true, source: 'transfer_out' });
    push(t.to_account_id, { date: t.occurred_on, signed_cents: num(t.amount_cents), realized: true, source: 'transfer_in' });
  }

  // Faturas ainda a pagar saem, no previsto, da conta padrão do cartão.
  const cards = await db.all<Card>('SELECT * FROM credit_cards WHERE household_id = ? AND deleted_at IS NULL', [hid]);
  const unassigned: Movement[] = [];
  for (const card of cards) {
    for (const b of await cardInvoiceBalances(ctx, card.id)) {
      if (b.remaining_cents <= 0) continue;
      const m: Movement = { date: b.due_date, signed_cents: -b.remaining_cents, realized: false, source: 'invoice_due' };
      if (card.default_pay_account_id) push(card.default_pay_account_id, m);
      else unassigned.push(m);
    }
  }
  return { byAccount, unassigned };
}

/** Saldo atual e previsto por conta e do household até o fim de `month`. */
export async function balances(ctx: Ctx, month = monthOf(ctx.today)) {
  const accounts = await ctx.db.all<AccountRow>('SELECT * FROM accounts WHERE household_id = ? AND deleted_at IS NULL ORDER BY archived, name', [
    ctx.householdId,
  ]);
  const { byAccount, unassigned } = await loadMovements(ctx);
  const horizon = lastDayOfMonth(month);
  const list = accounts.map((a) => {
    const opening = { initial_balance_cents: num(a.initial_balance_cents), initial_balance_on: a.initial_balance_on };
    const movements = byAccount.get(a.id) ?? [];
    return {
      ...a,
      current_balance_cents: currentBalance(opening, movements, ctx.today),
      forecast_balance_cents: forecastBalance(opening, movements, ctx.today, horizon),
    };
  });
  const unassignedDue = unassigned.filter((m) => m.date <= horizon).reduce((acc, m) => acc + m.signed_cents, 0);
  return {
    month,
    accounts: list,
    current_cents: list.reduce((acc, a) => acc + a.current_balance_cents, 0),
    forecast_cents: list.reduce((acc, a) => acc + a.forecast_balance_cents, 0) + unassignedDue,
  };
}

const accountBody = z.object({
  client_uuid: zUuid.optional(),
  name: z.string().trim().min(1).max(60),
  type: z.enum(ACCOUNT_TYPES),
  initial_balance_cents: z.number().int().default(0),
  initial_balance_on: zDate.optional(),
});

export function accountsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const month = parse(zMonth.optional(), req.query.month);
    const result = await balances(req.ctx, month);
    if (req.query.archived !== '1') result.accounts = result.accounts.filter((a) => !a.archived);
    res.json(result);
  });

  r.get('/:id/balance', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'accounts', id, 'Conta');
    const month = parse(zMonth.optional(), req.query.month);
    const all = await balances(req.ctx, month);
    res.json(all.accounts.find((a) => a.id === id));
  });

  r.post('/', async (req, res) => {
    const body = parse(accountBody, req.body);
    const existing = await findByUuid(req.ctx, 'accounts', body.client_uuid);
    if (existing) return void res.json(existing);
    const now = nowIso();
    const id = await insert(req.ctx.db, 'accounts', {
      client_uuid: body.client_uuid ?? newUuid(),
      household_id: req.ctx.householdId,
      name: body.name,
      type: body.type,
      initial_balance_cents: body.initial_balance_cents,
      initial_balance_on: body.initial_balance_on ?? req.ctx.today,
      created_at: now,
      updated_at: now,
    });
    res.status(201).json(await req.ctx.db.get('SELECT * FROM accounts WHERE id = ?', [id]));
  });

  r.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'accounts', id, 'Conta');
    const body = parse(accountBody.partial().omit({ client_uuid: true }).extend({ archived: zFlag.optional() }), req.body);
    if (body.archived !== undefined) requireAdmin(req.ctx);
    await update(req.ctx.db, 'accounts', id, { ...body, updated_at: nowIso() });
    res.json(await req.ctx.db.get('SELECT * FROM accounts WHERE id = ?', [id]));
  });

  /** Conta com histórico é arquivada; sem histórico, excluída logicamente. */
  r.delete('/:id', async (req, res) => {
    requireAdmin(req.ctx);
    const id = idParam(req.params.id);
    await owned(req.ctx, 'accounts', id, 'Conta');
    const used = await req.ctx.db.get(
      `SELECT 1 AS u FROM transactions WHERE account_id = ?
       UNION ALL SELECT 1 FROM transfers WHERE from_account_id = ? OR to_account_id = ?
       UNION ALL SELECT 1 FROM invoice_payments WHERE account_id = ?`,
      [id, id, id, id],
    );
    const now = nowIso();
    await update(req.ctx.db, 'accounts', id, used ? { archived: 1, updated_at: now } : { deleted_at: now, updated_at: now });
    res.json({ archived: Boolean(used), deleted: !used });
  });

  return r;
}

export function transfersRouter(): Router {
  const r = Router();
  const select = `SELECT t.*, fa.name AS from_account_name, ta.name AS to_account_name FROM transfers t
                    JOIN accounts fa ON fa.id = t.from_account_id JOIN accounts ta ON ta.id = t.to_account_id`;

  r.get('/', async (req, res) => {
    const month = parse(zMonth.optional(), req.query.month) ?? monthOf(req.ctx.today);
    res.json(
      await req.ctx.db.all(
        `${select} WHERE t.household_id = ? AND t.deleted_at IS NULL AND t.occurred_on >= ? AND t.occurred_on <= ? ORDER BY t.occurred_on DESC, t.id DESC`,
        [req.ctx.householdId, `${month}-01`, `${month}-31`],
      ),
    );
  });

  /** Transferência só desloca dinheiro: não é receita nem despesa. */
  r.post('/', async (req, res) => {
    const body = parse(
      z.object({
        client_uuid: zUuid.optional(),
        from_account_id: zId,
        to_account_id: zId,
        amount_cents: zCents,
        occurred_on: zDate.optional(),
        description: z.string().trim().max(120).optional(),
      }),
      req.body,
    );
    const existing = await findByUuid(req.ctx, 'transfers', body.client_uuid);
    if (existing) return void res.json(existing);
    if (body.from_account_id === body.to_account_id) throw badRequest('Escolha contas diferentes para a transferência');
    await owned(req.ctx, 'accounts', body.from_account_id, 'Conta de origem');
    await owned(req.ctx, 'accounts', body.to_account_id, 'Conta de destino');
    const now = nowIso();
    const id = await insert(req.ctx.db, 'transfers', {
      client_uuid: body.client_uuid ?? newUuid(),
      household_id: req.ctx.householdId,
      from_account_id: body.from_account_id,
      to_account_id: body.to_account_id,
      amount_cents: body.amount_cents,
      occurred_on: body.occurred_on ?? req.ctx.today,
      description: body.description ?? '',
      created_by: req.ctx.userId,
      created_at: now,
      updated_at: now,
    });
    res.status(201).json(await req.ctx.db.get(`${select} WHERE t.id = ?`, [id]));
  });

  r.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'transfers', id, 'Transferência');
    const now = nowIso();
    await update(req.ctx.db, 'transfers', id, { deleted_at: now, updated_at: now });
    res.status(204).end();
  });

  return r;
}
