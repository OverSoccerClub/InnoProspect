# InnoProspect — Documento de Arquitetura

> Versão 1.1 · Autora: Nova (arquitetura) · Data: 2026-08-03 (v1.0: 2026-07-30)
> Status: **fechado para implementação** nas partes marcadas como CONTRATO.
> Alterações em seções CONTRATO exigem aviso ao Atlas antes de codificar (Vega/Lyra dependem delas).

### O que mudou na v1.1

Revisão contra o código real (`REVISAO-ARQUITETURA.md`, 2026-08-03). Três tipos de mudança:

| # | Mudança | Seção | Tipo |
|---|---|---|---|
| 1 | **Contrato do envio unitário `POST /leads/:id/messages`** — a omissão que matou a entrega 3.7 | **§4.9 (nova)** | 🔒 CONTRATO novo |
| 2 | **`error.reason`**: sub-código legível por máquina no envelope de erro | §4.0 | 🔒 CONTRATO alterado — Vega precisa mexer em `packages/contracts` |
| 3 | Premissa de hospedagem corrigida (EasyPanel, não Docker Compose) | §0 | correção de fato |
| 4 | Diagrama: só 1 dos 3 workers existe; o seed roda no `apps/web` | §1.2 | correção de fato |
| 5 | Camada `lib/services/*` promovida a convenção (nenhuma query Prisma em `route.ts`) | §2 | convenção nova |
| 6 | `saturated` nunca foi para o schema — a dívida D4 está sem instrumento de medição | §5.2, §9.2 | correção de fato |
| 7 | Plano faseado reescrito: Fase 0, ordem por ondas, gatilho de `scrape-detail` | **§8** | reescrita |
| 8 | Dívidas novas D8 (reconciliação de status) e D9 (sem model de configuração) | §9.2 | dívida declarada |

**Regra que passa a valer para este documento:** nenhuma linha do plano de fases (§8) existe sem
contrato correspondente na §4. O §4 é, na prática, a lista de trabalho; o §8 é só a narrativa.
Foi exatamente essa omissão que fez a entrega 3.7 não existir (ver `REVISAO-ARQUITETURA.md §6.2`).

---

## 0. Contexto e premissas declaradas

Arquitetura só faz sentido dentro de um contexto. Como não houve briefing de escala/prazo, **assumo o
seguinte** — se alguma premissa estiver errada, avise antes da Fase 1, porque muda decisões:

| Dimensão | Premissa assumida | Impacto na arquitetura |
|---|---|---|
| Maturidade | **MVP evoluindo para produto**, não sistema maduro em escala | Monólito modular, não microserviços |
| Usuários | 1 a ~20 operadores internos/clientes iniciais | Sem multi-tenancy pesado; `User` + `orgId` opcional já preparado |
| Volume de leads | 10k–500k leads no primeiro ano | Postgres único aguenta com folga; índices bem feitos > sharding |
| Volume de disparo | Dezenas a poucos milhares de mensagens/dia, divididas por instância | Fila com rate limit, não streaming distribuído |
| Equipe | Time pequeno (agentes especializados), 1 ambiente de produção | Menos peças móveis = melhor |
| Prazo | Fase 1 funcional rápido | Fase 1 é deliberadamente mínima (ver §8) |
| Hospedagem | **EasyPanel** (PaaS sobre VPS Linux), não serverless — *corrigido na v1.1* | Obrigatório: worker e scraper precisam de processo longo e Chromium |

> ⚠️ **Correção v1.1 — hospedagem.** A v1.0 dizia "VPS com Docker Compose". A produção real é
> **EasyPanel** (TLS, rollback por health check e deploy por Git de graça — troca boa, feita durante a
> implementação). Consequências que valem como requisito de arquitetura, não como detalhe de deploy:
> 1. `infra/docker-compose.yml` descreve uma topologia que **nunca subiu**. É artefato de
>    desenvolvimento local; a produção está no `DEPLOY.md`. Documentação divergente induz a erro em
>    incidente — o arquivo precisa dizer isso no topo (Onda 4).
> 2. **Terminal dentro do container é recurso escasso e frágil neste ambiente** (já pagamos por isso:
>    seed e reset de senha viraram variáveis `RUN_SEED` / `ADMIN_RESET_PASSWORD`). Daí deriva um
>    requisito duro: **toda operação de manutenção e recuperação precisa de caminho pela UI ou por
>    variável de ambiente idempotente.** Nada de "é só rodar um comando no container".
> 3. O domínio é **público na internet**, não rede interna. Isso reclassifica a superfície de
>    autenticação — avaliação é do Órion.

**Consequência de senioridade:** este sistema **não** deve ser microserviços. É um monólito modular com
**dois processos**: o app web (Next.js) e o worker (Node). Eles compartilham banco e código via workspaces.
Isso é uma escolha consciente — se um dia o scraping crescer 100x, o `apps/worker` já está isolado o
suficiente para virar serviço separado sem reescrita.

### Decisões já tomadas pelo usuário (não reabertas)
- Fonte de leads: **scraping próprio de Google Maps**. Sem Google Places API paga, sem base da Receita.
- WhatsApp: **Evolution API** (não-oficial, Baileys, pareamento por QR).
- Stack base: **Next.js 15 (App Router) + TypeScript + Prisma + PostgreSQL**, com scraper e disparo em
  processo Node separado.

### Decisões que ainda tinham espaço — e onde apresento opções
Como a stack base está fechada, minhas opções ficam nas camadas que **não** foram decididas:
fila/orquestração (§1.3), motor de scraping (§5.1) e autenticação (§1.4). Cada uma com 2–3 alternativas,
trade-offs e recomendação.

---

## 1. Visão geral

### 1.1 O sistema em uma frase
O usuário descreve um alvo comercial (**nicho + UF**), o sistema varre o Google Maps município a
município transformando isso em **Leads** deduplicados num CRM leve, e depois dispara **campanhas de
WhatsApp** com cadência controlada, respeitando opt-out e limites anti-ban.

### 1.2 Diagrama de componentes

```mermaid
flowchart TB
    subgraph Browser["🖥️ Navegador do operador"]
        UI["Next.js App Router<br/>React Server Components<br/>+ Client Components"]
    end

    subgraph WebProc["Processo 1 — apps/web (Next.js 15)"]
        API["Route Handlers /api/v1/*<br/>Zod validation + Auth"]
        WH["Webhook /api/webhooks/evolution/:instanceKey"]
    end

    subgraph WorkerProc["Processo 2 — apps/worker (Node long-running)"]
        SW["Scrape Worker<br/>(Playwright/Chromium)"]
        DW["Dispatch Worker<br/>(envio WhatsApp)"]
        MW["Maintenance Worker<br/>(health, retenção, warmup roll)"]
    end

    subgraph Infra["Infraestrutura"]
        PG[("PostgreSQL<br/>Prisma")]
        RD[("Redis<br/>BullMQ: filas + rate limit + locks")]
    end

    subgraph Ext["Serviços externos"]
        GM["Google Maps<br/>(scraping)"]
        IBGE["IBGE Localidades<br/>(seed municípios)"]
        EVO["Evolution API<br/>(container próprio)"]
        WA["WhatsApp<br/>(via Baileys)"]
        PX["🔌 Proxy pool<br/>(ponto de injeção, não implementado)"]
    end

    UI -->|fetch JSON| API
    API -->|Prisma| PG
    API -->|enqueue| RD
    WH -->|Prisma| PG
    WH -->|enqueue/pause| RD

    RD <-->|consume/ack| SW
    RD <-->|consume/ack| DW
    RD <-->|consume/ack| MW

    SW -->|Prisma upsert| PG
    DW -->|Prisma| PG
    MW -->|Prisma| PG

    SW -.->|HTTP/headless| GM
    SW -.-> PX
    PX -.-> GM
    MW -.->|1x, seed| IBGE

    DW -->|POST /message/sendText| EVO
    EVO <-->|websocket| WA
    EVO -->|webhook: inbound,<br/>connection.update,<br/>messages.update| WH

    style PX stroke-dasharray: 5 5
    style WorkerProc fill:#f0f7ff
    style WebProc fill:#fff7f0
```

> ⚠️ **Correção v1.1 — o diagrama é o alvo, não o estado.** Em 2026-08-03, dos três workers
> desenhados dentro de `WorkerProc`, **só o `SW` (Scrape Worker) existe**. `DW` (Dispatch) e `MW`
> (Maintenance) não têm código. Duas consequências:
> - O `MW` aparece chamando o IBGE no seed; na prática o seed roda no **`apps/web`**
>   (`packages/db/prisma/seed.ts`, acionado por `RUN_SEED`). O diagrama está errado neste ponto.
> - A seta `DW → EVO (POST /message/sendText)` nunca existiu em execução: **nada no sistema jamais
>   enviou uma mensagem**. O primeiro chamador real de `sendText` é o envio unitário da **§4.9**, e
>   ele nasce no `apps/web` (route handler), não no worker — de propósito, ver §4.9.1.

### 1.3 Decisão: fila e orquestração

| Opção | Prós | Contras |
|---|---|---|
| **A. BullMQ + Redis** | Rate limiting nativo por fila (essencial pro anti-ban), jobs atrasados/agendados, retry com backoff exponencial pronto, concorrência por worker, locks distribuídos, dashboard (Bull Board) de graça | Mais uma peça de infra (Redis) para operar e fazer backup |
| **B. pg-boss (fila dentro do Postgres)** | Zero infra nova, transacional junto com os dados (enfileirar e gravar no mesmo commit), backup único | Rate limiting e throttling precisam ser escritos à mão; polling gera carga no banco; ecossistema/observabilidade mais pobres |
| **C. Inngest / Temporal (orquestração gerenciada)** | Workflows duráveis, retry e observabilidade excelentes, ótimo para cadências longas | Custo recorrente, vendor lock-in, e o scraper com Chromium continuaria fora dele — resolve só metade do problema |

**Recomendação: A — BullMQ + Redis.** O núcleo de valor deste produto é **cadência controlada**: X msgs/hora
por instância, delay entre envios, backoff em falha de scraping. Isso é exatamente o que o BullMQ resolve
com primitivas testadas (`limiter`, `delay`, `attempts`, `backoff`). Reimplementar isso em cima do pg-boss
(opção B) é escrever à mão a parte mais crítica e mais difícil de acertar do sistema. O custo é um
container Redis a mais — barato e a fila é reconstruível a partir do Postgres se o Redis morrer (regra:
**Redis é volátil por design; a verdade está no Postgres**).

### 1.4 Decisão: autenticação

| Opção | Prós | Contras |
|---|---|---|
| **A. Auth.js (NextAuth v5) com Credentials + Prisma Adapter** | Integra nativo com App Router, sessão em cookie httpOnly, zero custo, dados nossos | Precisamos cuidar de hash de senha, reset, rate limit de login |
| **B. Clerk / Auth0** | Pronto, MFA e recuperação de senha de fábrica | Custo por usuário, dependência externa para algo que aqui é interno |
| **C. Sessão própria (cookie + tabela Session)** | Controle total, simples de auditar | Reinventar roda; risco de erro sutil em segurança |

**Recomendação: A — Auth.js v5 com Credentials.** O sistema tem poucos usuários e todos internos/clientes
diretos; pagar por usuário (B) não se justifica, e (C) é risco desnecessário. Órion valida o hardening
(bcrypt/argon2, rate limit de login, cookie `Secure`+`SameSite=Lax`) na Fase 5.

### 1.5 Fluxos principais (sequência)

**Fluxo A — Busca de leads**
```mermaid
sequenceDiagram
    actor U as Operador
    participant W as Next.js API
    participant Q as Redis/BullMQ
    participant S as Scrape Worker
    participant G as Google Maps
    participant P as Postgres

    U->>W: POST /api/v1/searches {niche, uf, cities?}
    W->>P: cria SearchJob (status=queued) + SearchTask por município
    W->>Q: enqueue "scrape:search" (1 job = 1 SearchTask)
    W-->>U: 202 {searchJob}
    loop cada SearchTask (com rate limit + jitter)
        Q->>S: entrega job
        S->>G: busca "{niche} em {city}-{uf}" + scroll paginado
        G-->>S: HTML/DOM
        S->>S: extractor.parse() — módulo único de seletores
        S->>P: upsert Lead (dedupe por chave natural) + RawCapture
        S->>P: SearchTask.status=done, resultCount=N
        S->>S: sanity check (N zeros seguidos → alarme)
    end
    S->>P: SearchJob.status=completed quando todas as tasks fecham
```

**Fluxo B — Campanha de disparo**
```mermaid
sequenceDiagram
    actor U as Operador
    participant W as Next.js API
    participant Q as Redis/BullMQ
    participant D as Dispatch Worker
    participant E as Evolution API
    participant P as Postgres

    U->>W: POST /api/v1/campaigns {templateId, leadFilter, instanceIds}
    W->>P: cria Campaign(draft) + CampaignTarget[] (snapshot dos leads)
    U->>W: POST /api/v1/campaigns/:id/start
    W->>P: Campaign.status=running
    W->>Q: enqueue "dispatch:tick" (repeatable)
    loop a cada tick, respeitando janela + quota
        Q->>D: entrega tick
        D->>P: SELECT próximo CampaignTarget pending (FOR UPDATE SKIP LOCKED)
        D->>P: ⚠️ checa OptOut + instância conectada + quota + janela horária
        alt bloqueado
            D->>P: target.status=skipped (+reason)
        else liberado
            D->>D: renderiza template + spintax + variáveis
            D->>E: POST /message/sendText/{instance}
            E-->>D: {key.id}
            D->>P: Message(status=sent, providerMessageId)
            D->>D: sleep jitter(45–180s)
        end
    end
    E-->>W: webhook messages.update (delivered/read)
    E-->>W: webhook messages.upsert (resposta do lead)
    W->>P: Message.status / Lead.status=responded / detecta opt-out textual
```

---

## 2. Estrutura de pastas (CONTRATO — Vulcano e Vega seguem isto)

Monorepo **pnpm workspaces + Turborepo**. Motivo: web e worker compartilham Prisma Client, tipos de
contrato e regras de domínio; duplicar isso é a origem número um de bug de divergência.

```
InnoProspect/
├── ARQUITETURA.md
├── PROGRESSO.md
├── README.md
├── package.json                     # workspaces + scripts raiz
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example                     # TODAS as variáveis documentadas, sem valores reais
├── .gitignore
│
├── apps/
│   ├── web/                         # Next.js 15 App Router — UI + API
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── login/page.tsx
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── (dashboard)/
│   │   │   │   │   ├── layout.tsx           # shell: sidebar + topbar
│   │   │   │   │   ├── page.tsx             # visão geral / KPIs
│   │   │   │   │   ├── buscas/
│   │   │   │   │   │   ├── page.tsx         # lista de SearchJobs
│   │   │   │   │   │   ├── nova/page.tsx    # formulário nicho + UF + cidades
│   │   │   │   │   │   └── [id]/page.tsx    # progresso ao vivo
│   │   │   │   │   ├── leads/
│   │   │   │   │   │   ├── page.tsx         # tabela + filtros + export
│   │   │   │   │   │   └── [id]/page.tsx    # ficha do lead + timeline
│   │   │   │   │   ├── templates/
│   │   │   │   │   │   ├── page.tsx
│   │   │   │   │   │   └── [id]/page.tsx    # editor + preview + spintax
│   │   │   │   │   ├── campanhas/
│   │   │   │   │   │   ├── page.tsx
│   │   │   │   │   │   ├── nova/page.tsx
│   │   │   │   │   │   └── [id]/page.tsx    # progresso, pausar, métricas
│   │   │   │   │   ├── whatsapp/
│   │   │   │   │   │   └── page.tsx         # instâncias, QR, saúde, warmup
│   │   │   │   │   └── configuracoes/
│   │   │   │   │       ├── page.tsx
│   │   │   │   │       └── optouts/page.tsx
│   │   │   │   ├── descadastro/[token]/page.tsx   # página PÚBLICA de opt-out (LGPD)
│   │   │   │   ├── api/
│   │   │   │   │   ├── v1/
│   │   │   │   │   │   ├── searches/route.ts
│   │   │   │   │   │   ├── searches/[id]/route.ts
│   │   │   │   │   │   ├── searches/[id]/cancel/route.ts
│   │   │   │   │   │   ├── leads/route.ts
│   │   │   │   │   │   ├── leads/[id]/route.ts
│   │   │   │   │   │   ├── leads/bulk/route.ts
│   │   │   │   │   │   ├── leads/export/route.ts
│   │   │   │   │   │   ├── templates/route.ts
│   │   │   │   │   │   ├── templates/[id]/route.ts
│   │   │   │   │   │   ├── templates/[id]/preview/route.ts
│   │   │   │   │   │   ├── campaigns/route.ts
│   │   │   │   │   │   ├── campaigns/[id]/route.ts
│   │   │   │   │   │   ├── campaigns/[id]/targets/route.ts
│   │   │   │   │   │   ├── campaigns/[id]/[action]/route.ts   # start|pause|resume|cancel
│   │   │   │   │   │   ├── whatsapp/instances/route.ts
│   │   │   │   │   │   ├── whatsapp/instances/[id]/route.ts
│   │   │   │   │   │   ├── whatsapp/instances/[id]/qr/route.ts
│   │   │   │   │   │   ├── whatsapp/instances/[id]/[action]/route.ts  # connect|disconnect
│   │   │   │   │   │   ├── optouts/route.ts
│   │   │   │   │   │   ├── locations/ufs/route.ts
│   │   │   │   │   │   ├── locations/ufs/[uf]/cities/route.ts
│   │   │   │   │   │   └── health/route.ts
│   │   │   │   │   ├── webhooks/evolution/[instanceKey]/route.ts
│   │   │   │   │   └── auth/[...nextauth]/route.ts
│   │   │   │   ├── layout.tsx
│   │   │   │   └── globals.css
│   │   │   ├── components/
│   │   │   │   ├── ui/                       # shadcn/ui (button, table, dialog…)
│   │   │   │   ├── leads/                    # LeadTable, LeadFilters, LeadStatusBadge
│   │   │   │   ├── campaigns/                # CampaignProgress, TargetList
│   │   │   │   ├── templates/                # TemplateEditor, VariablePicker, SpintaxHelp
│   │   │   │   └── whatsapp/                 # QrDialog, InstanceHealthCard
│   │   │   ├── lib/
│   │   │   │   ├── api-handler.ts            # wrapper: auth + zod + envelope de erro
│   │   │   │   ├── auth.ts                   # Auth.js config
│   │   │   │   ├── fetcher.ts                # client HTTP tipado (usa @inno/contracts)
│   │   │   │   └── csv.ts                    # geração de CSV em stream
│   │   │   └── hooks/                        # useLeads, useCampaign, usePolling
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   └── worker/                      # processo Node separado (NÃO serverless)
│       ├── src/
│       │   ├── index.ts                      # bootstrap: conecta Redis, sobe workers, graceful shutdown
│       │   ├── queues.ts                     # definição de filas e nomes (fonte única)
│       │   ├── scheduler.ts                  # jobs repetíveis (tick de campanha, health, retenção)
│       │   ├── jobs/
│       │   │   ├── scrape-search.job.ts      # 1 job = 1 município
│       │   │   ├── scrape-detail.job.ts      # (v2) abrir ficha p/ site/telefone faltante
│       │   │   ├── dispatch-tick.job.ts      # seleciona e envia próximo target
│       │   │   ├── warmup-roll.job.ts        # avança o dia de aquecimento das instâncias
│       │   │   ├── health-check.job.ts       # sanity do scraper + saúde das instâncias
│       │   │   └── retention.job.ts          # LGPD: expurgo e anonimização
│       │   ├── policies/
│       │   │   ├── send-window.ts            # horário comercial + dias úteis + feriados
│       │   │   ├── quota.ts                  # teto diário/horário por instância (warmup)
│       │   │   ├── jitter.ts                 # delays aleatórios
│       │   │   └── guard.ts                  # 🔒 checagem pré-envio (opt-out, conexão, dedupe)
│       │   └── observability/
│       │       ├── logger.ts                 # pino, structured
│       │       └── alerts.ts                 # canal de alarme (log + webhook opcional)
│       ├── Dockerfile                        # base com Chromium/Playwright
│       └── package.json
│
├── packages/
│   ├── db/                          # Prisma — dono do schema (Cronos)
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts                       # UFs + municípios IBGE + usuário admin
│   │   ├── src/
│   │   │   ├── client.ts                     # PrismaClient singleton
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── contracts/                   # 🔒 FONTE ÚNICA DA VERDADE de API (Zod + tipos)
│   │   ├── src/
│   │   │   ├── common.ts                     # envelope, paginação, erros, enums
│   │   │   ├── search.contract.ts
│   │   │   ├── lead.contract.ts
│   │   │   ├── template.contract.ts
│   │   │   ├── campaign.contract.ts
│   │   │   ├── whatsapp.contract.ts
│   │   │   ├── webhook.contract.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── core/                        # regras de domínio, sem I/O de framework
│   │   ├── src/
│   │   │   ├── leads/
│   │   │   │   ├── dedupe.ts                 # chave natural + normalização
│   │   │   │   ├── phone.ts                  # normalização E.164 BR, celular vs fixo
│   │   │   │   └── status.ts                 # máquina de estados do funil
│   │   │   ├── templates/
│   │   │   │   ├── render.ts                 # {{variáveis}}
│   │   │   │   └── spintax.ts                # {a|b|c} + validação
│   │   │   ├── optout/
│   │   │   │   ├── detect.ts                 # detecção textual de descadastro em resposta
│   │   │   │   └── token.ts                  # token público de descadastro
│   │   │   └── locations/
│   │   │       └── uf.ts                     # enum de UFs, slug de município
│   │   └── package.json
│   │
│   ├── scraper/                     # 🔒 TODO o acoplamento com Google Maps vive aqui
│   │   ├── src/
│   │   │   ├── index.ts                      # export { runSearch } — única porta de entrada
│   │   │   ├── engine/
│   │   │   │   ├── browser.ts                # pool Playwright, contextos, fingerprint
│   │   │   │   ├── navigate.ts               # abrir busca, aceitar consent, scroll paginado
│   │   │   │   └── proxy.ts                  # 🔌 ProxyProvider (NoopProxyProvider hoje)
│   │   │   ├── extraction/
│   │   │   │   ├── selectors.ts              # ⚠️ ÚNICO arquivo com seletores do Maps
│   │   │   │   ├── extract-card.ts           # DOM → RawBusiness
│   │   │   │   ├── normalize.ts              # RawBusiness → ScrapedBusiness
│   │   │   │   └── types.ts
│   │   │   ├── sanity/
│   │   │   │   ├── assertions.ts             # fill-rate, zero-streak, forma dos dados
│   │   │   │   └── fixtures/                 # HTML congelado p/ teste sem rede (Íris)
│   │   │   ├── antidetect/
│   │   │   │   ├── user-agents.ts
│   │   │   │   └── humanize.ts               # scroll com curva, pausas, movimento de mouse
│   │   │   └── errors.ts                     # ScrapeError tipado (retryable vs fatal)
│   │   └── package.json
│   │
│   ├── messaging/                   # 🔒 TODO o acoplamento com Evolution API vive aqui
│   │   ├── src/
│   │   │   ├── evolution-client.ts           # HTTP tipado: createInstance, qr, sendText, status
│   │   │   ├── webhook-parser.ts             # payload Evolution → evento de domínio
│   │   │   ├── types.ts
│   │   │   └── errors.ts                     # classifica: retryable / ban / desconectado
│   │   └── package.json
│   │
│   └── config/                      # tsconfig, eslint, prettier compartilhados
│       ├── eslint-preset.js
│       └── tsconfig.json
│
├── infra/
│   ├── docker-compose.yml           # postgres, redis, evolution-api, web, worker
│   ├── docker-compose.dev.yml       # só as dependências, p/ rodar app local
│   ├── Caddyfile                    # reverse proxy + TLS automático
│   └── backup/pg-dump.sh
│
├── docs/                            # Alexandria
│   ├── runbook-scraper-quebrado.md
│   ├── runbook-numero-banido.md
│   └── lgpd.md
│
└── tests/
    ├── e2e/                         # Playwright (Íris)
    └── fixtures/
```

**Regras de dependência (Órion audita):**
- `apps/*` podem importar de `packages/*`. **`packages/*` nunca importam de `apps/*`.**
- `packages/core` não importa Prisma nem Next — é lógica pura, 100% testável em unidade.
- Só `packages/scraper` conhece o DOM do Google. Só `packages/messaging` conhece a Evolution API.
- Web e worker **não** se chamam por HTTP. Comunicam-se por **Postgres (estado) + Redis (fila)**.
- **`apps/web/src/lib/services/*` é camada obrigatória: nenhuma query Prisma vive em `route.ts`.**
  *(convenção v1.1)* Eu não tinha previsto essa camada — o Vega a criou e as rotas ficaram com ~10
  linhas cada. É melhor do que projetei; vira regra. O `route.ts` faz auth + parse Zod + chamada ao
  serviço + resposta, e nada mais. Isso é o que torna auditável a afirmação "todo envio passa pelo
  guard" (§4.9.3): há um único lugar onde procurar.
- **Regra pura + adaptador de I/O, quando a regra é de proteção.** A decisão mora em `packages/core`
  (sem I/O, testável); quem lê o banco e chama a rede é o adaptador em `apps/*`. Serve para o guard
  de envio (§4.9.3) exatamente como serve para warmup e sanidade do scraper — **e o adaptador tem
  que ser exercitado, senão a regra pura é código morto** (foi o que aconteceu com `evaluateSanity`,
  `effectiveDailyLimit` e `regressWarmupDay`: escritas, testadas, exportadas, zero chamadores).

---

## 3. Modelo de domínio (alto nível — schema detalhado é do Cronos)

```mermaid
erDiagram
    User ||--o{ SearchJob : cria
    User ||--o{ Campaign : cria
    User ||--o{ MessageTemplate : cria
    User ||--o{ WhatsAppInstance : possui

    SearchJob ||--|{ SearchTask : "fanout por município"
    SearchTask ||--o{ Lead : origina
    SearchJob ||--o{ Lead : agrupa

    Lead ||--o{ CampaignTarget : "é alvo de"
    Lead ||--o{ Message : "recebe/envia"
    Lead ||--o{ LeadActivity : timeline
    Lead }o--|| City : localizado_em
    City }o--|| Uf : pertence_a

    Campaign ||--|{ CampaignTarget : contém
    Campaign }o--|| MessageTemplate : usa
    Campaign }o--o{ WhatsAppInstance : "rotaciona entre"

    CampaignTarget ||--o| Message : gera
    WhatsAppInstance ||--o{ Message : envia
    WhatsAppInstance ||--o{ InstanceDailyStat : "quota/warmup"

    OptOut }o--|| Lead : "bloqueia (por telefone)"
```

### 3.1 Entidades e responsabilidades

| Entidade | Responsabilidade | Campos-chave (conceituais) |
|---|---|---|
| **User** | Operador do sistema. Dono lógico de tudo. | email, passwordHash, name, role (`admin`\|`operator`), createdAt |
| **Uf / City** | Tabela de referência **populada pelo IBGE no seed**. Base do fanout de busca. | Uf: sigla, nome, regiao. City: ibgeCode (PK natural), nome, slug, ufId, população (para priorizar/subdividir) |
| **SearchJob** | Uma intenção de busca do usuário: nicho + UF (+ cidades). Agregado que dá progresso. | niche, ufId, cityIds[], status (`queued`\|`running`\|`paused`\|`completed`\|`failed`\|`cancelled`), totalTasks, doneTasks, leadsFound, leadsNew, createdBy, startedAt, finishedAt |
| **SearchTask** | **Unidade real de trabalho: 1 nicho × 1 município.** Existe para paralelizar, retentar e medir sem refazer a busca inteira. | searchJobId, cityId, queryString, status, attempt, resultCount, errorCode, startedAt, finishedAt |
| **Lead** | A empresa capturada, deduplicada. Núcleo do CRM. | name, phoneRaw, phoneE164, phoneType (`mobile`\|`landline`\|`unknown`), address, cityId, uf, website, category, rating, reviewCount, latitude, longitude, **dedupeKey** (único), status de funil, tags[], notes, ownerId, **sourceType**, **sourceUrl**, **collectedAt**, externalRef (place id/cid quando houver), firstSeenAt, lastSeenAt |
| **LeadActivity** | Timeline auditável do lead (mudança de status, mensagem enviada, resposta, opt-out). Append-only. | leadId, type, payload (json), actor (`user`\|`system`\|`lead`), createdAt |
| **MessageTemplate** | Texto reutilizável com `{{variáveis}}` e spintax. Versionado por cópia, não editado em campanha ativa. | name, body, variablesUsed[], isActive, createdBy, version |
| **Campaign** | Um disparo planejado: template + público + instâncias + política de cadência. | name, templateId, status (`draft`\|`scheduled`\|`running`\|`paused`\|`completed`\|`cancelled`), instanceIds[], filterSnapshot (json), dailyLimit, sendWindow, jitterRange, startedAt, finishedAt, stats agregadas |
| **CampaignTarget** | **Snapshot** do lead dentro da campanha. Garante que editar/mover o lead não corrompe a campanha, e permite retry por alvo. | campaignId, leadId, phoneE164, status (`pending`\|`sent`\|`delivered`\|`read`\|`responded`\|`failed`\|`skipped`), skipReason, scheduledFor, attempt, messageId, sentAt |
| **Message** | Cada mensagem individual, enviada ou recebida. | leadId, campaignTargetId?, instanceId, direction (`outbound`\|`inbound`), body, providerMessageId, status (`queued`\|`sent`\|`delivered`\|`read`\|`failed`), errorCode, sentAt, deliveredAt, readAt |
| **WhatsAppInstance** | Um número conectado via Evolution API. Carrega o estado de aquecimento. | name, evolutionInstanceName, phoneNumber, status (`disconnected`\|`connecting`\|`qr_pending`\|`connected`\|`banned`), warmupStartedAt, warmupDay, dailyLimitOverride, lastConnectionAt, lastErrorAt, isActive, webhookSecret |
| **InstanceDailyStat** | Contador diário por instância (sent/failed/responded). Fonte da quota e do warmup. | instanceId, date, sentCount, failedCount, respondedCount, blockedCount |
| **OptOut** | **Blacklist. A tabela mais importante do sistema em termos de risco.** Chave é o telefone, não o lead — se o mesmo número reaparecer em outra busca, continua bloqueado. | phoneE164 (único), source (`reply`\|`manual`\|`public_link`\|`request`), leadId?, reason, createdAt |
| **ScraperHealthEvent** | Registro das assertions de sanidade (§5.6). Alimenta o alarme e o runbook. | type, severity, window, metric, value, threshold, message, createdAt, resolvedAt |

### 3.2 Regras de domínio que atravessam entidades (CONTRATO)

1. **Chave de deduplicação de Lead (`dedupeKey`)**, nesta ordem de preferência:
   1. `externalRef` (place id/cid do Maps), se capturado — mais confiável;
   2. senão `phoneE164` normalizado;
   3. senão `slug(name) + ':' + cityIbgeCode`.
   O campo é **único** e materializado na gravação (não calculado em query). Re-scraping faz `upsert`:
   atualiza `lastSeenAt`, rating e reviewCount, **mas nunca sobrescreve `status` de funil, `notes`,
   `tags` ou `ownerId`** — dado humano vence dado de máquina.
2. **Máquina de estados do funil** (`Lead.status`):
   `new → validated → contacted → responded → negotiating → won` e, de qualquer estado, `→ discarded`.
   Transições ilegais são rejeitadas em `packages/core/leads/status.ts`, não no frontend.
   `contacted` e `responded` são setados pelo sistema (worker/webhook); o resto é humano.
3. **Opt-out é global e imediato.** É consultado por `phoneE164` **no worker, imediatamente antes de cada
   envio** — nunca só na montagem da campanha. Uma campanha rodando há 3 horas respeita um opt-out
   registrado há 30 segundos. Não há exceção nem flag para desativar isso.
4. **Só telefone móvel recebe WhatsApp.** Fixo entra como Lead (é dado comercial válido) mas nasce
   `CampaignTarget.status = skipped, skipReason = 'landline'`.
5. **Campaign nunca aponta para o template vivo.** No `start`, copia o corpo do template para a campanha
   (`renderedTemplateSnapshot`). Editar o template depois não altera campanha em andamento.

---

## 4. Contratos de API (CONTRATO — Vega implementa, Lyra consome)

### 4.0 Convenções globais

- **Base:** `/api/v1`. Tudo JSON `application/json; charset=utf-8`, exceto o export CSV.
- **Auth:** cookie de sessão (Auth.js). Sem sessão → `401`. Sem permissão → `403`.
- **Validação:** Zod em `packages/contracts`. Erro de validação → `422`.
- **Datas:** ISO 8601 UTC (`2026-07-30T14:03:00.000Z`).
- **Telefone:** sempre E.164 no response (`+5511987654321`). O bruto fica em `phoneRaw`.
- **IDs:** `cuid2` string.

**Envelope de sucesso — coleção:**
```ts
type Paginated<T> = {
  data: T[];
  page: { cursor: string | null; nextCursor: string | null; limit: number; total: number };
};
```
**Envelope de sucesso — item:** o objeto direto (sem wrapper), ou `{ ok: true, ... }` em ações.

**Envelope de erro (todas as rotas):**
```ts
type ApiError = {
  error: {
    code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'
        | 'CONFLICT' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'INTERNAL_ERROR';
    reason?: string;                        // 🆕 v1.1 — sub-código SCREAMING_SNAKE, legível por máquina
    message: string;                        // legível, pt-BR, exibível ao usuário
    details?: Array<{ path: string; message: string }>;
    requestId: string;
  };
};
```
**Códigos HTTP usados:** 200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502.

> 🔒 **CONTRATO ALTERADO na v1.1 — `error.reason` (Vega implementa em `packages/contracts`).**
> Buraco encontrado na revisão: este documento vinha citando sub-códigos (`SEARCH_ALREADY_RUNNING`,
> `INVALID_STATUS_TRANSITION`, `TEMPLATE_IN_USE`, `ALREADY_OPTED_OUT`, `INSUFFICIENT_TEXT_VARIATION`,
> `HALT_NOT_ACKNOWLEDGED`…) como se fossem valores de `error.code` — mas `code` é um enum fechado de
> 8 valores, ligado 1:1 ao status HTTP. Não havia onde esses nomes viverem. Resultado: hoje a UI só
> tem a `message` em pt-BR para decidir o que fazer, ou seja, **não tem como decidir**.
>
> - `code` continua fechado e continua governando o status HTTP (`API_ERROR_HTTP_STATUS`).
> - `reason` é opcional, `SCREAMING_SNAKE`, e é **o único campo em que Lyra pode ramificar lógica**.
>   Nunca ramificar por `message` (texto muda; é para o humano ler).
> - Todo sub-código nomeado neste §4 é um valor de `reason`. O conjunto por rota é fechado e está
>   documentado na tabela de erros de cada endpoint.
> - Mudança **aditiva**: nenhum consumidor existente quebra. `details[]` continua sendo para erro de
>   campo (validação), `reason` para erro de regra de negócio.
>
> Isto é pré-requisito da §4.9: sem `reason`, a UI do envio unitário não distingue "bloqueado por
> opt-out" (nunca mais tente) de "estourou a cota do dia" (tente amanhã) — e são ações opostas.

**Paginação:** cursor (`?cursor=<id>&limit=<1..100>`, default 25). Ordenação padrão `createdAt desc`.

---

### 4.1 Localidades (auxiliar do formulário de busca)

#### `GET /api/v1/locations/ufs`
`200` → `{ data: [{ id, sigla: "SP", nome: "São Paulo", cityCount: 645 }] }`

#### `GET /api/v1/locations/ufs/:sigla/cities`
Query: `?q=<busca por nome>&limit=<n>`
`200` → `{ data: [{ ibgeCode: "3550308", nome: "São Paulo", slug: "sao-paulo", population: 11451245 }] }`

---

### 4.2 Buscas (SearchJob)

#### `POST /api/v1/searches` — criar e enfileirar busca
```ts
// Request
{
  niche: string;                 // 3..120 chars. ex.: "clínica odontológica"
  uf: string;                    // 2 chars maiúsculas. ex.: "SP"
  cityIbgeCodes?: string[];      // opcional. vazio/ausente = TODOS os municípios da UF
  maxResultsPerCity?: number;    // default 120, máx 300
  name?: string;                 // rótulo amigável; default: "{niche} — {uf}"
}
```
```ts
// 201 Created
{
  id: string; name: string; niche: string; uf: string;
  status: 'queued';
  totalTasks: number;            // = nº de municípios no fanout
  doneTasks: 0; leadsFound: 0; leadsNew: 0;
  createdAt: string;
  estimatedDurationMinutes: number;   // heurística: totalTasks * ~40s / concorrência
}
```
Erros: `422` (uf inválida / niche curto), `409` `SEARCH_ALREADY_RUNNING` se já existir job idêntico
(`niche`+`uf`) em `queued|running`.

#### `GET /api/v1/searches`
Query: `?status=&uf=&q=&cursor=&limit=`
`200` → `Paginated<SearchJobSummary>`, onde:
```ts
type SearchJobSummary = {
  id: string; name: string; niche: string; uf: string;
  status: 'queued'|'running'|'paused'|'completed'|'failed'|'cancelled';
  progress: { total: number; done: number; failed: number; percent: number };
  leadsFound: number; leadsNew: number;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
};
```

#### `GET /api/v1/searches/:id`
`200` → `SearchJobSummary & { tasks: SearchTaskItem[]; error?: string }`
```ts
type SearchTaskItem = {
  id: string; cityName: string; ibgeCode: string;
  status: 'pending'|'running'|'done'|'failed'|'skipped';
  resultCount: number; attempt: number;
  errorCode: string | null; finishedAt: string | null;
};
```
> **Nota para Lyra:** a tela de progresso usa **polling de 3s** neste endpoint enquanto
> `status ∈ {queued, running}`. Sem WebSocket no MVP — decisão consciente (§9, dívida D2).

#### `POST /api/v1/searches/:id/cancel`
`200` → `{ ok: true, status: 'cancelled', cancelledTasks: number }`
Erro: `409` se já `completed`.

#### `POST /api/v1/searches/:id/retry-failed`
`202` → `{ ok: true, requeuedTasks: number }`

---

### 4.3 Leads

#### `GET /api/v1/leads`
Query params (todos opcionais, combináveis com AND):
| Param | Tipo | Observação |
|---|---|---|
| `q` | string | busca em nome, telefone, endereço (ILIKE / trigram) |
| `status` | csv | `new,validated,contacted,...` |
| `uf` | csv | `SP,MG` |
| `cityIbgeCode` | csv | |
| `category` | csv | |
| `searchJobId` | string | |
| `hasWebsite` | boolean | |
| `hasPhone` | boolean | |
| `phoneType` | `mobile`\|`landline`\|`unknown` | |
| `minRating` | number | 0..5 |
| `tags` | csv | |
| `optedOut` | boolean | default `false` = esconde opt-outs |
| `contactedInCampaign` | boolean | filtro anti-recontato |
| `createdFrom` / `createdTo` | ISO date | |
| `sort` | `createdAt`\|`name`\|`rating`\|`reviewCount` (+ `:asc`/`:desc`) | default `createdAt:desc` |
| `cursor`, `limit` | | |

`200` → `Paginated<LeadListItem>` + campo extra `facets`:
```ts
type LeadListItem = {
  id: string; name: string;
  phoneE164: string | null; phoneType: 'mobile'|'landline'|'unknown';
  address: string | null; city: string | null; uf: string | null;
  website: string | null; category: string | null;
  rating: number | null; reviewCount: number | null;
  status: LeadStatus; tags: string[];
  isOptedOut: boolean;
  lastContactedAt: string | null;
  createdAt: string;
};
// resposta:
{ data: LeadListItem[], page: {...}, facets: { byStatus: Record<LeadStatus, number>, total: number } }
```

#### `GET /api/v1/leads/:id`
`200` → `LeadListItem & { notes, latitude, longitude, source: { type, url, collectedAt, searchJobId },
firstSeenAt, lastSeenAt, activities: LeadActivity[], messages: MessageItem[] }`

#### `PATCH /api/v1/leads/:id`
```ts
// Request (parcial)
{ status?: LeadStatus; notes?: string; tags?: string[]; name?: string; phoneE164?: string; website?: string }
```
`200` → `LeadListItem`. Erro `422 INVALID_STATUS_TRANSITION` com `details[0].message` explicando a
transição inválida (ex.: `"não é possível ir de 'new' para 'won'"`).

#### `POST /api/v1/leads/bulk`
```ts
{ action: 'set_status' | 'add_tags' | 'remove_tags' | 'discard' | 'opt_out';
  leadIds?: string[];          // OU
  filter?: LeadFilter;         // mesmos params de GET /leads
  value?: { status?: LeadStatus; tags?: string[] } }
```
`200` → `{ ok: true, affected: number }`. Limite: 10.000 leads por chamada (`422` acima disso).

#### `GET /api/v1/leads/export`
Mesmos filtros de `GET /leads` + `?columns=` (csv de campos) + `?format=csv`.
`200` com `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="leads-YYYY-MM-DD.csv"`.
Resposta em **stream** (não carrega tudo em memória). Separador `,`, aspas duplas, **BOM UTF-8** no
início (Excel PT-BR). Colunas default:
`nome,telefone,tipo_telefone,endereco,cidade,uf,site,categoria,nota,avaliacoes,status,tags,origem_url,coletado_em`
Limite: 50.000 linhas por export (`422 EXPORT_TOO_LARGE` acima, com sugestão de refinar filtro).

---

### 4.4 Templates

#### `GET /api/v1/templates` → `Paginated<TemplateItem>`
```ts
type TemplateItem = {
  id: string; name: string; body: string;
  variablesUsed: string[];        // detectadas do corpo
  hasSpintax: boolean; spintaxVariations: number;   // combinações possíveis
  isActive: boolean; usageCount: number;
  createdAt: string; updatedAt: string;
};
```

#### `POST /api/v1/templates`
```ts
{ name: string;      // 3..80
  body: string;      // 10..4000
  isActive?: boolean }  // default true
```
`201` → `TemplateItem`.
**Validação (CONTRATO):**
- Variáveis permitidas: `{{nome}}`, `{{primeiro_nome}}`, `{{cidade}}`, `{{uf}}`, `{{categoria}}`,
  `{{site}}`, `{{telefone}}`, `{{minha_empresa}}`. Variável desconhecida → `422 UNKNOWN_VARIABLE`.
- Spintax: `{opção a|opção b|opção c}`, sem aninhamento no MVP. Chave não fechada → `422 INVALID_SPINTAX`.
- **Aviso, não erro:** se `spintaxVariations < 3`, retorna `201` com `warnings: [{ code: 'LOW_VARIATION',
  message: '...' }]` — Lyra mostra alerta amarelo. Justificativa em §6.4.

#### `PATCH /api/v1/templates/:id` · `DELETE /api/v1/templates/:id`
`DELETE` → `204`. Se usado por campanha `running` → `409 TEMPLATE_IN_USE` (fazer soft delete via `isActive:false`).

#### `POST /api/v1/templates/:id/preview`
```ts
// Request
{ leadId?: string; sampleCount?: number }   // default 3
// 200
{ previews: Array<{ text: string; length: number; usedVariables: Record<string,string> }>,
  missingVariables: string[] }              // variáveis sem valor no lead-exemplo
```

---

### 4.5 Campanhas

#### `POST /api/v1/campaigns` — cria em `draft` (NÃO dispara)
```ts
{
  name: string;
  templateId: string;
  instanceIds: string[];              // 1..n; rotação round-robin ponderada por quota
  audience:
    | { mode: 'ids'; leadIds: string[] }
    | { mode: 'filter'; filter: LeadFilter };
  settings?: {
    dailyLimitPerInstance?: number;   // default = quota de warmup vigente (§6.2)
    sendWindow?: { startHour: number; endHour: number; daysOfWeek: number[] }; // default 9–18, seg–sex
    jitterSeconds?: { min: number; max: number };   // default {min:45,max:180}; min>=30 obrigatório
    skipRecentlyContactedDays?: number;             // default 30
  };
  scheduledFor?: string;              // ISO; se ausente, começa quando chamarem /start
}
```
`201` →
```ts
{
  id: string; name: string; status: 'draft';
  templateId: string; instanceIds: string[];
  audience: { totalMatched: number; eligible: number;
              excluded: { optedOut: number; landline: number; noPhone: number;
                          recentlyContacted: number; duplicatePhone: number } };
  settings: {...};                    // efetivas, com defaults resolvidos
  estimate: { days: number; messagesPerDay: number; finishesAround: string };
  createdAt: string;
}
```
> **Importante para Lyra:** o bloco `audience.excluded` é a tela de conferência antes de iniciar.
> Mostrar sempre, com os motivos discriminados. O usuário precisa ver *por que* 800 leads viraram 430 alvos.

#### `GET /api/v1/campaigns` → `Paginated<CampaignSummary>`
```ts
type CampaignSummary = {
  id: string; name: string;
  status: 'draft'|'scheduled'|'running'|'paused'|'completed'|'cancelled'|'halted';
  templateName: string; instanceCount: number;
  stats: { total: number; pending: number; sent: number; delivered: number;
           read: number; responded: number; failed: number; skipped: number };
  rates: { deliveryRate: number; responseRate: number };   // 0..1
  haltReason: string | null;         // preenchido quando status='halted' (§6.6)
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  nextSendAt: string | null;
};
```

#### `GET /api/v1/campaigns/:id` → `CampaignSummary & { settings, renderedTemplateSnapshot, perInstance: Array<{ instanceId, name, sent, failed, quotaRemaining, status }> }`

#### `GET /api/v1/campaigns/:id/targets`
Query: `?status=&cursor=&limit=`
`200` → `Paginated<{ id, leadId, leadName, phoneE164, status, skipReason, attempt, scheduledFor, sentAt, messagePreview }>`

#### Ações de campanha — `POST /api/v1/campaigns/:id/{action}`

| Action | De → Para | Body | Response | Efeito |
|---|---|---|---|---|
| `start` | `draft`/`scheduled` → `running` | — | `200 { ok:true, status:'running', firstSendAt }` | Congela snapshot do template, reavalia opt-outs, agenda tick |
| `pause` | `running` → `paused` | — | `200 { ok:true, status:'paused', pendingTargets }` | Para de enfileirar; envio em voo termina |
| `resume` | `paused`/`halted` → `running` | `{ acknowledgeHalt?: boolean }` | `200 { ok:true, status:'running' }` | De `halted` exige `acknowledgeHalt:true`, senão `409 HALT_NOT_ACKNOWLEDGED` |
| `cancel` | qualquer ativo → `cancelled` | — | `200 { ok:true, cancelledTargets }` | Irreversível |

Erros de transição: `409 INVALID_CAMPAIGN_TRANSITION` com `message` explicando o estado atual.
`start` com instância desconectada → `409 INSTANCE_NOT_CONNECTED` listando quais.

---

### 4.6 Instâncias de WhatsApp

#### `GET /api/v1/whatsapp/instances`
```ts
{ data: Array<{
    id: string; name: string; phoneNumber: string | null;
    status: 'disconnected'|'connecting'|'qr_pending'|'connected'|'banned';
    health: 'ok'|'warming'|'degraded'|'blocked';
    warmup: { day: number; dailyLimit: number; isWarm: boolean };   // isWarm = passou do ramp-up
    today: { sent: number; failed: number; responded: number; remaining: number };
    lastConnectionAt: string | null; lastErrorAt: string | null; lastError: string | null;
    activeCampaigns: number;
  }> }
```

#### `POST /api/v1/whatsapp/instances`
```ts
{ name: string; startWarmup?: boolean }   // default true
```
`201` → `{ id, name, status: 'qr_pending', evolutionInstanceName }`
(cria a instância no Evolution API e devolve; o QR vem no endpoint abaixo)

#### `GET /api/v1/whatsapp/instances/:id/qr`
`200` → `{ status: 'qr_pending', qrCodeBase64: string, expiresInSeconds: number, pairingCode?: string }`
ou `{ status: 'connected', qrCodeBase64: null }`.
`502 UPSTREAM_ERROR` se a Evolution API não responder.
> **Lyra:** poll de 2s neste endpoint enquanto o modal do QR estiver aberto; o QR expira em ~60s e o
> endpoint devolve um novo automaticamente.

#### `GET /api/v1/whatsapp/instances/:id` → objeto completo + `history: InstanceDailyStat[]` (30 dias)

#### `POST /api/v1/whatsapp/instances/:id/connect` → `202 { ok:true, status:'qr_pending' }`
#### `POST /api/v1/whatsapp/instances/:id/disconnect` → `200 { ok:true, status:'disconnected', pausedCampaigns: string[] }`
#### `DELETE /api/v1/whatsapp/instances/:id` → `204`. `409 INSTANCE_IN_USE` se houver campanha `running` usando só ela.

---

### 4.7 Opt-out

#### `GET /api/v1/optouts` → `Paginated<{ id, phoneE164, source, leadName, reason, createdAt }>`
#### `POST /api/v1/optouts`
```ts
{ phoneE164: string; reason?: string; source?: 'manual'|'request' }   // default 'manual'
```
`201` → `{ id, phoneE164, createdAt, affectedTargets: number }` (quantos alvos pendentes foram marcados `skipped`)
`409 ALREADY_OPTED_OUT` se já existir.

#### `DELETE /api/v1/optouts/:id` → `204`. Exige `role=admin`. Gera `LeadActivity` de auditoria.

#### `GET /descadastro/:token` (página pública, sem auth) e `POST /api/v1/public/optout`
```ts
{ token: string; confirm: true }
```
`200` → `{ ok: true, message: 'Você não receberá mais mensagens.' }`
Rate limit: 10 req/min por IP. Token é HMAC do `phoneE164` + segredo (não enumerável).

---

### 4.8 Webhook do Evolution API (CONTRATO — Vega implementa)

#### `POST /api/webhooks/evolution/:instanceKey`

- **`:instanceKey`** é um segredo por instância gerado por nós (não o nome da instância). Configurado
  na Evolution API na criação. Se não bater → `404` (**não** `401`, para não confirmar existência).
- Validação adicional: header `apikey` conferido contra `EVOLUTION_API_KEY` em tempo constante.
- **Sempre responde `200 { received: true }` rapidamente**, mesmo em erro de processamento — a
  Evolution API reenvia em não-200 e pode entrar em loop. Processamento pesado vai para a fila.
- **Idempotência:** `data.key.id` é chave única; evento repetido é ignorado silenciosamente.

Eventos tratados:

```ts
// 1) connection.update — mudança de estado da conexão
{ event: 'connection.update', instance: string,
  data: { state: 'open'|'close'|'connecting', statusReason?: number } }
// → 'close'/statusReason 401 => instance.status='banned' | 'disconnected'
// → PARA TODAS as campanhas que usam SÓ esta instância (status='halted', haltReason)

// 2) qrcode.updated
{ event: 'qrcode.updated', instance: string, data: { qrcode: { base64: string, code: string } } }
// → guarda em cache Redis (TTL 90s) p/ o endpoint GET /qr

// 3) messages.upsert — mensagem recebida (RESPOSTA DO LEAD)
{ event: 'messages.upsert', instance: string,
  data: { key: { id: string, remoteJid: string, fromMe: boolean },
          message: { conversation?: string, extendedTextMessage?: { text: string } },
          pushName?: string, messageTimestamp: number } }
// → ignora fromMe=true e remoteJid de grupo (@g.us)
// → cria Message(direction='inbound'); Lead.status: contacted → responded
// → CampaignTarget.status = 'responded'
// → 🔴 roda detectOptOut(text): se casar, cria OptOut IMEDIATAMENTE (§6.7)

// 4) messages.update — status de entrega
{ event: 'messages.update', instance: string,
  data: { keyId: string, status: 'PENDING'|'SERVER_ACK'|'DELIVERY_ACK'|'READ'|'ERROR' } }
// → mapeia p/ Message.status: sent | delivered | read | failed
```

**Mapa de status (CONTRATO):** `PENDING→queued`, `SERVER_ACK→sent`, `DELIVERY_ACK→delivered`,
`READ→read`, `ERROR→failed`.

**Ordem de chegada (v1.1, corrige um buraco real):** a Evolution pode entregar o `messages.update`
**antes** de terminarmos de gravar o `providerMessageId` da mensagem que acabamos de enviar (§4.9.5).
Se o handler não encontrar `Message` com aquele `data.key.id`, ele **não pode descartar em silêncio**:
- refaz a busca **uma vez, após ~2s**, antes de desistir (cobre a corrida de sub-segundo, custo zero);
- se ainda não achar, grava `logger.warn` com o `keyId` e a instância. É o que permite descobrir o
  problema sem esperar o cliente reclamar de "métrica de entrega baixa".

Reconciliação de verdade (varrer mensagens `sent` sem `delivered` e consultar a Evolution) é a
dívida **D8** (§9.2) — consciente, e o `warn` acima é o instrumento que vai medir se ela importa.

---

### 4.9 Envio unitário de mensagem (CONTRATO — 🆕 v1.1)

> **Por que esta seção existe.** A entrega 3.7 do plano faseado ("envio manual para 1 lead") existia
> justamente para **exercitar a integração com a Evolution API antes de a Fase 4 ser construída em
> cima dela**. Eu escrevi a linha no §8 e nunca escrevi o endpoint aqui. Ninguém implementou — e o
> §4 é, na prática, a lista de trabalho. Consequência medida na revisão: `EvolutionClient.sendText`
> está completo, testado e **sem um único chamador**; o sistema nunca enviou uma mensagem.
> Esta seção fecha o buraco. Erro meu, registrado como tal.

#### 4.9.1 Por que o envio unitário vem antes da campanha (e o que isso decide)

Esta rota **não é uma conveniência de UI**. É a primeira execução real de todos os portões de
proteção do §6, com volume 1 e um humano olhando. A Fase 4 não vai *estrear* o portão de opt-out num
disparo de 500 mensagens — vai **herdar um portão já exercitado em produção**.

Três decisões derivam disso:

1. **O guard nasce aqui, não na Fase 4.** O `dispatch-tick.job` vai importar exatamente a mesma
   função de decisão. Se o guard nascesse no worker, a primeira vez que ele rodaria seria também a
   primeira vez que 500 pessoas receberiam mensagem — o pior momento possível para descobrir um bug.
2. **A rota vive no `apps/web`, não no worker.** Envio unitário é síncrono por natureza: o operador
   clica e precisa saber, na mesma tela, se saiu e por que não saiu. Passar pela fila só para
   devolver "202 aceito" transforma um erro acionável ("este número pediu para sair") em silêncio.
   O worker continua sendo o único caminho para **volume** (§6.1) — isto aqui é uma mensagem.
3. **Nada aqui é "modo de teste".** O envio manual consome a mesma cota diária, avança os mesmos
   contadores e respeita os mesmos bloqueios. Se fosse exceção, viraria o caminho oficial para furar
   o warmup — e o WhatsApp do outro lado não distingue mensagem manual de mensagem de campanha.

#### 4.9.2 `POST /api/v1/leads/:id/messages`

Envia **uma** mensagem de texto para o lead `:id`, a partir de uma instância conectada.
Auth: sessão (`operator` ou `admin`). Não há versão pública nem por API key.

```ts
// Request
{
  // Exatamente UM dos dois — enviar os dois ou nenhum é 422:
  templateId?: string;          // renderiza {{variáveis}} + spintax a partir do template
  body?: string;                // 1..4000 chars, texto final, sem processamento de variáveis

  instanceId?: string;          // opcional — default resolvido por afinidade/cota (§4.9.4)
  spintaxSeed?: string;         // opcional — ver §4.9.4 "o que eu vi no preview é o que sai"

  // Confirmações explícitas. Default false: o caminho seguro nunca depende de o cliente lembrar.
  confirmOutsideBusinessWindow?: boolean;   // fora de 09–18/seg–sex, mas dentro do piso legal
  allowNonMobile?: boolean;                 // telefone classificado como fixo/desconhecido
}
```

```ts
// 201 Created
{
  message: MessageItem;                     // já existe em packages/contracts (whatsapp.contract.ts)
                                            // status = 'sent', providerMessageId preenchido
  instance: { id: string; name: string; phoneNumber: string | null;
              health: 'ok'|'warming'|'degraded'|'blocked' };
  quota: { warmupDay: number; isWarm: boolean; dailyLimit: number;
           sentToday: number; remaining: number };
  renderedFrom: { templateId: string; spintaxSeed: string } | null;   // null se veio `body` cru
  warnings: Array<{ code: string; message: string }>;                 // ver §4.9.6
}
```

Reaproveitar `messageItemSchema` é deliberado: a ficha do lead (`GET /leads/:id`) já lista mensagens
com esse formato, então a UI insere a nova na timeline sem refetch e sem um segundo tipo para manter.

#### 4.9.3 Os portões, em ordem, e onde cada um mora

Esta tabela é o coração da seção. A **ordem é normativa**: o custo cresce e a reversibilidade cai da
esquerda para a direita, e o portão inegociável é o último, colado na rede.

| # | Portão | Falha → | `reason` | Onde a decisão mora |
|---|---|---|---|---|
| G0 | Sessão válida | 401 | — | `api-handler` |
| G1 | Lead existe / instância existe | 404 | `LEAD_NOT_FOUND` · `INSTANCE_NOT_FOUND` | serviço |
| G2 | Payload: exatamente um de `templateId`\|`body`; tamanho; variáveis e spintax válidos | 422 | `BODY_OR_TEMPLATE_REQUIRED` · `BODY_TOO_LONG` · `UNKNOWN_VARIABLE` · `INVALID_SPINTAX` | Zod + `packages/core/templates` |
| G3 | Lead tem `phoneE164` | 409 | `LEAD_HAS_NO_PHONE` | serviço |
| G4 | `phoneType === 'mobile'` (ou `allowNonMobile: true`) | 409 | `LEAD_NOT_MOBILE` | `packages/core/leads/phone` |
| G5 | **Piso de horário (duro, não contornável)** | 409 | `QUIET_HOURS` | `core/whatsapp/send-window` |
| G6 | Janela comercial (mole: exige confirmação) | 409 | `OUTSIDE_BUSINESS_WINDOW` | `core/whatsapp/send-window` |
| G7 | Instância `connected` e não banida | 409 | `INSTANCE_NOT_CONNECTED` · `INSTANCE_BANNED` | serviço |
| G8 | **Cota diária do warmup** | 409 | `DAILY_LIMIT_REACHED` | `core/whatsapp/warmup` (`effectiveDailyLimit`) |
| G9 | Anti-duplo-clique: nenhum outbound para este lead nos últimos 60s | 409 | `DUPLICATE_SEND` | serviço |
| G10 | 1º contato frio: aviso de descadastro + `{{minha_empresa}}` presentes | 409 | `MISSING_OPTOUT_NOTICE` · `MISSING_COMPANY_NAME` | `core/templates` + serviço |
| G11 | 🔴 **OPT-OUT — `SELECT` por `phoneE164`, sem cache, imediatamente antes da rede** | 409 | `OPTED_OUT` | serviço (consulta) + `core/whatsapp/send-guard` (decisão) |
| — | → `EvolutionClient.sendText()` | — | — | `packages/messaging` |

**G11 é o ponto que o Órion audita.** Não basta que a consulta exista: ela tem que ser a **última**
coisa antes da chamada HTTP. O desenho que torna isso verificável, em vez de confiável:

```ts
// packages/core/src/whatsapp/send-guard.ts — puro, sem I/O, compartilhado web ↔ worker
export type SendGuardFacts = {
  now: Date;
  phone: { e164: string; type: PhoneType };
  instance: { status: WhatsAppInstanceStatus; isDegraded: boolean;
              warmupDay: number; dailyLimitOverride: number | null };
  quota: { sentToday: number };
  optOut: { exists: boolean; checkedAt: Date };   // ⚠️ carimbo obrigatório
  lastOutboundAt: Date | null;
  isColdFirstContact: boolean;
  text: string;
  overrides: { allowNonMobile: boolean; confirmOutsideBusinessWindow: boolean };
};

export type SendGuardVerdict =
  | { allow: true;  warnings: Array<{ code: string; message: string }> }
  | { allow: false; reason: SendBlockReason; message: string; meta?: Record<string, unknown> };

/** Lança (não retorna `false`) se `optOut.checkedAt` for mais velho que OPT_OUT_MAX_AGE_MS (5s). */
export function evaluateSendGuard(facts: SendGuardFacts): SendGuardVerdict;
```

O carimbo `optOut.checkedAt` converte uma regra de disciplina em **falha de runtime**: um chamador
que cachear a blacklist, ou que ler o opt-out no começo de uma função longa e enviar 3 segundos
depois, quebra em execução — não passa despercebido numa revisão de código. É o mesmo truque que o
`buildMachineUpdate()` usa para proteger dado humano no scraper, e que funcionou melhor do que a
regra escrita que eu tinha especificado. **Não substituir por um comentário `// não cachear`.**

Invariantes que o Órion verifica (§4.9.9): `evaluateSendGuard` é chamado **na mesma função** que
chama `sendText`, sem nenhum `await` de I/O entre os dois além da renderização do texto (que é pura).

#### 4.9.4 Decisões de detalhe (fechadas aqui para não virar dúvida na implementação)

**Escolha de instância, quando `instanceId` é omitido** — mesma política do §6.5, versão de 1 msg:
1. **Afinidade lead→instância:** se já houve mensagem (in ou out) com este lead, usa a mesma
   instância, se ela estiver `connected` e com cota. Trocar de número no meio de uma conversa
   confunde o prospect e parece spam.
2. Senão, entre as `connected`: maior `remaining` de cota. Empate → `isDegraded: false` vence.
3. Nenhuma elegível → `409 INSTANCE_NOT_CONNECTED` listando o motivo de cada uma em `details[]`
   (é a diferença entre "conecte um número" e "espere até amanhã").

**Spintax determinístico.** `spintaxSeed` default = `` `${leadId}:${templateId}:${YYYY-MM-DD}` ``.
A UI de preview (`POST /templates/:id/preview`) passa a devolver o `spintaxSeed` de cada variação, e
o botão "enviar esta versão" reenvia o mesmo seed. Sem isso, o operador aprova um texto e o sistema
manda outro — pequeno, mas destrói a confiança na tela de preview.

**`body` cru não passa por render de variáveis.** `{{nome}}` digitado à mão sai literal. Deliberado:
`body` existe para o operador **responder uma conversa**, não para driblar o cadastro de templates.

**A cota é sempre debitada.** Envio manual conta em `InstanceDailyStat.sentCount` do dia (fuso
`APP_TIMEZONE`) exatamente como campanha. `warmupDay` **não** é avançado por esta rota — quem avança
é o `warmup-roll.job` (Onda 3), e a fonte da verdade de "este dia teve envio" é justamente
`InstanceDailyStat.sentCount > 0`, que esta rota grava. Nenhum campo novo é necessário.

#### 4.9.5 Registro do `Message` e o que acontece quando a Evolution falha

**Decisão: grava-se ANTES de chamar a rede (write-ahead).** É o ponto mais fácil de errar da seção.

```
   ┌─ transação 1 (reserva) ────────────────────────────────────────────┐
   │ Message(status='queued', providerMessageId=null, body=<texto final>)│
   │ InstanceDailyStat.sentCount += 1        (upsert por instância+dia)   │
   └────────────────────────────────────────────────────────────────────┘
                    ↓  (nenhum outro I/O entre G11 e esta linha)
              EvolutionClient.sendText()
                    ↓
   ┌─ transação 2a (sucesso) ──────────┐   ┌─ transação 2b (falha) ─────────────────┐
   │ Message → status='sent',           │   │ Message → status='failed', errorCode,   │
   │   providerMessageId, sentAt        │   │   errorMessage                          │
   │ instance.consecutiveFailures = 0   │   │ InstanceDailyStat: sentCount−1,         │
   │ Lead.status: new|validated →       │   │   failedCount+1        (compensação)    │
   │   'contacted' (actor='system')     │   │ instance.consecutiveFailures += 1       │
   │ LeadActivity 'message_sent'        │   │ LeadActivity 'message_failed'           │
   └────────────────────────────────────┘   └─────────────────────────────────────────┘
```

**Por que write-ahead e não "grava depois que deu certo":** os dois modos de falha não são
simétricos. "Enviei e não registrei" (o processo morre entre o `sendText` e o `INSERT`) produz uma
mensagem **invisível**: não aparece na timeline, não conta na cota, e o operador reenvia — o lead
recebe duas vezes e o warmup é furado sem ninguém ver. "Registrei e não enviei" produz uma linha
`queued` visível na tela, que o operador entende e pode reenviar. **A cota erra sempre para menos,
nunca para mais.** Entre perder uma unidade de cota e perder a rastreabilidade de um envio real, o
anti-ban manda escolher a primeira. O `providerMessageId` é `@unique` e nullable no schema atual, o
que já suporta isso — nenhuma migração é necessária.

Linha `queued` órfã (processo morreu no meio) é o resíduo aceito dessa escolha: fica visível, e a
varredura que a resolve é a dívida **D8** (§9.2).

**Mapa de erro da Evolution → resposta e efeito colateral** (`MessagingErrorCode` já existe em
`packages/messaging/src/errors.ts` — não criar vocabulário novo):

| `MessagingErrorCode` | HTTP | `reason` | `consecutiveFailures` | Efeito colateral |
|---|---|---|---|---|
| `INSTANCE_DISCONNECTED` | 409 | `INSTANCE_NOT_CONNECTED` | +1 | instância → `disconnected`; chama `haltCampaignsSoleInstanceDisconnected` (já existe) |
| `INSTANCE_NOT_FOUND` | 409 | `INSTANCE_MISSING_UPSTREAM` | +1 | instância → `disconnected` + `lastError`; a instância sumiu do container |
| `INVALID_NUMBER` | 409 | `NUMBER_HAS_NO_WHATSAPP` | **0** | não é falha da instância; `LeadActivity` registra para alimentar a qualidade do dado (R6) |
| `AUTH_ERROR` | 502 | `EVOLUTION_AUTH` | **0** | erro de **configuração nossa** (`EVOLUTION_API_KEY`) — alerta `critical`; punir a instância seria diagnóstico errado |
| `RATE_LIMITED` | 502 | `EVOLUTION_RATE_LIMITED` | +1 | sem retry automático aqui (§ política do pacote: quem decide o quando é a camada de cadência) |
| `TRANSIENT_ERROR` · `TIMEOUT` | 502 | `EVOLUTION_TRANSIENT` | +1 | o cliente HTTP já fez seus 2 retries de transporte; se chegou aqui, acabou |
| `UNKNOWN` | 502 | `EVOLUTION_UNKNOWN` | +1 | log com corpo bruto |

**O kill switch por falhas consecutivas (§6.6, linha 3) nasce aqui:** ao atingir
`consecutiveFailures >= 5`, a instância vira `isDegraded = true` na mesma transação, e a resposta
carrega `warnings: [{ code: 'INSTANCE_DEGRADED', ... }]`. Qualquer envio bem-sucedido zera o
contador. Isso vale desde o envio unitário — não é preciso esperar a Fase 4 para o sistema começar a
se defender.

**Nunca `500` para falha da Evolution.** É `502 UPSTREAM_ERROR`: a distinção "o defeito é nosso" vs.
"o defeito é do provedor" é a primeira pergunta de qualquer runbook.

#### 4.9.6 Janela de envio no manual — a decisão, e por quê

**Pergunta:** a janela do §6.3 (09–18, seg–sex, pausa de almoço) vale para um operador clicando
"enviar"? **Decisão: não como está — vira um piso duro + uma confirmação explícita.** Dois níveis:

| Nível | Faixa | Comportamento no envio **manual** | Comportamento na **campanha** (§6.3) |
|---|---|---|---|
| 🔴 **Piso legal/anti-denúncia** (duro) | fora de **08:00–20:00**, ou **domingo**, ou feriado nacional | **`409 QUIET_HOURS`.** Não há flag, override ou papel de admin que passe | idem — nunca envia |
| 🟡 **Janela comercial** (mole no manual) | 08–09, 12:00–13:30, 18–20, sábado | exige `confirmOutsideBusinessWindow: true`; sem ele, `409 OUTSIDE_BUSINESS_WINDOW` com a próxima abertura em `details` | reagenda sozinha, nunca envia fora |

**Justificativa.** A janela do §6.3 protege contra duas coisas diferentes, que a v1.0 tratava como
uma só:
- **(a) padrão de robô** — rajada automatizada em horário estranho é assinatura de bot. Com volume 1
  e um humano no clique, esse risco basicamente desaparece. É por isso que a janela comercial pode
  ser mole aqui.
- **(b) irritação do destinatário** — e essa **não** desaparece com volume 1. Quem recebe abordagem
  comercial de desconhecido às 22h denuncia, e a denúncia derruba o número igual. O destinatário não
  sabe (nem se importa) se foi um humano ou um cron que apertou o botão.

Como (b) sobrevive e (a) não, a resposta certa não é "libera" nem "bloqueia": é **piso duro em (b),
confirmação explícita em (a)**. O operador que precisa responder um lead às 19h30 consegue; o
operador que iria prospectar a frio às 22h é impedido — inclusive de si mesmo, que é a defesa que o
R9 (§9.1) pede.

O piso 08:00–20:00 / sem domingos é ancorado no que a legislação brasileira já considera razoável
para contato comercial ativo (o parâmetro do telemarketing, Decreto 11.034/2022, é 09–20 em dias
úteis). Não é norma que se aplique literalmente a WhatsApp B2B, mas é exatamente o padrão que
sustenta a condição de "**expectativa razoável do titular**" da nossa base legal (§7.1) — usar um
horário mais agressivo que o do telemarketing enfraqueceria o legítimo interesse que o produto
inteiro depende. Configurável em §10 apenas para **estreitar**, nunca para alargar (mesmo princípio
do `dailyLimitOverride`).

**Toda confirmação fica registrada.** `confirmOutsideBusinessWindow` e `allowNonMobile` vão no
`payload` do `LeadActivity` de `message_sent`. Desvio autorizado é aceitável; desvio invisível não.

**`warnings[]` da resposta 201** (não bloqueiam, a UI mostra):
`OUTSIDE_BUSINESS_WINDOW_CONFIRMED` · `INSTANCE_DEGRADED` · `NON_MOBILE_CONFIRMED` ·
`LOW_QUOTA_REMAINING` (≤10% do teto) · `NO_OPTOUT_NOTICE_IN_REPLY` (resposta em conversa já aberta,
onde G10 não se aplica).

#### 4.9.7 Tabela de erros consolidada

| HTTP | `code` | `reason` | Quando | O que a UI faz |
|---|---|---|---|---|
| 401 | `UNAUTHORIZED` | — | sem sessão | redireciona ao login |
| 404 | `NOT_FOUND` | `LEAD_NOT_FOUND` · `INSTANCE_NOT_FOUND` | id inexistente | 404 na tela |
| 422 | `VALIDATION_ERROR` | `BODY_OR_TEMPLATE_REQUIRED` · `BODY_TOO_LONG` · `UNKNOWN_VARIABLE` · `INVALID_SPINTAX` | payload | erro no campo |
| 409 | `CONFLICT` | `LEAD_HAS_NO_PHONE` | lead sem telefone | desabilita o botão de envio na ficha |
| 409 | `CONFLICT` | `LEAD_NOT_MOBILE` | fixo/desconhecido, sem `allowNonMobile` | diálogo "enviar mesmo assim?" |
| 409 | `CONFLICT` | `NUMBER_HAS_NO_WHATSAPP` | Evolution confirmou que o número não tem WhatsApp | informa e sugere marcar o lead |
| 409 | `CONFLICT` | **`OPTED_OUT`** | telefone na blacklist | mensagem **terminal**: sem retry, sem "tentar assim mesmo" |
| 409 | `CONFLICT` | `INSTANCE_NOT_CONNECTED` · `INSTANCE_BANNED` · `INSTANCE_MISSING_UPSTREAM` | instância inapta | link para a tela de WhatsApp |
| 409 | `CONFLICT` | `DAILY_LIMIT_REACHED` | cota do warmup esgotada | mostra `resetsAt`; **não** oferece "aumentar limite" |
| 409 | `CONFLICT` | `QUIET_HOURS` | fora do piso duro | informa a próxima abertura; **sem** botão de forçar |
| 409 | `CONFLICT` | `OUTSIDE_BUSINESS_WINDOW` | fora do comercial, dentro do piso | diálogo de confirmação → reenvia com a flag |
| 409 | `CONFLICT` | `DUPLICATE_SEND` | outbound < 60s para o mesmo lead | "acabamos de enviar" |
| 409 | `CONFLICT` | `MISSING_OPTOUT_NOTICE` · `MISSING_COMPANY_NAME` | 1º contato frio sem saída fácil / sem remetente | leva ao editor do template |
| 429 | `RATE_LIMITED` | `MANUAL_SEND_RATE_LIMIT` | > `MANUAL_SEND_RATE_PER_MIN` por usuário | "aguarde" |
| 502 | `UPSTREAM_ERROR` | `EVOLUTION_*` (§4.9.5) | falha do provedor | "tente de novo"; a mensagem fica `failed` na timeline |

`DAILY_LIMIT_REACHED`, `QUIET_HOURS` e `OPTED_OUT` incluem `meta` útil em `details[]`
(`resetsAt`, `nextWindowOpensAt`, `optedOutAt`) — sem isso a UI só sabe dizer "não deu".

#### 4.9.8 O que NÃO entra nesta rota

Escopo cortado de propósito, para o envio unitário não virar meia campanha:
- **Envio em lote / seleção múltipla.** Isso é campanha (§4.5) e precisa de fila, cadência e jitter.
- **Mídia** (imagem, áudio, documento). Dívida D5, inalterada.
- **Agendamento.** Se precisa esperar a janela abrir, é campanha de 1 alvo.
- **Retry automático.** A rota é síncrona e falha na cara do operador — que decide reenviar. Retry
  automático de envio manual duplicaria mensagem com o operador olhando.
- **`GET /leads/:id/messages`.** A ficha do lead (`GET /leads/:id`) já devolve `messages[]`.

#### 4.9.9 Critério de aceite (é comportamento observável, não teste unitário)

Só está pronto quando, **com número real e Evolution real** (nada de mock):
1. Uma mensagem sai da ficha do lead e chega no celular do dono; a timeline mostra
   `sent → delivered → read` conforme os webhooks chegam.
2. O dono responde **"SAIR"**; o `OptOut` é criado automaticamente; **um segundo envio para o mesmo
   lead é recusado com `409 / OPTED_OUT`** — e a recusa aparece com texto legível na tela.
3. `sentToday` da instância aumentou em 1 e é visível em `GET /whatsapp/instances`.
4. Um envio com a Evolution derrubada devolve `502` e deixa a `Message` como `failed` na timeline —
   não some, não vira `500`, não fica `queued` para sempre.
5. **Órion:** `grep -rn "sendText(" apps/ packages/` devolve **exatamente um** call site de produção
   para mensagem de lead, e `evaluateSendGuard` é invocado na mesma função, sem I/O entre os dois.

Os itens 1–4 são o aceite da **Fase 3** que nunca foi executado (§8). O item 5 é o que impede que a
Fase 4 abra um segundo caminho de envio sem portão.

---

## 5. Design do scraper

### 5.1 Decisão: motor de coleta

| Opção | Prós | Contras |
|---|---|---|
| **A. Playwright headless (Chromium) navegando o Maps** | Funciona com o Maps real (JS pesado); resiliente a mudanças de API interna; permite humanização (scroll, mouse); fácil de depurar com screenshot | Pesado (~300MB RAM/contexto), mais lento (~30–60s/município), exige Chromium no container |
| **B. Endpoint interno `/search?tbm=map&pb=...` (protobuf) via HTTP** | Muito rápido (segundos), leve, sem browser | Formato não documentado e instável; quebra sem aviso; assinatura de requisição muda; mais fácil de detectar/bloquear |
| **C. Híbrido: B como caminho rápido, A como fallback** | Melhor dos dois: velocidade normal + resiliência | Duas implementações para manter; complexidade dobrada no MVP |

**Recomendação: A agora, arquitetada para virar C depois.** Confiabilidade vale mais que velocidade nesta
fase — um scraper rápido que quebra toda semana não entrega leads. Mas a interface `SearchEngine` (abaixo)
é definida de forma que o motor `pb` entre como segunda implementação **sem tocar em nada acima dele**.

```ts
// packages/scraper/src/index.ts — porta única de entrada
export interface SearchEngine {
  readonly id: 'playwright-maps' | 'maps-pb';
  search(input: SearchInput, ctx: ScrapeContext): Promise<SearchOutput>;
}

export type SearchInput = {
  niche: string;
  city: { name: string; uf: string; ibgeCode: string };
  maxResults: number;
};

export type SearchOutput = {
  businesses: ScrapedBusiness[];
  meta: { engineId: string; queryString: string; durationMs: number;
          scrolls: number; reachedEnd: boolean; sourceUrl: string };
};

export type ScrapedBusiness = {
  name: string;                 // único campo obrigatório
  phoneRaw: string | null;
  address: string | null;
  cityGuess: string | null;
  website: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  externalRef: string | null;   // cid/place id quando disponível
  sourceUrl: string;            // ⚖️ obrigatório — LGPD, registro de origem (§7)
};
```

### 5.2 Fanout: por que quebrar por município

O Google Maps devolve ~120 resultados por consulta, independente de quantos existam. Buscar
`"clínica odontológica em SP"` retorna 120 e some com o resto do estado. A solução é **transformar
1 busca do usuário em N buscas de município**, usando a lista oficial do IBGE.

```
SearchJob(niche="clínica odontológica", uf="SP")
   └─ fanout via tabela City (IBGE) → 645 SearchTask
        ├─ SearchTask("clínica odontológica em São Paulo, SP")
        ├─ SearchTask("clínica odontológica em Campinas, SP")
        └─ ... 643 outras
```

**Fonte dos municípios:** `https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios`,
consumida **uma vez no seed** e persistida na tabela `City`. O scraper **nunca** chama o IBGE em runtime —
dependência externa em caminho crítico é risco desnecessário e a lista muda de década em década.

**String de consulta (CONTRATO):** `` `${niche} em ${city.name}, ${uf}` ``. Normalizada
(trim, colapso de espaços), sem acento removido (o Maps lida bem com acento em PT-BR).

**Subdivisão de cidades grandes (v2, hook já previsto):** se uma task retornar `reachedEnd === false` E
`resultCount >= maxResults`, significa que saturou e há mais empresas ali. Nesse caso a task é marcada
`saturated: true` e o `health-check.job` pode gerar sub-tasks por bairro ou por célula geográfica
(bounding box + zoom). **Não implementar na Fase 2** — apenas gravar a flag, para sabermos o tamanho do
problema com dado real antes de investir.

> ⚠️ **Correção v1.1 — a flag nunca foi instalada.** `reachedEnd` é calculado em
> `packages/scraper/src/engine/navigate.ts` e devolvido em `SearchOutput.meta`, mas o
> `scrape-search.job.ts` **descarta o valor** e não existe coluna `saturated` no schema. Ou seja: o
> instrumento de medição da dívida **D4** não foi instalado, e a D4 chegaria à Fase 6 sem um único
> dado — decidindo "no achismo" exatamente o que a flag existia para evitar. Persistir
> `SearchTask.saturated` é item da Onda 1 (§8): é barato, e o custo de não ter é descobrir tarde.

**Nota de leitura sobre o `resultCount`:** ele hoje pode estar inflado. A deduplicação de cards em
`navigate.ts` usa um `Set` do `outerHTML`, que muda entre passos de scroll (imagem *lazy*, atributo
`aria-*` de foco) — o mesmo negócio pode entrar duas vezes, inflando a contagem **e** consumindo
`maxResults` antes da hora, o que **trunca resultados reais**. O `upsert` protege o banco, não a
métrica nem a completude. Deduplicar por `externalRef`/`detailUrl` (ambos já extraídos) é mais
barato e correto. Corrigir antes de tirar qualquer conclusão de taxa de preenchimento (§8, Onda 1).

**Priorização:** tasks são enfileiradas por **população decrescente** (campo `City.population`). O usuário
vê leads das capitais nos primeiros minutos em vez de esperar 645 municípios para ver valor.

### 5.3 Fila, concorrência e rate limiting

```ts
// apps/worker/src/queues.ts (referência)
export const QUEUES = {
  scrapeSearch: 'scrape:search',     // 1 job = 1 SearchTask (1 município)
  dispatchTick: 'dispatch:tick',
  maintenance:  'maintenance',
} as const;

new Worker(QUEUES.scrapeSearch, handler, {
  concurrency: Number(process.env.SCRAPE_CONCURRENCY ?? 2),   // 2 contextos de browser
  limiter: { max: 6, duration: 60_000 },                      // ≤6 buscas/min global
});
```

| Parâmetro | Valor default | Env | Razão |
|---|---|---|---|
| Concorrência | 2 | `SCRAPE_CONCURRENCY` | Memória do Chromium e discrição |
| Rate limit global | 6/min | `SCRAPE_RATE_PER_MIN` | ~1 busca a cada 10s — perfil de uso humano intenso, não de bot |
| Delay entre buscas | 8–25s aleatório | `SCRAPE_DELAY_MIN/MAX_MS` | Nunca intervalo fixo — periodicidade perfeita é assinatura de bot |
| Pausa entre scrolls | 900–2200ms | — | Simula leitura |
| Reciclagem de contexto | a cada 15 buscas | `SCRAPE_CONTEXT_TTL` | Descarta cookies/estado acumulado |
| Pausa longa | 3–8min a cada ~50 buscas | — | Simula "operador saiu pra um café" |

**Humanização** (`antidetect/humanize.ts`): scroll incremental com passo variável (não `scrollTo(bottom)`),
pequenos movimentos de mouse antes do scroll, ocasional hover em um card. Não é perfeito — é o suficiente
para não parecer um `while(true) scroll`.

**Rotação de user-agent** (`antidetect/user-agents.ts`): pool de 8–12 UAs de Chrome/Edge desktop **reais e
recentes** (Windows/macOS), sorteado **por contexto de browser, não por requisição** — trocar o UA no meio
da sessão é mais suspeito do que manter um. Viewport, `locale: 'pt-BR'`, `timezoneId: 'America/Sao_Paulo'`
e `Accept-Language` são sorteados **coerentemente** com o UA (um UA de macOS com fonte de Windows é
detectável).

### 5.4 Ponto de injeção de proxy (encaixe pronto, sem implementação)

```ts
// packages/scraper/src/engine/proxy.ts
export interface ProxyProvider {
  /** Retorna a config de proxy para a próxima sessão, ou null para conexão direta. */
  acquire(ctx: { taskId: string; uf: string }): Promise<ProxyConfig | null>;
  /** Devolve o proxy ao pool, sinalizando o desfecho — permite banir proxy ruim no futuro. */
  release(proxy: ProxyConfig | null, outcome: 'ok' | 'blocked' | 'error'): Promise<void>;
}

export type ProxyConfig = { server: string; username?: string; password?: string };

/** Implementação atual: conexão direta. Trocar por RotatingProxyProvider não muda mais nada. */
export class NoopProxyProvider implements ProxyProvider {
  async acquire() { return null; }
  async release() {}
}
```
O `browser.ts` **sempre** passa por `proxyProvider.acquire()` desde o dia 1, mesmo recebendo `null`. Assim,
ligar proxy no futuro é: escrever uma classe e trocar uma linha de injeção. Sem refatoração, sem risco.

### 5.5 Camada de extração isolada (⚠️ requisito central)

**Regra dura: nenhum seletor CSS/XPath do Google Maps existe fora de
`packages/scraper/src/extraction/selectors.ts`.** Órion tem que reprovar qualquer PR que viole isso.
Motivo: o Google muda classe/estrutura sem aviso, e quando isso acontecer o conserto precisa ser
"editar 1 arquivo e rodar os testes de fixture", não "caçar seletor espalhado por 6 arquivos".

```ts
// packages/scraper/src/extraction/selectors.ts
/**
 * ⚠️  ARQUIVO CRÍTICO — ÚNICO ponto de acoplamento com o DOM do Google Maps.
 * Se o scraper quebrar, o conserto começa (e quase sempre termina) AQUI.
 * Cada seletor tem alternativas em ordem de preferência: o extrator usa a primeira que casar.
 * Ao alterar: atualize a fixture em ../sanity/fixtures/ e rode `pnpm test:scraper`.
 * Última verificação: 2026-07-30
 */
export const SELECTORS = {
  resultsFeed:    ['div[role="feed"]', '#pane div[role="main"]'],
  resultCard:     ['div[role="feed"] > div > div[jsaction]', 'a.hfpxzc'],
  card: {
    name:         ['.qBF1Pd', 'div.fontHeadlineSmall', 'a.hfpxzc[aria-label]'],
    rating:       ['span.MW4etd', 'span[role="img"][aria-label*="estrela"]'],
    reviewCount:  ['span.UY7F9', 'span[aria-label*="avaliaç"]'],
    category:     ['div.W4Efsd > div > span:first-child'],
    address:      ['div.W4Efsd:last-child > div:last-child > span:last-child'],
    phone:        ['span.UsdlK', 'div.W4Efsd span:has-text("(")'],
    website:      ['a[data-value="Website"]', 'a[aria-label*="Visitar site"]'],
    link:         ['a.hfpxzc'],
  },
  consentButton:  ['button[aria-label*="Aceitar tudo"]', 'form[action*="consent"] button'],
  endOfList:     ['span.HlvSq', 'p.fontBodyMedium:has-text("chegou ao fim")'],
} as const;
```

Contrato do extrator — puro, sem browser, **testável com HTML congelado**:
```ts
// packages/scraper/src/extraction/extract-card.ts
export function extractCard(html: string): RawBusiness | null;      // DOM → bruto
// packages/scraper/src/extraction/normalize.ts
export function normalize(raw: RawBusiness, ctx: CityContext): ScrapedBusiness;  // bruto → domínio
```
Isso permite que Íris teste **100% da extração sem tocar na internet**, usando fixtures em
`sanity/fixtures/*.html`. Teste de scraper que depende de rede é teste que falha por motivo errado.

### 5.6 Retry, backoff e classificação de erro

```ts
// packages/scraper/src/errors.ts
export type ScrapeErrorCode =
  | 'NAVIGATION_TIMEOUT'    // retryable
  | 'RATE_LIMITED'          // retryable, backoff longo (429 / "unusual traffic")
  | 'CAPTCHA_DETECTED'      // retryable com backoff MUITO longo + alarme
  | 'LAYOUT_CHANGED'        // 🔴 FATAL — não adianta retentar, para a fila e alarma
  | 'EMPTY_RESULTS'         // não é erro; alimenta o zero-streak
  | 'BROWSER_CRASH'         // retryable
  | 'UNKNOWN';
```

| Código | Tentativas | Backoff | Ação extra |
|---|---|---|---|
| `NAVIGATION_TIMEOUT` | 3 | exponencial 30s → 2min → 8min (+ jitter ±20%) | recicla contexto |
| `BROWSER_CRASH` | 3 | idem | recria browser |
| `RATE_LIMITED` | 2 | 15min → 45min | **pausa a fila inteira por 15min** |
| `CAPTCHA_DETECTED` | 1 | 60min | pausa a fila + alarme `severity=high` |
| `LAYOUT_CHANGED` | 0 | — | **pausa a fila, alarme `severity=critical`, salva screenshot+HTML** |
| `UNKNOWN` | 2 | 1min → 5min | log completo |

Backoff sempre com jitter — retry sincronizado de N jobs é um novo pico de tráfego suspeito.
Após esgotar tentativas, a `SearchTask` vai para `failed` com `errorCode` e o `SearchJob` **continua**
(uma cidade falha não derruba o estado inteiro). `POST /searches/:id/retry-failed` recupera depois.

### 5.7 Detecção automática de scraper quebrado (assertions de sanidade)

O modo de falha mais perigoso não é o erro — é o **sucesso silencioso**: o scraper roda, não dá exceção,
e grava zero leads durante 3 dias sem ninguém perceber. Contra isso, quatro assertions rodando em
`packages/scraper/src/sanity/assertions.ts`, avaliadas ao fim de cada task e pelo `health-check.job`:

| # | Assertion | Condição de alarme | Severidade | Ação automática |
|---|---|---|---|---|
| **A1** | **Zero-streak** | As últimas **5** tasks concluídas retornaram `resultCount === 0` | `critical` | **Pausa a fila `scrape:search`**, cria `ScraperHealthEvent`, alerta |
| **A2** | **Fill-rate de nome** | Em janela de 50 leads capturados, `< 95%` têm `name` não vazio | `critical` | Pausa a fila + alerta (seletor de nome quebrou) |
| **A3** | **Fill-rate de telefone** | `phone` presente cai abaixo de **50% da média móvel de 7 dias** | `high` | **Não pausa**, alerta (pode ser característica do nicho) |
| **A4** | **Forma dos dados** | `>10%` dos ratings fora de 0–5, ou `>10%` dos telefones falhando na normalização E.164 | `high` | Alerta (seletores trocaram de posição — pegando o campo errado) |

Detalhes que fazem a diferença:
- **A1 só conta tasks de municípios com população > 20.000.** Um distrito de 3.000 habitantes retornar
  zero clínicas odontológicas é resultado correto, não bug. Sem esse filtro o alarme vira ruído e alarme
  ruidoso é alarme ignorado.
- Toda pausa automática grava **screenshot + HTML bruto** da última página em
  `storage/incidents/<eventId>/`. É o material que faz o conserto do `selectors.ts` levar 20 minutos em
  vez de 3 horas.
- O evento aparece na UI (banner vermelho no dashboard) e no `GET /api/v1/health`. Alarme que só vai
  para log não é alarme.
- **Canário diário (Íris):** um job às 06:00 roda uma busca fixa de controle
  (`"padaria em Campinas, SP"` — nicho denso, resultado garantido). Se voltar `< 10` resultados, o
  scraper está quebrado, e sabemos disso **antes** de o usuário rodar a busca dele.

---

## 6. Design do disparo com anti-ban

> Premissa que orienta toda esta seção: **estamos usando uma API não-oficial. Banimento não é hipótese
> remota, é evento esperado.** A arquitetura precisa (a) tornar o ban improvável, (b) detectá-lo em
> minutos, e (c) sobreviver a ele sem perder campanha. Nesta ordem.

### 6.1 O loop de envio (com todos os portões)

```mermaid
flowchart TD
    T["⏱️ dispatch:tick<br/>(job repetível, ~a cada 30s)"] --> A{"Campanha<br/>running?"}
    A -->|não| Z["encerra tick"]
    A -->|sim| B{"Dentro da janela<br/>horária e dia útil?"}
    B -->|não| Z2["reagenda p/ próxima abertura"]
    B -->|sim| C["Escolhe instância<br/>(round-robin ponderado<br/>por quota restante)"]
    C --> D{"Instância<br/>connected?"}
    D -->|não| HALT["🔴 halt campanha<br/>+ alerta"]
    D -->|sim| E{"Quota diária<br/>do warmup<br/>disponível?"}
    E -->|não| Z3["reagenda p/ amanhã"]
    E -->|sim| F["SELECT próximo target<br/>FOR UPDATE SKIP LOCKED"]
    F --> G{"🔒 GUARD PRÉ-ENVIO"}
    G --> G1{"OptOut?"}
    G1 -->|sim| SK1["skipped: opted_out"] --> T
    G --> G2{"Celular?"}
    G2 -->|não| SK2["skipped: landline"] --> T
    G --> G3{"Contatado<br/>nos últimos N dias?"}
    G3 -->|sim| SK3["skipped: recently_contacted"] --> T
    G --> H["Renderiza:<br/>variáveis + spintax"]
    H --> I["POST Evolution<br/>sendText"]
    I --> J{"Resultado"}
    J -->|ok| K["Message(sent)<br/>+ InstanceDailyStat++<br/>+ Lead.status=contacted"]
    J -->|erro conexão| HALT
    J -->|erro transitório| R["retry c/ backoff<br/>(máx 3)"]
    K --> W["😴 sleep jitter<br/>45–180s"] --> T

    style G fill:#ffe6e6
    style HALT fill:#ff9999
```

> **v1.1 — o bloco `GUARD PRÉ-ENVIO` não é escrito aqui.** Ele é a mesma
> `evaluateSendGuard(SendGuardFacts)` definida no **§4.9.3**, que já roda no envio unitário. O
> `dispatch-tick.job` monta os `facts` a partir do `CampaignTarget` e chama a mesma função. Duas
> diferenças, e só duas, entre campanha e manual:
> - a **janela comercial é dura** na campanha (não existe `confirmOutsideBusinessWindow`);
> - **não existe `allowNonMobile`** — fixo é `skipped/landline` (§3.2 regra 4), sem exceção.
>
> Ambas entram como `overrides: { allowNonMobile: false, confirmOutsideBusinessWindow: false }`.
> O worker **não pode** ter uma segunda implementação do portão: se `evaluateSendGuard` aparecer
> duplicada, o Órion reprova (§4.9.9, item 5).

### 6.2 Aquecimento de número novo (ramp-up)

Número novo que dispara 200 mensagens no primeiro dia é banido no primeiro dia. A tabela de warmup é
**aplicada pelo sistema, não sugerida ao usuário** — o teto do dia é um limite duro no worker.

| Dia | Teto diário | Msgs/hora | Observação |
|---|---|---|---|
| 1–2 | **20** | 4 | Idealmente com conversas reais/manuais no número |
| 3–4 | 40 | 6 | |
| 5–7 | 70 | 10 | |
| 8–10 | 110 | 15 | |
| 11–14 | 160 | 20 | |
| 15–21 | 220 | 25 | |
| 22+ | **300** (teto máximo) | 30 | `isWarm = true` |

Regras:
- `warmupDay` avança **por dia de calendário com ao menos 1 envio**, não por dia corrido. Instância parada
  não "amadurece sozinha".
- **Regressão automática:** se a instância ficar `disconnected`/`banned` e voltar, o `warmupDay` **recua
  30%** (mín. dia 1). Número que teve problema volta devagar.
- **Taxa de resposta como freio:** se a resposta em 48h cair abaixo de **2%** com ≥100 enviadas, o
  `health-check.job` marca a instância `degraded` e **congela o warmup** (não avança de dia). Resposta
  baixa é o principal sinal antecedente de shadow-ban.
- `dailyLimitOverride` existe, mas **só pode reduzir**, nunca aumentar acima da tabela. Isso é
  deliberado: o produto não deixa o usuário se sabotar.

### 6.3 Janela de envio e ritmo

| Regra | Default | Configurável | Racional |
|---|---|---|---|
| Dias | Seg–Sex | sim | Mensagem comercial no domingo gera denúncia |
| Horário | 09:00–18:00 (America/Sao_Paulo) | sim (dentro de 08:00–20:00) | Fora disso o sistema **recusa**, não avisa |
| Pausa de almoço | 12:00–13:30 sem envio | sim | Humano almoça |
| Jitter entre envios | 45–180s, distribuição não-uniforme | sim (mín. 30s) | Intervalo constante é a assinatura de bot mais óbvia |
| Micro-pausa | 5–12min a cada 18–25 envios | não | Simula atendimento em lotes |
| Feriados nacionais | pulados | sim (desligável) | Tabela estática em `policies/send-window.ts` |

O jitter usa distribuição **log-normal**, não uniforme: a maioria dos intervalos fica em torno de ~70s com
cauda longa. Intervalo uniforme entre 45–180s tem média perfeitamente estável — estatisticamente
identificável. Detalhe pequeno, custo zero, e é exatamente o tipo de coisa que separa "funciona" de
"funciona por meses".

### 6.4 Variação de texto (spintax) — combate à assinatura de conteúdo

Enviar a mesma string 300 vezes é o sinal mais fácil de detectar do lado do WhatsApp. Camadas de variação:

1. **Variáveis** — `{{nome}}`, `{{cidade}}` já dão variação natural.
2. **Spintax** — `{Olá|Oi|Bom dia}, tudo bem? {Vi que|Notei que} a {{nome}} {atende|trabalha} em {{cidade}}...`
   Sorteio uniforme por envio, com semente por `campaignTargetId` (o mesmo alvo, em retry, recebe o mesmo
   texto — não pode chegar mensagem "duas versões" para a mesma pessoa).
3. **Validação obrigatória no `start`:** se `spintaxVariations < 10` e a campanha tem `> 50` alvos, a API
   retorna `409 INSUFFICIENT_TEXT_VARIATION` com a mensagem `"Sua mensagem gera apenas N variações para M
   contatos. Adicione alternativas com {opção a|opção b} para reduzir risco de bloqueio."`.
   **É bloqueio, não aviso.** Deixar passar aqui custa o número do cliente.
4. **Sem link na primeira mensagem** (recomendação forte, `warning` na criação do template): link em
   primeiro contato de número novo aumenta muito a chance de denúncia/bloqueio.
5. **Invisíveis:** variação sutil de espaçamento/pontuação final é possível, mas **não faremos** — é
   truque frágil que degrada a mensagem. A variação vem do conteúdo real.

### 6.5 Rotação entre instâncias

- Seleção **round-robin ponderada pela quota restante do dia**, não puro rodízio: a instância com mais
  saldo é escolhida com mais frequência, o que naturaliza a distribuição.
- **Afinidade lead→instância:** um lead que já foi contatado pela instância A e respondeu continua sendo
  atendido pela A. Trocar de número no meio da conversa confunde o prospect e parece spam.
- Instância `degraded` entra na rotação com peso 0,3. Instância `banned`/`disconnected` sai imediatamente.
- Se **todas** as instâncias saírem, a campanha vai para `halted` (não `paused`) — estados diferentes
  porque `halted` exige `acknowledgeHalt: true` no `resume`. O operador precisa **ver** que houve
  incidente, não só clicar em "continuar".

### 6.6 Parada automática (kill switch)

| Gatilho | Detecção | Ação |
|---|---|---|
| `connection.update: close` com `statusReason 401` | webhook, segundos | Instância → `banned`. **Todas** as campanhas dela → `halted`. Alerta `critical`. |
| `connection.update: close` genérico | webhook | Instância → `disconnected`. Campanhas → `halted` se não houver outra instância. Tenta reconectar 3x. |
| ≥5 falhas de envio consecutivas na mesma instância | worker | Instância → `degraded`, para os envios dela, alerta |
| Taxa de falha > 30% em 50 envios | health-check | Instância → `degraded`, congela warmup |
| Evolution API fora do ar (health check falha 3x) | health-check, ~90s | **Todas** as campanhas → `halted` |
| Ausência total de resposta em 100+ envios | health-check | Alerta `high` (suspeita de shadow-ban) |

Toda parada automática grava `haltReason` legível, que aparece na UI e vai no `CampaignSummary`.
`pending` nunca vira `failed` numa parada — os alvos ficam pendentes e a campanha retoma de onde parou.

### 6.7 Opt-out — o portão inegociável

Este é o ponto onde estou sendo mais rígida do documento inteiro, e é proposital: um opt-out desrespeitado
é simultaneamente risco jurídico (LGPD), risco de banimento (denúncia) e dano de reputação.

1. **Consulta antes de cada envio, dentro do worker.** Não na montagem da campanha, não em cache de 5
   minutos, não em snapshot. É um `SELECT` indexado por `phoneE164` a cada mensagem. Sim, isso é uma query
   por envio — a 30 mensagens/hora, é irrelevante em custo e decisivo em risco.
   *(v1.1)* Isso vale para **todo** caminho de envio, não só o worker: o envio unitário do §4.9 usa a
   mesma consulta e a mesma função de decisão (`evaluateSendGuard`), com o carimbo `checkedAt` que
   **quebra em runtime** se alguém cachear. O portão nasce lá, no volume 1, e o `dispatch-tick.job`
   o herda já exercitado em produção — em vez de estreá-lo num disparo de 500 mensagens.
2. **A chave é o telefone, não o lead.** Se o mesmo número aparecer como outro lead numa busca futura,
   continua bloqueado. Opt-out não é apagável por re-scraping.
3. **Três formas de entrada:**
   - **Automática por resposta:** `detectOptOut(text)` roda em todo inbound. Casa (case-insensitive, sem
     acento, palavra isolada ou frase curta): `sair`, `parar`, `pare`, `remover`, `remova`, `descadastrar`,
     `descadastre`, `cancelar`, `nao quero`, `não quero`, `não me mande`, `me tira`, `me tire`, `stop`,
     `unsubscribe`, `sem interesse`, `nao perturbe`. **Na dúvida, opta por bloquear** — falso positivo
     custa 1 lead; falso negativo custa uma denúncia.
   - **Link público:** toda primeira mensagem da campanha inclui a instrução de descadastro (§7).
   - **Manual:** operador marca na UI, ou `POST /api/v1/optouts`.
4. **Efeito imediato e retroativo:** ao criar um `OptOut`, todos os `CampaignTarget` `pending` com aquele
   telefone viram `skipped/opted_out` **na mesma transação**. A campanha em andamento não precisa ser
   reiniciada nem sequer notada.
5. **Remover opt-out exige `role=admin`** e gera registro de auditoria em `LeadActivity`. Não é operação
   de rotina.

---

## 7. LGPD — objetivo, sem juridiquês

### 7.1 Base legal
**Legítimo interesse (LGPD Art. 7º, IX)** para prospecção B2B. Isso se sustenta enquanto **todas** as
condições abaixo forem verdadeiras — a arquitetura garante cada uma:

| Condição | Como o sistema garante |
|---|---|
| O dado é de **contato comercial público**, não pessoal | Coletamos telefone/endereço/site que a própria empresa publicou no Maps. **Não coletamos** nome de sócio, CPF, e-mail pessoal, foto de pessoa |
| A oferta é **pertinente à atividade** do destinatário | Busca é por nicho; o filtro é a própria segmentação |
| Há **expectativa razoável** do titular | Empresa que publica telefone no Maps espera contato comercial |
| O descadastro é **fácil e honrado** | §6.7 + link em toda primeira mensagem |
| A origem é **rastreável** | §7.2 |

**O que o sistema não faz, por decisão de arquitetura:** não coleta dado de pessoa física fora do contexto
comercial, não faz enriquecimento com bases de terceiros, não vende/compartilha base, não envia para
número que pediu para sair. Estes não são "boas práticas" — são limites do produto.

### 7.2 Registro de origem (obrigatório por lead)
Todo `Lead` grava, na criação, e isso **nunca** é sobrescrito:

```ts
source: {
  type: 'google_maps_scrape';
  url: string;              // URL exata da listagem/ficha de onde veio
  query: string;            // "clínica odontológica em Campinas, SP"
  collectedAt: string;      // ISO timestamp
  searchJobId: string;      // rastreia até quem pediu a busca
  engineId: string;         // qual motor extraiu
}
```
Isso responde, em segundos, a pergunta que importa numa solicitação do titular ou fiscalização:
**"de onde vocês tiraram meu número?"**. Sem isso, legítimo interesse é uma afirmação sem prova.

### 7.3 Mecanismos do titular

| Direito | Como exercer | Prazo | Implementação |
|---|---|---|---|
| **Oposição** (parar de receber) | Responder "sair" / link de descadastro / pedir ao operador | **Imediato** | §6.7 — vale antes do próximo envio |
| **Confirmação e acesso** | Solicitação pelo canal informado na mensagem | 15 dias | `GET /api/v1/leads?q=<telefone>` gera o relatório de origem |
| **Correção** | idem | 15 dias | `PATCH /api/v1/leads/:id` |
| **Eliminação** | Solicitação | 15 dias | Ação `delete_lead_data`: apaga `Lead`, `Message`, `LeadActivity` e **mantém apenas o hash do telefone no `OptOut`** — sem isso, uma busca futura recoletaria a mesma empresa e voltaríamos a incomodar quem pediu para sair. Registrar essa retenção mínima como o que ela é: cumprimento da própria oposição |

### 7.4 Conteúdo obrigatório da primeira mensagem
Validado no `start` da campanha **e no envio unitário** (`409 MISSING_OPTOUT_NOTICE` se ausente —
§4.9.3, portão G10). *(v1.1)* A regra vale para **primeiro contato frio**, definido como "não existe
nenhuma `Message` outbound para este lead". Se o lead já respondeu (existe inbound), é uma conversa
em curso: exigir "responda SAIR" numa resposta a quem perguntou o preço seria ruído, não proteção.
Nesse caso a API devolve `warning: NO_OPTOUT_NOTICE_IN_REPLY` em vez de bloquear.
O template precisa conter:
1. **Quem fala** — nome da empresa remetente (variável `{{minha_empresa}}`, obrigatória no primeiro contato).
2. **Saída fácil** — instrução literal de descadastro. Ex.: `Se preferir não receber mais, responda SAIR.`
   Aceita-se a variante com link público (`{{link_descadastro}}`).

### 7.5 Retenção (job diário `retention.job.ts`)

| Dado | Retenção | Ação ao expirar |
|---|---|---|
| Lead sem nenhuma interação | **24 meses** desde `collectedAt` | Exclusão física |
| Lead com interação (contatado/respondeu) | 24 meses desde a **última** interação | Exclusão física |
| `Message` (conteúdo) | 12 meses | Apaga o `body`, mantém metadados agregados |
| `OptOut` | **Indefinido** | Nunca apaga — é o registro que protege o titular |
| `RawCapture` (HTML bruto de debug) | **7 dias** | Exclusão física |
| `LeadActivity` | acompanha o lead | Cascade |

Registro de tratamento (ROPA simplificado) e política de privacidade ficam em `docs/lgpd.md` — Alexandria
escreve na Fase 6, a partir desta seção.

---

## 8. Plano faseado (reescrito na v1.1)

Princípio original, que mantenho: **cada fase termina com algo que o usuário consegue usar de ponta a
ponta.** O que mudou é que a v1.0 não tinha como *verificar* isso — e o resultado foi 13.400 linhas,
build verde e 164 testes sem que nada jamais tocasse Postgres, Redis, Google Maps ou WhatsApp.

### 8.0 As quatro regras que passam a valer (e que a v1.0 violava)

1. **"Escrito e com build passando" não é "entregue".** Só conta o que rodou contra serviço real.
   Toda fase tem um aceite executável, e o aceite é executado por alguém (Íris) antes de a fase
   fechar. Fase sem aceite executado é fase aberta, por mais verde que esteja o CI.
2. **Nenhuma linha do plano sem contrato correspondente na §4.** Foi a omissão que matou a 3.7 e
   deixou `sendText` sem chamador por duas fases. O §4 é a lista de trabalho; isto aqui é a
   narrativa.
3. **Função pura + teste ≠ funcionalidade. O wiring É a entrega.** O critério de aceite de uma regra
   de proteção é o **comportamento observável quando ela dispara** — evento gravado, tela mudou,
   alerta saiu — nunca o teste unitário da função que a calcula. Quatro peças (`evaluateSanity`,
   `WARMUP_TABLE`/`effectiveDailyLimit`, `regressWarmupDay`, `deriveInstanceHealth`) pareciam prontas
   em todo relatório de progresso e tinham zero chamadores. Nunca mais separar "escrever a regra" de
   "ligar a regra" em itens diferentes do plano.
4. **Todo modo degradado com default seguro e sinal mais barulhento que o normal.** Ao desenhar
   qualquer flag ou fallback, a pergunta é: *"se isto ficar ligado por engano em produção, alguém
   percebe?"*. Se a resposta for não, inverta o default e adicione sinal visível.

### 8.1 Ordem de execução real — as ondas mandam

As **fases** descrevem capacidade do produto (é assim que se conversa com o dono). As **ondas**
descrevem a ordem de execução dado o estado real do código em 2026-08-03 (`REVISAO-ARQUITETURA.md`
§5). **Onde divergirem, vale a onda.**

| Onda | Objetivo | Bloqueia | Fases que toca |
|---|---|---|---|
| **0** | Provar que o núcleo funciona: infra de pé, uma busca real, **medir a taxa de celular** | tudo | Fase 0 (nova) + aceite da Fase 1 |
| **1** | O sistema consegue **dizer que está quebrado** e ser retomado sem shell | uso real | resto da Fase 2 + lacunas novas |
| **2** | **Fase 3 de verdade**: envio unitário real ponta a ponta (§4.9) | Fase 4 | Fase 3 (3.7 + aceite) |
| **3** | Fase 4: campanhas com anti-ban | release | Fase 4 |
| **4** | Profissional: backup, CI, testes de integração, alertas, docs | cliente pagante | Fase 5 + Fase 6 |

**O que mudou de ordem, explicitamente:**
- **Fases 2 e 3 não rodam mais em paralelo.** Rodavam na v1.0 porque "não compartilham código" — o
  que continua verdade e continua irrelevante: o gargalo não é código, é **verificação**. A Onda 1
  (saber que quebrou) precisa vir antes de qualquer coisa que produza volume.
- **Saiu do caminho crítico:** `GET /leads/export` e `POST /leads/bulk` (eram 2.4, agora Onda 4).
  São valiosos e não bloqueiam nada — deixá-los na Fase 2 empurrava a validação real para depois.
- **Virou bloqueante e não estava no plano:** persistir o estado de pausa da fila fora do
  `setTimeout` em memória; `POST /scraper/queue/resume`; heartbeat do worker; `requeue-orphans`.
  A v1.0 tratava recuperação como detalhe de operação. Neste ambiente (sem terminal confiável, §0),
  recuperação é **requisito de arquitetura**.
- **Subiu para "ligar", não só "escrever":** as assertions A1–A4 (2.3) só fecham quando adulterar uma
  fixture produzir banner vermelho na tela e fila pausada — não quando o teste unitário passar.

### 8.2 🔴 Fase 0 — "Walking skeleton" (a fase que faltava)

**Objetivo:** infra real de pé e **um** caminho fim-a-fim verdadeiro, por mais ridículo que seja o
escopo, antes de qualquer domínio novo. Retroativa: deveria ter sido a primeira fase.

| # | Entrega | Responsável |
|---|---|---|
| 0.1 | Postgres + Redis + `apps/web` + `apps/worker` no ar no EasyPanel; migrações aplicadas | Dono + Vulcano |
| 0.2 | `GET /health` que reflete o mundo: banco, Redis, **worker vivo** (heartbeat) e estado da fila | Vega |
| 0.3 | Uma busca real: "clínica odontológica" em Campinas-SP, executada de verdade | Íris |
| 0.4 | **Medir e reportar: % de leads com telefone, e % com telefone móvel** | Íris |
| 0.5 | Decisão sobre `scrape-detail` com base em 0.4 (critério em §8.3) | **Nova** |
| 0.6 | Consumo real de RAM do Chromium na VPS (R8 nunca foi observado) | Vulcano |

**Depende de:** nada. **Aceite:** uma busca real devolve ≥30 leads sem duplicatas em <3 min, **e**
existe um número na mesa para "% de leads com celular". Sem 0.4, a Onda 2 é construída no escuro.

### 8.3 🔑 O gatilho: a taxa de celular decide se `scrape-detail` é melhoria ou requisito

Este é o furo de premissa mais caro do projeto e ele está **em aberto até a busca de Campinas rodar**.

**O problema:** o produto inteiro depende de telefone **móvel** (só celular recebe WhatsApp, §3.2
regra 4). O scraper extrai telefone **do card da lista** do Maps (`SELECTORS.card.phone`) — e o card
do feed **frequentemente não traz telefone**: ele aparece no painel de detalhe. Eu rebaixei
`scrape-detail.job.ts` para "v2" por disciplina de escopo e, na mesma revisão, escrevi um aceite de
Fase 1 exigindo telefone. **As duas coisas são incompatíveis** — e a incompatibilidade só é visível
quando alguém roda. Não afirmo a taxa: ela nunca foi medida (o scraper nunca abriu o Maps).

**Critério de decisão (métrica: `% de leads com telefone MÓVEL em E.164 válido`, sobre a busca de
Campinas, depois de corrigido o dedupe de card do §5.2 — senão a base do percentual está inflada):**

| Taxa medida | Veredito sobre `scrape-detail` | Consequência no plano |
|---|---|---|
| **≥ 50%** | **Melhoria.** Fica na Fase 6 | Nada muda. O aceite da Fase 1 passa a citar a taxa medida, não um absoluto |
| **25% – 50%** | **Requisito antes da Fase 4** (entra na Onda 2) | O operador precisa de 2–4× mais buscas para montar uma campanha. Campanha sobre base rala queima cota de warmup em alvos inexistentes |
| **< 25%** | 🔴 **Bloqueante imediato** — sobe para a Onda 1 | A premissa comercial do produto não se sustenta. Reescrever o aceite da Fase 1 e tratar `scrape-detail` como parte do caminho de coleta, não como enriquecimento |

**Por que estes cortes.** O custo de coleta é dominado pela busca (~40s/município) e independe da
taxa; o passo de detalhe custa ~3–5s por lead e é **linear no que já capturamos**. Acima de 50%, pagar
o detalhe para todos é desperdício — melhor rodar mais municípios. Abaixo de 25%, estamos pagando o
custo integral da busca para produzir uma lista majoritariamente inútil para a promessa central do
produto, e nenhum ganho de escala conserta isso. A faixa do meio é onde `scrape-detail` deixa de ser
enriquecimento e vira **parte da coleta**, mas ainda dá para trabalhar enquanto ele não existe.

**Corolário que já vale, independentemente do número:** o corte de escopo certo na Fase 1 teria sido
*menos cidades e menos filtros* — **nunca menos telefone**. Disciplina de escopo aplicada contra a
premissa comercial é escopo mal cortado.

**Nota para a Íris:** reportar **dois** números, não um. `% com qualquer telefone` e `% dos telefones
que são móveis`. Se a queda estiver no primeiro, o remédio é `scrape-detail`. Se estiver no segundo,
o remédio é outro (nicho com predominância de fixo) e `scrape-detail` não resolve nada.

---

### 🟢 Fase 1 — "Vejo leads reais na tela" (a menor coisa que já dá valor)
**Objetivo:** buscar 1 nicho em 1 cidade e ver a lista de leads. Sem WhatsApp, sem campanha, sem fila
sofisticada.

| # | Entrega | Responsável |
|---|---|---|
| 1.1 | Monorepo, Docker Compose (postgres+redis), tsconfig, lint, `.env.example` | Vulcano |
| 1.2 | Schema Prisma: `User`, `Uf`, `City`, `SearchJob`, `SearchTask`, `Lead`, `LeadActivity` + índices + seed IBGE | **Cronos** |
| 1.3 | `packages/scraper` completo: engine Playwright, `selectors.ts`, extractor, normalize, fixtures | **Vega** |
| 1.4 | `apps/worker` com fila `scrape:search`, retry/backoff, dedupe de Lead | **Vega** |
| 1.5 | API: `POST/GET /searches`, `GET /searches/:id`, `GET /leads`, `GET /locations/*` | **Vega** |
| 1.6 | Login + tela "Nova busca" + progresso ao vivo + tabela de leads com filtros | **Lyra** |
| 1.7 | Testes: unit do extractor com fixtures; e2e "criar busca → ver leads" | **Íris** |

**Depende de:** Fase 0. **Fora de escopo aqui:** fanout do estado inteiro, export, proxy, WhatsApp.

**Critério de aceite (corrigido na v1.1):** buscar "clínica odontológica" em Campinas-SP retorna
≥ 30 leads com **nome**, sem duplicatas, em < 3 minutos — **e a taxa de telefone móvel é medida e
reportada**, não assumida. O aceite v1.0 exigia "nome e telefone" enquanto o `scrape-detail` estava
rebaixado para v2: era um aceite impossível de cumprir por desenho (§8.3).

**Estado real (2026-08-03):** tudo escrito, **nada executado**. O aceite nunca rodou.

---

### 🟢 Fase 2 — "Cubro o estado inteiro e exporto"
**Objetivo:** escala de coleta e o primeiro valor exportável.

| # | Entrega | Responsável |
|---|---|---|
| 2.1 | Fanout por município (todos da UF), priorização por população, flag `saturated` | **Vega** |
| 2.2 | Rate limiting, jitter, rotação de UA, humanização, `ProxyProvider` (Noop) | **Vega** |
| 2.3 | 🔴 **Ligar** as assertions A1–A4: chamar `evaluateSanity` ao fim de cada task, **gravar `ScraperHealthEvent`**, canário diário, captura de incidente | **Vega** |
| 2.3b | 🆕 Estado de pausa da fila **persistido no Postgres** (não `setTimeout` em memória) + retomada no boot | **Vega** |
| 2.3c | 🆕 `POST /api/v1/scraper/queue/resume` com `acknowledge` do incidente + heartbeat do worker em `GET /health` + `requeue-orphans` no boot | **Vega** (contrato: **Nova**) |
| 2.3d | 🆕 Persistir `SearchTask.saturated` a partir de `reachedEnd` (instrumento da D4) e corrigir o dedupe de card por `externalRef`/`detailUrl` (§5.2) | **Cronos + Vega** |
| 2.4 | ⬇️ `GET /leads/export` (CSV em stream, BOM) + `POST /leads/bulk` — **movidos para a Onda 4**; `PATCH /leads/:id` fica (já feito) | **Vega** |
| 2.5 | UI: seleção de cidades, **banner de saúde do scraper + botão de retomar com motivo legível**, edição de status/tags/notas | **Lyra** |
| 2.6 | Schema: `ScraperHealthEvent`, `RawCapture`, campos de origem LGPD | **Cronos** |
| 2.7 | Teste de carga (1 UF completa) + teste de quebra de seletor (fixture adulterada deve alarmar) | **Íris** |

**Depende de:** Fase 1 **executada** (não só escrita).

**Aceite (v1.1 — agora é comportamento, não código):** adulterar um seletor **ou** derrubar o Redis
produz **sinal visível na tela em < 5 minutos**, e o operador retoma a operação **sem abrir um
shell**. Busca em UF média (ex.: ES, 78 municípios) conclui sem intervenção.

**Estado real (2026-08-03):** 2.1 ✅ · 2.2 ✅ · **2.3 🔴 código morto** (`evaluateSanity` existe,
tem teste, tem zero chamadores; nenhum `ScraperHealthEvent` é gravado por ninguém) · 2.3b–d ❌ ·
2.4 ❌ · 2.5 🟡 · 2.6 ✅ · 2.7 ❌.
**Por que 2.3 é a dívida mais perigosa do projeto:** se o Google mudar o layout hoje, o sistema roda,
não dá exceção, grava zero leads e **ninguém fica sabendo** — exatamente o cenário que a §5.7 existia
para impedir. A separação entre "escrever a assertion" (2.3) e "ligar no job" (1.4) foi minha, e foi
errada: não são itens independentes.

---

### 🟡 Fase 3 — "Mando a primeira mensagem"
**Objetivo:** um número conectado, um template, disparo manual para poucos leads.

| # | Entrega | Responsável |
|---|---|---|
| 3.1 | Schema: `WhatsAppInstance`, `InstanceDailyStat`, `MessageTemplate`, `Message`, `OptOut` | **Cronos** |
| 3.2 | `packages/messaging`: cliente Evolution tipado, parser de webhook, classificação de erro | **Vega** |
| 3.3 | Docker: container Evolution API + persistência + rede interna (não exposta) | **Vulcano** |
| 3.4 | API: instâncias (CRUD, QR, status), templates (CRUD, preview), webhook inbound | **Vega** |
| 3.5 | `packages/core`: render de variáveis, spintax, `detectOptOut`, normalização E.164 | **Vega** |
| 3.6 | UI: conectar número (modal QR com poll), editor de template com preview e contador de variações | **Lyra** |
| 3.7 | 🔴 **Envio unitário — agora com contrato: `POST /leads/:id/messages` (§4.9).** Inclui `evaluateSendGuard` em `packages/core` (o portão que a Fase 4 herda) | **Vega + Lyra** |
| 3.7b | 🆕 Pinar a versão real da imagem da Evolution API (hoje `v2.2.3` é chute admitido) | **Vulcano** |
| 3.8 | Testes: webhook idempotente, spintax, detecção de opt-out (incl. falsos positivos) | **Íris** |

**Depende de:** Fase 1 executada. **Não roda mais em paralelo com a Fase 2** — ver §8.1.

**Aceite (é o aceite do §4.9.9, com número real):** conectar número por QR, mandar mensagem da ficha
do lead para o celular do dono, ver `sent → delivered → read`, responder "SAIR", ver o `OptOut`
criado automaticamente **e o segundo envio ser recusado com `409 / OPTED_OUT`**.

**Estado real (2026-08-03):** 3.1 ✅ · 3.2 ✅ · 3.3 🟡 · 3.4 ✅ · 3.5 ✅ · 3.6 ✅ · **3.7 ❌** ·
3.8 🟡. O `EvolutionClient` está completo e testado — **contra os próprios mocks do autor**. Zero
chamadas reais. A 3.7 existia exatamente para derrubar esse risco antes da Fase 4, e não foi feita
porque eu escrevi a linha aqui e esqueci o endpoint no §4. Corrigido na v1.1: §4.9.

---

### 🟠 Fase 4 — "Campanha com anti-ban de verdade"
**Objetivo:** o coração do produto. Só entra depois que a Fase 3 provou que o envio unitário funciona.

| # | Entrega | Responsável |
|---|---|---|
| 4.1 | Schema: `Campaign`, `CampaignTarget` + índices de seleção (`FOR UPDATE SKIP LOCKED`) | **Cronos** |
| 4.2 | `policies/`: janela de envio, quota de warmup, jitter log-normal, **guard pré-envio** | **Vega** |
| 4.3 | `dispatch-tick.job` com rotação de instâncias, afinidade e retomada | **Vega** |
| 4.4 | Kill switch (§6.6), `halted` + `acknowledgeHalt`, `warmup-roll.job` | **Vega** |
| 4.5 | API de campanhas completa (criar com prévia de exclusões, start/pause/resume/cancel, targets) | **Vega** |
| 4.6 | UI: montar campanha (com painel de exclusões), acompanhar ao vivo, pausar, saúde das instâncias | **Lyra** |
| 4.7 | Testes: opt-out no meio da campanha **deve** ser honrado; quota respeitada; halt em desconexão; retomada sem duplicar envio | **Íris** |
| 4.8 | Revisão dedicada: nenhum caminho de código envia sem passar pelo guard | **Órion** |

**Depende de:** Fase 3 **executada com número real** (não só escrita) e Fase 1. A dependência é dura:
construir a Fase 4 sobre um acoplamento com a Evolution que nunca foi exercitado é empilhar em
fundação não testada — é precisamente o que a 3.7 existia para evitar.

**Aceite:** campanha de 50 alvos com 2 instâncias respeita quota e janela, para sozinha ao desconectar
um número, e um opt-out registrado durante a execução é honrado no envio seguinte. Este último item é
**critério de bloqueio de release**.

**O que mudou na v1.1:** 4.2 não escreve o guard do zero — **importa o `evaluateSendGuard` já em
produção desde a 3.7** (§4.9.3, §6.1). O que a Fase 4 acrescenta ao portão são dois `overrides` em
`false` e o caminho `skipped/<reason>` no `CampaignTarget` (em vez de resposta HTTP). Se aparecer uma
segunda implementação do portão no worker, o Órion reprova.

---

### 🔵 Fase 5 — "Seguro, auditado e no ar"
| # | Entrega | Responsável |
|---|---|---|
| 5.1 | Auditoria OWASP: authz por rota, IDOR, injeção, secrets, rate limit, headers, SSRF no webhook | **Órion** |
| 5.2 | Hardening: `apikey` do Evolution em comparação de tempo constante, `instanceKey` não enumerável, CSP | **Órion + Vega** |
| 5.3 | LGPD executável: `retention.job`, página pública de descadastro, ação de eliminação | **Vega** |
| 5.4 | Validação do conteúdo obrigatório da 1ª mensagem no `start` | **Vega** |
| 5.4b | 🆕 Validação do mesmo conteúdo obrigatório **no envio unitário** (§4.9, G10) — já entregue na Fase 3 | **Vega** |
| 5.5 | Deploy: TLS (EasyPanel), **backup diário do Postgres com restore testado**, healthchecks, rollback | **Vulcano** |
| 5.6 | Logs estruturados, alertas lendo `ALERT_WEBHOOK_URL` (scraper quebrado, número banido, Evolution fora) | **Vulcano + Vega** |
| 5.7 | Regressão completa + smoke test pós-deploy | **Íris** |
| 5.8 | 🆕 CI: task `test` no `turbo.json` + script na raiz + pipeline (typecheck, lint, test, **`next build`**) | **Vulcano + Íris** |

**Depende de:** Fase 4. **Aceite:** Órion sem achado `high`/`critical` aberto; restore de backup testado
de verdade (não "configurado"); alerta de scraper quebrado chega ao operador.

> ⚠️ **Antecipação condicional (v1.1):** **backup com restore testado sobe para a Onda 0** no dia em
> que entrar dado de cliente — não espera a Fase 5. Enquanto o único conteúdo do banco é o seed do
> IBGE, perder o volume é recuperável em minutos; com base de leads de um cliente, não é.
> `infra/backup/pg-dump.sh` foi especificado no §2 e nunca criado.
>
> **Sobre o CI (5.8):** hoje não há `.github/`, e — pior — **não existe task `test` no `turbo.json`
> nem script `test` na raiz**: um CI ligado hoje não teria o que executar. O gate de `next build`
> precisa existir desde cedo porque aprendemos, pagando, que `next build` pega classes de bug que
> `dev` e `typecheck` não pegam (componente como prop Server→Client, Prisma no Edge, imports `.js`
> sem `transpilePackages`).

---

### ⚪ Fase 6 — "Documentado e afiado" (pós-MVP)
| # | Entrega | Responsável |
|---|---|---|
| 6.1 | README, runbooks (scraper quebrado, número banido, Evolution caiu), `docs/lgpd.md` | **Alexandria** |
| 6.2 | Dashboard de métricas: taxa de resposta por nicho/template, funil, custo por lead | **Lyra + Vega** |
| 6.3 | Subdivisão de cidades saturadas — **só é possível se a flag `saturated` da 2.3d existir**; sem ela, a D4 chega aqui sem dado nenhum | **Vega** |
| 6.4 | `RotatingProxyProvider` (encaixe já existe) — **só se** houver bloqueio observado | **Vega** |
| 6.5 | Motor `maps-pb` como caminho rápido, com fallback Playwright | **Vega** |
| 6.6 | ⬆️ `GET /leads/export` + `POST /leads/bulk` (saíram da 2.4 — valiosos, não bloqueiam nada) | **Vega + Lyra** |
| 6.7 | 🆕 `scrape-detail.job` — **posição depende de §8.3**: fica aqui só se a taxa de celular ficar ≥ 50% | **Vega** |

### Grafo de dependências (v1.1)

A mudança em relação à v1.0: a Fase 3 não sai mais em paralelo com a 2, e a Fase 0 existe.

```mermaid
graph LR
    F0["Fase 0<br/>Infra real +<br/>taxa de celular"] --> F1["Fase 1<br/>Leads na tela<br/>(aceite executado)"]
    F1 --> F2["Fase 2<br/>Escala + o sistema<br/>diz que quebrou"]
    F2 --> F3["Fase 3<br/>Envio unitário real<br/>§4.9"]
    F3 --> F4["Fase 4<br/>Campanhas"]
    F4 --> F5["Fase 5<br/>Segurança + deploy + CI"]
    F5 --> F6["Fase 6<br/>Docs + otimização"]
    F0 -. "taxa &lt; 50%" .-> SD["scrape-detail<br/>vira requisito"]
    SD -.-> F4
    style F0 fill:#ffcccc
    style F3 fill:#ffe0b3
    style F4 fill:#ffe0b3
    style SD stroke-dasharray: 5 5
```

**Por que o paralelismo saiu.** A v1.0 rodava Fases 2 e 3 em paralelo "porque não compartilham
código" — verdade que se provou irrelevante. O gargalo real nunca foi escrever código (13.400 linhas
saíram rápido); foi **verificar**. Duas frentes de código não verificado em paralelo produzem o dobro
de hipóteses empilhadas, não o dobro de entrega. O ganho de tempo do plano passa a vir de outro
lugar: cada fase fecha com um aceite executado, então a fase seguinte não paga o custo de descobrir
tarde que a base estava errada.

---

## 9. Riscos, mitigações e dívidas conscientes

### 9.1 Riscos

> **Reavaliação v1.1 (o detalhe que muda a leitura da tabela abaixo).** A tabela lista as mitigações
> **projetadas**. Em 2026-08-03, várias delas existem como código sem chamador — o que significa que
> a coluna "Mitigação" descreve intenção, não proteção. Os três casos que mudam de patamar:
> - **R1 (layout do Maps): Alta / Crítico.** A mitigação que eu contava (A1–A4 + canário) é código
>   morto. Sobrou o `selectors.ts` isolado, que resolve o *conserto*, não a *detecção* — e sem
>   detecção o conserto começa dias depois, pelo cliente.
> - **R6 (qualidade do dado): Alta / Alto.** Subiu nas duas dimensões: telefone que não vem no card
>   (§8.3) e dedupe de card por `outerHTML` (§5.2) são falhas concretas, não hipóteses. E a A4, que
>   mediria isso, não roda.
> - **R4 (Evolution instável): Alta / Alto.** `packages/messaging` inteiro é uma hipótese validada
>   contra os próprios mocks do autor, e a versão da imagem é um chute. A §4.9 existe para derrubar
>   isso antes da Fase 4.
>
> **R2 e R9** (ban e auto-sabotagem) estão artificialmente baixos hoje **só porque não há envio**.
> Voltam ao patamar original no dia em que a Fase 4 subir — com metade das defesas ligadas, se a
> Onda 2 não tiver acontecido antes.

| # | Risco | Prob. | Impacto | Mitigação | Sinal de alerta |
|---|---|---|---|---|---|
| R1 | **Google muda o layout do Maps e o scraper para** | **Alta** (trimestral) | Alto | Seletores em 1 arquivo com alternativas em cascata; fixtures; assertions A1–A4; canário diário; captura de screenshot+HTML no incidente | A1/A2 dispara; canário < 10 resultados |
| R2 | **Número de WhatsApp banido** | **Alta** | Alto | Warmup obrigatório, teto duro, jitter log-normal, spintax bloqueante, opt-out imediato, múltiplas instâncias, kill switch | `statusReason 401`; taxa de resposta < 2% |
| R3 | Google bloqueia o IP (captcha/429) | Média | Alto | Rate limit conservador, pausas longas, humanização, `ProxyProvider` pronto para plugar em horas | `CAPTCHA_DETECTED`, `RATE_LIMITED` |
| R4 | Evolution API instável / breaking change | Média | Alto | Todo acoplamento em `packages/messaging`; versão do container **pinada**, nunca `latest`; health check; campanhas em `halted` sem perder alvos | Health check falha 3x |
| R5 | Exposição LGPD (reclamação de titular) | Baixa–Média | **Alto** | Origem por lead, opt-out inegociável, identificação na 1ª msg, retenção automática, base legal documentada | Pedido formal de titular |
| R6 | Qualidade ruim do dado (telefone errado, duplicata) | Média | Médio | Normalização E.164 + validação de DDD brasileiro; `dedupeKey` em 3 níveis; A4 mede a forma dos dados | A4 dispara; usuário reclama de duplicata |
| R7 | Campanha duplica envio após restart do worker | Média | Alto | `FOR UPDATE SKIP LOCKED`, `CampaignTarget` com status transacional, `providerMessageId` único, idempotência por `targetId` | Lead recebe 2x a mesma mensagem |
| R8 | Custo de infra do Chromium (RAM) | Média | Baixo | Concorrência 2, reciclagem de contexto a cada 15 buscas, limite de memória no container, restart automático | OOM kill no container |
| R9 | Usuário sabota a si mesmo (blast em número frio) | **Alta** | Alto | Tetos são **limites duros**, não sugestões; `dailyLimitOverride` só reduz; validação de spintax bloqueia | — (prevenido por design) |
| R10 | Redis cai e a fila se perde | Baixa | Médio | Postgres é a verdade: `SearchTask.status=pending` e `CampaignTarget.status=pending` permitem reenfileirar tudo. Job `requeue-orphans` no boot do worker | Worker sobe e encontra órfãos |
| R11 | Busca de UF grande (SP, 645 municípios) leva horas e parece travada | Alta | Baixo | Progresso por task na UI, priorização por população (valor nos primeiros minutos), `estimatedDurationMinutes` no create | Usuário cancela achando que travou |

### 9.2 Dívidas técnicas assumidas conscientemente

| ID | Dívida | Por que aceito agora | Quando pagar |
|---|---|---|---|
| D1 | Sem proxy rotativo | Custo recorrente sem problema comprovado; encaixe pronto | Ao primeiro `CAPTCHA_DETECTED` recorrente |
| D2 | Polling em vez de WebSocket/SSE | Polling de 3s resolve para ~20 usuários; SSE adiciona complexidade de infra | > 50 usuários simultâneos |
| D3 | Sem multi-tenancy real (só `ownerId`) | Uso interno/poucos clientes; adicionar `orgId` depois é migração simples se os índices já preverem | Primeiro cliente que exige isolamento |
| D4 | Sem subdivisão de cidades saturadas | Não sabemos o tamanho do problema; a flag `saturated` vai medir | Fase 6, com dado real |
| D5 | Só texto no disparo (sem mídia) | Texto puro tem menor risco de ban e cobre o caso de uso | Após 60 dias de operação estável |
| D6 | Feriados em tabela estática | Baixo custo de manutenção anual vs. dependência de API | Se o usuário pedir feriado municipal |
| D7 | Sem versionamento de template | Snapshot na campanha já resolve o problema real (corrupção de campanha ativa) | Se houver necessidade de auditoria histórica |
| **D8** | **Sem reconciliação de status de mensagem** — se um `messages.update` chegar durante um restart do `web`, o evento se perde (respondemos sempre 200 por desenho) e a `Message` fica `sent` para sempre. Idem para `Message` `queued` órfã do write-ahead do §4.9.5 | O impacto é **métrica de entrega subestimada**, não mensagem duplicada nem envio perdido. O paliativo do §4.8 (re-busca única após 2s) cobre a corrida comum, e o `logger.warn` mede se o resto importa | Quando o `warn` aparecer com frequência, ou quando a taxa de entrega virar número de venda |
| **D9** | **Não existe model de configuração** (`Settings`/`Organization`) — `{{minha_empresa}}` é lido de `APP_COMPANY_NAME` (env) | Há um único operador/empresa hoje; um model de configuração para uma linha é cerimônia. Mas isso significa que **trocar o nome do remetente exige redeploy**, e que multi-tenancy (D3) esbarra aqui | No primeiro cliente com marca própria — provavelmente junto com a D3 |

---

## 10. Variáveis de ambiente (referência para Vulcano)

```bash
# --- Banco e fila ---
DATABASE_URL=postgresql://user:pass@postgres:5432/innoprospect
REDIS_URL=redis://redis:6379

# --- App ---
NEXTAUTH_SECRET=            # openssl rand -base64 32
NEXTAUTH_URL=https://app.exemplo.com.br
APP_TIMEZONE=America/Sao_Paulo
OPTOUT_TOKEN_SECRET=        # HMAC do token público de descadastro

# --- Scraper ---
SCRAPE_CONCURRENCY=2
SCRAPE_RATE_PER_MIN=6
SCRAPE_DELAY_MIN_MS=8000
SCRAPE_DELAY_MAX_MS=25000
SCRAPE_MAX_RESULTS_PER_CITY=120
SCRAPE_HEADLESS=true
SCRAPE_INCIDENT_DIR=/data/incidents
PROXY_PROVIDER=noop                 # noop | rotating (futuro)

# --- Disparo ---
DISPATCH_JITTER_MIN_S=45
DISPATCH_JITTER_MAX_S=180
DISPATCH_WINDOW_START=9             # janela COMERCIAL (mole no envio manual, dura na campanha)
DISPATCH_WINDOW_END=18
DISPATCH_MAX_DAILY_ABSOLUTE=300     # teto que nenhum override ultrapassa

# Piso duro de horário (§4.9.6) — vale para TODO envio, inclusive manual.
# Só pode ser ESTREITADO (start maior / end menor); alargar é ignorado pelo código.
DISPATCH_QUIET_HOURS_START=20       # a partir desta hora, nenhum envio sai
DISPATCH_QUIET_HOURS_END=8          # antes desta hora, nenhum envio sai
DISPATCH_ALLOW_SATURDAY=true        # domingo e feriado nacional: nunca, não é configurável

# Envio unitário (§4.9)
MANUAL_SEND_RATE_PER_MIN=10         # por usuário; 429 acima disso
MANUAL_SEND_DUPLICATE_WINDOW_S=60   # anti-duplo-clique por lead

# --- Identidade do remetente (§7.4) ---
APP_COMPANY_NAME=                   # resolve {{minha_empresa}}. Sem isso, 1º contato frio é bloqueado
                                    # (409 MISSING_COMPANY_NAME) — ver dívida D9

# --- Evolution API ---
EVOLUTION_API_URL=http://evolution:8080
EVOLUTION_API_KEY=
EVOLUTION_WEBHOOK_BASE_URL=https://app.exemplo.com.br/api/webhooks/evolution

# --- Observabilidade ---
LOG_LEVEL=info
ALERT_WEBHOOK_URL=                  # opcional: Slack/Discord/Telegram
```

---

## 11. Resumo das decisões (índice rápido)

| # | Decisão | Onde |
|---|---|---|
| A1 | Monólito modular em 2 processos (web + worker), não microserviços | §0 |
| A2 | BullMQ + Redis para fila; Postgres é a fonte da verdade | §1.3 |
| A3 | Auth.js v5 com Credentials | §1.4 |
| A4 | pnpm workspaces + Turborepo; `packages/contracts` como fonte única de API | §2 |
| A5 | `dedupeKey` em 3 níveis; dado humano nunca sobrescrito por re-scraping | §3.2 |
| A6 | Playwright agora, interface `SearchEngine` pronta para motor `pb` depois | §5.1 |
| A7 | Fanout por município IBGE, priorizado por população | §5.2 |
| A8 | **Todos os seletores do Maps em 1 arquivo**; extração testável sem rede | §5.5 |
| A9 | 4 assertions de sanidade + canário diário; pausa automática da fila | §5.7 |
| A10 | Warmup é limite duro no worker, com regressão automática | §6.2 |
| A11 | Jitter log-normal; spintax insuficiente **bloqueia** o start da campanha | §6.3, §6.4 |
| A12 | Opt-out consultado por telefone, no worker, antes de cada envio, sem cache | §6.7 |
| A13 | Estado `halted` distinto de `paused`, com `acknowledgeHalt` obrigatório | §6.5, §6.6 |
| A14 | Origem do dado gravada por lead e imutável | §7.2 |
| ~~A15~~ | ~~Fase 1 = buscar 1 cidade e ver leads. Fases 2 e 3 em paralelo~~ — **revogado na v1.1**: o paralelismo saiu (§8.1) | §8 |
| **A16** | **O guard de envio nasce no envio unitário, não na campanha.** Uma única `evaluateSendGuard`, pura, compartilhada web↔worker; a Fase 4 herda um portão já exercitado em produção | **§4.9.1, §4.9.3, §6.1** |
| **A17** | **Opt-out com carimbo `checkedAt`**: o guard **lança** se a consulta tiver mais de 5s. Cache de blacklist vira falha de runtime, não questão de disciplina | **§4.9.3** |
| **A18** | **Write-ahead do `Message`**: grava `queued` + debita cota **antes** de chamar a Evolution. A cota erra sempre para menos, nunca para mais | **§4.9.5** |
| **A19** | **Horário no envio manual = piso duro (08–20, sem domingo) + janela comercial com confirmação explícita.** O risco de "parecer robô" some com volume 1; o de irritar o destinatário, não | **§4.9.6** |
| **A20** | **`error.reason`**: sub-código legível por máquina no envelope de erro. `code` governa o HTTP; `reason` é o único campo em que a UI ramifica | **§4.0** |
| **A21** | **Fase 0 = walking skeleton com infra real** antes de qualquer domínio; fase só fecha com aceite executado contra serviço real | **§8.0, §8.2** |
| **A22** | **A taxa medida de leads com celular decide se `scrape-detail` é melhoria, requisito ou bloqueante** — critério numérico fechado, não julgamento | **§8.3** |
