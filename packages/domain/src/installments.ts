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
