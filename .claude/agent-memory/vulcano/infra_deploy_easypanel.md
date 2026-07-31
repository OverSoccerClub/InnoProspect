---
name: infra-deploy-easypanel
description: Estado da entrega de deploy (Fase 5.5) — Dockerfiles, compose completo, DEPLOY.md, decisões e pendências para EasyPanel
metadata:
  type: project
---

Entrega de 2026-07-31 (item 5.5 puxado para frente — dono decidiu ir para GitHub + EasyPanel/VPS antes
de fechar a Fase 1). Arquivos entregues:

- `apps/web/Dockerfile` (novo) — multi-stage pnpm+Prisma+Next standalone, non-root, porta configurável via `PORT`.
- `apps/web/docker-entrypoint.sh` (novo) — `prisma migrate deploy --schema=packages/db/prisma/schema.prisma` fail-fast antes do server subir.
- `apps/web/next.config.ts` — adicionei `output: 'standalone'` + `outputFileTracingRoot` (não existiam antes).
- `apps/worker/Dockerfile` (revisado) — corrigi bug real de hoisting (ver [[feedback_pnpm_docker_monorepo_gotchas]]), adicionei stage `prod-deps` (imagem menor) e usuário não-root `pwuser` (Chromium não roda como root sem `--no-sandbox`).
- `.dockerignore` (raiz + `apps/web/` + `apps/worker/`).
- `infra/docker-compose.yml` (novo) — stack completa (web+worker+postgres+redis+evolution) de referência, NÃO é o mecanismo de deploy do EasyPanel (lá cada serviço é criado avulso pela UI).
- `DEPLOY.md` (novo, raiz) — passo a passo EasyPanel: ordem de serviços, tabela de env var por serviço, geração de `NEXTAUTH_SECRET`, health check em `/api/v1/health`, seed manual pós-migração, seção explícita "o que não está resolvido".
- `turbo.json` — task `generate` nova, `build`/`typecheck`/`dev` dependem de `^generate`+`generate` — corrige o item do PROGRESSO.md ("`@inno/db` sem `generate` no grafo, quebra silenciosamente"). **Validado de verdade**: rodei `pnpm typecheck` local e confirmei que `prisma generate` roda automaticamente antes do typecheck de `web`/`worker`, 8/8 tasks OK.
- `.env.example` — revisado contra `grep -r "process.env\."` real no código (não só contra `ARQUITETURA.md §10`). Achei e documentei `ADMIN_EMAIL`/`ADMIN_NAME`/`ADMIN_PASSWORD` (seed), `NEXT_PUBLIC_USE_MOCKS`/`NEXT_PUBLIC_API_BASE_URL` (build-time, não runtime — anotado), `PORT`, `RUN_MIGRATIONS`, `SCRAPE_CONTEXT_TTL` que não estavam documentados antes.

## Decisões-chave
- Health check é `GET /api/v1/health` (já existia, feito por Vega/Íris antes desta entrega) — público no `middleware.ts`, faz `SELECT 1` real no Postgres. Não criei rota nova.
- `NEXT_PUBLIC_USE_MOCKS=false` já vem hardcoded como default no build do Dockerfile (produção real de saída, sem precisar o dono lembrar de configurar — resolve o item pendente do PROGRESSO.md sozinho, sem intervenção humana).
- Evolution API: imagem `atendai/evolution-api`, versão pinada (nunca `latest`, risco R4 do ARQUITETURA.md) — **tag exata NÃO confirmada** (sem acesso à internet nesta sessão), `v2.2.3` é só ponto de partida em `infra/docker-compose.yml`/`DEPLOY.md`. Confirmar antes do deploy real.
- Banco da Evolution API: recomendo banco Postgres SEPARADO (`evolution`) do banco do app (`innoprospect`) — documentado em `DEPLOY.md §2` e `infra/docker-compose.yml`, com aviso de que precisa criar o banco manualmente (compose não faz isso sozinho).

## O que NÃO fiz / não pude validar
- Nenhum `docker build`/`docker compose up` real — sem Docker nesta máquina. Ver `DEPLOY.md §0` para o aviso completo repassado ao dono.
- `infra/backup/pg-dump.sh` (mencionado na estrutura de pastas do ARQUITETURA.md §2) — **não criado**. Backup+restore testado do Postgres continua em aberto, sinalizado explicitamente em `DEPLOY.md §8`.
- Alertas/observabilidade pós-deploy (Fase 5.6) — fora do escopo desta entrega, sinalizado como pendência.

Ver [[feedback_pnpm_docker_monorepo_gotchas]] para o bug técnico encontrado e corrigido, e
[[project_innoprospect]] para o contexto geral do projeto.
