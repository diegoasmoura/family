import { z } from 'zod';
import { badRequest, zId, type Ctx } from '../core';

/**
 * "Nosso" (for_user_id vazio) é dividido entre as duas pessoas; no Eu, cada um vê a sua parte.
 * `split_user_id` fica com `split_bp` (5000 = 50%), arredondado para cima; a outra pessoa, com o resto.
 * Vazio no banco = meio a meio, e o centavo ímpar vai para quem lançou (created_by).
 * A mesma conta existe em `personPart` (@fin/domain) e em `personPartSql` (queries.ts).
 */
export const splitFields = {
  split_user_id: zId.nullish(),
  split_bp: z.number().int().min(1).max(9999).nullish(),
};

/** Normaliza a divisão para gravar: só no Nosso; meio a meio fica vazio; percentual precisa dizer de quem é. */
export async function normalizeSplit(
  ctx: Ctx,
  forUserId: number | null,
  splitUserId: number | null | undefined,
  splitBp: number | null | undefined,
): Promise<{ split_user_id: number | null; split_bp: number | null }> {
  if (forUserId != null || splitBp == null || splitBp === 5000) return { split_user_id: null, split_bp: null };
  if (splitUserId == null) throw badRequest('Diga de quem é o percentual da divisão');
  const user = await ctx.db.get('SELECT id FROM users WHERE id = ? AND household_id = ?', [splitUserId, ctx.householdId]);
  if (!user) throw badRequest('Essa pessoa não está nesta casa');
  return { split_user_id: splitUserId, split_bp: splitBp };
}
