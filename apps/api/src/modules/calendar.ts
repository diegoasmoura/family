import { Router } from 'express';
import { lastDayOfMonth, monthOf } from '@fin/domain';
import { num, parse, zMonth, type Ctx } from '../core';
import { cardInvoiceBalances, type Card } from './cards';
import { personColor } from './couple';
import { personFilter } from './transactions';

interface CalItem {
  key: string;
  day: string;
  description: string;
  amount_cents: number;
  kind: 'income' | 'expense' | 'invoice';
  status: 'paid' | 'planned';
  who: 'me' | 'other' | 'house';
  for_user_id: number | null;
  tx_id?: number;
  card_id?: number;
  reference_month?: string;
}

function shortText(value: string, fallback: string): string {
  const text = value.trim().slice(0, 80);
  return text || fallback;
}

function whoOf(forUserId: number | null, me: number): CalItem['who'] {
  if (forUserId == null) return 'house';
  return forUserId === me ? 'me' : 'other';
}

async function accountItems(ctx: Ctx, from: string, to: string, personId: number | null): Promise<CalItem[]> {
  const params: unknown[] = [ctx.householdId, from, to];
  if (personId != null) params.push(personId);
  const rows = await ctx.db.all<{
    id: number;
    kind: 'income' | 'expense';
    description: string;
    amount_cents: number;
    day: string;
    paid_on: string | null;
    for_user_id: number | null;
  }>(
    `SELECT id, kind, description, amount_cents, COALESCE(due_on, occurred_on) AS day, paid_on, for_user_id
       FROM transactions
      WHERE household_id = ? AND deleted_at IS NULL AND card_id IS NULL
        AND COALESCE(due_on, occurred_on) BETWEEN ? AND ?
        ${personId == null ? '' : 'AND for_user_id = ?'}
      ORDER BY day, id`,
    params,
  );
  return rows.map((row) => ({
    key: `tx:${row.id}`,
    day: row.day,
    description: shortText(row.description, row.kind === 'income' ? 'Receita' : 'Despesa'),
    amount_cents: num(row.amount_cents),
    kind: row.kind,
    status: row.paid_on ? 'paid' : 'planned',
    who: whoOf(row.for_user_id == null ? null : Number(row.for_user_id), ctx.userId),
    for_user_id: row.for_user_id == null ? null : Number(row.for_user_id),
    tx_id: Number(row.id),
  }));
}

async function invoiceItems(ctx: Ctx, from: string, to: string): Promise<CalItem[]> {
  const cards = await ctx.db.all<Card>(
    'SELECT * FROM credit_cards WHERE household_id = ? AND deleted_at IS NULL AND archived = 0',
    [ctx.householdId],
  );
  const items: CalItem[] = [];
  for (const card of cards) {
    const balances = await cardInvoiceBalances(ctx, card.id);
    for (const balance of balances) {
      if (balance.due_date < from || balance.due_date > to) continue;
      const open = balance.remaining_cents > 0;
      const paid = balance.state === 'paid' && balance.total_cents > 0;
      if (!open && !paid) continue;
      items.push({
        key: `inv:${card.id}:${balance.reference_month}`,
        day: balance.due_date,
        description: shortText(`Fatura ${card.name}`, 'Fatura'),
        amount_cents: open ? balance.remaining_cents : balance.total_cents,
        kind: 'invoice',
        status: open ? 'planned' : 'paid',
        who: 'house',
        for_user_id: null,
        card_id: card.id,
        reference_month: balance.reference_month,
      });
    }
  }
  return items;
}

export function calendarRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const month = parse(zMonth.optional(), req.query.month) ?? monthOf(req.ctx.today);
    const personId = await personFilter(req.ctx, req.query.person);
    const from = `${month}-01`;
    const to = lastDayOfMonth(month);
    const users = await req.ctx.db.all<{ id: number; name: string; avatar: string | null }>(
      'SELECT id, name, avatar FROM users WHERE household_id = ? ORDER BY id',
      [req.ctx.householdId],
    );
    const items = [
      ...(await accountItems(req.ctx, from, to, personId)),
      ...(personId == null ? await invoiceItems(req.ctx, from, to) : []),
    ].sort((a, b) => a.day.localeCompare(b.day) || b.amount_cents - a.amount_cents);

    res.json({
      month,
      people: users.map((user) => ({
        id: Number(user.id),
        name: user.name,
        color: personColor(user.avatar, Number(user.id)),
        me: Number(user.id) === req.ctx.userId,
      })),
      items,
    });
  });

  return r;
}
