---
name: project-innoprospect
description: Visão geral do projeto InnoProspect — stack, arquitetura contrato, fases e papéis da equipe
metadata:
  type: project
---

InnoProspect é uma plataforma de prospecção B2B: busca empresas por nicho+UF via scraping do Google
Maps, gera Leads deduplicados num CRM leve, e dispara campanhas de WhatsApp via Evolution API (não
oficial, Baileys) com anti-ban (warmup, jitter, quota, opt-out).

**Por que importa:** hospedagem é VPS Linux com Docker Compose (não serverless) — `apps/worker`
precisa de processo Node long-running com Chromium (Playwright), o que define o Dockerfile do worker
e o motivo de o compose de dev existir separado do compose de produção.

## Arquitetura é CONTRATO
`C:\Projetos\Web\InnoProspect\ARQUITETURA.md` (autora: Nova) é a fonte da verdade. §2 (estrutura de
pastas) e §10 (variáveis de ambiente) são as seções que mais me dizem respeito. Mudança em seção
CONTRATO exige aviso ao Atlas antes de codificar — nunca redesenhar por conta própria.

## Decisões-chave que afetam infra
- Monólito modular, 2 processos: `apps/web` (Next.js 15) e `apps/worker` (Node long-running). Não se
  chamam por HTTP — comunicam via Postgres (estado) + Redis/BullMQ (fila).
- BullMQ + Redis para filas (rate limit nativo é essencial pro anti-ban). Redis é volátil por design —
  a verdade está sempre no Postgres (`SearchTask.status`/`CampaignTarget.status` permitem reenfileirar
  tudo se o Redis cair — job `requeue-orphans` no boot do worker, ainda não implementado).
- Evolution API roda em container próprio, versão **pinada** (nunca `latest` — risco R4 do documento),
  rede interna não exposta publicamente (Fase 3.3, minha entrega futura).

## Papéis (não invadir escopo)
- **Cronos**: dono exclusivo de `packages/db/` (schema Prisma, migrations, seed). Trabalha em paralelo
  comigo — nunca tocar nessa pasta, mesmo para "ajudar".
- **Vega**: implementa o conteúdo de `packages/scraper`, `packages/messaging`, `packages/core`,
  `packages/contracts`, as rotas de API em `apps/web/src/app/api`, e os jobs em `apps/worker/src/jobs`.
  Eu só entrego os esqueletos (package.json + tsconfig.json + src/index.ts vazio).
- **Lyra**: telas em `apps/web/src/app/(dashboard)` e `(auth)`.

## Plano faseado (relevante pra mim)
- Fase 1.1 (minha entrega): monorepo, Docker Compose dev, tsconfig, lint, `.env.example`. **Concluída
  em 2026-07-30.**
- Fase 3.3 (minha, futura): container Evolution API + persistência + rede interna não exposta. Já tem um
  esboço em `infra/docker-compose.yml` (entrega da Fase 5.5 abaixo), mas o container real "isolado, testado"
  ainda não subiu (sem Docker na máquina de dev).
- Fase 5.5 (minha, **parcial, 2026-07-31**): Dockerfiles (web+worker), `docker-entrypoint.sh` fail-fast,
  `infra/docker-compose.yml` completo, `DEPLOY.md` (EasyPanel), `turbo.json` com `generate`. **Ainda
  falta**: backup diário do Postgres com restore testado (`infra/backup/pg-dump.sh` não existe), TLS via
  Caddy (decisão do dono foi EasyPanel, que já traz TLS embutido — Caddy do ARQUITETURA §2 pode não ser
  mais necessário, confirmar com Atlas se isso muda a estrutura de pastas prevista), rollback é o nativo
  do EasyPanel via health check, não configurado por mim manualmente.
- Fase 5.6 (minha + Vega, futura): logs estruturados, alertas (scraper quebrado, número banido,
  Evolution fora do ar). Ainda não iniciado.

Ver [[infra_monorepo_scaffold]] para o que já foi montado, [[infra_docker_compose_dev]] para o compose
de dev, e [[infra_deploy_easypanel]] para a entrega de deploy da Fase 5.5.
