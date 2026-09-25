/**
 * time/local-date-key.ts — chave do DIA CIVIL num fuso horário (ARQUITETURA
 * §6.8.0.4/§10 `APP_TIMEZONE`). Puro: `now` e `timezone` chegam por
 * parâmetro; este módulo nunca lê `Date.now()`/`process.env` (mesmo
 * princípio de `whatsapp/send-window.ts`: "não sabe nada sobre infra").
 *
 * Antes da 4.F.2 existiam TRÊS cópias manuais desta mesma conta
 * (`Intl.DateTimeFormat` com `en-CA`) em `apps/web` —
 * `lib/services/whatsapp-instances.ts#todayDateKey`,
 * `lib/services/campaigns.ts#todayDateKey` e
 * `lib/services/messages.ts#todayDateKey` (que tinha ainda uma QUARTA
 * variante, em string: `localDateKeyString`, para a semente do spintax).
 * Fixado o mesmo dia em produção, as quatro sempre concordavam — mas nada
 * impedia uma delas de divergir num ajuste futuro feito só num lado. A
 * 4.F.4 (o tick, `apps/worker`) ia precisar de uma quinta. Este par de
 * funções é o ponto único; os três call sites de `apps/web` foram
 * religados para consumi-lo na própria 4.F.2 (ver handoff do Vega).
 */

/**
 * `"YYYY-MM-DD"` do dia civil de `now` no fuso `timezone` — mesma notação
 * (`en-CA`, que devolve exatamente esse formato) das cópias anteriores.
 * Usada onde o consumidor quer uma STRING determinística (ex.: semente do
 * spintax por dia), não uma coluna de banco.
 */
export function localDateKeyString(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Meia-noite UTC (`T00:00:00.000Z`) do dia civil de `now` no fuso
 * `timezone` — a MESMA granularidade de `InstanceDailyStat.date` (`@db.Date`,
 * coluna sem fuso, ver a armadilha registrada na memória do Vega:
 * `prisma-datetime-sem-fuso`). Não é "meia-noite NO fuso" (isso é
 * `nextLocalMidnight`, em `whatsapp/send-window.ts` — um instante real de
 * virada de cota, para `resetsAt`). Este valor é uma CHAVE de agrupamento
 * por dia civil, comparável direto com o que o Prisma grava.
 */
export function localDateKey(now: Date, timezone: string): Date {
  return new Date(`${localDateKeyString(now, timezone)}T00:00:00.000Z`);
}
