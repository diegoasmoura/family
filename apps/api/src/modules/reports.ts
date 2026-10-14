import { Router } from 'express';
import { z } from 'zod';
import { INVOICE_STATE_LABEL, addDays, addMonths, daysInMonth, monthOf, monthRange, yearOf } from '@fin/domain';
import { badRequest, num, parse, zMonth, type Ctx } from '../core';
import { balances } from './accounts';
import { cardInvoiceBalances, relevantInvoice, type Card } from './cards';
import { gamificationSummary, householdAvatars, syncMissions } from './gamification';
import { monthTotals } from './queries';
import { ensureRecurrences } from './recurrences';
import { TX_SELECT, decorateTransactions, personFilter } from './transactions';

interface Row {
  category_id: number | null;
  name: string;
  parent_id: number | null;
  icon: string | null;
  color: string | null;
  months: number[];
  /** Centavos já pagos ou recebidos em cada mês. A célula está quitada quando isto cobre `months`. */
  paid_months: number[];
  total_cents: number;
  /** Banco ou cartão quando todo o valor da linha veio de um só. Vazio quando a linha mistura mais de um. */
  card_name: string | null;
  children?: Row[];
  /** Composição: cada fixa e cada parcelamento numa linha; avulsos agrupados pela descrição. */
  items?: { key: string; name: string; fixed: boolean; card_name: string | null; months: number[]; paid_months: number[]; total_cents: number }[];
}

/** Na conta, pago é `paid_on`. No cartão, pago é a fatura quitada — a mesma conta da lista. */
const PAID_CENTS = `SUM(CASE
        WHEN t.card_id IS NULL AND t.paid_on IS NOT NULL THEN t.amount_cents
        WHEN t.card_id IS NOT NULL AND t.invoice_id IS NOT NULL
             AND COALESCE((SELECT SUM(pmt.amount_cents) FROM invoice_payments pmt WHERE pmt.invoice_id = t.invoice_id AND pmt.deleted_at IS NULL), 0)
                 >= COALESCE((SELECT SUM(x.amount_cents) FROM transactions x WHERE x.invoice_id = t.invoice_id AND x.deleted_at IS NULL), 0)
                    + COALESCE(inv.adjustment_cents, 0)
        THEN t.amount_cents
        ELSE 0 END)`;

const DESC = "COALESCE(NULLIF(TRIM(t.description), ''), '')";

/**
 * Categoria x mês. As filhas aparecem dentro do pai, e o total do pai é a
 * soma dele com as filhas. O total anual é a soma dos meses.
 */
async function yearMatrix(ctx: Ctx, year: number, kind: 'income' | 'expense', mode: 'realized' | 'planned', personId: number | null = null) {
  // No cartão, a compra já nasce efetivada na fatura. Na conta, o que ainda está a pagar também entra no mês do vencimento.
  const statusFilter = mode === 'realized' ? "AND (t.status = 'posted' OR t.card_id IS NULL)" : '';
  const personSql = personId == null ? '' : 'AND t.for_user_id = ?';
  const params: unknown[] = [ctx.householdId, kind, `${year}-01`, `${year}-12`];
  if (personId != null) params.push(personId);
  const rows = await ctx.db.all<{
    category_id: number | null;
    recurrence_id: number | null;
    plan_id: number | null;
    description: string;
    origin_description: string | null;
    day_of_month: number | null;
    installments: number | null;
    card_id: number | null;
    card_name: string | null;
    account_id: number | null;
    account_name: string | null;
    competence_month: string;
    total: number;
    paid: number;
  }>(
    `SELECT t.category_id, t.recurrence_id, t.plan_id, ${DESC} AS description,
            COALESCE(r.description, p.description) AS origin_description, r.day_of_month, p.installments,
            t.card_id, cc.name AS card_name, t.account_id, ac.name AS account_name,
            t.competence_month, SUM(t.amount_cents) AS total, ${PAID_CENTS} AS paid
       FROM transactions t
       LEFT JOIN recurrences r ON r.id = t.recurrence_id
       LEFT JOIN installment_plans p ON p.id = t.plan_id
       LEFT JOIN credit_cards cc ON cc.id = t.card_id
       LEFT JOIN accounts ac ON ac.id = t.account_id
       LEFT JOIN invoices inv ON inv.id = t.invoice_id
      WHERE t.household_id = ? AND t.kind = ? AND t.deleted_at IS NULL AND t.include_in_reports = 1
        AND t.competence_month >= ? AND t.competence_month <= ? ${statusFilter} ${personSql}
      GROUP BY t.category_id, t.recurrence_id, t.plan_id, ${DESC}, r.description, p.description, r.day_of_month, p.installments, t.card_id, cc.name, t.account_id, ac.name, t.competence_month`,
    params,
  );

  const zeros = () => Array(12).fill(0) as number[];
  // Cada fixa e cada parcelamento é uma linha; avulsos se juntam pela descrição e pelo banco.
  type Item = { key: string; base: string; day: number | null; installments: number | null; months: number[]; paid: number[]; places: Set<string> };
  const items = new Map<number | null, Map<string, Item>>();
  const origin = new Map<number | null, Set<string>>();
  const placeOf = (r: { card_id: number | null; card_name: string | null; account_name: string | null }) =>
    (r.card_id != null ? r.card_name : r.account_name)?.trim() || null;
  const noteOrigin = (id: number | null, place: string | null) => {
    const places = origin.get(id) ?? new Set<string>();
    if (place) places.add(place);
    origin.set(id, places);
  };
  for (const r of rows) {
    const cat = r.category_id == null ? null : Number(r.category_id);
    const cardId = r.card_id == null ? null : Number(r.card_id);
    const accountId = r.account_id == null ? null : Number(r.account_id);
    const place = placeOf(r);
    noteOrigin(cat, place);
    const byKey = items.get(cat) ?? new Map<string, Item>();
    const key = r.recurrence_id
      ? `r${r.recurrence_id}`
      : r.plan_id
        ? `p${r.plan_id}`
        : cardId
          ? `d:${r.description}::c${cardId}`
          : accountId
            ? `d:${r.description}::a${accountId}`
            : `d:${r.description}`;
    const item = byKey.get(key) ?? {
      key,
      base: (r.recurrence_id || r.plan_id ? r.origin_description?.trim() : '') || r.description || 'Sem descrição',
      day: r.recurrence_id ? Number(r.day_of_month) : null,
      installments: r.plan_id ? Number(r.installments) : null,
      months: zeros(),
      paid: zeros(),
      places: new Set<string>(),
    };
    if (place) item.places.add(place);
    const monthIdx = Number(r.competence_month.slice(5, 7)) - 1;
    item.months[monthIdx] += num(r.total);
    item.paid[monthIdx] += num(r.paid);
    byKey.set(key, item);
    items.set(cat, byKey);
  }
  const placeLabel = (places: Set<string>) => (places.size === 1 ? [...places][0] : null);
  const cardOf = (ids: (number | null)[]) => {
    const places = new Set<string>();
    for (const id of ids) {
      const named = origin.get(id);
      if (!named) continue;
      for (const name of named) places.add(name);
    }
    return placeLabel(places);
  };
  const itemsOf = (id: number | null) => {
    const list = [...(items.get(id)?.values() ?? [])];
    const count = new Map<string, number>();
    for (const it of list) count.set(it.base, (count.get(it.base) ?? 0) + 1);
    return list
      .map((it) => {
        let name = it.base;
        if (it.installments) name = `${it.base} · ${it.installments}x`;
        else if (it.day && count.get(it.base)! > 1) name = `${it.base} · dia ${it.day}`;
        else if (!it.day && count.get(it.base)! > 1) name = `${it.base} · avulsos`;
        return { key: it.key, name, fixed: Boolean(it.day), card_name: placeLabel(it.places), months: it.months, paid_months: it.paid, total_cents: it.months.reduce((a, v) => a + v, 0) };
      })
      .sort((a, b) => b.total_cents - a.total_cents || a.name.localeCompare(b.name));
  };
  const cats = await ctx.db.all<{ id: number; name: string; parent_id: number | null; icon: string | null; color: string | null; sort_order: number }>(
    'SELECT id, name, parent_id, icon, color, sort_order FROM categories WHERE household_id = ? AND kind = ? ORDER BY sort_order, name',
    [ctx.householdId, kind],
  );
  const own = new Map<number | null, number[]>();
  const ownPaid = new Map<number | null, number[]>();
  for (const r of rows) {
    const key = r.category_id == null ? null : Number(r.category_id);
    const arr = own.get(key) ?? zeros();
    const paidArr = ownPaid.get(key) ?? zeros();
    const monthIdx = Number(r.competence_month.slice(5, 7)) - 1;
    arr[monthIdx] += num(r.total);
    paidArr[monthIdx] += num(r.paid);
    own.set(key, arr);
    ownPaid.set(key, paidArr);
  }
  const sumArr = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const mk = (id: number | null, name: string, parent: number | null, months: number[], paidMonths: number[], scope: (number | null)[], withItems = false): Row => ({
    category_id: id,
    name,
    parent_id: parent,
    icon: id == null ? null : (catById.get(id)?.icon ?? null),
    color: id == null ? null : (catById.get(id)?.color ?? (parent == null ? null : (catById.get(parent)?.color ?? null))),
    months,
    paid_months: paidMonths,
    total_cents: months.reduce((a, v) => a + v, 0),
    card_name: cardOf(scope),
    ...(withItems ? { items: itemsOf(id) } : {}),
  });

  const out: Row[] = [];
  for (const parent of cats.filter((c) => c.parent_id == null)) {
    const children = cats
      .filter((c) => c.parent_id === parent.id && own.has(c.id))
      .map((c) => mk(c.id, c.name, parent.id, own.get(c.id)!, ownPaid.get(c.id)!, [c.id], true));
    const ownMonths = own.get(parent.id) ?? zeros();
    const ownPaidMonths = ownPaid.get(parent.id) ?? zeros();
    if (!children.length && !own.has(parent.id)) continue;
    const months = children.reduce((acc, c) => sumArr(acc, c.months), ownMonths);
    const paidMonths = children.reduce((acc, c) => sumArr(acc, c.paid_months), ownPaidMonths);
    const scope = [parent.id, ...children.map((c) => c.category_id)];
    const row = mk(parent.id, parent.name, null, months, paidMonths, scope, !children.length);
    if (children.length) row.children = own.has(parent.id) ? [mk(parent.id, `${parent.name} (geral)`, parent.id, ownMonths, ownPaidMonths, [parent.id], true), ...children] : children;
    out.push(row);
  }
  if (own.has(null)) out.push(mk(null, 'Sem categoria', null, own.get(null)!, ownPaid.get(null)!, [null], true));
  const totals = out.reduce((acc, r) => sumArr(acc, r.months), zeros());
  const paidTotals = out.reduce((acc, r) => sumArr(acc, r.paid_months), zeros());
  return { rows: out, months: totals, paid_months: paidTotals, total_cents: totals.reduce((a, v) => a + v, 0) };
}

export function reportsRouter(): Router {
  const r = Router();

  r.get('/year', async (req, res) => {
    const year = parse(z.coerce.number().int().min(2000).max(2100).optional(), req.query.year) ?? yearOf(req.ctx.today);
    const mode = parse(z.enum(['realized', 'planned']).default('realized'), req.query.mode);
    const personId = await personFilter(req.ctx, req.query.person);
    if (year >= yearOf(req.ctx.today)) await ensureRecurrences(req.ctx, `${year}-12`);
    const income = await yearMatrix(req.ctx, year, 'income', mode, personId);
    const expense = await yearMatrix(req.ctx, year, 'expense', mode, personId);
    const balance = income.months.map((v, i) => v - expense.months[i]);
    res.json({
      year,
      mode,
      current_month: monthOf(req.ctx.today),
      months: monthRange(`${year}-01`, `${year}-12`),
      income,
      expense,
      balance: { months: balance, total_cents: income.total_cents - expense.total_cents },
    });
  });

  /** Lançamentos por trás de uma célula da visão anual (para auditar o número). */
  r.get('/year/transactions', async (req, res) => {
    const q = parse(
      z.object({
        year: z.coerce.number().int().min(2000).max(2100),
        mode: z.enum(['realized', 'planned']).default('realized'),
        kind: z.enum(['income', 'expense']),
        month: z.coerce.number().int().min(1).max(12).optional(),
        category: z.union([z.literal('none'), z.coerce.number().int().positive()]).optional(),
        tree: z.enum(['0', '1']).default('0'),
        item: z.string().max(200).optional(),
      }),
      req.query,
    );
    const where = ['t.household_id = ?', 't.kind = ?', 't.deleted_at IS NULL', 't.include_in_reports = 1'];
    const params: unknown[] = [req.ctx.householdId, q.kind];
    if (q.month) {
      where.push('t.competence_month = ?');
      params.push(`${q.year}-${String(q.month).padStart(2, '0')}`);
    } else {
      where.push('t.competence_month >= ? AND t.competence_month <= ?');
      params.push(`${q.year}-01`, `${q.year}-12`);
    }
    if (q.mode === 'realized') where.push("(t.status = 'posted' OR t.card_id IS NULL)");
    const personId = await personFilter(req.ctx, req.query.person);
    if (personId != null) {
      where.push('t.for_user_id = ?');
      params.push(personId);
    }
    if (q.category === 'none') where.push('t.category_id IS NULL');
    else if (q.category != null && q.tree === '1') {
      where.push('(t.category_id = ? OR c.parent_id = ?)');
      params.push(q.category, q.category);
    } else if (q.category != null) {
      where.push('t.category_id = ?');
      params.push(q.category);
    }
    if (q.item?.startsWith('r')) {
      where.push('t.recurrence_id = ?');
      params.push(Number(q.item.slice(1)));
    } else if (q.item?.startsWith('p')) {
      where.push('t.plan_id = ?');
      params.push(Number(q.item.slice(1)));
    } else if (q.item?.startsWith('d:')) {
      const card = q.item.match(/::c(\d+)$/);
      const account = q.item.match(/::a(\d+)$/);
      const suffix = card?.[0] ?? account?.[0] ?? '';
      const description = q.item.slice(2, q.item.length - suffix.length);
      where.push(`t.recurrence_id IS NULL AND t.plan_id IS NULL AND ${DESC} = ?`);
      params.push(description);
      if (card) {
        where.push('t.card_id = ?');
        params.push(Number(card[1]));
      } else if (account) {
        where.push('t.card_id IS NULL AND t.account_id = ?');
        params.push(Number(account[1]));
      } else where.push('t.card_id IS NULL');
    }
    const rows = await req.ctx.db.all(
      `${TX_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.competence_month, COALESCE(t.due_on, t.occurred_on), t.id`,
      params,
    );
    const transactions = decorateTransactions(rows, req.ctx.today);
    res.json({ transactions, total_cents: transactions.reduce((a, t) => a + t.amount_cents, 0) });
  });

  return r;
}

export function dashboardRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const ctx = req.ctx;
    const month = parse(zMonth.optional(), req.query.month) ?? monthOf(ctx.today);
    const personId = await personFilter(ctx, req.query.person);
    if (month > `${yearOf(ctx.today) + 5}-12`) throw badRequest('Mês muito distante');
    await ensureRecurrences(ctx, month);

    const totals = await monthTotals(ctx, month, personId);
    const bal = await balances(ctx, month);
    const catParams: unknown[] = [ctx.householdId, month];
    if (personId != null) catParams.push(personId);

    const catRows = await ctx.db.all(
      `SELECT COALESCE(c.parent_id, c.id) AS id, SUM(t.amount_cents) AS total FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.household_id = ? AND t.competence_month = ? AND t.kind = 'expense' AND t.include_in_reports = 1 AND t.deleted_at IS NULL
          ${personId == null ? '' : 'AND t.for_user_id = ?'}
        GROUP BY COALESCE(c.parent_id, c.id) ORDER BY total DESC`,
      catParams,
    );
    const names = new Map(
      (await ctx.db.all('SELECT id, name, color FROM categories WHERE household_id = ?', [ctx.householdId])).map((c) => [Number(c.id), c]),
    );
    const categories = catRows.map((c) => ({
      category_id: c.id == null ? null : Number(c.id),
      name: c.id == null ? 'Sem categoria' : names.get(Number(c.id))?.name,
      color: c.id == null ? null : names.get(Number(c.id))?.color,
      total_cents: num(c.total),
    }));

    const rhythm = await ctx.db.get(
      `SELECT
         SUM(CASE WHEN plan_id IS NOT NULL THEN amount_cents ELSE 0 END) AS installment_cents,
         SUM(CASE WHEN plan_id IS NULL AND recurrence_id IS NOT NULL THEN amount_cents ELSE 0 END) AS fixed_cents,
         SUM(CASE WHEN plan_id IS NULL AND recurrence_id IS NULL THEN amount_cents ELSE 0 END) AS variable_cents
       FROM transactions
       WHERE household_id = ? AND competence_month = ? AND kind = 'expense' AND include_in_reports = 1 AND deleted_at IS NULL
         ${personId == null ? '' : 'AND for_user_id = ?'}`,
      catParams,
    );
    const recurrence = [
      { key: 'fixed', name: 'Fixas', color: '#6aa4e0', total_cents: num(rhythm?.fixed_cents) },
      { key: 'installment', name: 'Parceladas', color: '#e6c15a', total_cents: num(rhythm?.installment_cents) },
      { key: 'variable', name: 'Variáveis', color: '#e08b84', total_cents: num(rhythm?.variable_cents) },
    ];

    const cards = await ctx.db.all<Card>('SELECT * FROM credit_cards WHERE household_id = ? AND deleted_at IS NULL AND archived = 0 ORDER BY name', [
      ctx.householdId,
    ]);
    let invoice = null;
    let invoicesDueInMonth = 0;
    for (const card of cards) {
      const all = await cardInvoiceBalances(ctx, card.id);
      invoicesDueInMonth += all.filter((i) => i.reference_month === month).reduce((a, i) => a + i.remaining_cents, 0);
      const b = relevantInvoice(all);
      if (!b) continue;
      const candidate = { ...b, card_id: card.id, card_name: card.name, state_label: INVOICE_STATE_LABEL[b.state] };
      if (!invoice || (candidate.remaining_cents > 0 && candidate.due_date < invoice.due_date) || invoice.remaining_cents === 0) invoice = candidate;
    }

    const horizon = addDays(ctx.today, 30);
    const upcomingParams: unknown[] = [ctx.householdId, horizon];
    if (personId != null) upcomingParams.push(personId);
    const upcomingTx = await ctx.db.all(
      `SELECT t.id, t.kind, t.description, t.amount_cents, COALESCE(t.due_on, t.occurred_on) AS due_on, t.installment_no, p.installments AS plan_installments,
              c.name AS category_name, c.icon AS category_icon, COALESCE(c.color, pc.color) AS category_color, c.parent_id AS category_parent_id
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN categories pc ON pc.id = c.parent_id
         LEFT JOIN installment_plans p ON p.id = t.plan_id
        WHERE t.household_id = ? AND t.status = 'planned' AND t.card_id IS NULL AND t.deleted_at IS NULL
          AND COALESCE(t.due_on, t.occurred_on) <= ?
          ${personId == null ? '' : 'AND t.for_user_id = ?'}
        ORDER BY COALESCE(t.due_on, t.occurred_on), t.id LIMIT 8`,
      upcomingParams,
    );
    const upcomingInvoices = [];
    for (const card of cards) {
      for (const b of await cardInvoiceBalances(ctx, card.id)) {
        if (b.remaining_cents > 0 && b.due_date <= horizon) {
          upcomingInvoices.push({
            type: 'invoice',
            id: b.id,
            card_id: card.id,
            card_name: card.name,
            reference_month: b.reference_month,
            kind: 'expense',
            description: `Fatura ${card.name}`,
            amount_cents: b.remaining_cents,
            due_on: b.due_date,
          });
        }
      }
    }
    const upcoming = [
      ...upcomingTx.map((t) => ({
        type: 'tx',
        ...t,
        id: Number(t.id),
        amount_cents: num(t.amount_cents),
        description: t.description || (t.kind === 'income' ? 'Receita' : 'Despesa'),
        installment_label: t.installment_no && t.plan_installments ? `${t.installment_no}/${t.plan_installments}` : null,
      })),
      ...upcomingInvoices,
    ]
      .map((u) => ({ ...u, overdue: u.due_on < ctx.today }))
      .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.description.localeCompare(b.description));
    const futureParams: unknown[] = [ctx.householdId, month];
    if (personId != null) futureParams.push(personId);
    const futureInstallments = await ctx.db.get(
      `SELECT SUM(amount_cents) AS total FROM transactions
        WHERE household_id = ? AND kind = 'expense' AND plan_id IS NOT NULL AND deleted_at IS NULL
          AND include_in_reports = 1 AND competence_month > ?
          ${personId == null ? '' : 'AND for_user_id = ?'}`,
      futureParams,
    );

    const goals = await ctx.db.all(
      'SELECT id, name, target_cents, saved_cents, deadline FROM goals WHERE household_id = ? AND deleted_at IS NULL AND completed_at IS NULL ORDER BY deadline, id LIMIT 3',
      [ctx.householdId],
    );

    const series = async (target: string) => {
      const params: unknown[] = [ctx.householdId, target];
      if (personId != null) params.push(personId);
      const rows = await ctx.db.all(
        `SELECT t.amount_cents, COALESCE(t.due_on, t.occurred_on) AS date
           FROM transactions t
          WHERE t.household_id = ? AND t.kind = 'expense' AND t.include_in_reports = 1 AND t.deleted_at IS NULL
            AND substr(COALESCE(t.due_on, t.occurred_on), 1, 7) = ?
            ${personId == null ? 'AND t.card_id IS NULL' : 'AND t.for_user_id = ?'}`,
        params,
      );
      const byDay = Array.from({ length: daysInMonth(target) }, () => 0);
      for (const row of rows) {
        const date = String(row.date ?? '');
        const index = Number(date.slice(8, 10)) - 1;
        if (index >= 0 && index < byDay.length) byDay[index] += num(row.amount_cents);
      }
      let run = 0;
      return byDay.map((value) => {
        run += value;
        return run;
      });
    };
    const evolution = { current: await series(month), previous: await series(addMonths(month, -1)) };

    res.json({
      month,
      today: ctx.today,
      balance: { current_cents: bal.current_cents, forecast_cents: bal.forecast_cents },
      income: { realized_cents: totals.income_posted, planned_cents: totals.income_planned, total_cents: totals.income_posted + totals.income_planned },
      expense: {
        realized_cents: totals.expense_posted,
        planned_cents: totals.expense_planned,
        total_cents: totals.expense_posted + totals.expense_planned,
        to_pay_cents: totals.expense_planned + (personId == null ? invoicesDueInMonth : 0),
      },
      result_cents: totals.income_posted + totals.income_planned - totals.expense_posted - totals.expense_planned,
      categories,
      recurrence,
      future_installments_cents: num(futureInstallments?.total),
      invoice: personId == null ? invoice : null,
      goals: goals.map((g) => ({ ...g, target_cents: num(g.target_cents), saved_cents: num(g.saved_cents) })),
      upcoming,
      evolution,
      gamification: await gamificationSummary(ctx),
      members: await householdAvatars(ctx),
      missions: await syncMissions(ctx, month),
    });
  });

  return r;
}
