# REVISÃO DE ARQUITETURA — InnoProspect

> Autora: Nova (arquitetura) · Data: 2026-08-03 · Base: `ARQUITETURA.md` v1.0 (2026-07-30)
> Método: leitura do código real (`apps/`, `packages/`, `infra/`), não da intenção documentada.
> Escopo: **lacuna entre o projetado e o existente.** Segurança é revisão do Órion; cobertura de
> testes e veredito de qualidade são da Íris — cito onde encosta e sigo adiante.

---

## Sumário executivo (leia isto se não ler mais nada)

O código escrito é de qualidade acima da média: as invariantes duras que defini (seletores em um
arquivo, `buildMachineUpdate` impedindo sobrescrita de dado humano, opt-out retroativo na mesma
transação, `halted ≠ paused`) **foram respeitadas e em vários pontos reforçadas além do que pedi**.
Isso não é elogio de cortesia — é informação: o problema deste projeto não é qualidade de código.

O problema é outro, e é grave: **13.400 linhas foram escritas sem que nenhuma delas jamais tenha
tocado um Postgres, um Redis, o Google Maps ou o WhatsApp.** O sistema nunca coletou um lead e
nunca enviou uma mensagem. O que existe é um sistema plausível, não um sistema verificado.

Três achados que mudam a prioridade de tudo:

1. 🔴 **A rede de proteção contra "sucesso silencioso" do scraper não existe em execução.**
   `evaluateSanity` (A1–A4) está escrita e testada em `packages/scraper/src/sanity/assertions.ts`,
   mas **tem zero chamadores**. Nenhum `ScraperHealthEvent` é gravado por nenhum código. Não há
   canário. `GET /api/v1/health` só faz `SELECT 1`. Escrevi na §5.7 que este era o modo de falha
   mais perigoso do sistema — e é exatamente a parte que ficou como código morto.

2. 🔴 **Nada no sistema chama `sendText`.** O `EvolutionClient` está completo e testado, mas nenhum
   route handler e nenhum job o invoca. A entrega 3.7 ("envio manual para 1 lead") **nunca teve
   contrato no §4** — falha minha, não do Vega: o que não tem contrato não é implementado. O
   critério de aceite da Fase 3 é, hoje, inalcançável.

3. 🟠 **O modo de mocks é fail-open.** `apps/web/src/lib/config.ts`:
   `export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== 'false';` — o default é **dados
   falsos**. A única coisa que protege produção é um `ARG NEXT_PUBLIC_USE_MOCKS="false"` no
   `apps/web/Dockerfile`. Qualquer build fora daquele Dockerfile serve ficção convincente ao
   operador, sem nenhum aviso na tela.

---

## 1. Gap analysis, seção por seção

Legenda: ✅ implementado · 🟡 parcial · ❌ ausente · 🔀 divergente do projeto

### §0 — Contexto e premissas

| Item | Estado | Verificado em |
|---|---|---|
| Monólito modular, 2 processos | ✅ | `apps/web`, `apps/worker` |
| Premissa "VPS com Docker Compose" | 🔀 | Produção é **EasyPanel**, não `infra/docker-compose.yml` |

**Divergência (melhoria com efeito colateral):** EasyPanel entrega TLS, rollback por health check e
deploy por Git de graça — troca boa. Mas `infra/docker-compose.yml` (7 serviços, incluindo
`evolution` com `v2.2.3`) **descreve uma topologia que não roda em lugar nenhum**. Documentação
divergente é pior que ausente: alguém vai debugar produção olhando aquele arquivo. Ele precisa de um
cabeçalho declarando "somente desenvolvimento local — produção é `DEPLOY.md`", ou ser removido.

**Premissa que mudou e ninguém reavaliou:** "usuários internos" (§0) virou **domínio público na
internet**. Isso reclassifica riscos de autenticação — território do Órion, cito e sigo.

### §1.2 — Diagrama de componentes

🟡 **O diagrama descreve um sistema que não existe.** Dos três workers desenhados dentro de
`WorkerProc`, só o `SW` (Scrape Worker) existe. `DW` (Dispatch) e `MW` (Maintenance) não têm código.
O `MW` no diagrama também é quem chamaria o IBGE no seed — na prática o seed roda no `apps/web`
(`packages/db/prisma/seed.ts` via `RUN_SEED`), não no worker. Corrigir o diagrama na próxima revisão.

### §1.3 — Fila (BullMQ + Redis)

| Item | Estado | Nota |
|---|---|---|
| BullMQ + Redis, filas nomeadas | ✅ | `apps/worker/src/queues.ts` |
| Rate limiter global 6/min, concorrência 2 | ✅ | `SCRAPE_RATE_LIMITER` |
| Priorização por população | ✅ | `priorityFromPopulation()` — inversão bem feita |
| Retry/backoff por código de erro | 🔀 **melhoria** | Retry **manual**, não `attempts` nativo |
| Postgres é a verdade / `requeue-orphans` | ❌ | Não existe |

**Divergência boa:** o Vega trocou o `attempts` nativo do BullMQ por re-enfileiramento manual porque
`SCRAPE_ERROR_POLICY` tem `maxAttempts` **diferente por código de erro** e o nativo é um número fixo
por job. Está certo, está documentado no cabeçalho do arquivo, e o handler `on('failed')` deixa
explícito que chegar ali é bug. Isso é engenharia, não desvio.

🔴 **Divergência ruim (defeito de operação):** a pausa automática da fila
(`pauseQueueFor` em `apps/worker/src/jobs/scrape-search.job.ts:37`) guarda o timer de retomada num
`setTimeout` **em memória do processo**. Consequências reais:
- `LAYOUT_CHANGED` pausa **indefinidamente** e não existe nenhum endpoint, botão ou comando de
  `resume` em lugar algum do sistema. A recuperação exige `redis-cli` ou restart do container.
- `RATE_LIMITED` pausa 15 min via timer; se o worker reiniciar nesse intervalo, a fila continua
  pausada no Redis para sempre e o timer se perde.
- Em ambos os casos o sintoma para o operador é **"criei uma busca e ela nunca sai de `queued`"** —
  indistinguível de "o worker não está no ar". O sistema não tem como contar a diferença.

### §1.4 — Autenticação

✅ Auth.js v5 + Credentials + `middleware.ts` com proteção real (não só o `AuthGuard` client-side).
A lista de rotas públicas está correta e comentada (`/api/webhooks`, `/api/v1/public`,
`/api/v1/health`). Hardening = Órion.

### §2 — Estrutura de pastas (era CONTRATO)

**Regras de dependência: respeitadas.** Confirmei que `apps/web` não importa `@inno/scraper` — e
mais: `lib/services/searches.ts` **duplica `buildQueryString` de propósito**, com comentário
explicando que importar arrastaria Playwright para o bundle do servidor. É a decisão certa,
documentada no lugar certo.

**Ausente do contrato:**

| Caminho previsto | Estado |
|---|---|
| `apps/worker/src/jobs/scrape-detail.job.ts` | ❌ (era v2) |
| `apps/worker/src/jobs/dispatch-tick.job.ts` | ❌ |
| `apps/worker/src/jobs/warmup-roll.job.ts` | ❌ |
| `apps/worker/src/jobs/health-check.job.ts` | ❌ |
| `apps/worker/src/jobs/retention.job.ts` | ❌ |
| `apps/worker/src/policies/` (4 arquivos) | ❌ pasta inteira |
| `apps/worker/src/observability/alerts.ts` | ❌ (só `logger.ts`) |
| `infra/Caddyfile` | ❌ (EasyPanel assume — ok) |
| `infra/backup/pg-dump.sh` | ❌ **e isso não é ok** |
| `docs/` (3 runbooks + `lgpd.md`) | ❌ pasta inteira |
| `tests/e2e/`, `tests/fixtures/` | ❌ pasta inteira |

**Surgiu, não previsto (melhoria — promover a regra):** `apps/web/src/lib/services/*` (7 arquivos).
Eu tinha desenhado `lib/api-handler.ts` mas não uma camada de serviço; o Vega criou uma e as rotas
ficaram com 10 linhas cada. É melhor do que projetei. Documentar como convenção:
**nenhuma query Prisma vive em `route.ts`.**

**Surgiu, não previsto (dívida):** `apps/web/src/mocks/*` (8 arquivos) acoplado a `lib/api/*` por
uma flag global. Ver §Novos riscos N1.

### §3 — Modelo de domínio

✅ **Completo, e à frente do resto.** 15 models e 14 enums em `packages/db/prisma/schema.prisma`,
duas migrações (`20260730120000_init`, `20260801130000_add_messaging_and_campaigns`). Todas as
entidades das Fases 1–4 existem, incluindo `Campaign`, `CampaignTarget`, `InstanceDailyStat`,
`ScraperHealthEvent` e `RawCapture`.

**Divergências, todas melhorias:**
- `CampaignInstance` (tabela de junção) — meu ERD dizia `Campaign }o--o{ WhatsAppInstance`; o Cronos
  materializou a relação. Correto, e é o que sustenta o `haltCampaignsSoleInstanceDisconnected`.
- Contadores agregados incrementais na `Campaign` em vez de `COUNT(*)` — decisão do Cronos,
  virou invariante do projeto, e `advanceCampaignTargetStatus` é o único portão que os toca.

**§3.2, regra a regra:**

| Regra | Estado |
|---|---|
| 1. `dedupeKey` em 3 níveis + dado humano nunca sobrescrito | ✅ **acima do projetado** |
| 2. Máquina de estados do funil | ✅ `checkStatusTransition` |
| 3. Opt-out antes de cada envio | ❌ **não pode existir — não há envio** |
| 4. Só móvel recebe WhatsApp | 🟡 `phoneType` existe; o skip `landline` é do dispatch, ausente |
| 5. Campanha usa snapshot do template | 🟡 campo no schema; lógica de `start` ausente |

Sobre a regra 1: eu descrevi "dado humano vence dado de máquina" como regra. O Vega/Cronos
transformaram em `buildMachineUpdate()`, que **lança exceção** se um campo fora da allowlist tentar
entrar no upsert (`apps/worker/src/jobs/scrape-search.job.ts:185`, com comentário proibindo objeto
literal ali). Isso converte uma regra de disciplina em uma falha de runtime. É melhor do que pedi.

### §4 — Contratos de API

21 rotas implementadas. Contra o contrato §4:

**Ausentes:**
- `POST /api/v1/leads/bulk` ❌ (Fase 2.4)
- `GET /api/v1/leads/export` ❌ (Fase 2.4) — nem no backend nem na UI
- `POST /api/v1/campaigns` e as 6 rotas de campanha ❌ (Fase 4)
- **Envio manual de mensagem** ❌ — e este **nunca esteve no §4**

**Sobre o envio manual — erro de arquitetura meu, registrado como tal:** a entrega 3.7 do plano
faseado diz "envio manual para 1 lead a partir da ficha (validação real ponta a ponta)". Eu nunca
escrevi o endpoint correspondente na §4. O §4 foi tratado (corretamente) como a lista do que
implementar. Resultado: a entrega que existia justamente para **validar a integração com a Evolution
API antes de construir a Fase 4 em cima dela** simplesmente não foi feita, e o risco que ela
mitigava segue aberto. Regra nova para mim: **nenhuma linha do plano de fases sem contrato
correspondente no §4.**

> ✅ **Fechado em 2026-08-03** — `ARQUITETURA.md` §4.9 (`POST /api/v1/leads/:id/messages`). A regra
> acima virou item do §8.0 do documento de arquitetura, para valer daqui em diante e não só para mim.

**Presentes e conformes:** `locations/*`, `searches/*` (incl. `retry-failed`), `leads` (GET/PATCH),
`templates/*` (incl. `preview`), `whatsapp/instances/*` (incl. `qr` e `connect|disconnect`),
`optouts/*`, `public/optout`, `webhooks/evolution/:instanceKey`, `health`.

**Divergência consciente e bem justificada:** o QR não é cacheado em Redis (TTL 90s) como o §4.8
previa — `GET /qr` bate direto na Evolution a cada poll. O comentário em
`lib/services/webhook.ts:206` explica: funcionalmente equivalente sem introduzir um cliente Redis de
cache em `apps/web`. Aceito. Custo: um request extra à Evolution a cada 2s enquanto o modal está
aberto — irrelevante nesta escala.

### §5 — Scraper

| Sub | Item | Estado |
|---|---|---|
| 5.1 | Interface `SearchEngine`, porta única `runSearch` | ✅ |
| 5.2 | Fanout por município IBGE, priorizado por população | ✅ |
| 5.2 | Flag `saturated` (instrumento de medição p/ v2) | ❌ **não existe no schema** |
| 5.3 | Rate limit, jitter, reciclagem de contexto, pausa longa | ✅ |
| 5.4 | `ProxyProvider` / `NoopProxyProvider` | ✅ |
| 5.5 | **Seletores em 1 arquivo só** | ✅ **respeitado e reforçado** |
| 5.6 | `ScrapeErrorCode` + política de retry/backoff | ✅ |
| 5.7 | Assertions A1–A4 | 🔴 **código morto** |
| 5.7 | `ScraperHealthEvent` gravado | ❌ |
| 5.7 | Canário diário | ❌ |
| 5.7 | Banner na UI / evento em `/health` | ❌ |
| 5.7 | Captura de screenshot+HTML no incidente | ✅ (só em `LAYOUT_CHANGED`) |

Sobre 5.5: o `selectors.ts` real está **melhor** que o que especifiquei. Ganhou uma nota explicando
que alternativas `:has-text()` (sintaxe Playwright) são puladas pelo parser de fixture, e por isso a
alternativa CSS pura nunca pode ser removida "porque a outra parece mais robusta". Esse é o tipo de
armadilha que só quem implementou descobre.

Sobre 5.7 — o detalhe que importa: `evaluateSanity` existe, tem teste, e é **exportada** pelo
`packages/scraper/src/index.ts:54`. Zero chamadores em `apps/`. O `scrape-search.job.ts` fecha a
task, incrementa contadores e vai embora — não avalia nada. `captureIncident` é a única peça de
sanidade ligada (`playwright-engine.ts:96`). Resultado prático: **se o Google mudar o layout hoje, o
sistema roda, não dá exceção, grava zero leads e ninguém fica sabendo** — exatamente o cenário que a
§5.7 existia para impedir.

Sobre `saturated`: `reachedEnd` é calculado em `navigate.ts` e devolvido em `SearchOutput.meta`, mas
o job **descarta o valor**. Não há coluna no schema. Consequência: a dívida D4 ("não sabemos o
tamanho do problema; a flag vai medir") continuará sem dados na Fase 6, porque o instrumento de
medição nunca foi instalado.

### §6 — Disparo com anti-ban

**0% em execução.** Existe, pronto e testado, o material de base:

| Peça | Onde | Estado |
|---|---|---|
| `WARMUP_TABLE`, `effectiveDailyLimit`, `regressWarmupDay` | `packages/core/src/whatsapp/warmup.ts` | ✅ puro, testado |
| `deriveInstanceHealth` | `packages/core/src/whatsapp/health.ts` | ✅ |
| `advanceCampaignTargetStatus` (idempotente, sem regressão) | `apps/web/src/lib/services/campaign-targets.ts` | ✅ |
| `haltCampaignsSoleInstanceDisconnected` | idem | ✅ e **já chamado** pelo webhook |
| `EvolutionClient.sendText` | `packages/messaging` | ✅ escrito, ❌ **nunca chamado** |

Ausente: `guard.ts` (o portão pré-envio), `send-window.ts`, `quota.ts`, `jitter.ts`,
`dispatch-tick.job`, `warmup-roll.job`, `health-check.job`, rotação/afinidade de instância, kill
switch por falhas consecutivas e por taxa de falha, `409 INSUFFICIENT_TEXT_VARIATION`,
`409 MISSING_OPTOUT_NOTICE`, `acknowledgeHalt` no resume.

Um crédito específico: o kill switch por **webhook** (§6.6, linha 1 da tabela) **existe e funciona** —
`connection.update` com ban leva a instância a `banned` e as campanhas dela a `halted`, na mesma
transação. É a única linha da §6 que está de pé, e é a mais importante delas.

### §7 — LGPD

| Item | Estado |
|---|---|
| 7.2 Registro de origem por lead (imutável) | ✅ `sourceType/sourceUrl/sourceQuery/collectedAt/searchJobId/engineId` |
| 7.3 Oposição — resposta textual (`detectOptOut`) | ✅ no webhook, com efeito retroativo transacional |
| 7.3 Oposição — link público `/descadastro/:token` | ✅ página + `POST /api/v1/public/optout` |
| 7.3 Oposição — manual | ✅ `POST /api/v1/optouts` |
| 7.3 Acesso/correção | 🟡 via `GET /leads?q=` e `PATCH` — funciona, não é um fluxo |
| 7.3 **Eliminação** (`delete_lead_data`) | ❌ não existe rota nem ação |
| 7.4 Conteúdo obrigatório da 1ª mensagem | ❌ (validação é no `start`, ausente) |
| 7.5 `retention.job` | ❌ |
| 7.5 `RawCapture` com expurgo de 7 dias | ❌ model existe; ninguém escreve nem apaga |
| `docs/lgpd.md` / ROPA | ❌ |

A base legal do §7.1 se sustenta em cinco condições. Quatro estão garantidas por código. A quinta
("o descadastro é fácil e honrado") está garantida **na entrada** (três caminhos de opt-out
funcionam) e **não garantida na saída** — porque o portão que respeita o opt-out no envio é o guard,
que não existe. Hoje isso é inofensivo (não há envio); no dia em que a Fase 4 subir, é o item nº 1
de bloqueio de release, como a própria §8 já dizia.

### §8 — Plano faseado

| Fase | Escrito | Validado com dado/serviço real |
|---|---|---|
| 1 | ✅ | ❌ **nunca** — critério de aceite não executado |
| 2 | 🟡 2.1✅ 2.2✅ 2.3❌ 2.4❌ 2.5🟡 2.6✅ 2.7❌ | ❌ |
| 3 | 🟡 3.1✅ 3.2✅ 3.3🟡 3.4✅ 3.5✅ 3.6✅ 3.7❌ 3.8🟡 | ❌ |
| 4 | schema ✅ + contratos ✅, resto ❌ | — |
| 5 | ❌ | — |
| 6 | ❌ | — |

O princípio que escrevi na abertura da §8 — *"cada fase termina com algo que o usuário consegue usar
de ponta a ponta"* — **não foi cumprido em nenhuma fase**. Não por culpa de quem implementou: o
plano tratava "escrito e com build passando" como equivalente a "entregue", e nada no processo
forçava a validação contra serviço real. Isso é falha de desenho do plano, e é o que corrijo na §5
deste documento.

---

## 2. O que falta para "completo"

Não é só a Fase 4. Estas são lacunas que a arquitetura original **subestimou ou não previu**, e que
um sistema em produção precisa.

### 2.1 O operador não tem como saber que algo quebrou
Hoje, quando o sistema falha, o operador vê: uma busca parada em `queued`. Isso é o mesmo sintoma
para **cinco causas distintas**: worker fora do ar; Redis fora do ar; fila pausada por
`LAYOUT_CHANGED`; fila pausada por `RATE_LIMITED`; enqueue que falhou e só virou log. Nenhuma delas
aparece na tela. Falta:
- **Heartbeat do worker** (chave Redis com TTL ou linha no Postgres, atualizada a cada N segundos).
  Sem isso, `GET /health` responde `200 ok` com o worker morto. É um health check que mente.
- **Estado da fila exposto** (`paused`/`active`, motivo, desde quando).
- **Banner de saúde no dashboard** alimentado por `ScraperHealthEvent`, como a §5.7 previa.

### 2.2 Não existe caminho de recuperação sem shell
`LAYOUT_CHANGED` pausa a fila para sempre. Não há botão, endpoint ou comando. Já sabemos, pelo
histórico do projeto (seed e reset de senha viraram variáveis de ambiente `RUN_SEED` /
`ADMIN_RESET_PASSWORD`), que **terminal no container é um recurso escasso e frágil neste ambiente**.
Isso deveria ter entrado como requisito de arquitetura: *toda operação de recuperação precisa de um
caminho pela UI ou por variável idempotente.* Falta:
- `POST /api/v1/scraper/queue/resume` (com `acknowledge` do incidente, mesma filosofia do
  `acknowledgeHalt`) e o botão correspondente.
- `requeue-orphans` no boot do worker (R10) — hoje, se o enqueue falhar em
  `createSearchJob` (só `logger.error`, `services/searches.ts:149`) as tasks ficam `pending` para
  sempre, sem que ninguém as recolha.

### 2.3 Reprocessamento existe pela metade
`POST /searches/:id/retry-failed` existe e está correto. Mas não existe:
- Reprocessar tasks `pending` órfãs (acima).
- Re-scrapear um `SearchJob` inteiro (rebusca periódica de um nicho) — o upsert já suporta, falta
  o gatilho.
- Reprocessar webhooks perdidos: se a Evolution API entregar um `messages.update` enquanto o `web`
  está reiniciando, o evento é perdido em silêncio (respondemos sempre 200 por desenho). Não há
  reconciliação de status de mensagem. Impacto: métricas de entrega subestimadas para sempre.

### 2.4 O que acontece quando o Google muda o layout às 3h da manhã
Estado atual: a fila pausa (bom), um screenshot é salvo em `SCRAPE_INCIDENT_DIR` (bom), e **nada
mais acontece** — sem evento no banco, sem alerta, sem sinal na UI, sem caminho de retomada.
Descobrimos de manhã, pelo cliente. Falta: gravar `ScraperHealthEvent`, disparar
`ALERT_WEBHOOK_URL` (documentada em `.env.example:134`, **não lida por nenhum código**), mostrar na
tela, e permitir retomar depois do fix.

### 2.5 O que acontece quando o número é banido no meio de uma campanha
Aqui a notícia é melhor do que eu esperava: o webhook trata o ban, marca a instância e leva as
campanhas a `halted` com `haltReason`. O que falta para fechar o ciclo:
- Kill switch **proativo** (5 falhas consecutivas, taxa de falha > 30%, ausência de resposta em
  100+ envios) — depende do `health-check.job`, ausente.
- `resume` com `acknowledgeHalt` — a rota não existe.
- Regressão de warmup ao reconectar (`regressWarmupDay` existe, ninguém chama).
- Alerta. Hoje o operador descobre `halted` se por acaso abrir a tela.

### 2.6 Telefone: o furo que pode invalidar a premissa do produto
🔴 **Risco novo, e provavelmente o mais caro.** O produto inteiro depende de telefone **móvel**. O
scraper extrai telefone **do card da lista** (`SELECTORS.card.phone`, consumido em
`extract-card.ts:98`). Na prática, o card do feed do Google Maps frequentemente **não traz telefone**
— ele aparece no painel de detalhe. Eu rebaixei `scrape-detail.job.ts` para "v2" na §2, mas escrevi
na §8 um critério de aceite da Fase 1 que exige "≥30 leads com nome **e telefone**". As duas coisas
não são compatíveis.

Não posso afirmar a taxa real sem rodar (não confirmado — o scraper nunca abriu o Maps). Mas é o
primeiro número a medir na Onda 0, e ele decide se `scrape-detail` sobe para bloqueante.

### 2.7 Duplicação de card por `outerHTML`
`navigate.ts:125` deduplica cards com `Set<string>` do `outerHTML`. O `outerHTML` do mesmo card muda
entre passos de scroll (imagem lazy-loaded, atributo `aria-*` de foco). Se isso ocorrer, o mesmo
negócio entra duas vezes em `cardHtmls`, o que (a) infla `resultCount` e o contador `leadsFound`, e
(b) faz `maxResults` ser atingido cedo, **truncando resultados reais**. O `upsert` protege o banco,
mas não a métrica nem a completude. Deduplicar por `externalRef`/`detailUrl` (já extraídos) é mais
barato e mais correto.

### 2.8 Fanout de UF grande enfileira 645 jobs num request HTTP
`createSearchJob` faz `Promise.all(tasks.map(enqueue))` — para SP são 645 `Queue.add` em paralelo
dentro do handler de `POST /searches`. Funciona, mas é uma chamada HTTP que faz 645 idas ao Redis
antes de responder. `Queue.addBulk` resolve em uma. Não é bloqueante; é o tipo de coisa que vira
timeout intermitente em produção e custa uma tarde para diagnosticar.

---

## 3. O que falta para "profissional"

Separado de propósito: nada aqui impede o sistema de funcionar. Tudo aqui impede o sistema de ser
confiável para um cliente pagante.

| # | Falta | Por que importa | Dono |
|---|---|---|---|
| P1 | **Backup do Postgres com restore testado** | Não existe. `infra/backup/pg-dump.sh` foi especificado na §2 e nunca criado; o `DEPLOY.md §8` admite isso. Perder o volume = perder tudo, sem recuperação. Enquanto o único dado é o seed do IBGE, é recuperável; no dia do primeiro cliente, deixa de ser | Vulcano |
| P2 | **CI** | Não há `.github/`. Pior: **não há task `test` no `turbo.json` nem script `test` na raiz** — os 164 testes só rodam pacote a pacote, à mão. Um CI hoje não teria o que executar | Vulcano + Íris |
| P3 | **Testes de integração com Postgres e Redis reais** | 19 arquivos de teste, **todos em `packages/*`**, zero em `apps/*`. O `scrape-search.job.ts` (o código mais perigoso do repo: claim atômico, upsert, contadores, pausa de fila) tem cobertura zero. Detalhe do escopo é da Íris; aponto aqui porque é decisão de arquitetura de teste, não de cobertura | Íris |
| P4 | **Documentação de operação** | `docs/` não existe. Os três runbooks que especifiquei (`scraper-quebrado`, `numero-banido`, `evolution-caiu`) são exatamente os três cenários que vão acontecer. Sem eles, cada incidente é uma investigação do zero | Alexandria |
| P5 | **Erro que o usuário final entende** | O envelope `ApiError` com `message` em pt-BR está implementado e é bom. O que falta é o outro lado: quando o **worker** falha, o usuário não recebe mensagem nenhuma — só ausência de progresso. Erro de sistema assíncrono precisa de superfície na UI | Vega + Lyra |
| P6 | **Alertas** | `ALERT_WEBHOOK_URL` está documentada e não é lida por nenhum código. `observability/alerts.ts` não existe. Alarme que só vai para log não é alarme (§5.7, minhas palavras) | Vega |
| P7 | **Default seguro para modo mock** | Inverter para `=== 'true'` e exibir um badge permanente na UI quando ligado. Fail-open para dados falsos é uma escolha errada em qualquer sistema | Lyra |
| P8 | **`docker-compose.yml` marcado como dev-only** | Ou removido. Descreve produção que não existe | Vulcano |
| P9 | **Versão da Evolution API pinada de verdade** | `v2.2.3` é chute admitido no `DEPLOY.md §4`. R4 (breaking change) depende inteiramente de a versão ser conhecida | Vulcano |
| P10 | **Rotação de segredos** | Sem processo. `NEXTAUTH_SECRET` e `EVOLUTION_API_KEY` vivem em três lugares cada. Território do Órion, cito e sigo | Órion |

---

## 4. Riscos: o que mudou desde o desenho

### 4.1 Riscos originais reavaliados

| # | Risco | Antes | Agora | O que mudou |
|---|---|---|---|---|
| R1 | Google muda layout | Alta / Alto | **Alta / Crítico** | A mitigação que eu contava (A1–A4 + canário) **não existe em execução**. Sobrou só o `selectors.ts` isolado — que resolve o *conserto*, não a *detecção*. Sem detecção, o conserto começa dias depois |
| R2 | Número banido | Alta / Alto | **Média / Alto** | Probabilidade caiu porque não há envio. Mas a mitigação também não existe: warmup é função pura sem chamador. No dia em que a Fase 4 subir, R2 volta para Alta com metade das defesas |
| R3 | Google bloqueia IP | Média / Alto | **Média / Alto** ⚠️ | Inalterado em papel, mas o `RATE_LIMITED` pausa a fila com timer em memória — a mitigação tem um defeito que só aparece se o worker reiniciar |
| R4 | Evolution instável | Média / Alto | **Alta / Alto** | Subiu. A versão não está confirmada, e **o acoplamento nunca foi exercitado contra a API real** — `packages/messaging` inteiro é uma hipótese validada só contra os próprios mocks do autor |
| R5 | Exposição LGPD | Baixa–Média / Alto | **Baixa / Alto** | Caiu: sem envio, não há a quem incomodar. Volta assim que a Fase 4 subir |
| R6 | Qualidade do dado | Média / Médio | **Alta / Alto** | Subiu nas duas dimensões. §2.6 (telefone no card) e §2.7 (dedupe por HTML) são falhas concretas, não hipóteses. E A4, que mediria isso, é código morto |
| R7 | Campanha duplica envio | Média / Alto | — | Não aplicável ainda. A técnica de claim atômico usada no scraper (`updateMany WHERE status='pending'`) funciona bem e deve ser reaproveitada no dispatch |
| R8 | RAM do Chromium | Média / Baixo | **não confirmado** | O worker nunca subiu. Não sabemos o consumo real na VPS. Pode ser o motivo pelo qual o primeiro deploy do worker falha |
| R9 | Usuário se sabota | Alta / Alto | — | Não aplicável ainda. As defesas (teto duro, override só para baixo) são funções puras sem chamador |
| R10 | Redis cai, fila se perde | Baixa / Médio | **Média / Alto** | Subiu. `requeue-orphans` não existe, e agora sabemos que **o enqueue pode falhar mesmo com o Redis vivo** (o `catch` que só loga em `services/searches.ts:149`) — o buraco é maior que o previsto |
| R11 | Busca de UF grande parece travada | Alta / Baixo | **Alta / Médio** | Subiu de impacto: com a fila podendo estar pausada em silêncio, "parece travada" e "está travada" ficam indistinguíveis para o usuário |

### 4.2 Riscos novos, que não existiam no papel

| # | Risco | Prob. | Impacto | Detalhe |
|---|---|---|---|---|
| **N1** | **Operador tomando decisão sobre dados falsos** | Média | **Alto** | `USE_MOCKS` é fail-open. Uma tela de leads mockada é convincente e não tem nenhum indicador visual. Protegido hoje só por um `ARG` de Dockerfile |
| **N2** | **Fila pausada permanentemente sem sinal** | **Alta** | Alto | `LAYOUT_CHANGED` → pausa infinita, sem resume; `RATE_LIMITED` → timer em memória. Sintoma indistinguível de worker morto |
| **N3** | **Health check que mente** | Alta | Médio | `GET /health` responde `ok` com o worker morto, Redis fora e fila pausada. O EasyPanel considera o deploy saudável |
| **N4** | **Operação depende de terminal no container** | Alta | Médio | Já materializado (seed, senha do admin). O contorno foi mover operação para variáveis de ambiente — inclusive **reset de senha por env var** (`ADMIN_RESET_PASSWORD`), que funciona mas é superfície de risco. Órion avalia |
| **N5** | **Integração Evolution nunca exercitada** | **Certeza** | Alto | Zero chamadas reais. Construir a Fase 4 sobre isso é empilhar em fundação não testada — é precisamente o que a entrega 3.7 existia para evitar |
| **N6** | **Taxa de telefone insuficiente para o produto** | Média | **Crítico** | Ver §2.6. Se confirmado, invalida a premissa comercial até `scrape-detail` existir |
| **N7** | **Contadores e completude corrompidos por dedupe de card** | Média | Médio | Ver §2.7 |
| **N8** | **Divergência silenciosa entre spintax do cliente e do servidor** | Média | Médio | `apps/web/src/lib/spintax.ts` (200 linhas) duplica a gramática de `packages/core/templates/spintax.ts`. A duplicação está **documentada e justificada** (preview a cada tecla, sem round-trip). O risco é real e aceitável — mas precisa de um teste que rode a mesma bateria de casos nas duas implementações |
| **N9** | **`infra/docker-compose.yml` como documentação enganosa** | Alta | Baixo | Descreve produção que não existe |

---

## 5. Plano priorizado, em ondas

Regra de leitura: **Ondas 0 a 3 são bloqueantes para uso real.** A Onda 4 é o que separa "funciona"
de "profissional" — com uma exceção marcada, que eu subiria de onda se houver dado de cliente.

---

### 🔴 Onda 0 — Provar que o núcleo funciona (bloqueia literalmente tudo)

Nada abaixo desta onda tem valor até ela fechar. Hoje o projeto tem 13.400 linhas de hipótese.

| # | Entrega | Quem |
|---|---|---|
| 0.1 | Subir o worker no EasyPanel; aplicar a migração das Fases 2/3/4 | Dono + Vulcano |
| 0.2 | Rodar o aceite da Fase 1: "clínica odontológica" em Campinas-SP | Íris |
| 0.3 | Consertar `selectors.ts` se quebrar (por desenho, 1 arquivo + fixtures) | Vega |
| 0.4 | **Medir e reportar a taxa real de preenchimento de telefone** e de telefone **móvel** | Íris |
| 0.5 | Decisão arquitetural sobre `scrape-detail` com base em 0.4 | Nova |

**Pronto quando:** uma busca real devolve ≥30 leads com nome, sem duplicatas, em <3 min, **e**
existe um número na mesa para "% de leads com celular". Sem 0.4, a Onda 3 é construída no escuro.

---

### 🔴 Onda 1 — O sistema consegue dizer que está quebrado (bloqueia uso real)

Esta onda existe porque a §5.7 virou código morto. É a dívida mais perigosa do projeto.

| # | Entrega | Quem |
|---|---|---|
| 1.1 | Chamar `evaluateSanity` ao fim de cada task; gravar `ScraperHealthEvent` | Vega |
| 1.2 | Persistir o estado de pausa da fila no Postgres (não `setTimeout`); retomada no boot | Vega |
| 1.3 | `POST /api/v1/scraper/queue/resume` com `acknowledge` do incidente | Vega (contrato: Nova) |
| 1.4 | Heartbeat do worker; `GET /health` reportando worker, Redis, fila e último incidente | Vega |
| 1.5 | `requeue-orphans` no boot do worker (R10) | Vega |
| 1.6 | Banner de saúde no dashboard + botão de retomar com motivo legível | Lyra |
| 1.7 | Persistir `reachedEnd` como `SearchTask.saturated` (instrumento de medição da D4) | Cronos + Vega |
| 1.8 | Corrigir dedupe de card por `externalRef`/`detailUrl` (§2.7) | Vega |

**Pronto quando:** adulterar uma fixture de seletor **ou** derrubar o Redis produz um sinal visível
na tela em menos de 5 minutos, e o operador retoma a operação **sem abrir um shell**.

---

### 🟠 Onda 2 — Fase 3 de verdade (bloqueia a Fase 4)

Corrige o erro de contrato descrito em §1/§4 e derruba o risco N5 antes de empilhar a Fase 4.

> ✅ **Atualização 2026-08-03 — a 2.1 está entregue.** O contrato está em `ARQUITETURA.md` **§4.9**
> (documento promovido a v1.1). O que ficou decidido e que o resto da onda precisa saber:
> - **A rota vive no `apps/web`, síncrona**, não na fila — o operador precisa do motivo da recusa na
>   mesma tela (§4.9.1).
> - **O guard é uma função pura em `packages/core`** (`evaluateSendGuard`), com carimbo
>   `optOut.checkedAt` que **lança** se a consulta tiver mais de 5s. O `dispatch-tick.job` importa a
>   mesma função; segunda implementação é reprovação do Órion (§4.9.3).
> - **Write-ahead do `Message`**: grava `queued` e debita cota antes de chamar a Evolution (§4.9.5).
> - **Horário no manual**: piso duro 08–20 sem domingo (`409 QUIET_HOURS`, sem override) + janela
>   comercial com `confirmOutsideBusinessWindow` explícito (§4.9.6).
> - **Pré-requisito descoberto no caminho**: o envelope de erro ganhou `error.reason` (§4.0). Sem
>   ele a UI não distingue "opt-out" (terminal) de "cota estourada" (tente amanhã).
>
> Segue pendente comigo o contrato da **1.3** (`POST /api/v1/scraper/queue/resume`), da Onda 1.

| # | Entrega | Quem |
|---|---|---|
| 2.1 | ✅ **Contrato definido** — `ARQUITETURA.md` §4.9 (envio unitário, portões G0–G11, erros, falha da Evolution) | **Nova** |
| 2.2 | Implementar a rota — passando pelo mesmo guard de opt-out do futuro dispatch | Vega |
| 2.3 | Botão de envio na ficha do lead | Lyra |
| 2.4 | Pinar a versão real da imagem da Evolution API | Vulcano |
| 2.5 | Conectar um número real por QR; enviar para o celular do dono; ver `sent → delivered → read`; responder "SAIR"; conferir o `OptOut` criado | Dono + Íris |

**Pronto quando:** o ciclo completo aconteceu **uma vez, com número real**. Este é o aceite da Fase 3
que nunca foi executado.

**Nota de arquitetura:** o guard de opt-out deve nascer **aqui**, no envio unitário, não na Fase 4.
Assim ele é exercitado antes de existir volume, e o dispatch worker herda um portão já testado.

---

### 🟠 Onda 3 — Fase 4: o produto (o que o sistema promete e não faz)

| # | Entrega | Quem |
|---|---|---|
| 3.1 | `policies/`: `send-window`, `quota` (usando `effectiveDailyLimit`), `jitter` log-normal, `guard` | Vega |
| 3.2 | `dispatch-tick.job` com claim atômico (reaproveitar a técnica do scraper), rotação ponderada, afinidade lead→instância | Vega |
| 3.3 | `warmup-roll.job` e `health-check.job` (kill switch proativo, regressão de warmup) | Vega |
| 3.4 | 7 rotas de campanha, com as validações **bloqueantes**: spintax insuficiente (409), aviso de descadastro ausente (409), instância desconectada (409), `acknowledgeHalt` no resume | Vega |
| 3.5 | UI de campanha com o painel de exclusões discriminadas e acompanhamento ao vivo | Lyra |
| 3.6 | Auditoria dedicada: **nenhum caminho de código envia sem passar pelo guard** | Órion |
| 3.7 | Opt-out registrado durante a campanha é honrado no envio seguinte | Íris |

**Pronto quando:** campanha de 50 alvos com 2 instâncias respeita quota e janela, para sozinha ao
desconectar um número, e 3.7 passa. **3.7 é critério de bloqueio de release**, como já estava na §8.

---

### 🔵 Onda 4 — Profissional (não bloqueia uso; bloqueia cliente pagante)

| # | Entrega | Quem |
|---|---|---|
| 4.0 | ⚠️ **Backup do Postgres com restore testado.** Se entrar dado de cliente antes da Onda 3, **isto sobe para a Onda 0** | Vulcano |
| 4.1 | Task `test` no `turbo.json` + script na raiz + CI (typecheck, lint, test, build) | Vulcano + Íris |
| 4.2 | Testes de integração com Postgres e Redis reais, cobrindo `scrape-search.job` e as rotas | Íris |
| 4.3 | `retention.job` + ação de eliminação LGPD + `leads/bulk` + `leads/export` | Vega |
| 4.4 | `observability/alerts.ts` lendo `ALERT_WEBHOOK_URL` | Vega |
| 4.5 | Runbooks (scraper quebrado, número banido, Evolution caiu) + `docs/lgpd.md` | Alexandria |
| 4.6 | Inverter o default de `USE_MOCKS` + badge visível quando ligado | Lyra |
| 4.7 | Marcar `docker-compose.yml` como dev-only (ou remover); corrigir o diagrama da §1.2 | Vulcano + Nova |
| 4.8 | Teste de paridade entre as duas implementações de spintax (N8) | Íris |

### ⚪ Melhorias (não bloqueiam nada)

Subdivisão de cidades saturadas (agora com a flag da 1.7 medindo), `RotatingProxyProvider`, motor
`maps-pb`, dashboard de métricas por nicho/template, multi-tenancy, `Queue.addBulk` no fanout (§2.8).

---

## 6. O que eu faria diferente

Sete correções ao meu próprio desenho, cada uma comprada com o que aconteceu na implementação.

**1. Fase 0: walking skeleton com infra real, antes de qualquer domínio.**
O erro mais caro do projeto não foi técnico, foi de sequenciamento. Escrevi um plano em que "fase
concluída" era compatível com "nunca executado". Resultado: 13.400 linhas, 12 commits, build verde,
164 testes — e zero contato com Postgres, Redis, Google Maps ou WhatsApp. Cada fase acumulou
hipóteses não verificadas sobre as anteriores. A Fase 0 correta seria: subir Postgres + Redis +
`GET /health` verde + **uma** busca real de uma cidade, antes da segunda linha de domínio. Custaria
um dia e teria antecipado N5, N6, R8 e todo o Onda 1.

**2. Nada no plano de fases sem contrato correspondente no §4.**
A entrega 3.7 (envio manual) existia justamente para derrubar o risco R4/N5 antes da Fase 4. Ela não
foi feita porque eu escrevi a linha no plano e esqueci o endpoint no contrato. O §4 é, na prática, a
lista de trabalho — o plano faseado é só a narrativa. Regra: toda entrega que expõe comportamento
novo entra no §4 na mesma revisão, ou não entra no plano.

**3. Função pura + teste ≠ funcionalidade. Wiring é a entrega.**
`evaluateSanity`, `WARMUP_TABLE`, `regressWarmupDay`, `effectiveDailyLimit`: quatro peças escritas,
testadas, exportadas — e com zero chamadores. Cada uma parece pronta em qualquer relatório de
progresso. Eu separei "assertions A1–A4" (2.3) da entrega do job (1.4) como se fossem itens
independentes; não são. Regra: **o critério de aceite de uma regra de proteção é o comportamento
observável quando ela dispara**, nunca o teste unitário da função que a calcula.

**4. `scrape-detail` deveria ter nascido na Fase 1.**
Rebaixei para v2 por disciplina de escopo ("Fase 1 é deliberadamente mínima"), e ao mesmo tempo
escrevi um critério de aceite que exige telefone. Disciplina de escopo aplicada contra a premissa
comercial do produto é escopo mal cortado. O corte certo teria sido: menos cidades, menos filtros —
nunca menos telefone.

**5. Todo modo degradado com default seguro e sinal visível.**
`USE_MOCKS` fail-open é o exemplo, mas o padrão se repete: health check que responde `ok` sem saber
do worker; fila que pausa sem avisar. Em todos os casos o default escolhido foi "parece funcionando".
Regra: **o estado degradado tem que ser mais barulhento que o estado normal**, e nunca ser o default.

**6. Restrições do ambiente de operação são requisito de arquitetura, não detalhe de deploy.**
Aprendemos, pagando, que neste ambiente não se pode contar com terminal no container, e que
`next build` esconde bugs que `dev` e `typecheck` não pegam (componente como prop Server→Client,
Prisma no Edge, imports `.js` sem `transpilePackages`). Eu tratei "VPS com Docker" como uma linha na
tabela de premissas. Deveria ter derivado dela um requisito explícito: *toda operação de manutenção e
recuperação precisa de caminho pela UI ou por variável de ambiente idempotente, desde o dia 1* — e um
gate de `next build` no CI desde o primeiro commit.

**7. Artefato de infra que não é a produção real precisa dizer isso no topo.**
`infra/docker-compose.yml` descreve com detalhe uma topologia que nunca subiu. Custou zero até agora
e vai custar caro no primeiro incidente. Documentação errada é pior que documentação ausente, porque
é confiável o suficiente para induzir a erro.

---

## Referências verificadas neste documento

- `C:\Projetos\Web\InnoProspect\ARQUITETURA.md` (v1.0, 1549 linhas)
- `C:\Projetos\Web\InnoProspect\PROGRESSO.md` · `C:\Projetos\Web\InnoProspect\DEPLOY.md`
- `C:\Projetos\Web\InnoProspect\apps\worker\src\` (5 arquivos — 1 job dos 6 previstos)
- `C:\Projetos\Web\InnoProspect\apps\web\src\lib\config.ts` (flag `USE_MOCKS`)
- `C:\Projetos\Web\InnoProspect\apps\web\src\lib\services\` (7 arquivos, camada não prevista no §2)
- `C:\Projetos\Web\InnoProspect\packages\scraper\src\sanity\assertions.ts` (sem chamadores)
- `C:\Projetos\Web\InnoProspect\packages\scraper\src\extraction\selectors.ts` · `engine\navigate.ts`
- `C:\Projetos\Web\InnoProspect\packages\core\src\whatsapp\` (warmup e health, sem chamadores)
- `C:\Projetos\Web\InnoProspect\packages\db\prisma\schema.prisma` (15 models, 2 migrações)
- `C:\Projetos\Web\InnoProspect\packages\contracts\src\campaign.contract.ts` (completo, sem rotas)
- `C:\Projetos\Web\InnoProspect\turbo.json` (sem task `test`) · `package.json` (sem script `test`)
- Ausentes e confirmados como ausentes: `docs/`, `tests/`, `.github/`, `infra/Caddyfile`,
  `infra/backup/pg-dump.sh`, `apps/worker/src/policies/`, `apps/worker/src/observability/alerts.ts`
