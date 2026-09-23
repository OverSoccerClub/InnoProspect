-- InnoProspect — Fase 4.B: múltiplos servidores Evolution API.
--
-- POR QUE EXISTE: até esta migração, `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`
-- eram variáveis de ambiente GLOBAIS (packages/messaging/src/client/
-- evolution-client.ts) — um processo só conseguia falar com UM servidor
-- Evolution, e não havia onde configurar um segundo pela tela. Esta migração
-- cria `evolution_servers` (1 linha por servidor/deployment real, com a API
-- key CIFRADA EM REPOUSO — nunca em texto puro) e liga `whatsapp_instances`
-- a ela.
--
-- Gerada com `prisma migrate diff --from-schema-datamodel <snapshot do
-- schema ANTES desta mudança> --to-schema-datamodel prisma/schema.prisma
-- --script` — sem Postgres disponível nesta máquina de desenvolvimento (ver
-- memória `innoprospect-bloqueio-docker`). ⚠️ Esta migração NÃO foi
-- aplicada contra um banco vivo. O `snapshot ANTES` usado já incluía uma
-- mudança concorrente de outra sessão (`User.isActive`, Onda 4/Vega) que
-- estava no working tree no momento — CONFERIDO que ela não aparece no SQL
-- abaixo (o diff comparou contra um "antes" que já a continha, então só as
-- mudanças desta entrega — `evolution_servers` + `whatsapp_instances.
-- evolutionServerId` — entraram no script). É o primeiro `migrate deploy`
-- real quem prova, de fato, que este SQL bate com o datamodel atual — eu
-- escrevi/revisei à mão porque não há shadow database para `migrate dev`
-- confirmar.
--
-- ⚠️ 100% ADITIVA: `CREATE TABLE` nova + `ADD COLUMN` nullable (sem
-- DEFAULT) em tabela existente + índices/FKs novas. Nenhuma linha existente
-- é lida, nenhuma coluna/tabela existente é alterada em significado.
--
-- ── POR QUE NÃO PRECISA DE EXPAND/CONTRACT NESTA ETAPA ─────────────────────
-- `ADD COLUMN "evolutionServerId" TEXT` (nullable, sem DEFAULT) em Postgres
-- ≥11 é operação de METADADO — lock ACCESS EXCLUSIVE de milissegundos,
-- independente do volume de `whatsapp_instances` (hoje dezenas de linhas,
-- de qualquer forma). `CREATE TABLE`/`CREATE INDEX`/`ADD CONSTRAINT` numa
-- tabela NOVA e vazia (`evolution_servers`) não tem nenhum dado para travar.
--
-- ── A PARTE QUE *PRECISA* DE EXPAND/CONTRACT: A COLUNA FICA NULLABLE AQUI,
--    DE PROPÓSITO — NÃO é a versão final ────────────────────────────────
-- `evolutionServerId` nasce NULLABLE porque toda linha de PRODUÇÃO já
-- existente em `whatsapp_instances` foi criada quando `evolution_servers`
-- nem existia — não há como fazer backfill DENTRO desta migração porque o
-- valor certo (o servidor real que `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`
-- apontam hoje) só existe FORA do banco, na variável de ambiente do
-- processo, não em nenhuma linha já gravada. A sequência completa
-- (obrigatória, nesta ordem):
--   1. Esta migração roda no boot via `prisma migrate deploy` (automático).
--   2. Rodar UMA VEZ, manualmente, o script operacional
--      `packages/db/prisma/evolution-servers.ts bootstrap` (a ser escrito
--      pelo Vega, mesma família de `admin.ts`/`seed.ts` já existentes —
--      roda via `tsx` no container do `web`, JAMAIS via `pnpm`/`tsup` no
--      container do `worker`, que não tem esses binários, ver DEPLOY.md
--      §7.2): lê `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` do ambiente, cria
--      a PRIMEIRA linha de `evolution_servers` com a API key já cifrada, e
--      faz `UPDATE "whatsapp_instances" SET "evolutionServerId" = <id>
--      WHERE "evolutionServerId" IS NULL` — uma única UPDATE, sem risco de
--      lock longo (tabela pequena).
--   3. Confirmar `SELECT count(*) FROM "whatsapp_instances" WHERE
--      "evolutionServerId" IS NULL` = 0.
--   4. SÓ ENTÃO aplicar uma SEGUNDA migração (não incluída aqui de
--      propósito) com `ALTER TABLE "whatsapp_instances" ALTER COLUMN
--      "evolutionServerId" SET NOT NULL` — rodar essa ALTER antes do passo
--      2/3 quebraria TODA instância existente (a migração falharia contra
--      linhas com NULL; forçar um DEFAULT fake para "passar" criaria uma FK
--      para um servidor que não existe). Ver handoff do Cronos para o
--      texto exato desta segunda migração.
-- Até o passo 4 rodar, tratar `evolutionServerId` como OBRIGATÓRIO na
-- camada de aplicação (toda rota nova de criação de instância deve exigir
-- o campo, mesmo que o banco ainda aceite NULL) — o NULL que sobra depois
-- do bootstrap é só das linhas legadas, nunca de uma linha criada depois
-- desta feature existir.
--
-- ── CREDENCIAL CIFRADA — FORMATO (implementação da cifra: Vega) ───────────
-- `apiKeyCiphertext`/`apiKeyIv`/`apiKeyAuthTag` são `BYTEA` (não texto
-- base64) — mapeiam direto para `Buffer` no Node, sem encode/decode manual,
-- e sem os ~33% de overhead que base64 teria em texto. Formato esperado:
-- AES-256-GCM, IV de 12 bytes, auth tag de 16 bytes — CADA cifragem usa um
-- IV novo (nunca reaproveitar IV com a mesma chave). `apiKeyKeyVersion`
-- (INTEGER, default 1) identifica qual versão da CHAVE-MESTRE (não do
-- algoritmo) cifrou aquela linha — existe para permitir rotacionar a
-- chave-mestre sem ter que decifrar/recifrar TODAS as linhas no mesmo
-- instante em que a env var trocar (ver comentário completo no
-- schema.prisma, model `EvolutionServer`).
--
-- ── INTEGRIDADE / FKs ───────────────────────────────────────────────────
-- `evolution_servers.createdById` → `users.id`, RESTRICT: mesmo padrão de
-- `whatsapp_instances.createdById` — não apaga usuário que já cadastrou
-- servidor.
-- `whatsapp_instances.evolutionServerId` → `evolution_servers.id`,
-- RESTRICT: um servidor com QUALQUER instância viva apontando para ele não
-- pode ser apagado por baixo — mesma família do "409 X_IN_USE" já usado em
-- `CampaignInstance.instance`/`MessageTemplate` referenciado por Campaign.
-- Apagar um `EvolutionServer` exige antes mover/apagar todas as
-- `WhatsAppInstance` que apontam para ele (ou só marcar `isActive = false`,
-- sem apagar — caminho preferido: preserva histórico).
-- `evolution_servers.baseUrl` é `UNIQUE` — evita cadastrar o mesmo servidor
-- real duas vezes; depende da aplicação normalizar a URL (sem barra final)
-- antes de gravar/comparar, senão "https://x.com" e "https://x.com/"
-- passam como servidores diferentes.
--
-- ── ÍNDICES ─────────────────────────────────────────────────────────────
-- `whatsapp_instances_evolutionServerId_idx`: NÃO é para o hot path do
-- webhook (esse caminho entra por `instanceKey`, já `@unique`, e o join até
-- `EvolutionServer` é por PK — sempre indexada, sem precisar de índice
-- extra desta ponta). Serve a tela de administração de servidores ("quais
-- instâncias este servidor hospeda") e a checagem "409 SERVER_IN_USE" antes
-- de excluir um servidor.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────
-- Reversível, na ordem inversa:
--   ALTER TABLE "whatsapp_instances" DROP CONSTRAINT "whatsapp_instances_evolutionServerId_fkey";
--   DROP INDEX "whatsapp_instances_evolutionServerId_idx";
--   ALTER TABLE "whatsapp_instances" DROP COLUMN "evolutionServerId";
--   DROP TABLE "evolution_servers";
-- Seguro em qualquer momento ANTES do passo 4 da sequência acima (enquanto
-- a coluna ainda for nullable) — depois que a segunda migração (NOT NULL)
-- rodar, revisar o rollback dela primeiro. Perda de dado no rollback: a
-- configuração de servidor(es) cadastrados manualmente pela tela some junto
-- — o app volta a depender só de `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` em
-- variável de ambiente, então antes de reverter em produção confirmar que
-- essas duas env vars ainda apontam para um servidor válido.

-- AlterTable
ALTER TABLE "whatsapp_instances" ADD COLUMN     "evolutionServerId" TEXT;

-- CreateTable
CREATE TABLE "evolution_servers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyCiphertext" BYTEA NOT NULL,
    "apiKeyIv" BYTEA NOT NULL,
    "apiKeyAuthTag" BYTEA NOT NULL,
    "apiKeyKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evolution_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evolution_servers_baseUrl_key" ON "evolution_servers"("baseUrl");

-- CreateIndex
CREATE INDEX "whatsapp_instances_evolutionServerId_idx" ON "whatsapp_instances"("evolutionServerId");

-- AddForeignKey
ALTER TABLE "evolution_servers" ADD CONSTRAINT "evolution_servers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_evolutionServerId_fkey" FOREIGN KEY ("evolutionServerId") REFERENCES "evolution_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
