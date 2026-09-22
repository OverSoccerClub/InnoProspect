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

**Identidade visual / sistema de design — 2ª rodada (2026-08-03, mesma sessão do Atlas, commit da 1ª
rodada `c353708`):** corrigi o bug que eu mesma tinha documentado (`InstanceHealthBadge`: `degraded`
e `blocked` caíam na mesma cor — agora `degraded`=warning/`TrendingDown`, `blocked`=destructive/
`AlertOctagon`, com ícone em todo badge de status/saúde de WhatsApp e borda de severidade no
`InstanceCard`). Redesenhei Templates (editor+preview+variable-picker), Opt-outs, o placeholder de
Campanhas, e a página pública de descadastro (a única que um estranho vê sem contexto — tratada como
peça de marca: halo, wordmark, ícone de estado em círculo, rodapé anti-phishing explicando o que é o
InnoProspect). Deixei prontos (sem tela ainda) `components/campaigns/{campaign-status-badge,
campaign-target-status-badge}.tsx`, importando `CampaignStatus`/`CampaignTargetStatus` direto de
`@inno/contracts` — usar esses componentes quando a Fase 4 chegar, não recriar a lógica de cor.
Também tornei `Sidebar` e `Topbar` sticky (`sticky top-0`/`h-screen`) — isso quebra qualquer painel
com `lg:sticky lg:top-4` que dependa de colar no topo real da viewport (ex.: preview do editor de
templates); o ajuste foi usar `lg:top-20` (56px do Topbar + folga) em vez de `top-4`. Se adicionar
outro painel sticky dentro do dashboard, lembrar desse offset.

**Identidade visual / sistema de design — 1ª rodada (entregue em 2026-08-03):** `DESIGN-SYSTEM.md` na raiz é a
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

**3ª rodada, refinamento (2026-09-22, mesma sessão):** o dono reprovou a 1ª
entrega do painel ("fraca e fria") e pediu ajustes na landing. Painel virou
redesenho completo em cima de `GET /api/v1/dashboard/summary`, construído
pelo Vega EM PARALELO — troquei meu tipo local (`types/dashboard.ts`) por
reexport de `@inno/contracts` assim que vi `packages/contracts/src/
dashboard.contract.ts` aparecer no `git status` (bateu campo a campo com o
que eu tinha escrito combinando com o Atlas antes; ver
[[convention-check-contracts-before-mocking]] — aconteceu de novo, 3ª vez
nesta squad). Detalhes técnicos (gráficos em SVG próprio, estado de primeiro
acesso, cor dos indicadores, animações) em DESIGN-SYSTEM.md §9.4. Landing:
título do hero cortado de 97 pra ~35 caracteres, mockup redesenhado mais
pesado, 3 seções trocaram de "grid de cards" pra composições variadas
(stepper horizontal, seção dividida com 2º/3º mockup do produto, faixa de
estatística) — DESIGN-SYSTEM.md §9.1/§9.2.

**Identidade visual / sistema de design — 3ª rodada, "layout premium"
(2026-09-22):** landing pública em `/` (`app/page.tsx` +
`components/marketing/*` — header, hero com mockup do produto 100% em
código, como-funciona, recursos, conformidade/LGPD, CTA final, rodapé) e o
painel saiu de `/` para `/painel` (`app/(dashboard)/painel/page.tsx`, novo
hero de boas-vindas com saudação via `auth()` + `components/dashboard/
overview-kpis.tsx` + `components/dashboard/queue-health-banner.tsx` — este
último é a primeira UI pra `GET/POST /api/v1/scraper/queue`, endpoint que já
existia sem tela nenhuma consumindo). Rotas que mudaram: nav "Visão geral",
logo da sidebar, redirect pós-login (`lib/auth-client.ts`) e redirect de
`/login` autenticado (`middleware.ts`) — todos passaram a apontar pra
`/painel`. Único ponto sensível: liberar `/` no middleware por checagem
EXATA (`pathname === '/'`), nunca acrescentando `'/'` a
`PUBLIC_PATH_PREFIXES` (que usa `startsWith`, e bateria em toda rota do
sistema). Ver DESIGN-SYSTEM.md §9 para os padrões novos (hero/mockup,
ritmo de seção de marketing, semântica do banner de saúde), e
[[bug-layered-card-absolute-overlap]] +
[[bug-dev-csp-blocks-hydration]] + [[convention-test-session-cookie]] para
os três achados técnicos da rodada — o último documenta como testei o
painel (atrás de login real) sem Postgres rodando nesta máquina.

**Fase 3 (entregue em 2026-08-01):** Templates (lista + editor `[id]/page.tsx`, tratando `id==='novo'`
como criação, com preview local de spintax — ver `lib/spintax.ts`), Instâncias de WhatsApp
(`app/(dashboard)/whatsapp`, cards com QR polling de 2s via `usePolling`), Opt-outs
(`app/(dashboard)/configuracoes/optouts`) e a página pública `app/descadastro/[token]/page.tsx` (sem
`AuthGuard`, sem sidebar — layout próprio em `app/descadastro/layout.tsx`). Nessa entrega descobri que o
Vega já tinha publicado `@inno/contracts` de verdade em paralelo — ver [[convention-check-contracts-before-mocking]]
antes de repetir o padrão de tipo local em fases futuras.
