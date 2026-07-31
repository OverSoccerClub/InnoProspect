# InnoProspect — Documento de Arquitetura

> Versão 1.0 · Autora: Nova (arquitetura) · Data: 2026-07-30
> Status: **fechado para implementação** nas partes marcadas como CONTRATO.
> Alterações em seções CONTRATO exigem aviso ao Atlas antes de codificar (Vega/Lyra dependem delas).

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
| Hospedagem | VPS Linux com Docker Compose (não serverless puro) | Obrigatório: worker e scraper precisam de processo longo e Chromium |

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
    message: string;                        // legível, pt-BR, exibível ao usuário
    details?: Array<{ path: string; message: string }>;
    requestId: string;
  };
};
```
**Códigos HTTP usados:** 200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502.

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
Validado no `start` da campanha (`409 MISSING_OPTOUT_NOTICE` se ausente). O template precisa conter:
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

## 8. Plano faseado

Princípio: **cada fase termina com algo que o usuário consegue usar de ponta a ponta.** Nada de "fase de
backend" seguida de "fase de frontend" — isso produz três semanas sem nada demonstrável e esconde erro de
integração até o fim.

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

**Depende de:** nada. **Critério de aceite:** buscar "clínica odontológica" em Campinas-SP retorna
≥ 30 leads com nome e telefone em < 3 minutos, sem duplicatas.
**Fora de escopo aqui:** fanout do estado inteiro, export, proxy, WhatsApp.

---

### 🟢 Fase 2 — "Cubro o estado inteiro e exporto"
**Objetivo:** escala de coleta e o primeiro valor exportável.

| # | Entrega | Responsável |
|---|---|---|
| 2.1 | Fanout por município (todos da UF), priorização por população, flag `saturated` | **Vega** |
| 2.2 | Rate limiting, jitter, rotação de UA, humanização, `ProxyProvider` (Noop) | **Vega** |
| 2.3 | Assertions de sanidade A1–A4 + `ScraperHealthEvent` + canário diário + captura de incidente | **Vega** |
| 2.4 | `GET /leads/export` (CSV em stream, BOM) + `PATCH /leads/:id` + `POST /leads/bulk` | **Vega** |
| 2.5 | UI: seleção de cidades, banner de saúde do scraper, export, edição de status/tags/notas | **Lyra** |
| 2.6 | Schema: `ScraperHealthEvent`, `RawCapture`, campos de origem LGPD | **Cronos** |
| 2.7 | Teste de carga (1 UF completa) + teste de quebra de seletor (fixture adulterada deve alarmar) | **Íris** |

**Depende de:** Fase 1 completa. **Aceite:** busca em UF média (ex.: ES, 78 municípios) conclui sem
intervenção; adulterar um seletor faz a fila pausar e o banner vermelho aparecer.

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
| 3.7 | Envio manual para 1 lead a partir da ficha (validação real ponta a ponta) | **Vega + Lyra** |
| 3.8 | Testes: webhook idempotente, spintax, detecção de opt-out (incl. falsos positivos) | **Íris** |

**Depende de:** Fase 1 (leads existem). Pode rodar **em paralelo com a Fase 2** — não compartilham código.
**Aceite:** conectar número por QR, mandar mensagem para o próprio celular do operador, ver
`sent → delivered → read`, responder "sair" e ver o `OptOut` criado automaticamente.

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

**Depende de:** Fases 3 e 1. **Aceite:** campanha de 50 alvos com 2 instâncias respeita quota e janela,
para sozinha ao desconectar um número, e um opt-out registrado durante a execução é honrado no envio
seguinte. Este último item é **critério de bloqueio de release**.

---

### 🔵 Fase 5 — "Seguro, auditado e no ar"
| # | Entrega | Responsável |
|---|---|---|
| 5.1 | Auditoria OWASP: authz por rota, IDOR, injeção, secrets, rate limit, headers, SSRF no webhook | **Órion** |
| 5.2 | Hardening: `apikey` do Evolution em comparação de tempo constante, `instanceKey` não enumerável, CSP | **Órion + Vega** |
| 5.3 | LGPD executável: `retention.job`, página pública de descadastro, ação de eliminação | **Vega** |
| 5.4 | Validação do conteúdo obrigatório da 1ª mensagem no `start` | **Vega** |
| 5.5 | Deploy: Caddy + TLS, backup diário do Postgres com restore testado, healthchecks, rollback | **Vulcano** |
| 5.6 | Logs estruturados, alertas (scraper quebrado, número banido, Evolution fora) | **Vulcano + Vega** |
| 5.7 | Regressão completa + smoke test pós-deploy | **Íris** |

**Depende de:** Fase 4. **Aceite:** Órion sem achado `high`/`critical` aberto; restore de backup testado
de verdade (não "configurado"); alerta de scraper quebrado chega ao operador.

---

### ⚪ Fase 6 — "Documentado e afiado" (pós-MVP)
| # | Entrega | Responsável |
|---|---|---|
| 6.1 | README, runbooks (scraper quebrado, número banido, Evolution caiu), `docs/lgpd.md` | **Alexandria** |
| 6.2 | Dashboard de métricas: taxa de resposta por nicho/template, funil, custo por lead | **Lyra + Vega** |
| 6.3 | Subdivisão de cidades saturadas (usa a flag `saturated` da Fase 2, agora com dado real) | **Vega** |
| 6.4 | `RotatingProxyProvider` (encaixe já existe) — **só se** houver bloqueio observado | **Vega** |
| 6.5 | Motor `maps-pb` como caminho rápido, com fallback Playwright | **Vega** |

### Grafo de dependências
```mermaid
graph LR
    F1["Fase 1<br/>Leads na tela"] --> F2["Fase 2<br/>Estado + export"]
    F1 --> F3["Fase 3<br/>1ª mensagem"]
    F2 --> F4["Fase 4<br/>Campanhas"]
    F3 --> F4
    F4 --> F5["Fase 5<br/>Segurança + deploy"]
    F5 --> F6["Fase 6<br/>Docs + otimização"]
    style F1 fill:#d4f7d4
    style F4 fill:#ffe0b3
```
**Fases 2 e 3 rodam em paralelo** — é o principal ganho de tempo do plano, e só é possível porque os
contratos da §4 estão fechados agora.

---

## 9. Riscos, mitigações e dívidas conscientes

### 9.1 Riscos

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
DISPATCH_WINDOW_START=9
DISPATCH_WINDOW_END=18
DISPATCH_MAX_DAILY_ABSOLUTE=300     # teto que nenhum override ultrapassa

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
| A15 | Fase 1 = buscar 1 cidade e ver leads. Fases 2 e 3 em paralelo | §8 |
