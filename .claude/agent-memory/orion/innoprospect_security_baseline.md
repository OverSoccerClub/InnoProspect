---
name: innoprospect-security-baseline
description: Estado da auditoria de segurança pré-go-live do InnoProspect (2026-07-31) — decisões de arquitetura relevantes, padrão de defesa em profundidade do projeto, e o que ficou pendente.
metadata:
  type: project
---

Primeira auditoria de segurança do InnoProspect, feita antes do primeiro deploy no EasyPanel
(2026-07-31). Nesta data só a Fase 1 (busca de leads via scraping) está implementada — Fases 3/4
(WhatsApp/campanhas) e Fase 5 (hardening) ainda não existem no código, mesmo já documentadas na
arquitetura.

**Padrão de defesa em profundidade do projeto (bom, preservar):** toda rota `/api/v1/*` passa por
`apiRoute()` (`apps/web/src/lib/api-handler.ts`), que chama `auth()` (Auth.js) **dentro da própria
rota**, independente do `middleware.ts`. Ou seja, mesmo que o middleware seja contornado, as rotas de
API continuam exigindo sessão válida. As páginas do dashboard são 100% client components que buscam
dado via essas mesmas rotas (nenhum Server Component lê Prisma direto) — então não há vazamento de
dado real mesmo se só o middleware falhar. **Isso é o que reduziu a severidade do achado do Next.js
15.1.4 (CVE-2025-29927, bypass de middleware por header `x-middleware-subrequest`) de "vazamento de
dado" para "bypass do redirect de login" apenas.** Ao revisar código novo: se alguém adicionar um
Server Component que lê Prisma/serviço diretamente (bypassando `api-handler.ts`), essa camada de
proteção deixa de existir para aquela rota — sinal de alerta a vigiar em futuras revisões.

**Modelo de acesso é "autenticado = pode tudo" por decisão consciente** (ARQUITETURA §1.4, §0):
poucos usuários internos, sem multi-tenancy (`ownerId` existe mas não é usado para filtrar). Não é
IDOR — é o modelo pretendido. `role: admin|operator` existe no schema/sessão mas nenhuma rota ainda
checa role (porque nenhuma rota que precisaria — DELETE /optouts, bulk actions — está implementada
ainda). Quando essas rotas forem implementadas (Fase 3+), confirmar que checam `session.user.role`.

**Rate limit de login foi decisão consciente de adiar para Fase 5** (ARQUITETURA §1.4) — só há
mitigação de timing attack (`DUMMY_PASSWORD_HASH` em `apps/web/src/lib/auth.ts`, comparação bcrypt
mesmo quando o e-mail não existe). Aceitável para poucos usuários internos, mas o domínio vai ficar
exposto à internet pública via EasyPanel — reavaliar se/quando o número de usuários crescer ou se
houver qualquer sinal de tentativa de força bruta nos logs.

**LGPD (§7):** os campos de origem obrigatórios (`sourceType`, `sourceUrl`, `sourceQuery`,
`collectedAt`, `searchJobId`, `engineId`) SÃO gravados no `Lead` desde a Fase 1
(`packages/db/prisma/schema.prisma`, bloco "ORIGEM" do model `Lead`; preenchido em
`apps/worker/src/jobs/scrape-search.job.ts`). O que falta é só o *exercício* dos direitos do titular:
não existe ainda `/descadastro/:token`, `POST /api/v1/optouts`, nem `retention.job.ts` — tudo
Fase 3/5, ainda não implementado. Como a Fase 1 só coleta e lista (nenhum disparo de WhatsApp ainda
acontece), o risco prático hoje é baixo, mas **isso precisa existir antes de qualquer disparo real
(Fase 3)** — não é opcional, é o "portão inegociável" da própria arquitetura (§6.7).

**Logging está limpo:** nenhum grep encontrou telefone/e-mail/senha/hash sendo logado em
`apps/web/src/lib/logger.ts` ou `apps/worker/src/observability/logger.ts` — só ids, contagens e
mensagens de erro. Manter esse padrão ao revisar código novo.

**`.env.example` e `.dockerignore` (raiz + apps/web + apps/worker) confirmados limpos** — sem
segredo real, `.env*`/`.git`/`.claude` bloqueados do contexto de build em todos os três arquivos.

Ver também [[innoprospect-pending-gologive-items]] para a lista de achados por severidade da
auditoria de 2026-07-31.
