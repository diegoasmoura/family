import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '@fin/db';
import { badRequest, findByUuid, idParam, insert, newUuid, nowIso, owned, parse, update, zFlag, zId, zUuid, type Ctx } from '../core';

type Kind = 'income' | 'expense';

const DEFAULTS: { kind: Kind; name: string; color: string; children?: string[] }[] = [
  { kind: 'expense', name: 'Moradia', color: '#58CC02', children: ['Aluguel', 'Condomínio', 'Energia', 'Internet'] },
  { kind: 'expense', name: 'Alimentação', color: '#FF9600', children: ['Mercado', 'Restaurante'] },
  { kind: 'expense', name: 'Transporte', color: '#1CB0F6', children: ['Combustível', 'Estacionamento', 'IPVA', 'Seguro', 'Manutenção'] },
  { kind: 'expense', name: 'Serviços', color: '#CE82FF', children: ['Telefone', 'Assinaturas'] },
  { kind: 'expense', name: 'Saúde', color: '#FF4B4B' },
  { kind: 'expense', name: 'Lazer', color: '#FFC800' },
  { kind: 'expense', name: 'Educação', color: '#2B70C9' },
  { kind: 'income', name: 'Pagamentos', color: '#58CC02', children: ['Salário'] },
  { kind: 'income', name: 'Extras', color: '#FFC800' },
];

export async function seedDefaultCategories(db: Db, householdId: number) {
  const now = nowIso();
  let order = 0;
  for (const cat of DEFAULTS) {
    const parentId = await insert(db, 'categories', {
      client_uuid: newUuid(),
      household_id: householdId,
      name: cat.name,
      kind: cat.kind,
      color: cat.color,
      sort_order: order++,
      created_at: now,
      updated_at: now,
    });
    for (const child of cat.children ?? []) {
      await insert(db, 'categories', {
        client_uuid: newUuid(),
        household_id: householdId,
        name: child,
        kind: cat.kind,
        parent_id: parentId,
        color: cat.color,
        sort_order: order++,
        created_at: now,
        updated_at: now,
      });
    }
  }
}

/** Categoria do household, com o kind esperado do lançamento. */
export async function assertCategory(ctx: Ctx, id: number | null | undefined, kind: Kind) {
  if (id == null) return null;
  const cat = await owned<{ id: number; kind: Kind }>(ctx, 'categories', id, 'Categoria');
  if (cat.kind !== kind) throw badRequest(kind === 'income' ? 'Use uma categoria de receita' : 'Use uma categoria de despesa');
  return cat;
}

async function validateParent(ctx: Ctx, parentId: number | null | undefined, kind: Kind, selfId?: number) {
  if (parentId == null) return;
  if (parentId === selfId) throw badRequest('Uma categoria não pode ser pai dela mesma');
  const parent = await owned<{ kind: Kind; parent_id: number | null }>(ctx, 'categories', parentId, 'Categoria pai');
  if (parent.kind !== kind) throw badRequest('A categoria pai precisa ser do mesmo tipo');
  if (parent.parent_id != null) throw badRequest('A categoria pai precisa ser de primeiro nível');
  if (selfId) {
    const children = await ctx.db.get('SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL', [selfId]);
    if (children) throw badRequest('Uma categoria com subcategorias não pode virar filha');
  }
}

export function categoriesRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const kind = req.query.kind as string | undefined;
    const params: unknown[] = [req.ctx.householdId];
    let where = 'household_id = ? AND deleted_at IS NULL';
    if (kind === 'income' || kind === 'expense') {
      where += ' AND kind = ?';
      params.push(kind);
    }
    if (req.query.archived !== '1') where += ' AND archived = 0';
    res.json(await req.ctx.db.all(`SELECT * FROM categories WHERE ${where} ORDER BY sort_order, name`, params));
  });

  r.post('/', async (req, res) => {
    const body = parse(
      z.object({
        client_uuid: zUuid.optional(),
        name: z.string().trim().min(1).max(60),
        kind: z.enum(['income', 'expense']),
        parent_id: zId.nullish(),
        icon: z.string().max(40).nullish(),
        color: z.string().max(20).nullish(),
        sort_order: z.number().int().optional(),
      }),
      req.body,
    );
    const existing = await findByUuid(req.ctx, 'categories', body.client_uuid);
    if (existing) return void res.json(existing);
    await validateParent(req.ctx, body.parent_id, body.kind);
    const max = await req.ctx.db.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM categories WHERE household_id = ?', [req.ctx.householdId]);
    const now = nowIso();
    const id = await insert(req.ctx.db, 'categories', {
      client_uuid: body.client_uuid ?? newUuid(),
      household_id: req.ctx.householdId,
      name: body.name,
      kind: body.kind,
      parent_id: body.parent_id ?? null,
      icon: body.icon ?? null,
      color: body.color ?? null,
      sort_order: body.sort_order ?? Number(max?.m ?? 0) + 1,
      created_at: now,
      updated_at: now,
    });
    res.status(201).json(await req.ctx.db.get('SELECT * FROM categories WHERE id = ?', [id]));
  });

  r.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const cat = await owned<{ kind: Kind }>(req.ctx, 'categories', id, 'Categoria');
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(60).optional(),
        parent_id: zId.nullable().optional(),
        icon: z.string().max(40).nullable().optional(),
        color: z.string().max(20).nullable().optional(),
        sort_order: z.number().int().optional(),
        archived: zFlag.optional(),
      }),
      req.body,
    );
    if (body.parent_id !== undefined) await validateParent(req.ctx, body.parent_id, cat.kind, id);
    await update(req.ctx.db, 'categories', id, { ...body, updated_at: nowIso() });
    res.json(await req.ctx.db.get('SELECT * FROM categories WHERE id = ?', [id]));
  });

  /** Categoria com uso ou com filhas é arquivada para preservar o histórico. */
  r.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    await owned(req.ctx, 'categories', id, 'Categoria');
    const used = await req.ctx.db.get(
      `SELECT 1 AS u FROM transactions WHERE category_id = ?
       UNION ALL SELECT 1 FROM recurrences WHERE category_id = ?
       UNION ALL SELECT 1 FROM installment_plans WHERE category_id = ?
       UNION ALL SELECT 1 FROM budgets WHERE category_id = ?
       UNION ALL SELECT 1 FROM categories WHERE parent_id = ? AND deleted_at IS NULL`,
      [id, id, id, id, id],
    );
    const now = nowIso();
    if (used) await update(req.ctx.db, 'categories', id, { archived: 1, updated_at: now });
    else await update(req.ctx.db, 'categories', id, { deleted_at: now, updated_at: now });
    res.json({ archived: Boolean(used), deleted: !used });
  });

  return r;
}
