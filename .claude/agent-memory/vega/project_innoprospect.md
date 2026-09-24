---
name: project-innoprospect
description: Contexto do InnoProspect e o que o Vega entregou na Fase 1 (worker + API + auth real)
metadata:
  type: project
---

InnoProspect é um monorepo pnpm workspaces + Turborepo (`C:\Projetos\Web\InnoProspect`), Next.js 15
App Router + Prisma/Postgres + worker Node separado (scraping do Google Maps + disparo WhatsApp via
Evolution API, fases futuras). Arquitetura fechada em `ARQUITETURA.md` — §2 estrutura de pastas
(CONTRATO), §4 contratos de API (CONTRATO), §5.3/§5.6 fila/retry/backoff (CONTRATO). Fases em §8.

**Meu escopo entregue (itens 1.4, 1.5 e auth real da Fase 1, 2026-07-31):**
- `apps/worker`: fila `scrape-search` real (BullMQ) — `queues.ts`, `scheduler.ts`,
  `jobs/scrape-search.job.ts`, `observability/logger.ts` (pino).
- `apps/web/src/app/api/v1/**`: todas as rotas da Fase 1 (locations, searches, leads, health).
- `apps/web/src/lib/api-handler.ts`, `lib/auth.ts` + `lib/auth.config.ts`, `middleware.ts`: auth real
  Auth.js v5 + wrapper único de rota.

**Meu escopo entregue (item 3.2 da Fase 3, 2026-08-01):** `packages/messaging` completo — cliente
Evolution API + parser de webhook. Detalhe completo em [[convention-messaging-evolution-api]]. Ainda
falta a rota real do webhook em `apps/web` e o dispatch worker (rodadas futuras, dependem do Cronos
terminar `Message`/`OptOut`/`WhatsAppInstance` no schema).

**Meu escopo entregue (Onda 1 pós-revisão, 2026-08-03 — REVISAO-ARQUITETURA.md/REVISAO-QA.md):**
"o sistema consegue dizer que está quebrado". Liguei `evaluateSanity` (A1-A4, estava escrita e testada
com zero chamadores) em `apps/worker/src/observability/sanity.ts`, chamado ao fim de cada `SearchTask`
bem-sucedida (`jobs/scrape-search.job.ts`) — grava/resolve `ScraperHealthEvent` e pausa a fila quando
A1/A2 disparam. Troquei o `setTimeout` em memória da pausa de fila por estado persistido no Redis
(`lib/queue-state.ts`, escritor no worker/leitor no web, ver [[convention-worker-redis-state]]) — não
some mais num restart. Adicionei heartbeat do worker (mesma via Redis), `requeue-orphans` no boot
(`jobs/requeue-orphans.ts`, risco R10), `GET /api/v1/health` de verdade (banco/Redis/worker/fila
separados, só o banco decide 200/503) e os endpoints novos `GET /api/v1/scraper/queue` +
`POST /api/v1/scraper/queue/resume` (sem contrato prévio da Nova — documentado no handoff). Também
adicionei rate limit + limite de corpo em `apiRoute` (`rateLimit`/`maxBodyBytes`, `lib/rate-limit.ts`),
aplicado nas duas rotas públicas (webhook Evolution, opt-out público) por achado do Órion. Gotcha de
typecheck descoberto nessa rodada: [[bug-bullmq-client-not-ioredis]].
**Não pude validar:** nada disto rodou contra Postgres/Redis reais (indisponíveis nesta máquina) —
`pnpm typecheck`/`lint`/`test` (164+48 testes existentes) e `next build`/`tsup build` passaram limpos,
mas o comportamento sob concorrência real (claim atômico, sweep de pausa, heartbeat expirando) só se
prova em ambiente com Redis de verdade.

**Meu escopo entregue (Onda 2, 2026-09-22):** alerta webhook do worker (`apps/worker/src/observability/
alerts.ts`, ver [[convention-worker-alerts]]) plugado nas 3 transições de estado da fila (incidente de
sanidade aberto, pausa por erro de coleta, retomada automática) — nunca lança, timeout curto, só
dispara na transição. E rate limit de tentativas de login por e-mail/IP (`lib/auth.ts`, ver
[[convention-login-rate-limit]]) — conta só FALHA (peek antes, `checkRateLimit` só em falha, reset só
do e-mail no sucesso; a primeira versão contava toda tentativa inclusive sucesso, corrigido ainda nesta
rodada antes de fechar — ver a causa raiz lá). Bug de teste novo: [[bug-nextauth-vitest-server-import]].
**Não pude validar (mesma limitação de sempre):** POST real contra um endpoint de webhook (Slack/Google
Chat) não foi testado fora de mock — `fetch` real não disponível/necessário nesta rodada; a lógica de
timeout/erro está testada com `fetch` mockado, mas o formato exato que Slack/Google Chat aceitam não foi
validado contra o serviço real.

**Antes de mim:** `packages/db` (schema+seed, Cronos), `packages/contracts` (Zod, Nova/Cronos),
`packages/core` (dedupe/phone/status/uf, já com `MACHINE_UPDATABLE_FIELDS` pronto), `packages/scraper`
(engine Playwright completo, `runSearch`/`SearchEngine`), `apps/web` telas (Lyra, rodando em mock).

**Meu escopo entregue (§4.9 envio unitário + mensagens reais na ficha, 2026-09-22):** primeiro (e
único) call site de produção de `EvolutionClient.sendText` — `apps/web/src/lib/services/messages.ts`
(`sendLeadMessage`) + `evaluateSendGuard`/`send-window.ts`/`optout-notice.ts` em `packages/core`.
`reason` opcional adicionado ao envelope de erro (`packages/contracts/src/common.ts`, aprovado pelo
Atlas). `getLeadDetail` (`lib/services/leads.ts`) agora devolve `messages`/`lastContactedAt` reais.
Detalhe completo, gaps de contrato preenchidos e por quê, em [[convention-envio-unitario-send-guard]].

**Meu escopo entregue (export CSV + ações em massa, 2026-09-22, decisão do dono: uso próprio):**
`GET /api/v1/leads/export` (streaming, CSV separado por `;`, coluna `descadastrado`) e
`POST /api/v1/leads/bulk` (`set_status`/`add_tags`/`remove_tags`, `expectedCount` obrigatório com
`filter`, resposta por item). Revisei o contrato-rascunho da Fase 1 (nunca consumido) em vez de
versionar por cima. Detalhe completo, motivos e o que não validei em
[[convention-leads-export-bulk]].

**Meu escopo entregue (incidente LAYOUT_CHANGED em produção, 2026-09-22 — fila `scrape-search` estava
auto-pausada):** causa raiz comprovada ao vivo contra o Google Maps real (não suposição) — bug de
timing em `packages/scraper/src/engine/navigate.ts`, não seletor quebrado nem bloqueio do Google.
Detalhe completo em [[bug-navigate-isvisible-no-real-wait]]. Fila continua pausada até Atlas/Vulcano
decidirem retomar (`POST /api/v1/scraper/queue/resume`) — não é chamada minha.

**Meu escopo entregue (lead sem telefone/endereço/categoria em produção, 2026-09-22, mesmo dia):**
seletores do card da lista do Maps (`packages/scraper/src/extraction/selectors.ts`) estavam
quebrados/errados de verdade — endereço sem nenhum seletor que casasse, categoria casando no elemento
da NOTA por acidente — comprovado contra o Maps real (1 busca, 7 cards). Telefone sai direto da lista,
não precisa abrir a ficha (confirmado 7/7). Reescrevi os seletores (âncoras ARIA/estrutura em vez de
classe ofuscada onde deu), as fixtures de teste com HTML real capturado, e adicionei piso absoluto
(20%, amostra >= 20) na assertion A3 de fill-rate de telefone (`packages/scraper/src/sanity/
assertions.ts` + call site em `apps/worker/src/observability/sanity.ts`) — antes A3 só comparava com
média móvel de 7 dias, que é 0 num sistema novo e nunca disparava. Detalhe completo, achados numerados
e o que NÃO ficou provado (o caso específico do lead "Botocenter" 100% vazio não foi reproduzido ao
vivo) em [[bug-maps-card-selectors-drift-2026-09]].

**Meu escopo entregue (Onda 3, 2026-09-23 — alertas no web + A5 + remoção de RawCapture):** estendi
`sendAlert` para `apps/web` (`lib/alerts.ts`, duplicado do worker — [[convention-web-alerts]]) nos 4
eventos que eram silenciosos: instância caindo, instância degradada, campanha parada (kill switch) e
Evolution API com erro (dedupe por código, 15min). Nova assertion A5 (`checkEnrichmentFillRate`,
`@inno/scraper`) pega leads "só com o nome" (todos os campos de enriquecimento vazios ao mesmo tempo)
que A1-A4 nunca cobriam — [[convention-sanity-a5-enrichment]], mesmo arquivo cobre a remoção do model
`RawCapture` (decisão do dono, verificado zero uso antes de apagar, migração destrutiva documentada).
**Não pude validar:** as duas migrações novas não rodaram contra Postgres real (mesma limitação de
sempre); `pnpm typecheck` na raiz (via turbo) fica bloqueado por um lock de arquivo do Windows
(`next dev` rodando em paralelo trava a rename do binário nativo do Prisma) — confirmei tipos corretos
rodando cada pacote individualmente. `ARQUITETURA.md §7.5`/`§2.6` ainda citam `RawCapture` — não
editei (território da Nova), fica pendente.

**Meu escopo entregue (CRUD de usuários + autorização por papel, Onda 4,
2026-09-23 — sessão paralela à Fase 4.C, que estava em `messages.ts`/
`whatsapp-instances.ts`, intocados aqui):** não existia NENHUMA rota de
usuário, e `role` (`admin`|`operator`) só era verificado em UM lugar de todo
o código. Entreguei `/api/v1/users/**` (novo, `@inno/contracts/user.contract.ts`)
E o mecanismo que dá sentido a ele — `requireRole: 'admin'` centralizado em
`apiRoute` (`lib/api-handler.ts`), aplicado também em `/api/v1/whatsapp/
instances/**`, `POST /api/v1/scraper/queue/resume` e `DELETE /api/v1/optouts/
:id` (migrado do `if` ad-hoc que existia só ali). `User.isActive` (soft-delete,
nunca excluir — `SearchJob`/`WhatsAppInstance`/`MessageTemplate`/`Campaign.
createdById` são `onDelete: Restrict`, comprovado antes de decidir) +
autoproteção (não se auto-excluir/rebaixar) + nunca-zero-admin (`SELECT ...
FOR UPDATE` dentro de transação, não validado contra Postgres real). Detalhe
completo, o que não ficou provado, e a colisão de timestamp de migração com o
Cronos (mesmo `schema.prisma`, mesma janela) em
[[convention-admin-role-and-user-crud]].

**Meu escopo entregue (servidores Evolution multi-servidor + correção da
monotonicidade do freio de envio, 2026-09-23, pedido direto do dono +
achado do Órion, mesma rodada):** cifra AES-256-GCM da credencial de cada
`EvolutionServer` (`lib/evolution-server-crypto.ts`), CRUD admin-only
(`/api/v1/evolution-servers/**`) + teste de conexão, bootstrap
(`packages/db/prisma/evolution-servers.ts`), religação do
`EvolutionClient`/webhook para resolver por servidor em vez de env global
(com fallback documentado). Detalhe completo em
[[convention-evolution-servers-multiserver]] — inclui uma PENDÊNCIA que
quebra `pnpm typecheck` em 1 arquivo da Lyra (contrato ficou mais estrito,
decisão do Cronos, não editei território dela). No mesmo commit, corrigi o
bug do Órion em `messages.ts` (`nextSendAllowedAt` gravado com `SET` cego —
podia recuar sob concorrência): [[bug-pace-lock-blind-set-regression]].

**Meu escopo entregue (Fase 4.D — API de campanha sem motor + disparo manual,
2026-09-24, em paralelo com a Lyra montando as telas no mesmo dia):**
`apps/web/src/app/api/v1/campaigns/**` (POST/GET/PATCH/DELETE, ações
start/pause/resume/cancel, disparo manual por alvo) + `lib/services/
campaigns.ts`. Estendi `sendLeadMessage` (`messages.ts`) com contexto de
campanha opcional em vez de duplicar o guard. Preenchi 3 gaps do contrato
(`alreadyTargeted`, `PATCH`, envio manual por alvo) que a Lyra já tinha
documentado como pendentes no `types/campaign.ts` dela — coordenação ficou
visível em tempo real (ela reagiu e já consumiu os nomes exatos que eu
publiquei antes de eu terminar a rodada). Detalhe completo, decisões de
escopo (sem `POST /campaigns/preview`) e o que não ficou provado em
[[convention-campanhas-fase-4d]].

**Como aplicar:** antes de tocar em `apps/web/src/app/api/**`, `lib/api-handler.ts`, `lib/auth*.ts`,
`middleware.ts` ou `apps/worker/**`, ler este arquivo + [[convention-api-routes-fase1]] +
[[bug-nextauth-edge-prisma-split]] + [[bug-nextjs-workspace-ts-source-imports]] antes de reabrir
decisão já tomada. Nunca criar/editar nada em `app/(dashboard)/**`, `app/(auth)/**`, `components/**`
nem `mocks/**` (território da Lyra). `packages/db/prisma/schema.prisma` é território do Cronos por
padrão — só editei em 2026-09-23 porque o Atlas delegou explicitamente a remoção do `RawCapture` e a
extensão do enum `ScraperHealthEventType` nesta rodada; fora de uma delegação explícita como essa,
relatar no handoff em vez de editar.

**Meu escopo entregue (webhook mudo em produção, incidente 2026-09-23, mesmo
dia — pedido direto do dono, 1ª mensagem real enviada):** webhook da
Evolution recusava TODO retorno (status/resposta/opt-out) em silêncio —
validava só a chave GLOBAL do `EvolutionServer`, mas a v2 dá uma `apikey`
PRÓPRIA por instância (achado do dono no painel). Corrigido aceitando as
DUAS candidatas em paralelo (nunca escolhendo uma só, já que não dá para
confirmar qual a Evolution usa sem servidor real disponível) — 4 colunas
novas cifradas em `WhatsAppInstance` (migração aditiva
`20260923150000_instance_webhook_apikey`), captura na criação
(`EvolutionClient.createInstance` agora devolve `apiKey`), comando
operacional `apps/web/scripts/sync-instance-api-keys.ts` para a instância
JÁ PAREADA do dono (só lê `fetchInstances`, nunca reconecta), e log
distinguindo o motivo da recusa (nunca na resposta HTTP, que continua
sempre `404`). Detalhe completo, causa raiz e o que não ficou provado em
[[bug-webhook-apikey-instance-vs-global]].

Ver também [[convention-api-routes-fase1]] (padrões de rota/serviço estabelecidos),
[[convention-messaging-evolution-api]] (cliente Evolution API + webhook parser) e
[[bug-nextauth-edge-prisma-split]]/[[bug-nextjs-workspace-ts-source-imports]]/
[[bug-vitest-fake-timers-retry-backoff]] (bugs corrigidos com causa raiz).
