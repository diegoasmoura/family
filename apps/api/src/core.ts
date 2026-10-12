import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '@fin/db';
import { isISODate, isMonth } from '@fin/domain';

export type Role = 'admin' | 'member';

export interface Ctx {
  db: Db;
  userId: number;
  householdId: number;
  role: Role;
  timezone: string;
  today: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx: Ctx;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const notFound = (what = 'Registro') => new HttpError(404, `${what} não encontrado`);
export const forbidden = (message = 'Sem permissão para esta ação') => new HttpError(403, message);

export function parse<T>(schema: z.ZodType<T, any, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Dados inválidos',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const zCents = z.number().int('Valor deve estar em centavos').positive('Valor deve ser maior que zero');
export const zCentsOrZero = z.number().int('Valor deve estar em centavos').min(0);
export const zDate = z.string().refine(isISODate, 'Data deve estar no formato YYYY-MM-DD');
export const zMonth = z.string().refine(isMonth, 'Mês deve estar no formato YYYY-MM');
export const zId = z.number().int().positive();
export const zUuid = z.string().min(8).max(64);
export const zFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

export const nowIso = () => new Date().toISOString();
export const newUuid = () => randomUUID();

export function requireAdmin(ctx: Ctx) {
  if (ctx.role !== 'admin') throw forbidden('Apenas administradores podem fazer isso');
}

export function idParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Identificador inválido');
  return id;
}

/** Insere uma linha e devolve o id gerado (RETURNING funciona em SQLite 3.35+ e PostgreSQL). */
export async function insert(db: Db, table: string, row: Record<string, unknown>): Promise<number> {
  const cols = Object.keys(row);
  const res = await db.get<{ id: number }>(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`,
    cols.map((c) => row[c]),
  );
  return Number(res!.id);
}

export async function update(db: Db, table: string, id: number, patch: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(patch).filter((c) => patch[c] !== undefined);
  if (!cols.length) return;
  await db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => patch[c]), id]);
}

/** Recurso do household que ainda não foi excluído. */
export async function owned<T = any>(ctx: Ctx, table: string, id: number | null | undefined, what: string): Promise<T> {
  const row = await ctx.db.get<T>(`SELECT * FROM ${table} WHERE id = ? AND household_id = ? AND deleted_at IS NULL`, [id, ctx.householdId]);
  if (!row) throw notFound(what);
  return row;
}

/** Idempotência do sync offline: o mesmo client_uuid devolve o registro já criado. */
export async function findByUuid<T = any>(ctx: Ctx, table: string, uuid: string | undefined): Promise<T | undefined> {
  if (!uuid) return undefined;
  return ctx.db.get<T>(`SELECT * FROM ${table} WHERE client_uuid = ? AND household_id = ?`, [uuid, ctx.householdId]);
}

export const num = (v: unknown) => Number(v ?? 0);
