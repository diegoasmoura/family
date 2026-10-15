import { Router } from 'express';
import { z } from 'zod';
import {
  INVOICE_STATE_LABEL,
  addMonths,
  classifyRecurrence,
  deriveStatus,
  monthOf,
  statusLabel,
  type DisplayStatus,
  type Kind,
} from '@fin/domain';
import {
  HttpError,
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
  zDate,
  zFlag,
  zId,
  zMonth,
  zUuid,
  type Ctx,
} from '../core';
import { cardInvoiceBalances, invoiceForCardPurchase, type Card } from './cards';
import { assertCategory } from './categories';
import { logTransactionXp, type XpResult } from './gamification';
import { ensureRecurrences } from './recurrences';

export const TX_SELECT = `SELECT t.*, a.name AS account_name, cc.name AS card_name, c.name AS category_name, c.color AS category_color,
       pc.name AS parent_category_name, pc.color AS parent_category_color, p.installments AS plan_installments, fu.name AS for_user_name,
       inv.due_date AS invoice_due_on,
       CASE WHEN t.invoice_id IS NULL THEN 0
            WHEN COALESCE((SELECT SUM(pmt.amount_cents) FROM invoice_payments pmt WHERE pmt.invoice_id = t.invoice_id AND pmt.deleted_at IS NULL), 0)
                 >= COALESCE((SELECT SUM(x.amount_cents) FROM transactions x WHERE x.invoice_id = t.invoice_id AND x.deleted_at IS NULL), 0)
                    + COALESCE(inv.adjustment_cents, 0)
            THEN 1 ELSE 0 END AS invoice_paid,
       CASE
         WHEN t.plan_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM transactions nxt
           WHERE nxt.plan_id = t.plan_id AND nxt.deleted_at IS NULL AND nxt.installment_no > t.installment_no
         ) THEN 1
         WHEN t.recurrence_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM recurrences r
           WHERE r.id = t.recurrence_id AND r.deleted_at IS NULL
             AND (r.end_month IS NULL OR r.end_month > t.competence_month)
         ) THEN 1
         ELSE 0
       END AS has_following
  FROM transactions t
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN credit_cards cc ON cc.id = t.card_id
  LEFT JOIN invoices inv ON inv.id = t.invoice_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories pc ON pc.id = c.parent_id
  LEFT JOIN installment_plans p ON p.id = t.plan_id
  LEFT JOIN users fu ON fu.id = t.for_user_id`;

/** `all` não filtra. `me` e um id restringem a for_user_id. Vazio (da casa) fica de fora. */
export async function personFilter(ctx: Ctx, raw: unknown): Promise<number | null> {
  const value = parse(z.union([z.literal('all'), z.literal('me'), z.coerce.number().int().positive()]).optional(), raw === undefined || raw === '' ? 'all' : raw);
  if (!value || value === 'all') return null;
  const id = value === 'me' ? ctx.userId : value;
  return assertHouseholdUser(ctx, id);
}

export async function assertHouseholdUser(ctx: Ctx, userId: number | null | undefined): Promise<number | null> {
  if (userId == null) return null;
  const user = await ctx.db.get('SELECT id FROM users WHERE id = ? AND household_id = ?', [userId, ctx.householdId]);
  if (!user) throw badRequest('Essa pessoa não está nesta casa');
  return userId;
}

/** Acrescenta os campos derivados que a interface exibe. */
export function decorateTransactions(rows: any[], today: string) {
  return rows.map((t) => {
    const display = deriveStatus(t, today);
    return {
      ...t,
      amount_cents: num(t.amount_cents),
      display_status: display,
      status_label: statusLabel(display, t.kind),
      recurrence_class: classifyRecurrence(t),
      installment_label: t.plan_id ? `${t.installment_no}/${t.plan_installments}` : null,
      has_following: num(t.has_following),
    };
  });
}

async function loadTx(ctx: Ctx, id: number) {
  const row = await ctx.db.get(`${TX_SELECT} WHERE t.id = ? AND t.household_id = ?`, [id, ctx.householdId]);
  if (!row) throw notFound('Lançamento');
  return decorateTransactions([row], ctx.today)[0];
}

export async function assertPaymentTarget(ctx: Ctx, kind: Kind, accountId?: number | null, cardId?: number | null) {
  if (Boolean(accountId) === Boolean(cardId)) throw badRequest('Escolha uma conta ou um cartão');
  if (kind === 'income' && cardId) throw badRequest('Receita não pode ser lançada em cartão');
  if (accountId) {
    const acc = await owned<{ archived: number }>(ctx, 'accounts', accountId, 'Conta');
    if (acc.archived) throw badRequest('Esta conta está arquivada');
    return { card: null };
  }
  const card = await owned<Card>(ctx, 'credit_cards', cardId, 'Cartão');
  if (card.archived) throw badRequest('Este cartão está arquivado');
  return { card };
}

export const createTxBody = z.object({
  client_uuid: zUuid.optional(),
  kind: z.enum(['income', 'expense']),
  description: z.string().trim().max(120).default(''),
  amount_cents: zCents,
  occurred_on: zDate.optional(),
  due_on: zDate.nullish(),
  paid: z.boolean().optional(),
  paid_on: zDate.nullish(),
  category_id: zId.nullish(),
  account_id: zId.nullish(),
  card_id: zId.nullish(),
  include_in_reports: zFlag.optional(),
  for_user_id: zId.nullable().optional(),
});

/**
 * Lançamento único. Em conta, efetivado = pago/recebido (por padrão, quando a
 * data já chegou). No cartão, a compra é despesa na hora e entra na fatura
 * pelo fechamento; o dinheiro só sai da conta quando a fatura é paga.
 */
export async function createTransaction(ctx: Ctx, input: z.input<typeof createTxBody>): Promise<{ transaction: any; xp: XpResult | null }> {
  const body = parse(createTxBody, input);
  const existing = await findByUuid(ctx, 'transactions', body.client_uuid);
  if (existing) return { transaction: await loadTx(ctx, existing.id), xp: null };

  const { card } = await assertPaymentTarget(ctx, body.kind, body.account_id, body.card_id);
  await assertCategory(ctx, body.category_id, body.kind);
  const forUserId = await assertHouseholdUser(ctx, body.for_user_id ?? null);
  const occurredOn = body.occurred_on ?? ctx.today;

  const id = await ctx.db.tx(async (db) => {
    const tctx = { ...ctx, db };
    const now = nowIso();
    let fields: Record<string, unknown>;
    if (card) {
      const { invoiceId, referenceMonth } = await invoiceForCardPurchase(db, card, occurredOn);
      fields = { card_id: card.id, invoice_id: invoiceId, competence_month: referenceMonth, status: 'posted', paid_on: null, due_on: null };
    } else {
      const paid = body.paid ?? (body.paid_on != null || occurredOn <= ctx.today);
      fields = {
        account_id: body.account_id,
        competence_month: monthOf(occurredOn),
        status: paid ? 'posted' : 'planned',
        paid_on: paid ? (body.paid_on ?? occurredOn) : null,
        due_on: body.due_on ?? null,
      };
    }
    const txId = await insert(db, 'transactions', {
      client_uuid: body.client_uuid ?? newUuid(),
      household_id: ctx.householdId,
      kind: body.kind,
      description: body.description,
      amount_cents: body.amount_cents,
      occurred_on: occurredOn,
      category_id: body.category_id ?? null,
      include_in_reports: body.include_in_reports ?? 1,
      for_user_id: forUserId,
      created_by: ctx.userId,
      created_at: now,
      updated_at: now,
      ...fields,
    });
    return { txId, xp: await logTransactionXp(tctx, txId) };
  });
  return { transaction: await loadTx(ctx, id.txId), xp: id.xp };
}

type Bucket = Record<string, number>;

function summarize(items: any[], kind: Kind) {
  const included = items.filter((t) => t.include_in_reports);
  const sum = (list: any[]) => list.reduce((acc, t) => acc + t.amount_cents, 0);
  const by = (status: DisplayStatus) => sum(included.filter((t) => t.display_status === status));
  const total = sum(included);
  const notSummed = sum(items.filter((t) => !t.include_in_reports));
  const recurrence: Bucket = {
    fixed: sum(included.filter((t) => t.recurrence_class === 'fixed')),
    installment: sum(included.filter((t) => t.recurrence_class === 'installment')),
    variable: sum(included.filter((t) => t.recurrence_class === 'variable')),
  };
  const situation: Bucket = {
    paid: by('paid'),
    near: by('near'),
    overdue: by('overdue'),
    planned: by('planned'),
    unpaid: by('near') + by('overdue') + by('planned'),
  };
  if (kind === 'expense') situation.cards = by('card');
  return {
    records: items.length,
    total_cents: total,
    total_without_cards_cents: sum(included.filter((t) => !t.card_id)),
    not_summed_cents: notSummed,
    total_with_not_summed_cents: total + notSummed,
    situation,
    recurrence,
  };
}

/**
 * Compras da fatura: cada parcelamento e cada cobrança fixa numa linha;
 * as avulsas somam em "Outras compras".
 */
function firstName(name: string | null | undefined): string | null {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}

export function invoiceLines(txs: any[]) {
  type Tracked = { kind: 'installment' | 'fixed'; tx: any; description: string; label: string; amount_cents: number };
  type Other = { kind: 'other'; description: string; count: number; amount_cents: number; for_user_name?: string | null };
  const tracked = new Map<string, Tracked>();
  const loose: any[] = [];
  for (const t of txs) {
    const amount = num(t.amount_cents);
    const description = String(t.description ?? '').trim() || 'Sem descrição';
    if (t.plan_id) {
      const key = `p${t.plan_id}`;
      const prev = tracked.get(key);
      if (prev) prev.amount_cents += amount;
      else tracked.set(key, { kind: 'installment', tx: t, description, label: t.installment_label ?? '', amount_cents: amount });
    } else if (t.recurrence_id) {
      const key = `r${t.recurrence_id}`;
      const prev = tracked.get(key);
      if (prev) prev.amount_cents += amount;
      else tracked.set(key, { kind: 'fixed', tx: t, description, label: 'Fixa', amount_cents: amount });
    } else {
      loose.push(t);
    }
  }
  const lines: (Tracked | Other)[] = [...tracked.values()].sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === 'installment' ? -1 : 1) || b.amount_cents - a.amount_cents || a.description.localeCompare(b.description),
  );
  if (loose.length) {
    const names = loose.map((t) => firstName(t.for_user_name));
    const same = names.every((name) => name === names[0]);
    const other: Other = {
      kind: 'other',
      description: 'Outras compras',
      count: loose.length,
      amount_cents: loose.reduce((sum, t) => sum + num(t.amount_cents), 0),
    };
    if (same) other.for_user_name = names[0];
    lines.push(other);
  }
  return lines;
}

/** Soma o acerto da fatura na linha que não é parcela, para o total bater. */
export function foldInvoiceAdjustment(lines: ReturnType<typeof invoiceLines>, adjustmentCents: number) {
  if (!adjustmentCents) return lines;
  const other = lines.find((l) => l.kind === 'other');
  if (other && other.kind === 'other') {
    const amount = other.amount_cents + adjustmentCents;
    const rest = lines.filter((l) => l !== other);
    return amount === 0 ? rest : [...rest, { ...other, amount_cents: amount }];
  }
  return [...lines, { kind: 'other' as const, description: 'Ajuste', count: 1, amount_cents: adjustmentCents }];
}

/** Lista do mês. Despesas de cartão aparecem agrupadas na linha da fatura. */
export async function monthView(ctx: Ctx, month: string, kind: Kind, personId: number | null = null) {
  await ensureRecurrences(ctx, month < monthOf(ctx.today) ? monthOf(ctx.today) : month);
  const params: unknown[] = [ctx.householdId, kind, month];
  const personSql = personId == null ? '' : ' AND t.for_user_id = ?';
  if (personId != null) params.push(personId);
  const rows = await ctx.db.all(
    `${TX_SELECT} WHERE t.household_id = ? AND t.kind = ? AND t.competence_month = ? AND t.deleted_at IS NULL${personSql}
      ORDER BY COALESCE(t.due_on, t.occurred_on), t.id`,
    params,
  );
  const items = decorateTransactions(rows, ctx.today);
  const summary = summarize(items, kind);

  let invoices: any[] = [];
  if (kind === 'expense' && personId == null) {
    const cards = await ctx.db.all<Card>('SELECT * FROM credit_cards WHERE household_id = ? AND deleted_at IS NULL', [ctx.householdId]);
    for (const card of cards) {
      const b = (await cardInvoiceBalances(ctx, card.id)).find((x) => x.reference_month === month);
      if (!b || b.total_cents === 0) continue;
      const purchases = items.filter((t) => Number(t.card_id) === card.id && Number(t.invoice_id) === Number(b.id));
      invoices.push({
        ...b,
        state_label: INVOICE_STATE_LABEL[b.state],
        card_id: card.id,
        card_name: card.name,
        card_brand: card.brand,
        lines: foldInvoiceAdjustment(invoiceLines(purchases), b.adjustment_cents),
      });
    }
    invoices = invoices.sort((a, b) => a.due_date.localeCompare(b.due_date));
  }
  return {
    month,
    kind,
    items: kind === 'expense' && personId == null ? items.filter((t) => !t.card_id) : items,
    card_items_count: items.filter((t) => t.card_id).length,
    invoices,
    summary,
    // Valor efetivado e a efetivar, no caixa (sem as compras de cartão).
    settled_cents: items.filter((t) => !t.card_id && t.paid_on && t.include_in_reports).reduce((a, t) => a + t.amount_cents, 0),
    pending_cents: items.filter((t) => !t.card_id && !t.paid_on && t.include_in_reports).reduce((a, t) => a + t.amount_cents, 0),
  };
}

export function transactionsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const month = parse(zMonth.optional(), req.query.month) ?? monthOf(req.ctx.today);
    const kind = parse(z.enum(['income', 'expense']).default('expense'), req.query.kind);
    const personId = await personFilter(req.ctx, req.query.person);
    if (month > addMonths(monthOf(req.ctx.today), 60)) throw badRequest('Mês muito distante');
    res.json(await monthView(req.ctx, month, kind, personId));
  });

  r.get('/suggestions', async (req, res) => {
    const kind = parse(z.enum(['income', 'expense']), req.query.kind);
    const rows = await req.ctx.db.all(
      `SELECT t.description, t.category_id
         FROM transactions t
         JOIN (
           SELECT description, MAX(id) AS last_id
             FROM transactions
            WHERE household_id = ? AND kind = ? AND deleted_at IS NULL AND TRIM(COALESCE(description, '')) <> ''
            GROUP BY description
         ) s ON s.last_id = t.id
        ORDER BY t.id DESC LIMIT 30`,
      [req.ctx.householdId, kind],
    );
    res.json(rows);
  });

  r.get('/:id', async (req, res) => {
    res.json(await loadTx(req.ctx, idParam(req.params.id)));
  });

  r.post('/', async (req, res) => {
    const result = await createTransaction(req.ctx, req.body);
    res.status(result.xp ? 201 : 200).json(result);
  });

  r.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const tx = await loadTx(req.ctx, id);
    if (tx.deleted_at) throw badRequest('Restaure o lançamento antes de editar');
    const body = parse(
      z.object({
        description: z.string().trim().max(120).nullish().transform((v) => v ?? undefined),
        amount_cents: zCents.optional(),
        category_id: zId.nullable().optional(),
        include_in_reports: zFlag.optional(),
        for_user_id: zId.nullable().optional(),
        occurred_on: zDate.optional(),
        due_on: zDate.nullable().optional(),
        account_id: zId.optional(),
      }),
      req.body,
    );
    if (body.category_id !== undefined) await assertCategory(req.ctx, body.category_id, tx.kind);
    if (body.for_user_id !== undefined) body.for_user_id = await assertHouseholdUser(req.ctx, body.for_user_id);
    const patch: Record<string, unknown> = { ...body, updated_at: nowIso() };

    if (body.account_id !== undefined) {
      if (tx.card_id) throw badRequest('Compra no cartão não pode ser movida para uma conta');
      await assertPaymentTarget(req.ctx, tx.kind, body.account_id, null);
    }
    const generated = Boolean(tx.recurrence_id || tx.plan_id);
    if (generated && body.occurred_on && body.occurred_on !== tx.occurred_on) {
      if (tx.card_id) throw badRequest('A data de uma cobrança fixa ou parcela no cartão segue a fatura');
      if (monthOf(body.occurred_on) !== tx.competence_month) throw badRequest('Escolha uma data dentro do mesmo mês desta ocorrência');
      if (body.due_on === undefined) patch.due_on = body.occurred_on;
    }
    await req.ctx.db.tx(async (db) => {
      if (body.occurred_on && body.occurred_on !== tx.occurred_on && !generated) {
        if (tx.card_id) {
          const card = await owned<Card>({ ...req.ctx, db }, 'credit_cards', tx.card_id, 'Cartão');
          const { invoiceId, referenceMonth } = await invoiceForCardPurchase(db, card, body.occurred_on);
          patch.invoice_id = invoiceId;
          patch.competence_month = referenceMonth;
        } else {
          patch.competence_month = monthOf(body.occurred_on);
        }
      }
      // Editar uma ocorrência gerada a desliga da recorrência/plano original.
      if (generated && Object.keys(body).some((k) => k !== 'include_in_reports')) patch.overridden = 1;
      await update(db, 'transactions', id, patch);
    });
    res.json(await loadTx(req.ctx, id));
  });

  r.post('/:id/pay', async (req, res) => {
    const id = idParam(req.params.id);
    const tx = await loadTx(req.ctx, id);
    if (tx.deleted_at) throw badRequest('Lançamento excluído');
    const body = parse(z.object({ paid_on: zDate.optional() }), req.body ?? {});
    const patch = tx.card_id ? { status: 'posted' } : { status: 'posted', paid_on: body.paid_on ?? req.ctx.today };
    await update(req.ctx.db, 'transactions', id, { ...patch, updated_at: nowIso() });
    res.json(await loadTx(req.ctx, id));
  });

  r.post('/:id/unpay', async (req, res) => {
    const id = idParam(req.params.id);
    const tx = await loadTx(req.ctx, id);
    if (tx.card_id && !tx.recurrence_id) throw badRequest('Compra no cartão é quitada pelo pagamento da fatura');
    await update(req.ctx.db, 'transactions', id, { status: 'planned', paid_on: null, updated_at: nowIso() });
    res.json(await loadTx(req.ctx, id));
  });

  r.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    await loadTx(req.ctx, id);
    const now = nowIso();
    await update(req.ctx.db, 'transactions', id, { deleted_at: now, updated_at: now });
    res.json(await loadTx(req.ctx, id));
  });

  r.post('/:id/restore', async (req, res) => {
    const id = idParam(req.params.id);
    await loadTx(req.ctx, id);
    try {
      await update(req.ctx.db, 'transactions', id, { deleted_at: null, updated_at: nowIso() });
    } catch (err) {
      if (/unique/i.test(String(err))) throw new HttpError(409, 'Já existe outro lançamento ativo para esta parcela/ocorrência');
      throw err;
    }
    res.json(await loadTx(req.ctx, id));
  });

  return r;
}

export function exportRouter(): Router {
  const r = Router();
  r.get('/transactions.csv', async (req, res) => {
    const rows = await req.ctx.db.all(
      `SELECT COALESCE(t.due_on, t.occurred_on) AS date, t.description, t.amount_cents, t.kind, t.status,
              c.name AS category_name, pc.name AS parent_name, a.name AS account_name, cd.name AS card_name, u.name AS who
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN categories pc ON pc.id = c.parent_id
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN credit_cards cd ON cd.id = t.card_id
         LEFT JOIN users u ON u.id = t.for_user_id
        WHERE t.household_id = ? AND t.deleted_at IS NULL
        ORDER BY date, t.id`,
      [req.ctx.householdId],
    );
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((row) =>
      [row.date, row.description, (Number(row.amount_cents) / 100).toFixed(2).replace('.', ','), row.kind, row.parent_name, row.category_name, row.account_name || row.card_name, row.status, row.who]
        .map(cell)
        .join(';'),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(`\uFEFFdata;descrição;valor;tipo;categoria;subcategoria;conta ou cartão;situação;de quem\n${lines.join('\n')}\n`);
  });
  return r;
}
