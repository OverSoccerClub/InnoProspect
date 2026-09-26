/**
 * time/months-ago.ts — corte de retenção LGPD (ARQUITETURA §7.5,
 * `apps/worker/src/jobs/retention.job.ts`). Puro: `now` chega por parâmetro
 * (mesmo princípio de `local-date-key.ts` — nunca lê `Date.now()`).
 *
 * Diferente de `localDateKey` (dia CIVIL num FUSO), a retenção conta "meses
 * corridos" a partir de um INSTANTE (`collectedAt`/última interação, ambos
 * `DateTime` sem fuso no Postgres — ver `prisma-datetime-sem-fuso` na
 * memória do Vega) — não precisa normalizar para um fuso específico, só
 * subtrair meses de forma determinística. Por isso usa `setUTCMonth`
 * (opera em UTC, nunca no fuso local do processo Node) em vez de
 * `Intl.DateTimeFormat`.
 */

/**
 * `now` menos `months` meses, em UTC. `Date#setUTCMonth` NÃO trava "dia
 * inexistente no mês de destino" no último dia daquele mês — ele ROLA para
 * o mês seguinte pelos dias excedentes (ex.: 31/mar - 1 mês = fevereiro só
 * tem 28/29 dias, então o resultado cai em 2 ou 3 de MARÇO, não em
 * 28/29 de fevereiro). Comportamento nativo do JS `Date`, verificado
 * empiricamente no teste (não assumido de memória) — irrelevante na prática
 * para retenção de meses inteiros (a diferença de 1-2 dias não muda a
 * decisão "está ou não dentro do prazo" numa janela de 12/24 MESES), mas
 * documentado aqui para quem for depurar um corte "faltando 1-2 dias".
 */
export function monthsAgo(now: Date, months: number): Date {
  const result = new Date(now.getTime());
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}
