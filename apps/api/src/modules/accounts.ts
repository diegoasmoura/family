import { Router } from 'express';
import { z } from 'zod';
import { closingAdjustments, currentBalance, forecastBalance, lastDayOfMonth, monthFlow, monthOf, type Movement, type MonthClosing } from '@fin/domain';
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
  const closings = await db.all<{ account_id: number; month: string; closing_cents: number }>(
    `SELECT c.account_id, c.month, c.closing_cents FROM account_month_closings c
       JOIN accounts a ON a.id = c.account_id WHERE a.household_id = ?`,
    [hid],
  );
  return { byAccount, unassigned, closings };
}

/** Saldo atual e previsto por conta e do household até o fim de `month`. */
export async function balances(ctx: Ctx, month = monthOf(ctx.today)) {
  const accounts = await ctx.db.all<AccountRow>('SELECT * FROM accounts WHERE household_id = ? AND deleted_at IS NULL ORDER BY archived, name', [
    ctx.householdId,
  ]);
  const { byAccount, unassigned, closings } = await loadMovements(ctx);
  const horizon = lastDayOfMonth(month);
  const list = accounts.map((a) => {
    const opening = { initial_balance_cents: num(a.initial_balance_cents), initial_balance_on: a.initial_balance_on };
    const own: MonthClosing[] = closings.filter((c) => c.account_id === a.id).map((c) => ({ month: c.month, closing_cents: num(c.closing_cents) }));
    const movements = [...(byAccount.get(a.id) ?? []), ...closingAdjustments(opening, byAccount.get(a.id) ?? [], own, ctx.today)];
    const closing = own.find((c) => c.month === month);
    const mine = byAccount.get(a.id) ?? [];
    return {
      ...a,
      // O que entrou e saiu desta conta no mês, sem carregar o saldo dos meses anteriores.
      month_flow: monthFlow(mine, month),
      current_balance_cents: currentBalance(opening, movements, ctx.today),
      forecast_balance_cents: forecastBalance(opening, movements, ctx.today, horizon),
      month_closing_cents: closing ? closing.closing_cents : null,
    };
  });
  const unassignedDue = unassigned.filter((m) => m.date <= horizon).reduce((acc, m) => acc + m.signed_cents, 0);
  // Total da casa: transferência entre contas não é entrada nem saída; fatura sem conta padrão entra no previsto.
  const all = [...[...byAccount.values()].flat(), ...unassigned];
  return {
    month,
    accounts: list,
    month_flow: monthFlow(all, month, ['transfer_in', 'transfer_out']),
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

/** Quanto existe ligado à conta (o que a exclusão leva junto). */
async function accountImpact(ctx: Ctx, id: number) {
  const count = async (sql: string, params: unknown[]) => num((await ctx.db.get<{ n: number }>(sql, params))?.n ?? 0);
  return {
    transactions: await count('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND deleted_at IS NULL', [id]),
    transfers: await count('SELECT COUNT(*) AS n FROM transfers WHERE (from_account_id = ? OR to_account_id = ?) AND deleted_at IS NULL', [id, id]),
    installment_plans: await count('SELECT COUNT(*) AS n FROM installment_plans WHERE account_id = ? AND deleted_at IS NULL', [id]),
    recurrences: await count('SELECT COUNT(*) AS n FROM recurrences WHERE account_id = ? AND deleted_at IS NULL', [id]),
    invoice_payments: await count('SELECT COUNT(*) AS n FROM invoice_payments WHERE account_id = ? AND deleted_at IS NULL', [id]),
  };
}

export function accountsRouter(): Router {
  const r = Router();

  /** "Recomeçar": o mês escolhido, no máximo o atual (recomeçar no futuro ignoraria o que já aconteceu). */
  const restartDate = (ctx: Ctx, month: string) => {
    if (month > monthOf(ctx.today)) throw badRequest('Escolha o mês atual ou um anterior para recomeçar');
    return `${month}-01`;
  };

  /**
   * Prévia do "Recomeçar do zero": o que fica para trás quando as contas passam a valer a partir do dia 1º do
   * mês. Tudo antes dessa data continua no histórico, mas deixa de contar para o saldo.
   */
  r.get('/restart/preview', async (req, res) => {
    requireAdmin(req.ctx);
    const month = parse(zMonth, req.query.month);
    const date = restartDate(req.ctx, month);
    const { accounts } = await balances(req.ctx, monthOf(req.ctx.today));
    const { byAccount } = await loadMovements(req.ctx);
    const list = accounts
      .filter((a) => !a.archived)
      .map((a) => ({
        id: a.id,
        name: a.name,
        current_balance_cents: a.current_balance_cents,
        // pago ou recebido antes da data: deixa de contar para o saldo
        ignored_movements: (byAccount.get(a.id) ?? []).filter((m) => m.realized && m.date < date && m.date >= a.initial_balance_on).length,
      }));
    const pending = await req.ctx.db.all(
      `SELECT kind, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total FROM transactions
        WHERE household_id = ? AND account_id IS NOT NULL AND status = 'planned' AND deleted_at IS NULL AND COALESCE(due_on, occurred_on) < ?
        GROUP BY kind`,
      [req.ctx.householdId, date],
    );
    const sum = (kind: string) => ({ count: num(pending.find((p) => p.kind === kind)?.n ?? 0), total_cents: num(pending.find((p) => p.kind === kind)?.total ?? 0) });
    const old = await req.ctx.db.all(
      `SELECT kind, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total FROM transactions
        WHERE household_id = ? AND deleted_at IS NULL AND include_in_reports = 1 AND competence_month < ?
        GROUP BY kind`,
      [req.ctx.householdId, month],
    );
    const oldSum = (kind: string) => ({ count: num(old.find((o) => o.kind === kind)?.n ?? 0), total_cents: num(old.find((o) => o.kind === kind)?.total ?? 0) });
    const cards = await req.ctx.db.all<Card>('SELECT * FROM credit_cards WHERE household_id = ? AND deleted_at IS NULL AND archived = 0', [req.ctx.householdId]);
    let invoiceCount = 0;
    let invoiceCents = 0;
    for (const card of cards) {
      for (const b of await cardInvoiceBalances(req.ctx, card.id)) {
        if (b.remaining_cents > 0 && b.due_date < date) {
          invoiceCount += 1;
          invoiceCents += b.remaining_cents;
        }
      }
    }
    res.json({
      month,
      date,
      accounts: list,
      pending_expenses: sum('expense'),
      pending_incomes: sum('income'),
      card_invoices: { count: invoiceCount, remaining_cents: invoiceCents },
      old_in_reports: { expenses: oldSum('expense'), incomes: oldSum('income') },
    });
  });

  /**
   * Recomeçar do zero: cada conta passa a ter o saldo informado no dia 1º do mês. O histórico (lançamentos,
   * relatórios, faturas) não é apagado; só deixa de contar para o saldo. Opcionalmente apaga as contas a pagar e a
   * receber que ficaram em aberto antes dessa data, e/ou tirar dos totais tudo que é de competência anterior (continua
   * na lista). Correções de fim de mês anteriores perdem o sentido e saem.
   */
  r.post('/restart', async (req, res) => {
    requireAdmin(req.ctx);
    const body = parse(
      z.object({
        month: zMonth,
        accounts: z.array(z.object({ id: zId, balance_cents: z.number().int() })).min(1),
        delete_pending: z.boolean().default(false),
        hide_old_from_reports: z.boolean().default(false),
      }),
      req.body,
    );
    const date = restartDate(req.ctx, body.month);
    for (const a of body.accounts) await owned(req.ctx, 'accounts', a.id, 'Conta');
    const now = nowIso();
    let deletedPending = 0;
    let hidden = 0;
    await req.ctx.db.tx(async (db) => {
      for (const a of body.accounts) {
        await update(db, 'accounts', a.id, { initial_balance_cents: a.balance_cents, initial_balance_on: date, updated_at: now });
        await db.run('DELETE FROM account_month_closings WHERE account_id = ? AND month < ?', [a.id, body.month]);
      }
      if (body.delete_pending) {
        const ids = body.accounts.map((a) => a.id);
        const marks = ids.map(() => '?').join(', ');
        const res2 = await db.run(
          `UPDATE transactions SET deleted_at = ?, updated_at = ?
            WHERE household_id = ? AND account_id IN (${marks}) AND status = 'planned' AND deleted_at IS NULL AND COALESCE(due_on, occurred_on) < ?`,
          [now, now, req.ctx.householdId, ...ids, date],
        );
        deletedPending = res2.changes;
      }
      if (body.hide_old_from_reports) {
        // "Contar na soma" desligado: continua na lista e na fatura, mas sai dos totais (Início, Visão anual, orçamento).
        // O saldo das contas e o valor das faturas não olham esse campo, então não mudam.
        const res3 = await db.run(
          `UPDATE transactions SET include_in_reports = 0, updated_at = ?
            WHERE household_id = ? AND deleted_at IS NULL AND include_in_reports = 1 AND competence_month < ?`,
          [now, req.ctx.householdId, body.month],
        );
        hidden = res3.changes;
      }
    });
    res.json({ month: body.month, date, accounts: body.accounts.length, deleted_pending: deletedPending, hidden_from_reports: hidden });
  });

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

  r.put('/:id/closing', async (req, res) => {
    const id = idParam(req.params.id);
    const account = await owned<AccountRow>(req.ctx, 'accounts', id, 'Conta');
    const body = parse(z.object({ month: zMonth, closing_cents: z.number().int() }), req.body);
    if (lastDayOfMonth(body.month) < account.initial_balance_on) throw badRequest('Esse mês é anterior ao saldo inicial da conta');
    const now = nowIso();
    const existing = await req.ctx.db.get<{ id: number }>('SELECT id FROM account_month_closings WHERE account_id = ? AND month = ?', [id, body.month]);
    if (existing) await update(req.ctx.db, 'account_month_closings', existing.id, { closing_cents: body.closing_cents, updated_at: now });
    else {
      await insert(req.ctx.db, 'account_month_closings', {
        account_id: id,
        month: body.month,
        closing_cents: body.closing_cents,
        created_at: now,
        updated_at: now,
      });
    }
    const all = await balances(req.ctx, body.month);
    res.json(all.accounts.find((a) => a.id === id));
  });

  r.delete('/:id/closing', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'accounts', id, 'Conta');
    const month = parse(zMonth, req.query.month);
    const existing = await req.ctx.db.get<{ id: number }>('SELECT id FROM account_month_closings WHERE account_id = ? AND month = ?', [id, month]);
    if (existing) await req.ctx.db.run('DELETE FROM account_month_closings WHERE id = ?', [existing.id]);
    const all = await balances(req.ctx, month);
    res.json(all.accounts.find((a) => a.id === id));
  });

  r.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'accounts', id, 'Conta');
    const body = parse(accountBody.partial().omit({ client_uuid: true }).extend({ archived: zFlag.optional() }), req.body);
    if (body.archived !== undefined) requireAdmin(req.ctx);
    await update(req.ctx.db, 'accounts', id, { ...body, updated_at: nowIso() });
    res.json(await req.ctx.db.get('SELECT * FROM accounts WHERE id = ?', [id]));
  });

  /** O que será apagado junto, para a tela mostrar antes de confirmar. */
  r.get('/:id/impact', async (req, res) => {
    requireAdmin(req.ctx);
    const id = idParam(req.params.id);
    await owned(req.ctx, 'accounts', id, 'Conta');
    res.json(await accountImpact(req.ctx, id));
  });

  /**
   * Excluir apaga de verdade: a conta e tudo que depende dela (lançamentos, transferências,
   * parcelamentos, fixas e pagamentos de fatura feitos por ela; as faturas pagas por ela voltam a
   * ficar em aberto). Exclusão lógica, numa transação só. Para guardar o histórico, arquive (PATCH).
   */
  r.delete('/:id', async (req, res) => {
    requireAdmin(req.ctx);
    const id = idParam(req.params.id);
    await owned(req.ctx, 'accounts', id, 'Conta');
    const removed = await accountImpact(req.ctx, id);
    const now = nowIso();
    await req.ctx.db.tx(async (db) => {
      await db.run('UPDATE invoice_payments SET deleted_at = ?, updated_at = ? WHERE account_id = ? AND deleted_at IS NULL', [now, now, id]);
      await db.run('UPDATE transfers SET deleted_at = ?, updated_at = ? WHERE (from_account_id = ? OR to_account_id = ?) AND deleted_at IS NULL', [now, now, id, id]);
      await db.run('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE account_id = ? AND deleted_at IS NULL', [now, now, id]);
      await db.run('UPDATE installment_plans SET deleted_at = ?, updated_at = ? WHERE account_id = ? AND deleted_at IS NULL', [now, now, id]);
      await db.run('UPDATE recurrences SET deleted_at = ?, updated_at = ? WHERE account_id = ? AND deleted_at IS NULL', [now, now, id]);
      await db.run('DELETE FROM account_month_closings WHERE account_id = ?', [id]);
      await db.run('UPDATE credit_cards SET default_pay_account_id = NULL, updated_at = ? WHERE default_pay_account_id = ?', [now, id]);
      await update(db, 'accounts', id, { deleted_at: now, updated_at: now });
    });
    res.json({ deleted: true, removed });
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
