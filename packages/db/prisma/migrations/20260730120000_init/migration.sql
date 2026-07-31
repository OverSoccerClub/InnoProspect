-- InnoProspect — migração inicial (Fase 1)
-- Gerada com `prisma migrate diff --from-empty --to-schema-datamodel` (sem
-- banco disponível no momento — ver PENDÊNCIAS no handoff do Cronos) e
-- complementada manualmente na seção final com um índice único parcial que
-- o Prisma Schema DSL não é capaz de expressar (cláusula WHERE em índice).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'operator');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'validated', 'contacted', 'responded', 'negotiating', 'won', 'discarded');

-- CreateEnum
CREATE TYPE "PhoneType" AS ENUM ('mobile', 'landline', 'unknown');

-- CreateEnum
CREATE TYPE "SearchJobStatus" AS ENUM ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "SearchTaskStatus" AS ENUM ('pending', 'running', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "LeadSourceType" AS ENUM ('google_maps_scrape');

-- CreateEnum
CREATE TYPE "LeadActivityActor" AS ENUM ('user', 'system', 'lead');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'operator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ufs" (
    "sigla" VARCHAR(2) NOT NULL,
    "nome" TEXT NOT NULL,
    "regiao" TEXT NOT NULL,

    CONSTRAINT "ufs_pkey" PRIMARY KEY ("sigla")
);

-- CreateTable
CREATE TABLE "cities" (
    "ibgeCode" VARCHAR(7) NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "uf" VARCHAR(2) NOT NULL,
    "population" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("ibgeCode")
);

-- CreateTable
CREATE TABLE "search_jobs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "uf" VARCHAR(2) NOT NULL,
    "cityIbgeCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxResultsPerCity" INTEGER NOT NULL DEFAULT 120,
    "status" "SearchJobStatus" NOT NULL DEFAULT 'queued',
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "doneTasks" INTEGER NOT NULL DEFAULT 0,
    "failedTasks" INTEGER NOT NULL DEFAULT 0,
    "leadsFound" INTEGER NOT NULL DEFAULT 0,
    "leadsNew" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "search_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_tasks" (
    "id" TEXT NOT NULL,
    "searchJobId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "queryString" TEXT NOT NULL,
    "status" "SearchTaskStatus" NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneRaw" TEXT,
    "phoneE164" TEXT,
    "phoneType" "PhoneType" NOT NULL DEFAULT 'unknown',
    "address" TEXT,
    "cityId" TEXT NOT NULL,
    "uf" VARCHAR(2) NOT NULL,
    "website" TEXT,
    "category" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "externalRef" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" "LeadSourceType" NOT NULL DEFAULT 'google_maps_scrape',
    "sourceUrl" TEXT NOT NULL,
    "sourceQuery" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "searchJobId" TEXT NOT NULL,
    "searchTaskId" TEXT,
    "engineId" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "actor" "LeadActivityActor" NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "cities_uf_population_idx" ON "cities"("uf", "population");

-- CreateIndex
CREATE UNIQUE INDEX "cities_uf_slug_key" ON "cities"("uf", "slug");

-- CreateIndex
CREATE INDEX "search_jobs_status_createdAt_idx" ON "search_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "search_jobs_uf_createdAt_idx" ON "search_jobs"("uf", "createdAt");

-- CreateIndex
CREATE INDEX "search_jobs_niche_uf_status_idx" ON "search_jobs"("niche", "uf", "status");

-- CreateIndex
CREATE INDEX "search_tasks_searchJobId_status_idx" ON "search_tasks"("searchJobId", "status");

-- CreateIndex
CREATE INDEX "search_tasks_status_priority_idx" ON "search_tasks"("status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "search_tasks_searchJobId_cityId_key" ON "search_tasks"("searchJobId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_dedupeKey_key" ON "leads"("dedupeKey");

-- CreateIndex
CREATE INDEX "leads_phoneE164_idx" ON "leads"("phoneE164");

-- CreateIndex
CREATE INDEX "leads_status_createdAt_idx" ON "leads"("status", "createdAt");

-- CreateIndex
CREATE INDEX "leads_cityId_idx" ON "leads"("cityId");

-- CreateIndex
CREATE INDEX "leads_searchJobId_idx" ON "leads"("searchJobId");

-- CreateIndex
CREATE INDEX "leads_uf_idx" ON "leads"("uf");

-- CreateIndex
CREATE INDEX "leads_name_idx" ON "leads" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "leads_address_idx" ON "leads" USING GIN ("address" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "lead_activities_leadId_createdAt_idx" ON "lead_activities"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_uf_fkey" FOREIGN KEY ("uf") REFERENCES "ufs"("sigla") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_jobs" ADD CONSTRAINT "search_jobs_uf_fkey" FOREIGN KEY ("uf") REFERENCES "ufs"("sigla") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_jobs" ADD CONSTRAINT "search_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_tasks" ADD CONSTRAINT "search_tasks_searchJobId_fkey" FOREIGN KEY ("searchJobId") REFERENCES "search_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_tasks" ADD CONSTRAINT "search_tasks_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("ibgeCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("ibgeCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_uf_fkey" FOREIGN KEY ("uf") REFERENCES "ufs"("sigla") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_searchJobId_fkey" FOREIGN KEY ("searchJobId") REFERENCES "search_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_searchTaskId_fkey" FOREIGN KEY ("searchTaskId") REFERENCES "search_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Índice único PARCIAL, escrito à mão (Prisma Schema DSL não expressa
-- cláusula WHERE em índice) — reforça no banco a regra de negócio de
-- POST /api/v1/searches: só pode existir 1 SearchJob "ativo" (queued|running)
-- por combinação (niche, uf). A API já checa isso antes de inserir e devolve
-- 409 SEARCH_ALREADY_RUNNING, mas essa é só uma corrida de leitura-antes-de-
-- escrever — sem o índice, duas requisições concorrentes (duplo clique,
-- retry de rede) podem passar pela checagem da API ao mesmo tempo e criar
-- dois jobs ativos idênticos. O índice é quem garante isso de verdade.
--
-- ⚠️ ARMADILHA PARA QUEM MEXER NESTA MIGRAÇÃO NO FUTURO: como este índice
-- não tem representação no schema.prisma (Prisma não suporta WHERE em
-- @@index/@@unique), rodar `prisma migrate dev` para gerar uma NOVA migração
-- a partir daqui vai comparar o "estado desejado" (schema.prisma) com o
-- "estado calculado pelo histórico de migrations" — e como o schema.prisma
-- não sabe deste índice, o Prisma vai propor DROP INDEX nele. NÃO aceite
-- esse DROP automaticamente. Se isso acontecer, edite a migração gerada
-- para remover o DROP INDEX, ou use `prisma migrate dev --create-only` e
-- ajuste à mão antes de aplicar.
-- ─────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "search_jobs_active_niche_uf_key"
    ON "search_jobs" ("niche", "uf")
    WHERE "status" IN ('queued', 'running');
