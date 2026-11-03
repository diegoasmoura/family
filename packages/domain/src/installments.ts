import type { Cents } from './money';

/**
 * Divide o total em N parcelas inteiras. O resto da divisão soma
 * 1 centavo nas primeiras parcelas, então a soma é exatamente o total.
 * Ex.: 100,00 em 3x -> 33,34 + 33,33 + 33,33.
 */
export function splitInstallments(totalCents: Cents, n: number): Cents[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error('Total deve ser inteiro positivo em centavos');
  if (!Number.isInteger(n) || n < 1) throw new Error('Número de parcelas inválido');
  if (totalCents < n) throw new Error('Total menor que o número de parcelas');
  const base = Math.floor(totalCents / n);
  const rest = totalCents % n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Divide um valor pelas fatias em pontos-base (10000 = 100%).
 * As fatias precisam somar 10000. O centavo que sobra vai para a maior fração,
 * e empate fica com a primeira. A soma é o total e nenhuma fatia sai zerada.
 */
export function splitByShares(totalCents: Cents, bps: number[]): Cents[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error('Total deve ser inteiro positivo em centavos');
  if (bps.length < 2 || bps.some((bp) => !Number.isInteger(bp) || bp < 1 || bp > 9999) || bps.reduce((a, b) => a + b, 0) !== 10000) {
    throw new Error('A divisão precisa fechar 100%');
  }
  const raw = bps.map((bp) => (totalCents * bp) / 10000);
  const parts = raw.map((n) => Math.floor(n));
  const rest = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((n, i) => ({ i, frac: n - parts[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < rest; k++) parts[order[k].i] += 1;
  if (parts.some((part) => part < 1)) throw new Error('Total menor que o número de partes');
  return parts;
}

/**
 * Parte de uma pessoa num lançamento.
 * - Meu (forUserId = pessoa): o valor inteiro. De outra pessoa: zero.
 * - Nosso (forUserId vazio): dividido. `splitUserId` fica com `splitBp` (5000 = 50%), arredondado para cima;
 *   a outra pessoa fica com o resto. Sem divisão gravada: meio a meio, e o centavo ímpar vai para quem lançou.
 * A API faz a mesma conta em SQL (`personPartSql`); as duas precisam bater.
 */
export function personPart(
  amountCents: Cents,
  personId: number,
  t: { forUserId: number | null; splitUserId: number | null; splitBp: number | null; createdBy: number },
): Cents {
  if (t.forUserId != null) return t.forUserId === personId ? amountCents : 0;
  const lead = t.splitUserId ?? t.createdBy;
  const leadPart = Math.floor((amountCents * (t.splitBp ?? 5000) + 9999) / 10000);
  return lead === personId ? leadPart : amountCents - leadPart;
}
