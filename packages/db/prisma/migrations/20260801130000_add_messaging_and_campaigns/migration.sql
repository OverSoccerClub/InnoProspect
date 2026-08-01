-- InnoProspect — Fases 2, 3 e 4 (mensageria + campanhas), num único incremento.
--
-- Gerada com `prisma migrate diff --from-schema-datamodel <snapshot do schema
-- ANTES desta mudança> --to-schema-datamodel prisma/schema.prisma --script`
-- (sem banco disponível nesta máquina de desenvolvimento — ver PENDÊNCIAS no
-- handoff do Cronos: esta migração NÃO foi aplicada contra um Postgres vivo.
-- Rode `pnpm --filter @inno/db migrate:deploy` no primeiro ambiente com
-- conexão real ao banco de produção do EasyPanel e confira o resultado).
--
-- ⚠️ 100% ADITIVA de propósito — banco de produção já tem dado real (UFs,
-- 5.571 municípios, usuário admin). Nenhuma linha abaixo faz ALTER/DROP em
-- tabela ou coluna existente: só `CREATE TYPE`, `CREATE TABLE`, `CREATE
-- INDEX` e `ALTER TABLE ... ADD CONSTRAINT` (foreign keys) para tabelas
-- NOVAS. `users`, `ufs`, `cities`, `search_jobs`, `search_tasks`, `leads` e
-- `lead_activities` não são tocadas — zero risco de lock longo ou de
-- indisponibilidade em tabela grande.
--
-- ⚠️ Índice único parcial `search_jobs_active_niche_uf_key` (migração
-- 20260730120000_init) NÃO é afetado por este arquivo — confirmado: esta
-- migração não contém nenhuma linha referenciando `search_jobs`. Continua
-- valendo o aviso da migração anterior: se um dia alguém rodar `prisma
-- migrate dev` para gerar uma migração nova comparando com o HISTÓRICO
-- (não com um schema-datamodel a schema-datamodel como foi feito aqui), o
-- Prisma pode propor DROP desse índice porque ele não existe no
-- schema.prisma. Não aceite esse DROP.

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'halted');

-- CreateEnum
CREATE TYPE "CampaignTargetStatus" AS ENUM ('pending', 'sent', 'delivered', 'read', 'responded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('outbound', 'inbound');

-- CreateEnum
CREATE TYPE "WhatsAppInstanceStatus" AS ENUM ('disconnected', 'connecting', 'qr_pending', 'connected', 'banned');

-- CreateEnum
CREATE TYPE "OptOutSource" AS ENUM ('reply', 'manual', 'public_link', 'request');

-- CreateEnum
CREATE TYPE "ScraperHealthEventType" AS ENUM ('zero_streak', 'fill_rate_name', 'fill_rate_phone', 'data_shape');

-- CreateEnum
CREATE TYPE "ScraperHealthEventSeverity" AS ENUM ('critical', 'high');

-- CreateTable
CREATE TABLE "scraper_health_events" (
    "id" TEXT NOT NULL,
    "type" "ScraperHealthEventType" NOT NULL,
    "severity" "ScraperHealthEventSeverity" NOT NULL,
    "window" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "scraper_health_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_captures" (
    "id" TEXT NOT NULL,
    "searchTaskId" TEXT NOT NULL,
    "leadId" TEXT,
    "rawData" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_instances" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "evolutionInstanceName" TEXT NOT NULL,
    "instanceKey" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "status" "WhatsAppInstanceStatus" NOT NULL DEFAULT 'disconnected',
    "isDegraded" BOOLEAN NOT NULL DEFAULT false,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "warmupStartedAt" TIMESTAMP(3),
    "warmupDay" INTEGER NOT NULL DEFAULT 1,
    "warmupFrozenAt" TIMESTAMP(3),
    "dailyLimitOverride" INTEGER,
    "lastConnectionAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instance_daily_stats" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "respondedCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instance_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variablesUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignTargetId" TEXT,
    "instanceId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opt_outs" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "source" "OptOutSource" NOT NULL,
    "leadId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Nota (decisão Atlas/Nova, ver PROGRESSO/handoff do Cronos): totalTargets/
-- sentCount/deliveredCount/readCount/respondedCount/failedCount/
-- skippedCount são contadores HISTÓRICOS de funil, incrementados pelo
-- worker a cada transição de status de CampaignTarget — nunca recalculados
-- por COUNT(*). Existem porque CampaignTarget.leadId é ON DELETE CASCADE
-- (eliminação LGPD apaga o Lead e o CampaignTarget junto, para não reter o
-- telefone snapshotado em CampaignTarget.phoneE164); sem estes contadores,
-- o histórico de "quantos foram enviados" encolheria retroativamente
-- quando um lead pedisse exclusão meses depois. `pending` continua sendo
-- lido ao vivo via COUNT(*) WHERE status='pending' — é estado atual, não
-- histórico. Ver comentário completo no model Campaign em schema.prisma.
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "audienceSnapshot" JSONB NOT NULL,
    "renderedTemplateSnapshot" TEXT,
    "dailyLimitPerInstance" INTEGER,
    "sendWindowStartHour" INTEGER NOT NULL DEFAULT 9,
    "sendWindowEndHour" INTEGER NOT NULL DEFAULT 18,
    "sendWindowDaysOfWeek" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "jitterMinSeconds" INTEGER NOT NULL DEFAULT 45,
    "jitterMaxSeconds" INTEGER NOT NULL DEFAULT 180,
    "skipRecentlyContactedDays" INTEGER NOT NULL DEFAULT 30,
    "haltReason" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "totalTargets" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "respondedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_instances" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_targets" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "status" "CampaignTargetStatus" NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scraper_health_events_resolvedAt_createdAt_idx" ON "scraper_health_events"("resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "scraper_health_events_type_createdAt_idx" ON "scraper_health_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "raw_captures_searchTaskId_idx" ON "raw_captures"("searchTaskId");

-- CreateIndex
CREATE INDEX "raw_captures_leadId_idx" ON "raw_captures"("leadId");

-- CreateIndex
CREATE INDEX "raw_captures_createdAt_idx" ON "raw_captures"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_instances_evolutionInstanceName_key" ON "whatsapp_instances"("evolutionInstanceName");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_instances_instanceKey_key" ON "whatsapp_instances"("instanceKey");

-- CreateIndex
CREATE INDEX "instance_daily_stats_instanceId_date_idx" ON "instance_daily_stats"("instanceId", "date");

-- CreateIndex
-- Requisito crítico (Nova): chave da quota diária e do ramp-up de warmup —
-- o worker faz upsert nesta linha (instanceId, date) a cada envio.
CREATE UNIQUE INDEX "instance_daily_stats_instanceId_date_key" ON "instance_daily_stats"("instanceId", "date");

-- CreateIndex
CREATE INDEX "message_templates_isActive_createdAt_idx" ON "message_templates"("isActive", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_campaignTargetId_key" ON "messages"("campaignTargetId");

-- CreateIndex
-- Requisito crítico (Nova): chave de idempotência do webhook da Evolution API
-- (ARQUITETURA §4.8 — "data.key.id é chave única; evento repetido é ignorado
-- silenciosamente").
CREATE UNIQUE INDEX "messages_providerMessageId_key" ON "messages"("providerMessageId");

-- CreateIndex
CREATE INDEX "messages_leadId_createdAt_idx" ON "messages"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_instanceId_createdAt_idx" ON "messages"("instanceId", "createdAt");

-- CreateIndex
-- A GARANTIA MAIS IMPORTANTE DESTA MIGRAÇÃO (ARQUITETURA §3.2 regra 3, §6.7):
-- chave de negócio do OptOut é o TELEFONE, não o leadId. Consultada 1x por
-- mensagem enviada, sem cache, no worker — este índice é crítico.
CREATE UNIQUE INDEX "opt_outs_phoneE164_key" ON "opt_outs"("phoneE164");

-- CreateIndex
CREATE INDEX "campaigns_status_createdAt_idx" ON "campaigns"("status", "createdAt");

-- CreateIndex
CREATE INDEX "campaign_instances_instanceId_idx" ON "campaign_instances"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_instances_campaignId_instanceId_key" ON "campaign_instances"("campaignId", "instanceId");

-- CreateIndex
-- ÍNDICE MAIS CRÍTICO DESTA MIGRAÇÃO (requisito direto da Nova): hot path do
-- worker de disparo — SELECT ... WHERE campaignId=? AND status='pending' AND
-- scheduledFor<=now() ORDER BY scheduledFor FOR UPDATE SKIP LOCKED LIMIT 1.
-- SKIP LOCKED evita 2 workers pegarem o mesmo alvo após um restart; este
-- índice é quem dá performance a essa query numa campanha com muitos alvos.
CREATE INDEX "campaign_targets_campaignId_status_scheduledFor_idx" ON "campaign_targets"("campaignId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "campaign_targets_campaignId_status_idx" ON "campaign_targets"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_targets_campaignId_leadId_key" ON "campaign_targets"("campaignId", "leadId");

-- AddForeignKey
ALTER TABLE "raw_captures" ADD CONSTRAINT "raw_captures_searchTaskId_fkey" FOREIGN KEY ("searchTaskId") REFERENCES "search_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_captures" ADD CONSTRAINT "raw_captures_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_daily_stats" ADD CONSTRAINT "instance_daily_stats_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "whatsapp_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaignTargetId_fkey" FOREIGN KEY ("campaignTargetId") REFERENCES "campaign_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "whatsapp_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_instances" ADD CONSTRAINT "campaign_instances_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_instances" ADD CONSTRAINT "campaign_instances_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "whatsapp_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade (não Restrict) de propósito: a ação de eliminação LGPD
-- (ARQUITETURA §7.3) precisa conseguir apagar um Lead sem ficar bloqueada
-- por histórico de campanha. O registro que sobrevive à eliminação é o
-- OptOut (chave por telefone), não o CampaignTarget — ver comentário no
-- schema.prisma e PENDÊNCIAS no handoff do Cronos.
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
