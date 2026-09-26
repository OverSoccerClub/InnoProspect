/**
 * lib/retention-config.ts — envs do `retention.job` (ARQUITETURA §7.5/§6.9,
 * Fase 5.3). Mesmo espírito de `health-check-config.ts`/`dispatch-config.ts`:
 * ler `process.env` só aqui, zero `process.env` em `packages/*`.
 *
 * `dryRun` é o campo mais importante deste arquivo: default `true` — só um
 * `RETENTION_DRY_RUN=false` EXPLÍCITO no deploy liga a exclusão/redação de
 * verdade no CRON agendado (`scheduler.ts`). Mesma filosofia do motor de
 * disparo ("nasce pausado", ARQUITETURA §6.8.9/§8.0 regra 4): entre um job
 * que apaga por engano e um job que nunca apagou nada até alguém pedir
 * explicitamente, o segundo é o estado seguro. Este knob é INDEPENDENTE do
 * `--apply` do script manual (`scripts/run-retention.ts`) — cada "porta de
 * entrada" (cron vs. execução à mão) decide seu próprio dry-run, de
 * propósito (ver comentário no script).
 */

export type RetentionConfig = {
  /** `RETENTION_DRY_RUN` (default `true`) — `false` (string exata) é a ÚNICA forma de desligar. Qualquer outro valor (ausente, typo, "0") permanece seguro. */
  dryRun: boolean;
  /** `RETENTION_LEAD_MONTHS` (default 24, ARQUITETURA §7.5) — Lead sem interação: contado desde `collectedAt`. Lead com interação: desde a ÚLTIMA interação (ver `retention.job.ts`). */
  leadRetentionMonths: number;
  /** `RETENTION_MESSAGE_BODY_MONTHS` (default 12, ARQUITETURA §7.5) — acima disso, `Message.body` é redigido (mantém metadados). */
  messageBodyRetentionMonths: number;
  /**
   * `RETENTION_MAX_LEAD_DELETES_PER_RUN` (default 500) — teto de segurança
   * (escopo desta rodada, número proposto e justificado pelo Vega): a base
   * do InnoProspect é nova (dias de idade na Fase 4, ARQUITETURA §6.9) — os
   * PRIMEIROS meses de retenção real não deveriam apagar quase nada (nenhum
   * lead legítimo ainda tem 24 meses). 500/dia já é uma folga generosa acima
   * de qualquer volume diário esperado de leads cruzando o prazo, mesmo com
   * a base crescendo para as centenas de milhares (ARQUITETURA §1, "10k-500k
   * linhas no ano 1") — mas está bem abaixo de "a base inteira", que é
   * exatamente o cenário que este teto existe para impedir (um predicado
   * invertido/errado apagando tudo de uma vez).
   */
  maxLeadDeletesPerRun: number;
  /** `RETENTION_MAX_MESSAGE_REDACTIONS_PER_RUN` (default 5000) — mesmo raciocínio do teto acima, escala maior porque redigir É reversível-neutro em risco (não é exclusão de linha, só esvazia `body`) — ainda assim tem teto, pelo mesmo motivo: um predicado errado não pode redigir a tabela inteira numa rodada só. */
  maxMessageRedactionsPerRun: number;
};

function parsedPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveRetentionConfig(env: Record<string, string | undefined>): RetentionConfig {
  return {
    // Só a string exata 'false' desliga a simulação — qualquer outro valor
    // (undefined, '', 'FALSE', '0') permanece no lado seguro. Comparação
    // deliberadamente diferente do padrão `parsedPositiveInt`/`parsedRateFraction`
    // (que caem no fallback para qualquer entrada inválida): aqui o fallback
    // SEMPRE vence, exceto o ÚNICO valor que significa "eu quero apagar de
    // verdade, sei o que estou fazendo".
    dryRun: env.RETENTION_DRY_RUN !== 'false',
    leadRetentionMonths: parsedPositiveInt(env.RETENTION_LEAD_MONTHS, 24),
    messageBodyRetentionMonths: parsedPositiveInt(env.RETENTION_MESSAGE_BODY_MONTHS, 12),
    maxLeadDeletesPerRun: parsedPositiveInt(env.RETENTION_MAX_LEAD_DELETES_PER_RUN, 500),
    maxMessageRedactionsPerRun: parsedPositiveInt(env.RETENTION_MAX_MESSAGE_REDACTIONS_PER_RUN, 5000),
  };
}
