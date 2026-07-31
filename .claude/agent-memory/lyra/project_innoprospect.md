---
name: project-innoprospect
description: Contexto do projeto InnoProspect (prospecção B2B) — stack, papel da Lyra e como ela coordena com Vega/Nova
metadata:
  type: project
---

InnoProspect é um monorepo pnpm workspaces + Turborepo (`C:\Projetos\Web\InnoProspect`), Next.js 15
App Router + Tailwind 4 + Prisma/Postgres + worker Node separado (scraping do Google Maps + disparo
WhatsApp via Evolution API). Arquitetura fechada em `ARQUITETURA.md` (autora: Nova) — §2 é contrato de
estrutura de pastas, §4 é contrato de API. Fases do produto em §8 do mesmo arquivo.

**Meu escopo (item 1.6 da Fase 1, entregue em 2026-07-30):** login mock, shell do dashboard
(sidebar+topbar+nav), fluxo "Nova busca" → progresso ao vivo (polling 3s) → tabela de leads com
filtros → ficha do lead com timeline. Tudo em `apps/web/src/`.

**Por que:** Fase 1 do produto é deliberadamente mínima — "buscar 1 nicho em 1 cidade e ver a lista de
leads" (ARQUITETURA.md §8, Fase 1). As rotas de API reais (`apps/web/src/app/api/v1/*`) são do Vega e
não existiam ainda quando fiz essa entrega — só o esqueleto do Next e o `packages/contracts` vazio
(placeholder) estavam prontos.

**Como aplicar:** Antes de mexer em telas de outras fases (templates, campanhas, WhatsApp), primeiro
checar se as rotas de API correspondentes já existem em `apps/web/src/app/api/v1/` — se não existirem,
repetir o padrão de mocks descrito em [[convention-mock-api-layer]]. Nunca criar nem editar nada dentro
de `apps/web/src/app/api/` ou `apps/web/src/lib/api-handler.ts` (território do Vega) nem em `packages/*`
(território de Cronos/Vega/Nova) — declarar tipos localmente em `apps/web/src/types/` com comentário
`// TODO: trocar por import de @inno/contracts quando o Vega publicar` até o pacote de contratos ser
publicado de verdade.

Ver também [[bug-rsc-client-icon-props]] (bug de build descoberto e corrigido nessa entrega).
