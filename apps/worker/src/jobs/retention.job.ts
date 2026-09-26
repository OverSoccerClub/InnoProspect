/**
 * jobs/retention.job.ts — ARQUITETURA §7.5/§6.9 (Fase 5.3). O job MAIS
 * DESTRUTIVO do sistema: exclusão física de `Lead` (cascade de `Message`/
 * `LeadActivity`/`CampaignTarget`, ver comentário no schema) e redação de
 * conteúdo de `Message`. Diferente de todo outro job periódico deste
 * projeto, aqui o freio vem ANTES do acelerador (mesmo princípio do motor de
 * disparo, ARQUITETURA §6.8.9) — três camadas de segurança, nesta ordem de
 * decisão a cada rodada:
 *
 *   1. CONTAGEM antes de qualquer escrita (nunca decide "apagar" sem saber
 *      quantos, por qual regra — log estruturado sempre, alerta quando há
 *      algo a reportar).
 *   2. TETO DE SEGURANÇA por execução (`RETENTION_MAX_LEAD_DELETES_PER_RUN`/
 *      `_MESSAGE_REDACTIONS_PER_RUN`, `lib/retention-config.ts`) — candidatos
 *      acima do teto interrompem a rodada SEM TOCAR NADA (nem parcialmente)
 *      + alerta crítico. Um predicado invertido que casaria com a base
 *      inteira bate aqui antes de terminar um único registro.
 *   3. MODO DE SIMULAÇÃO (`dryRun`, default `true`, `resolveRetentionConfig`)
 *      — com ele ligado, os passos 1-2 rodam por completo (a contagem É a
 *      simulação), mas nenhum `update`/`delete` executa. É o default de
 *      TODA execução MANUAL (`scripts/run-retention.ts`); o CRON agendado
 *      (`scheduler.ts`) só aplica de verdade se `RETENTION_DRY_RUN=false`
 *      estiver no ambiente — decisão explícita, não esquecimento.
 *
 * ── AS DUAS REGRAS DA TABELA §7.5, E A SUTILEZA DE CADA UMA ──────────────
 *
 * "Lead sem nenhuma interação: 24 meses desde `collectedAt`." / "Lead com
 * interação: 24 meses desde a ÚLTIMA interação." "Interação" = qualquer
 * `Message` do lead (inbound OU outbound — contato tentado por nós OU
 * resposta do titular, ambos são "o titular foi/nos contatou", ver a própria
 * tabela: "Lead com interação (contatado/respondeu)"). Deliberadamente NÃO
 * inclui `LeadActivity` (edição de nota/tag/status por um operador não é
 * "interação com o titular", é registro interno nosso) — decisão registrada
 * no handoff, não uma omissão. A consulta (`findExpiredLeadCandidates`)
 * calcula `COALESCE(MAX(message.createdAt), lead.collectedAt)` num único
 * `$queryRaw` — é a MESMA lógica das duas linhas da tabela, expressa uma vez
 * (lead sem mensagem nenhuma cai no `collectedAt` do COALESCE automaticamente,
 * sem `if` separado).
 *
 * "`Message` (conteúdo): 12 meses → apaga o `body`, mantém metadados
 * agregados." É um UPDATE (`contentRedactedAt`, ver schema), não um DELETE de
 * linha — direção/status/timestamps/instanceId sobrevivem, é isso que
 * sustenta contadores e funil. Roda ANTES da exclusão de `Lead` (ordem
 * arbitrária em termos de correção — como 12 < 24 meses, toda mensagem de um
 * lead elegível para exclusão já teria sido redigida antes de chegar lá —,
 * mas redigir primeiro é a operação menor/mais segura das duas).
 *
 * "`OptOut`: NUNCA apaga." Este arquivo não declara NENHUM método
 * `prisma.optOut.delete`/`deleteMany` — é estrutural, não um `if` que
 * poderia ser removido por engano. A proteção real é do SCHEMA:
 * `OptOut.leadId` é `onDelete: SetNull` (nunca `Cascade`), então mesmo o
 * `prisma.lead.delete` abaixo (que cascateia `Message`/`LeadActivity`/
 * `CampaignTarget`) NUNCA leva um `OptOut` junto — confirmado lendo o
 * schema antes de escrever este job (ver PENDÊNCIAS do handoff sobre a única
 * divergência encontrada, que é na Entrega 2, não aqui).
 */
import type { Job } from 'bullmq';
import { prisma as defaultPrisma, type PrismaClient } from '@inno/db';
import { monthsAgo } from '@inno/core';
import { resolveRetentionConfig, type RetentionConfig } from '../lib/retention-config.js';
import { logger as defaultLogger, type Logger } from '../observability/logger.js';
import { sendAlert as defaultSendAlert, type AlertEvent } from '../observability/alerts.js';

export type RetentionDeps = {
  prisma: PrismaClient;
  logger: Logger;
  notify: (event: AlertEvent) => void | Promise<void>;
  /** Default `() => new Date()` — testes de corte de mês injetam um relógio fixo. */
  now?: () => Date;
  /**
   * Sobrescreve `resolveRetentionConfig(process.env)` — usado pelo script
   * manual (`scripts/run-retention.ts`), que decide seu PRÓPRIO `dryRun`
   * (default `true`, só `--apply` desliga), independente do
   * `RETENTION_DRY_RUN` de ambiente que governa o cron. Testes também usam
   * isto para injetar tetos pequenos sem depender de env global.
   */
  config?: RetentionConfig;
};

export function defaultRetentionDeps(): RetentionDeps {
  return { prisma: defaultPrisma, logger: defaultLogger, notify: defaultSendAlert };
}

type SweepResult = {
  /** "Pelo menos" quando o teto foi ultrapassado (a query para em `cap + 1`, não conta o total real — ver comentário em `findExpiredLeadCandidates`). */
  candidateCount: number;
  applied: number;
  cappedOut: boolean;
};

type LeadSweepResult = SweepResult & {
  noInteractionCount: number;
  withInteractionCount: number;
};

export type RetentionSummary = {
  dryRun: boolean;
  occurredAt: string;
  message: SweepResult;
  lead: LeadSweepResult;
};

export async function runRetention(deps: RetentionDeps): Promise<RetentionSummary> {
  const config = deps.config ?? resolveRetentionConfig(process.env);
  const now = deps.now ? deps.now() : new Date();

  const message = await redactOldMessageBodies(deps, config, now);
  const lead = await deleteExpiredLeads(deps, config, now);

  const summary: RetentionSummary = { dryRun: config.dryRun, occurredAt: now.toISOString(), message, lead };

  deps.logger.info(
    { ...summary },
    `retention: ciclo concluído (${config.dryRun ? 'SIMULAÇÃO — nada foi apagado/redigido' : 'APLICADO'})`,
  );

  if (!config.dryRun && (message.applied > 0 || lead.applied > 0)) {
    void deps.notify({
      kind: 'retention_run_completed',
      messagesRedacted: message.applied,
      leadsDeleted: lead.applied,
      leadsWithoutInteraction: lead.noInteractionCount,
      leadsWithInteraction: lead.withInteractionCount,
    });
  }

  return summary;
}

export function createRetentionProcessor(deps: RetentionDeps) {
  return async function processRetentionJob(_job: Job): Promise<void> {
    await runRetention(deps);
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Message — redação de conteúdo (12 meses)
// ─────────────────────────────────────────────────────────────────────────

/** Substitui o conteúdo original — nunca string vazia "por acaso" de outro caminho (`sendLeadMessage`/webhook sempre gravam `body` não-vazio), então este valor É o marcador de "isto foi redigido por retenção", mesmo sem depender só dele (a fonte de verdade é `contentRedactedAt`, não o conteúdo do `body`). */
const REDACTED_BODY = '';

async function redactOldMessageBodies(deps: RetentionDeps, config: RetentionConfig, now: Date): Promise<SweepResult> {
  const cutoff = monthsAgo(now, config.messageBodyRetentionMonths);

  const candidateCount = await deps.prisma.message.count({
    where: { createdAt: { lt: cutoff }, contentRedactedAt: null },
  });

  if (candidateCount > config.maxMessageRedactionsPerRun) {
    deps.logger.error(
      { candidateCount, cap: config.maxMessageRedactionsPerRun, cutoff: cutoff.toISOString() },
      'retention: teto de segurança de REDAÇÃO DE MENSAGENS ultrapassado — nenhuma mensagem foi tocada nesta rodada',
    );
    void deps.notify({
      kind: 'retention_safety_cap_exceeded',
      target: 'message_body_redaction',
      candidateCount,
      cap: config.maxMessageRedactionsPerRun,
    });
    return { candidateCount, applied: 0, cappedOut: true };
  }

  if (config.dryRun || candidateCount === 0) {
    return { candidateCount, applied: 0, cappedOut: false };
  }

  const result = await deps.prisma.message.updateMany({
    where: { createdAt: { lt: cutoff }, contentRedactedAt: null },
    data: { body: REDACTED_BODY, contentRedactedAt: now },
  });
  return { candidateCount, applied: result.count, cappedOut: false };
}

// ─────────────────────────────────────────────────────────────────────────
// Lead — exclusão física (24 meses desde collectedAt OU última interação)
// ─────────────────────────────────────────────────────────────────────────

type LeadRetentionCandidate = { id: string; hadInteraction: boolean };

/**
 * `$queryRaw` parametrizado (nunca interpolação de string — mesmo padrão de
 * `dashboard.ts`, `convention-dashboard-summary` na memória do Vega):
 * calcula, num único passe, `COALESCE(MAX(message.createdAt), lead.
 * collectedAt)` por lead — a MESMA fórmula das duas linhas da tabela §7.5
 * ("sem interação" cai no `collectedAt` automaticamente quando o `LEFT JOIN`
 * não encontra nenhuma `Message`, sem `if` separado).
 *
 * `LIMIT ${cap + 1}` (não `cap`) é o mesmo truque de `resolveBulkTargetIds`
 * (`apps/web/src/lib/services/leads.ts`): "pelo menos cap+1" já é suficiente
 * para decidir "estourou o teto" sem pagar um segundo `COUNT(*)` completo
 * contra a tabela toda. Por isso `candidateCount` no retorno do sweep é uma
 * contagem "pelo menos", não o total exato, QUANDO o teto é ultrapassado —
 * documentado no tipo (`SweepResult.candidateCount`) e aceitável porque o
 * único uso desse número no caminho de teto ultrapassado é log/alerta, nunca
 * uma decisão de negócio.
 */
async function findExpiredLeadCandidates(prisma: PrismaClient, cutoff: Date, limit: number): Promise<LeadRetentionCandidate[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; had_interaction: boolean }>>`
    SELECT l.id, (m.last_message_at IS NOT NULL) AS had_interaction
    FROM leads l
    LEFT JOIN (
      SELECT "leadId", MAX("createdAt") AS last_message_at
      FROM messages
      GROUP BY "leadId"
    ) m ON m."leadId" = l.id
    WHERE COALESCE(m.last_message_at, l."collectedAt") < ${cutoff}
    ORDER BY l.id
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ id: r.id, hadInteraction: r.had_interaction }));
}

async function deleteExpiredLeads(deps: RetentionDeps, config: RetentionConfig, now: Date): Promise<LeadSweepResult> {
  const cutoff = monthsAgo(now, config.leadRetentionMonths);
  const candidates = await findExpiredLeadCandidates(deps.prisma, cutoff, config.maxLeadDeletesPerRun + 1);

  if (candidates.length > config.maxLeadDeletesPerRun) {
    deps.logger.error(
      { candidateCountAtLeast: candidates.length, cap: config.maxLeadDeletesPerRun, cutoff: cutoff.toISOString() },
      'retention: teto de segurança de EXCLUSÃO DE LEADS ultrapassado — nenhum lead foi apagado nesta rodada',
    );
    void deps.notify({
      kind: 'retention_safety_cap_exceeded',
      target: 'lead_deletion',
      candidateCount: candidates.length,
      cap: config.maxLeadDeletesPerRun,
    });
    return { candidateCount: candidates.length, applied: 0, cappedOut: true, noInteractionCount: 0, withInteractionCount: 0 };
  }

  const noInteractionCount = candidates.filter((c) => !c.hadInteraction).length;
  const withInteractionCount = candidates.length - noInteractionCount;

  if (config.dryRun || candidates.length === 0) {
    return { candidateCount: candidates.length, applied: 0, cappedOut: false, noInteractionCount, withInteractionCount };
  }

  // Um `prisma.lead.delete` por vez, com o SEU PRÓPRIO try/catch (mesma
  // postura de `warmup-roll.job`/`health-check.job`: um lead com erro (ex.:
  // corrida rara com outra escrita) nunca impede os demais desta rodada de
  // serem apagados). Cascade real do schema (Postgres, DENTRO do mesmo
  // DELETE): `Message.leadId`/`LeadActivity.leadId`/`CampaignTarget.leadId`
  // são `onDelete: Cascade` — não precisa de transação manual nem de apagar
  // cada tabela filha à mão. `OptOut.leadId` é `SetNull`, nunca some.
  let applied = 0;
  for (const candidate of candidates) {
    try {
      await deps.prisma.lead.delete({ where: { id: candidate.id } });
      applied += 1;
    } catch (err) {
      deps.logger.error(
        { leadId: candidate.id, err: err instanceof Error ? err.message : String(err) },
        'retention: erro apagando lead — outros leads desta rodada continuam',
      );
    }
  }

  return { candidateCount: candidates.length, applied, cappedOut: false, noInteractionCount, withInteractionCount };
}
