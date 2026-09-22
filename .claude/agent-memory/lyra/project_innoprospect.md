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

**4ª rodada — Onda 2B (2026-09-22, mesma sessão do dia, EM PARALELO com a
Onda 2A que cobriu leads/templates):** dois bugs reais relatados pelo dono em
produção, ambos em `/buscas/[id]`: (1) busca com os 5 municípios falhando e
0 leads aparecia com selo verde "Concluída" — `SearchJobStatus.completed` só
diz "terminou de rodar", não diz nada sobre resultado; (2) a barra de
progresso usava `job.progress.percent` (fórmula não documentada no
contrato) enquanto o rótulo ao lado usava `done`/`total` — podiam
contradizer. Corrigido derivando um "outcome" visual (`completed_success` /
`completed_partial` / `completed_empty`) só de `done`/`failed`/`total` (já
existiam no contrato, nenhum campo novo pedido) — ver
[[convention-derive-outcome-from-progress-not-status]] pro detalhe técnico e
o porquê isso é candidato a repetir em `CampaignTarget` na Fase 4. Também
redesenhei `/buscas` (lista: selos com ícone consistentes, nomes truncados
em vez de quebrar linha), `/buscas/nova` (2 colunas com `SearchSummaryPanel`
ao vivo mostrando município/tempo/teto de leads — dado real do banco,
`Uf.cityCount`, que já existia e não era usado; `<details>` nativo com
chevron animado em vez de cru), `/whatsapp` (badge `health===ok` escondido
por redundante com o status + borda; ação "Excluir" saiu de link vermelho
solto pra dentro de `DropdownMenu`, ícone só — achei e corrigi
[[bug-card-header-kebab-overflow-mobile]] nessa mudança) e `/campanhas`
(saiu de `ComingSoon` genérico pra `CampaignRoadmap`, 6 etapas honestas
extraídas de ARQUITETURA.md §8 Fase 4, sem nenhuma data inventada).
Incidente à parte: subi um `next dev` extra numa porta separada pra testar
com Playwright e corrompi o `.next` compartilhado (porta 3000) — mesmo
padrão que a Onda 2A já tinha documentado em
[[bug-shared-next-dev-cache-conflict]], reincidência independente. Recuperei
matando os dois processos e subindo de novo o compartilhado limpo com
`NEXT_PUBLIC_USE_MOCKS=true` e um novo `NEXTAUTH_SECRET` efêmero
(`innoprospect-shared-dev-secret`) — qualquer cookie de sessão mintado antes
dessa hora ficou inválido, seria preciso mintar de novo.

**4ª rodada — "layout premium", Onda 1 de 2 (2026-09-22):** o dono pediu uma
segunda passada de polimento ("nada de telas simples sem vida") depois de já
ter aprovado a 3ª rodada (painel/landing). Esta onda cobriu só **fundação +
login + shell + configurações** — leads/buscas/templates/whatsapp/campanhas/
painel ficam pra Onda 2 (outro agente, em paralelo, a partir dos primitivos
daqui).

Fundação nova em `components/ui/*`/`components/common/*` (é o que a Onda 2
deve reusar, não recriar):
- `Card` (`components/ui/card.tsx`) ganhou `variant` via `cva`: `flat`
  (padrão, idêntico ao comportamento antigo — nenhuma tela existente
  regrediu, confirmado por screenshot em `/leads`, `/whatsapp`, `/templates`,
  `/buscas`), `elevated` (`shadow-md` fixo) e `interactive` (hover
  `shadow-md` + `motion-safe:hover:-translate-y-0.5` — a variante nativa
  `motion-safe:` do Tailwind, sem CSS custom nenhum, desliga sozinha em
  `prefers-reduced-motion: reduce`).
- `components/ui/dropdown-menu.tsx` — 1º uso do nível "popover" da escala de
  elevação (`bg-popover`+`shadow-lg`, um degrau acima do Card `elevated`).
  Precisou instalar `@radix-ui/react-dropdown-menu` (não quebra a convenção
  "Radix só onde compensa" — menu com teclado/foco/Escape é exatamente onde
  compensa). Animação à mão em `globals.css` (`.inno-popover-content`,
  mesma técnica de `opacity`+`scale` isolado do Dialog, nunca `transform`
  puro — o Radix já usa `transform` pra posicionar via Popper).
  **`DropdownMenuItem variant="destructive"` colore só o ÍCONE, nunca o
  texto** — reincidência da armadilha de [[feedback-dual-role-color-tokens]]
  (`--destructive` no dark mede 3.58:1, abaixo do piso 4.5:1 de texto).
- `components/common/page-header.tsx` — título/descrição/ação, formaliza o
  padrão que Configurações/painel já repetiam à mão.
- `components/common/permission-denied-state.tsx` — mesma família visual de
  `EmptyState`/`ErrorState`, pra quando `session.user.role` (admin/operator)
  ganhar a 1ª checagem de verdade (nenhuma tela usa ainda).
- `components/common/card-grid-skeleton.tsx` — companheiro de `LoadingRows`
  pra loading de telas em grade de card (Buscas/WhatsApp na Onda 2).

Login (`app/(auth)/*`, `components/auth/*`): layout de 2 painéis
(`AuthBrandPanel`, novo, Server Component — prova do produto com as 3
features REALMENTE prontas hoje, nunca "disparo em massa"/Campanhas) +
formulário (mesma lógica de `login()`, só toggle de mostrar/ocultar senha
como estado cosmético novo). `AuthLayout` perdeu o `max-w-sm` fixo — cada
página do grupo decide a própria largura agora.

Shell (`components/shell/*`): `NAV_ITEMS` virou `NAV_SECTIONS` (agrupado —
Visão geral / Prospecção / Canais / Sistema), `Sidebar` e `MobileNav`
iteram seções agora. Botão "Sair" solto do `Topbar` virou
`components/shell/user-menu.tsx` (dropdown com nome/e-mail/papel + Sair) —
`Topbar` voltou a ser Server Component, recebe `user` de
`app/(dashboard)/layout.tsx` (agora `async`, única leitura de `auth()` da
árvore do shell, mesmo padrão de `painel/page.tsx`). **`user` pode vir
`null`** (ver [[project-mock-mode-needs-real-session]] — modo mock nunca
tem sessão Auth.js real nesta build) — `UserMenu` trata com fallback neutro,
nunca quebra.

Configurações: `PageHeader` + os 2 cards em grid, "Preferências da conta"
saiu de item cinza morto pra card com pílula "em breve" (mesmo estilo da
pílula `comingSoon` do nav) — sem inventar fase/prazo que o roadmap não
confirma (ARQUITETURA.md §8 não cita essa feature em nenhuma fase numerada).

Favicon: `app/icon.svg` (reaproveita o glifo lucide "radar" exato do
badge de marca, testado em 16/32/180px via Playwright antes de aceitar) +
`app/apple-icon.png` (180×180, gerado renderizando o SVG num `<div>` e
tirando screenshot do elemento — sem lib de rasterização nova). **Achado
bloqueante:** `middleware.ts` redireciona as duas rotas pro `/login` (307) —
ver [[bug-middleware-blocks-metadata-icon-routes]], não corrigido por mim
(fora do meu território).

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

**Onda 2A do redesign (2026-09-22), rodando EM PARALELO com uma "Onda 2B"
(outra sessão, escopo `/buscas`/`/whatsapp`/`/campanhas`) no MESMO working
directory:** meu escopo foi o bug sistêmico de tabela (primitivo
compartilhado, só eu podia tocar `components/ui/table.tsx`) + `/leads`
(lista+ficha) + `/templates` (lista+edição).

- **Bug de tabela — causa raiz não era a tabela.** Ver
  [[bug-table-overflow-flex-min-width]]: faltava `min-w-0` no item flex do
  shell (`app/(dashboard)/layout.tsx`), não no `overflow-auto` da tabela
  (que já existia). Medido antes/depois com Playwright: `PAGE_OVERFLOW`
  (scrollWidth−clientWidth do `<html>`) foi de 192px/78px pra 0px. Também
  adicionei sombra de rolagem 100% CSS (`.inno-table-scroll`,
  `app/globals.css`) — a barra de rolagem fina/só-no-hover do SO não era
  sinal forte o bastante de "tem mais coluna pra rolar". Estratégia de
  prioridade de coluna (documentada em `LeadTable`/`TemplateTable`): colunas
  essenciais sempre visíveis, colunas de enriquecimento saem do fluxo em
  telas estreitas (`hidden lg:table-cell`/`hidden xl:table-cell`) em vez de
  forçar rolagem, e texto de tamanho variável é truncado com `title`
  (tooltip acessível) — nunca "perdido".
- **CSV export + ações em massa** (backend já existia, sem tela —
  `lib/services/leads.ts`, `POST/GET /api/v1/leads/{bulk,export}`) ganharam
  interface: seleção de linha (`LeadTable`) + `LeadBulkToolbar` (set
  status/add tag/remove tag) + botão "Exportar CSV" no `PageHeader` de
  `/leads`. Mock do CSV duplica a FORMATAÇÃO (BOM/separador `;`/decimal com
  vírgula) do `lib/services/leads.ts` de propósito — aquele arquivo importa
  `@inno/db` (Prisma), que não pode entrar no bundle do client; as colunas
  (`LEAD_EXPORT_COLUMNS`) vêm de `@inno/contracts` sem duplicação (zod puro,
  seguro nos dois lados). Ver `mocks/leads.ts` (`mockExportLeadsCsv`,
  `mockBulkUpdateLeads`) e `lib/download.ts` (helpers novos e reutilizáveis
  de download de URL/Blob).
- **Incidente operacional real, registrado em
  [[bug-shared-next-dev-cache-conflict]]:** subir um `next dev` numa porta
  separada (só pra mintar um cookie de sessão de teste) E depois rodar
  `pnpm build`, ambos no MESMO diretório `apps/web` de um `next dev`
  compartilhado (usado pela Onda 2B/pelo dono), corrompeu o `.next` de
  todo mundo — `/` chegou a devolver 500. Recuperado com
  `rm -rf apps/web/.next` + ~15-20s de espera (o `next dev` vivo recompila
  sozinho). Lição prática: NUNCA rodar `next dev`/`next build` extra num
  diretório com um dev server compartilhado vivo — usar só `pnpm
  typecheck`/`lint`/`test` (não tocam `.next`) como portão nesses casos.
