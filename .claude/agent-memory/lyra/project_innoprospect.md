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

**Identidade visual / sistema de design (entregue em 2026-08-03):** `DESIGN-SYSTEM.md` na raiz é a
fonte da verdade — paleta OKLCH própria do InnoProspect (hue≈231, azure, deliberadamente distinta do
navy da InnovareCode hue≈262), tipografia via `next/font` (Inter + Plus Jakarta Sans, self-hosted,
respeita a CSP do Vulcano), tema claro/escuro com toggle (`components/theme/*`, chave de localStorage
`inno-prospect-theme`) e semântica de cor de status documentada para os 4 domínios do produto (lead,
saúde de instância WhatsApp, status de campanha incl. `halted` vs. `paused`, target de campanha).
Refinei todos os primitivos em `components/ui/*` e apliquei em profundidade só nas 5 telas de maior
visibilidade (login, shell, dashboard, leads lista+ficha) — Buscas/Templates/WhatsApp/Opt-outs/
Campanhas/Descadastro herdam a base de tokens/componentes automaticamente mas não foram redesenhadas
tela a tela; ficou para uma próxima rodada (contexto já registrado no DESIGN-SYSTEM.md §5 e §8, em
especial um bug real encontrado no `InstanceHealthBadge` — `degraded` e `blocked` mapeiam pra mesma cor
hoje, precisa diferenciar). Ver [[feedback-dual-role-color-tokens]] para o achado técnico principal
(um token de cor não serve pros dois papéis "fill+texto branco" e "texto sobre fundo escuro" ao mesmo
tempo, sobretudo em vermelho) — isso também corrigiu um bug de contraste real e pré-existente no
componente `Alert` (`success` com texto branco sobre fundo quase-branco, 1.02:1 de contraste).

**Fase 3 (entregue em 2026-08-01):** Templates (lista + editor `[id]/page.tsx`, tratando `id==='novo'`
como criação, com preview local de spintax — ver `lib/spintax.ts`), Instâncias de WhatsApp
(`app/(dashboard)/whatsapp`, cards com QR polling de 2s via `usePolling`), Opt-outs
(`app/(dashboard)/configuracoes/optouts`) e a página pública `app/descadastro/[token]/page.tsx` (sem
`AuthGuard`, sem sidebar — layout próprio em `app/descadastro/layout.tsx`). Nessa entrega descobri que o
Vega já tinha publicado `@inno/contracts` de verdade em paralelo — ver [[convention-check-contracts-before-mocking]]
antes de repetir o padrão de tipo local em fases futuras.
