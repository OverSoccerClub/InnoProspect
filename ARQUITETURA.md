# InnoProspect — Documento de Arquitetura

> Versão 1.5 · Autora: Nova (arquitetura) · Data: 2026-09-26 (v1.4: 2026-09-26 · v1.3: 2026-09-24 · v1.2: 2026-09-22 · v1.1: 2026-08-03 · v1.0: 2026-07-30)
> Status: **fechado para implementação** nas partes marcadas como CONTRATO.
> Alterações em seções CONTRATO exigem aviso ao Atlas antes de codificar (Vega/Lyra dependem delas).

### O que mudou na v1.5 — "o laço de cinco etapas: classificar quem, e depois ler o que voltou"

O dono descreveu o fluxo que quer (busca → classifica os mais promissores → campanha para eles →
filtra quem tem interesse → continuar ou não). O Atlas apontou que ele parava cedo demais, o dono
concordou, e o escopo aprovado ficou com **cinco etapas**. Esta revisão **estende a §8.11** (v1.4)
com as três etapas novas — ②, ③ e ④. Nada da v1.4 é revogado.

| # | Mudança | Seção | Tipo |
|---|---|---|---|
| 1 | **Classificar os leads não é refinamento: é a consequência da cota.** Um número no dia 1 faz 20 mensagens/dia — com 200 alvos são dez dias úteis. Quando só dá para falar com 20 pessoas hoje, **quem** se escolhe é o jogo inteiro | **§8.11.11, §8.11.12 (novas)** | 🔒 CONTRATO novo |
| 2 | 🔒 **O ranking é a HIPÓTESE; a resposta é a EVIDÊNCIA.** Tudo que coletamos mede **encaixe**, nada mede **intenção** — uma clínica 4.8 sem site pode ter decidido não ter site | **§8.11.11** | enquadramento travado |
| 3 | **Elegibilidade corta antes, score ordena depois** (A39). O que o portão recusa terminalmente (G4 → `LEAD_NOT_MOBILE` → `skipped/landline`) não deveria ter entrado no recorte | **§8.11.12** | 🔒 decisão travada |
| 4 | **Score explicável por componente, com perfil de pesos imutável e versionado** (A40) — "sem site +30 · nota 4.8 +15" e não "55". O dono precisa poder **discordar ajustando os pesos** | **§8.11.12.1** | 🔒 CONTRATO novo |
| 5 | 🔴 **Campanhas separadas por ângulo NÃO rodam em paralelo — serializam** (A48). O motor itera `campaign.findMany({ orderBy: startedAt asc })` sobre uma cota que é **do número**: a mais antiga consome o dia inteiro, e a comparação entre ângulos vira comparação entre semanas | **§8.11.13 (nova)** | achado no código |
| 6 | **Ler e classificar a RESPOSTA** — a etapa que faltava, e o uso de IA mais seguro do sistema: o modelo **lê** em vez de escrever, não inventa fato sobre o negócio de ninguém e **nunca chega no celular de ninguém** | **§8.11.14 (nova)** | 🔒 CONTRATO novo |
| 7 | 🔴 **`discarded` é irreversível** (`checkStatusTransition`: "não é possível sair de 'discarded'", para qualquer ator). Logo **nada descarta lead sozinho**: classificar é automático, mover o funil não é (A44) | **§8.11.14.1** | achado no código |
| 8 | **Dois vieses de seleção, não um** (A47): explorar **público** (o score prevê resposta?) e explorar **ângulo** (qual mensagem converte?) são fatias disjuntas, com perguntas diferentes e marcas diferentes | **§8.11.15 (nova)** | 🔒 decisão travada |
| 9 | **A escada ganha o degrau N4a — "monta e não dispara"**. Decisão do dono: classificar e montar são automáticos, **apertar o disparo continua humano**, até a medição mostrar que a autonomia foi conquistada | **§8.11.13, §8.11.4** | 🔒 escada revisada |
| 10 | **LGPD: classificar resposta é transmitir texto escrito por um terceiro.** Diferente de mandar `rating`/`categoria`. Começa **sem modelo** (regra pura); se ligar, sai minimizado e sem identidade (A46) | **§8.11.14.4** | avaliação + recomendação |

**A regra que esta revisão acrescenta:** *capacidade escassa transforma priorização em arquitetura.*
Enquanto a cota couber no público, ordenar é enfeite; a partir do momento em que não cabe — e ela
nunca vai caber, porque a escassez é anti-ban — **a ordem da fila é o produto**.

### O que mudou na v1.4 — "medir antes de gerar, e autonomia como escada com guarda-corpo"

O dono pediu uma máquina de prospecção autônoma. Ao desenhá-la contra o código real, o obstáculo não
é gerar texto — é que **o sistema hoje não consegue dizer qual abordagem converte**, e uma máquina
que gera sem medir erra com confiança, em escala. Esta revisão acrescenta a §8.11, que **estende** a
§8.10 (os dois invariantes de lá continuam valendo palavra por palavra).

| # | Mudança | Seção | Tipo |
|---|---|---|---|
| 1 | **A medição vira pré-requisito da geração**, não relatório posterior. Model `ApproachOutcome`, escrito na MESMA transação do write-ahead, em `@inno/sending` — único ponto em que nenhum chamador pode esquecer | **§8.11.3 (nova)** | 🔒 CONTRATO novo |
| 2 | 🔴 **Responder "SAIR" conta como RESPOSTA hoje.** `webhook.ts#handleInboundMessage` avança o alvo para `responded` antes de registrar o descadastro. Ligar aprendizado sobre isso ensina a máquina a premiar a abordagem que mais irrita | **§8.11.3** | correção de fato |
| 3 | **O ângulo da abordagem é CALCULADO por regra pura; a IA só escreve a frase.** O modelo deixa de selecionar fatos — recebe um conjunto fechado e declara quais citou, verificável em código | **§8.11.2** | 🔒 decisão travada (A33) |
| 4 | **Escada de autonomia N0-N4**, nível persistido lido em runtime (ausente = N0). Cada degrau acrescenta um autor e não altera **nada** à direita de `executeSendAttempt` — subir e descer sem reescrever | **§8.11.4** | 🔒 CONTRATO novo |
| 5 | **A maior parte do valor da fase não depende de IA**: catálogo de ângulos determinístico + template por ângulo entrega o ganho e serve de braço de comparação. Sem ele, "a IA converte mais" é incomparável | §8.11.6 | decisão |
| 6 | **O texto final por alvo ganha coluna** (`CampaignTarget.renderedBody`). Hoje ele é recalculado do snapshot em três lugares no momento do envio — não há onde texto gerado morar | §8.11.5 | correção de fato |
| 7 | O achado `medium` do Órion (corrida de `respondedCount`) **teve o gatilho disparado**: a heurística que iria lê-lo é justamente esta fase | §8.11.3 | dívida vencida |

**A regra que esta revisão acrescenta:** *nenhum laço de aprendizado pode ser ligado sobre um sinal
que mistura sucesso com fracasso.* Separar `replied` de `optedOut` não é refinamento de métrica — é
a diferença entre uma máquina que melhora e uma que piora com confiança.

### O que mudou na v1.3 — "onde o envio mora, para o motor não ser uma segunda implementação"

A v1.2 especificou o motor (§6.8) supondo que o worker conseguiria enviar. Ele não consegue: o envio
inteiro (`sendLeadMessage`) vive em `apps/web/src/lib/services/messages.ts`, e `packages/*` é a única
coisa que os dois processos compartilham. Esta revisão responde **onde cortar**, e fecha três lacunas
que só apareceram quando desenhei o corte contra o código real.

| # | Mudança | Seção | Tipo |
|---|---|---|---|
| 1 | **`packages/sending` (`@inno/sending`)**: o ato de enviar UMA mensagem — portão, write-ahead, `sendText`, contabilidade — sai de `apps/web` e passa a ser o único lugar onde isso existe. `apps/web` e `apps/worker` viram chamadores | **§6.8.0 (nova)**, §2 | 🔒 CONTRATO novo |
| 2 | **O executor devolve resultado, não lança HTTP.** A tradução para `409/502` continua em `apps/web`; a tradução para estado do alvo (§6.8.5) é do worker. Uma decisão, dois vocabulários | **§6.8.0** | 🔒 CONTRATO novo |
| 3 | **Worker chamando a rota HTTP do web: descartado**, com motivo escrito (§6.8.0.5) — não é preferência de estilo, é que um deploy do `web` no meio de uma campanha vira `EVOLUTION_SEND_UNCERTAIN` em massa | §6.8.0 | decisão |
| 4 | 🔴 **Três configurações de campanha estavam gravadas, exibidas na tela e honradas por ninguém**: `sendWindowDaysOfWeek`, `jitterMin/MaxSeconds` e `dailyLimitPerInstance`. O motor é o primeiro consumidor delas | **§6.8.10 (nova)** | correção de fato |
| 5 | **O motor nasce PAUSADO** — e o interruptor é a pausa global persistida (§4.10), não uma env. Chave ausente no Redis = pausado, ao contrário do scraper | §6.8.9 | 🔒 decisão travada |
| 6 | Fase 4.F quebrada em 6 passos ordenados, com a fiação de build/bundle como **passo 0** | §8 Fase 4 | plano |

**A regra que esta revisão acrescenta:** *duplicar é permitido para protocolo (nome de fila, chave de
Redis, transporte de log/alerta); é proibido para qualquer coisa que decida **se** uma mensagem sai,
**quando** ela sai, ou **o que** foi cobrado por ela.* A primeira classe diverge e alguém percebe na
próxima leitura de log. A segunda diverge em silêncio, e a conta chega como número banido.

### O que mudou na v1.2 — "a Fase 4 desenhada contra o código que existe"

A v1.1 escreveu o envio unitário. Ele **foi implementado e está em produção no código** (§4.9), e com
ele vieram fatos que a v1.1 não tinha: um resultado de envio **incerto**, um guard puro com um único
call site, e um schema de campanha já criado pelo Cronos. Esta revisão fecha a Fase 4 contra isso.

| # | Mudança | Seção | Tipo |
|---|---|---|---|
| 0 | **Decisão do dono: o InnoProspect é de USO PRÓPRIO.** Sem venda, sem conta por cliente, sem isolamento por organização. A dívida **D3 (multi-tenancy) está ENCERRADA, não adiada** | **§0.1**, §9.2 | 🔒 decisão travada |
| 1 | §4.5 reescrita contra o schema e os contratos que já existem; `POST /campaigns/preview`, `PATCH`, `DELETE`, exclusão `alreadyTargeted`, tabela de erros por `reason` | **§4.5** | 🔒 CONTRATO fechado |
| 2 | **Convenção `meta` → `details[]`** declarada: o envelope de erro não tem campo `meta`; o mapa do guard viaja em `details[]` com `path` = nome da chave | §4.0 | correção de fato |
| 3 | **`dispatch-tick.job` especificado ponta a ponta**: claim por lease, rotação, gate de cadência, micro-pausa, incerto, kill switch | **§6.8 (nova)** | 🔒 CONTRATO novo |
| 4 | **Cadência é propriedade do NÚMERO, não do chamador** — `WhatsAppInstance.nextSendAllowedAt` é o gate único, honrado pelo manual e pela campanha. Fecha o achado médio do Órion (2026-09-22) | **§4.9.10 (nova)**, §6.8 | 🔒 CONTRATO alterado |
| 5 | **O guard continua um só**: 2 fatos novos (`lastInboundAt`, `instance.nextSendAllowedAt`), 1 override novo (`ignorePaceLock`), 2 `reason` novos. Nenhuma segunda implementação no worker | §4.9.3, §6.1 | 🔒 CONTRATO alterado |
| 6 | **Resultado incerto na campanha**: alvo vira `failed`, **nunca é retentado**, cota não volta, e 3 incertos seguidos tiram a instância da rotação | §6.8.6 | regra nova |
| 7 | `warmup-roll` e um `health-check` **mínimo** entram na Fase 4; `retention` fica na Fase 5 — com o critério escrito | §6.9, §8 Fase 4 | plano |
| 7b | **Pausa global do disparo** — um botão que para tudo num incidente, espelho do que o scraper já tem | **§4.10 (nova)**, §6.8.9 | 🔒 CONTRATO novo |
| 8 | Fase 4 reescrita em 6 entregas testáveis isoladamente, com dono e critério de pronto | **§8** | reescrita |

**Critério que separou "entra na Fase 4" de "fica para depois":** entra o que é necessário para o
sistema **parar**; fica para depois o que é necessário para o sistema **otimizar**. Um job que impede
queimar cota contra um provedor morto é Fase 4; um job que detecta shadow-ban por taxa de resposta
precisa de 100+ envios de histórico para significar alguma coisa — não é sequer testável no aceite da
Fase 4 (50 alvos), e por isso não entra nela.

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
| Usuários | **Poucos operadores internos de um único dono** (§0.1, v1.2) | **Sem multi-tenancy, nem preparado** — `orgId` sai do horizonte |
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
- 🔒 **O InnoProspect é de USO PRÓPRIO** — decidido pelo dono em 2026-09-22. Ver §0.1.

### 0.1 🔒 Uso próprio — a decisão que fecha uma família inteira de requisitos

**Decisão do dono, fechada em 2026-09-22: o InnoProspect não será vendido para clientes.** Não há conta
por cliente, não há isolamento de dados por organização, não há planos nem cobrança. Os dados têm **um
único dono**, e os usuários do sistema são **poucos operadores internos** dessa mesma empresa.

Isto não é uma premissa minha nem uma hipótese a validar: é restrição de contorno, no mesmo nível de
"a fonte é scraping próprio" e "o canal é Evolution API". **Não reabrir.**

**O que isso encerra (não adia):**

| Item | Antes | Agora |
|---|---|---|
| **D3 — multi-tenancy** | dívida "pagar no primeiro cliente que exigir isolamento" | **ENCERRADA.** Não haverá esse cliente. `ownerId` no `Lead` continua existindo, mas como **atribuição de responsável** entre operadores, não como fronteira de segurança |
| **D9 — model de configuração** | "pagar junto com a D3, no primeiro cliente com marca própria" | **ACEITA em definitivo.** `APP_COMPANY_NAME` por env é a resposta certa para uma única empresa; trocar o nome do remetente é evento raro e um redeploy é aceitável |
| `orgId` em índices, escopo por organização em toda query, tela de gestão de organizações | "já preparado" | **não construir.** Preparar terreno para um requisito cancelado é custo puro |
| Planos, limites por plano, cobrança, onboarding de cliente | fora do MVP | fora do produto |

**O que isso NÃO encerra** — e é onde erra quem lê "uso próprio" como "pode ser relaxado":
- **Autenticação e autorização continuam de pé.** O domínio é público na internet (§0, correção v1.1).
  "Poucos usuários internos" muda quantos são, não se o sistema fica exposto.
- **LGPD continua valendo integralmente.** O titular do dado é o lead, não o cliente do software. Quem
  prospecta em nome próprio é controlador do dado exatamente igual — opt-out, base legal, retenção e
  eliminação (§7) não têm nada a ver com o modelo de negócio.
- **Anti-ban continua valendo integralmente.** O número que cai é o do próprio dono.
- **Papéis `admin` / `operator` continuam.** Remover opt-out exige `admin` (§4.7) porque é operação
  perigosa, não porque é "de outro cliente".

**Impacto direto na Fase 4:** nenhuma campanha precisa de escopo por organização. `GET /campaigns` lista
todas as campanhas do sistema, e qualquer `operator` autenticado vê e opera qualquer campanha. Isso
**simplifica** a Fase 4 de verdade — e é a razão de a §4.5 não ter um único filtro por dono.

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
    W->>Q: enqueue "scrape-search" (1 job = 1 SearchTask)
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
    W->>Q: enqueue "dispatch-tick" (repeatable)
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
│   │   │   │   │   │   ├── whatsapp/instances/[id]/status/route.ts   # leitura pura, seguro sondar
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
│   ├── sending/                     # 🔒 🆕 v1.3 — O ATO DE ENVIAR UMA MENSAGEM (§6.8.0)
│   │   ├── src/                     #    Único lugar com Prisma + Evolution na mesma função.
│   │   │   ├── index.ts             #    Importado por apps/web E apps/worker.
│   │   │   ├── send-one.ts                   # 🔒 opt-out → guard → write-ahead → sendText → contabilidade
│   │   │   ├── outcome.ts                    # EVOLUTION_ERROR_EFFECT: sucesso | falha confirmada | incerto
│   │   │   ├── pace.ts                       # advanceNextSendAllowedAt (UPDATE monotônico) + micro-pausa
│   │   │   ├── campaign-targets.ts           # advanceCampaignTargetStatus, halt por instância única
│   │   │   ├── evolution-resolver.ts         # instância → EvolutionServer → client (com a cifra da chave)
│   │   │   └── ports.ts                      # interfaces de logger e alerta (cada app injeta a sua)
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
- 🆕 **v1.3 — `packages/sending` é a exceção declarada à regra "pacote não fala com o mundo".** Ele
  importa `@inno/db` **e** `@inno/messaging` de propósito, porque a coisa que ele protege é
  justamente a *sequência* entre ler o banco e chamar a rede (§6.8.0). O que ele **não** pode:
  importar `next/*`, ler `process.env` (a política entra por parâmetro) ou lançar erro de HTTP.
  Quem traduz o resultado em `409`/`502` é `apps/web`; quem traduz em estado do alvo é o worker.
- 🆕 **v1.3 — o que pode ser duplicado entre os dois apps, e o que não pode.** Duplicar é permitido
  quando o que se duplica é **protocolo** (nome de fila, chave de Redis, payload de alerta) — diverge
  alto e alguém percebe. É proibido quando o que se duplica **decide se a mensagem sai, quando sai ou
  o que foi cobrado por ela** (portão, gate de cadência, write-ahead/compensação, classificação de
  incerto, chave do dia da cota, limites lidos da env) — esses divergem em silêncio.
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

> 🔧 **Correção v1.2 — `meta` não existe no envelope; ele viaja em `details[]`.**
> A v1.1 escreveu, em vários pontos do §4.9, que certos erros "incluem `meta` útil em `details[]`". Isso
> descreve duas coisas incompatíveis: `meta` é `Record<string, unknown>` (é o que `SendGuardVerdict`
> devolve) e `details` é `Array<{ path, message }>`. Não há campo `meta` no `ApiError`, e **não vai
> haver** — seria a segunda alteração de envelope em duas versões, para ganhar pouco.
>
> **Convenção fechada:** o `meta` do guard é achatado em `details[]`, uma entrada por chave, com
> `path` = **nome da chave** e `message` = valor serializado como string.
> ```ts
> // verdict.meta = { nextWindowOpensAt: '2026-09-23T12:00:00.000Z' }
> // vira:
> details: [{ path: 'nextWindowOpensAt', message: '2026-09-23T12:00:00.000Z' }]
> ```
> Consequência assumida: em erro de **regra de negócio**, `path` não é caminho de campo JSON — é nome
> de chave. Em erro de **validação** (422), `path` continua sendo caminho de campo, como sempre foi. A
> UI distingue pelos dois eixos que já tem: `code` (`VALIDATION_ERROR` vs `CONFLICT`) e `reason`.
>
> **Divergência real a corrigir no código (Vega, item pequeno):** hoje só `QUIET_HOURS` e
> `OUTSIDE_BUSINESS_WINDOW` propagam `meta` (`apps/web/src/lib/services/messages.ts`). O guard já
> devolve `meta` em `DAILY_LIMIT_REACHED` (`dailyLimit`, `sentToday`), `LEAD_NOT_MOBILE` (`phoneType`),
> `INSTANCE_NOT_CONNECTED` (`status`) e `DUPLICATE_SEND` (`lastOutboundAt`) — e tudo isso é descartado
> no caminho. **Propagar sempre que `meta` existir**, em vez de manter uma lista de `reason`
> privilegiados: a lista é justamente o tipo de coisa que envelhece quando um `reason` novo entra.

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

### 4.5 Campanhas (🔒 CONTRATO — reescrito na v1.2 contra o código real)

> **Por que esta seção foi reescrita.** Quando escrevi a v1.0, `Campaign` não existia em lugar nenhum.
> Hoje existem `Campaign`, `CampaignInstance` e `CampaignTarget` no schema (com os contadores de funil e
> o índice de seleção), e `packages/contracts/src/campaign.contract.ts` está inteiro escrito. O que
> **não** existe é qualquer rota: `find apps/web/src/app/api/v1 -name route.ts` não devolve nada com
> "campaign". Ou seja, é mais um caso de "escrito ≠ ligado". Esta seção fecha o contrato **em cima do
> que já está no disco**, para ninguém precisar adivinhar onde o documento e o código divergiam.

#### 4.5.0 O que já existe e não se discute mais

| Peça | Onde | Observação para quem for implementar |
|---|---|---|
| Schemas Zod de request/response | `packages/contracts/src/campaign.contract.ts` | Fonte da verdade dos tipos. As adições da v1.2 estão marcadas 🆕 abaixo |
| `Campaign`, `CampaignInstance`, `CampaignTarget` | `packages/db/prisma/schema.prisma` | Já migrado |
| Contadores de funil (`sentCount`…`skippedCount`) | `Campaign` | **Incrementados, nunca `COUNT(*)`** |
| Índice do hot path `(campaignId, status, scheduledFor)` | `CampaignTarget` | É o que o §6.8.2 usa |
| Transição de status do alvo + incremento atômico do contador | `apps/web/src/lib/services/campaign-targets.ts` | **Único** lugar autorizado a mudar `CampaignTarget.status` |
| Halt por instância que caiu | `haltCampaignsSoleInstanceDisconnected()` no mesmo arquivo | Já chamado pelo webhook, pelo disconnect manual e pelo envio unitário |

**Regra de ouro desta seção:** nenhuma rota de campanha escreve `campaignTarget.status` direto.
Sempre por `advanceCampaignTargetStatus()`. O contador e o status saem da mesma transação ou saem
dessincronizados desde o primeiro dia — foi o Cronos que pediu isso, e está certo.

#### 4.5.1 Ciclo de vida (a máquina de estados, normativa)

```
                    ┌──────────── PATCH / DELETE permitidos ────────────┐
                    │                                                   │
  POST ─→ draft ──────────────────── start ───────────────→ running ─┐
            │  └─ scheduledFor? ─→ scheduled ── start/auto ─┘         │
            │                                                          │
            │                              pause ↕ resume              │
          DELETE                                                       │
            ↓                              paused ←──────────────┐     │
          (some)                             │                   │     │
                                             │   ┌── halt automático (§6.6)
                                             │   ↓                     │
                                             │ halted ── resume(acknowledgeHalt:true) ─→ running
                                             │                         │
                        cancel (de qualquer ativo) ─→ cancelled        │
                                                                       │
                                     último alvo processado ─→ completed
```

**Invariantes:**
1. `draft` e `scheduled` **já têm alvos materializados** (ver §4.5.2). O que não têm é
   `renderedTemplateSnapshot` nem `scheduledFor` preenchido nos alvos.
2. `completed` e `cancelled` são **terminais**. Não há `restart` — copiar campanha é outro recurso, e
   não entra na Fase 4 (§4.5.9).
3. `halted` ≠ `paused`, e a diferença é o `acknowledgeHalt`. `paused` é decisão humana; `halted` é
   incidente. Se `resume` de `halted` não exigisse confirmação, o operador retomaria sem nunca ficar
   sabendo que o número foi banido — que é a única informação que importava.
4. Em **qualquer** parada (pause, halt, cancel de alvos pendentes), alvo `pending` **continua
   `pending`**. Nunca vira `failed`. A campanha retoma de onde parou (§6.6).

#### 4.5.2 Quando os alvos são materializados — e por quê no `POST`, não no `start`

**Decisão: `POST /campaigns` já grava as linhas de `CampaignTarget`.** A alternativa (materializar só
no `start`) é mais barata, e foi descartada por um motivo de produto: o operador precisa **ver quais
leads entraram**, não só quantos. "800 viraram 430" sem lista é um número que ele não tem como
auditar; com `GET /campaigns/:id/targets` em `draft`, ele confere nome por nome antes de disparar.

Consequência assumida: um `draft` abandonado deixa linhas no banco. É barato (o `DELETE` de draft
existe, e `onDelete: Cascade` limpa), e o `draft` é reaproveitável — que é o comportamento que o
operador espera de um rascunho.

**Duas passagens de exclusão, deliberadamente:**

| Momento | O que avalia | Resultado |
|---|---|---|
| `POST` (ou `PATCH` de audiência) | opt-out, telefone, duplicata, contato recente, já-alvo-de-outra-campanha | lead excluído **não vira linha**; entra só na contagem de `audience.excluded` |
| `start` | **reavalia** opt-out e contato recente sobre os alvos já materializados | alvo que passou a ser inelegível vira `skipped` com `skipReason`, e o contador `skippedCount` sobe |

Por que duas: entre criar e iniciar podem passar horas ou dias, e opt-out não espera. A segunda
passagem é barata (um `UPDATE ... WHERE phoneE164 IN (SELECT ...)`) e é a diferença entre "o documento
diz que respeitamos opt-out" e "respeitamos". Ela **não** substitui o portão do §6.8/§4.9 — que
continua consultando por telefone imediatamente antes de cada envio.

#### 4.5.3 `POST /api/v1/campaigns/preview` — 🆕 v1.2, a prévia sem criar nada

```ts
// Request — o mesmo `audience` e os mesmos `settings` do POST /campaigns
{
  templateId: string;
  instanceIds: string[];
  audience: { mode: 'ids'; leadIds: string[] } | { mode: 'filter'; filter: LeadFilter };
  settings?: CampaignSettingsInput;
}
```
```ts
// 200 OK — nenhuma linha gravada
{
  audience: {
    totalMatched: number;
    eligible: number;
    excluded: {
      optedOut: number; landline: number; noPhone: number;
      recentlyContacted: number; duplicatePhone: number;
      alreadyTargeted: number;            // 🆕 v1.2 — ver §4.5.4
    };
  };
  settings: CampaignSettings;             // efetivas, com defaults resolvidos
  estimate: { days: number; messagesPerDay: number; finishesAround: string };
  sample: Array<{ leadId: string; name: string; phoneE164: string; city: string }>;  // 🆕 até 10 elegíveis
  blockers: Array<{ reason: string; message: string }>;   // 🆕 o que impediria o `start` HOJE
}
```

**Por que `preview` existe e não basta criar um `draft`:** a tela de montagem de campanha recalcula a
audiência a cada mexida no filtro. Criar um `draft` por mexida produziria lixo, e o operador nem sabe
ainda se vai criar a campanha. `preview` é `GET` disfarçado de `POST` (é `POST` só porque o filtro não
cabe em query string) — **não escreve nada, e por isso pode ser chamado a cada debounce de 400ms**.

**`blockers[]` é a parte que muda a UI.** Ele antecipa, na tela de montagem, tudo o que faria o `start`
devolver 409 depois: `INSUFFICIENT_TEXT_VARIATION`, `MISSING_OPTOUT_NOTICE`, `MISSING_COMPANY_NAME`,
`INSTANCE_NOT_CONNECTED`, `EMPTY_AUDIENCE`. Sem isso, o operador monta a campanha inteira, clica em
iniciar e só então descobre que o template não tem variação suficiente. Os mesmos `reason` do `start`,
de propósito: uma lista só, em dois lugares.

> **Lyra:** `blockers` é aviso, não bloqueio — o operador **pode** criar a campanha em `draft` com
> blockers pendentes (ele pode estar montando aos poucos). Quem bloqueia é o `start`.

#### 4.5.4 `POST /api/v1/campaigns` — cria em `draft` (NÃO dispara)

Request: `createCampaignBodySchema` (já existe em `packages/contracts`) — `name`, `templateId`,
`instanceIds[]`, `audience`, `settings?`, `scheduledFor?`.

`201` → `createCampaignResponseSchema`, com **uma adição**: `audience.excluded.alreadyTargeted` 🆕.

**Os seis motivos de exclusão, em ordem de avaliação (a ordem importa: cada lead conta em UM motivo
só, o primeiro que casar — senão as parcelas não somam `totalMatched`):**

| # | `excluded.*` | Regra | Por que existe |
|---|---|---|---|
| 1 | `noPhone` | `phoneE164 IS NULL` | Não há para onde mandar |
| 2 | `landline` | `phoneType != 'mobile'` | §3.2 regra 4 — fixo não recebe WhatsApp, e na campanha não existe `allowNonMobile` |
| 3 | `optedOut` | `EXISTS (SELECT 1 FROM opt_outs WHERE phoneE164 = lead.phoneE164)` | O portão inegociável (§6.7) |
| 4 | `duplicatePhone` | mesmo `phoneE164` de outro lead já elegível nesta audiência | Dois leads, um telefone, duas mensagens para a mesma pessoa. Mantém o de `createdAt` mais antigo |
| 5 | `recentlyContacted` | existe `Message` outbound para o lead nos últimos `skipRecentlyContactedDays` | Abordagem repetida é o padrão que gera denúncia |
| 6 | 🆕 `alreadyTargeted` | o lead é alvo `pending` de **outra** campanha não terminal (`draft`, `scheduled`, `running`, `paused`, `halted`) | **Buraco da v1.0.** `recentlyContacted` olha mensagem já *enviada*; duas campanhas criadas no mesmo dia com públicos que se cruzam passam as duas pela regra 5 e a pessoa recebe duas abordagens frias. É o mesmo dano, e não havia regra cobrindo |

**`totalMatched = eligible + soma(excluded.*)`** é invariante testável. Íris valida isso com números
que não fecham por acidente (ex.: um lead que é ao mesmo tempo fixo e opt-out conta **uma vez**, em
`landline`, porque é o motivo que aparece primeiro).

**`estimate`** = `eligible / (nº de instâncias × cota diária efetiva de cada uma hoje)`, arredondado
para cima em dias úteis da janela configurada. É estimativa, não promessa: a cota cresce com o warmup
(§6.2), então a campanha tende a terminar **antes** do previsto. Melhor errar para mais.

> **Importante para Lyra:** o bloco `audience.excluded` é a tela de conferência antes de iniciar.
> Mostrar sempre, com os motivos discriminados e **clicáveis** — "430 elegíveis · 180 sem celular ·
> 120 já contatados · 70 sem telefone". O usuário precisa ver *por que* 800 leads viraram 430 alvos, e
> cada motivo tem uma ação diferente do lado dele (buscar mais, esperar, ou conferir o dado).

**Erros do `POST`:**

| HTTP | `code` | `reason` | Quando |
|---|---|---|---|
| 422 | `VALIDATION_ERROR` | — | Zod: nome curto, `instanceIds` vazio, `jitter.min < 30`, `sendWindow` fora de 08–20 |
| 404 | `NOT_FOUND` | `TEMPLATE_NOT_FOUND` · `INSTANCE_NOT_FOUND` | id inexistente (lista quais em `details[]`) |
| 409 | `CONFLICT` | `EMPTY_AUDIENCE` | `eligible === 0` — criar campanha sem ninguém é sempre erro de quem montou |
| 409 | `CONFLICT` | `AUDIENCE_TOO_LARGE` | `eligible > CAMPAIGN_MAX_TARGETS` (default 5.000). Teto de sanidade: a `POST` materializa as linhas, e 200k alvos numa transação derruba o request. Acima disso, fatie |

#### 4.5.5 `PATCH /api/v1/campaigns/:id` — 🆕 v1.2: o que acontece com os alvos quando se edita

A pergunta que faltava responder. **Decisão: o que pode ser editado depende do estado, e a audiência só
é editável enquanto ninguém recebeu mensagem.**

| Estado | `name` | `settings` | `instanceIds` | `templateId` | `audience` | `scheduledFor` |
|---|---|---|---|---|---|---|
| `draft` / `scheduled` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `paused` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `halted` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `running` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `completed` / `cancelled` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

`409 CAMPAIGN_NOT_EDITABLE` quando o estado não permite; `409 FIELD_NOT_EDITABLE_IN_STATE` (com o campo
em `details[]`) quando o estado permite editar, mas não *aquele* campo.

**Por que `running` não aceita nada:** editar cadência no meio de um disparo cria uma janela em que o
tick já leu as configurações antigas e vai gravar com elas. Resolver isso direito custa versionamento
de settings; resolver errado produz envio fora da janela nova. **Pausar primeiro custa um clique e
elimina a classe inteira de bug.** É uma restrição de contorno deliberada, não uma limitação.

**Efeito de cada edição sobre os alvos:**

| Campo | Efeito |
|---|---|
| `audience` (só em `draft`/`scheduled`) | Recalcula do zero: `DELETE` dos alvos `pending` que saíram, `INSERT` dos que entraram, **mantém** os que permaneceram (preserva `createdAt` e não reembaralha a ordem). `totalTargets` é reescrito |
| `templateId` (só em `draft`/`scheduled`) | Nenhum efeito nos alvos. O snapshot só é congelado no `start` (§3.2 regra 5) |
| `instanceIds` | **Adicionar** é sempre seguro. **Remover** uma instância não mexe em alvo nenhum: `CampaignTarget` não é ligado a instância (a instância é escolhida no momento do envio, §6.5). Mensagens já enviadas por ela continuam na timeline. `409 LAST_INSTANCE_REMOVED` se a lista ficar vazia |
| `settings.sendWindow` / `jitterSeconds` / `dailyLimitPerInstance` | Vale a partir do próximo tick. Alvos com `scheduledFor` fora da janela nova são **reagendados** para a próxima abertura, em lote, na mesma transação do `PATCH` |
| `settings.skipRecentlyContactedDays` | Só afeta cálculo de audiência. Em `paused`, **não** reexecuta a exclusão (seria um recálculo surpresa sobre alvos que o operador já conferiu) — só vale se a audiência for reeditada |

**Adicionar leads a uma campanha `running`/`paused` não existe na Fase 4** (§4.5.9). Quem precisa disso
cria uma segunda campanha — o custo é um nome a mais, e o ganho é não ter que testar a interação entre
"audiência crescendo" e "tick consumindo".

#### 4.5.6 `DELETE /api/v1/campaigns/:id`

`204`. **Só em `draft`.** Em qualquer outro estado → `409 CAMPAIGN_NOT_DELETABLE`.

Campanha que já enviou mensagem é registro histórico: os `Message` apontam para `CampaignTarget`
(`onDelete: SetNull`), e apagar a campanha transformaria mensagens reais em órfãs sem contexto. Para
tirar da frente sem apagar, o caminho é `cancel` — que é irreversível e mantém o histórico. Se a lista
ficar poluída, o remédio é filtro na UI, não `DELETE`.

#### 4.5.7 Leitura: lista, detalhe, alvos e progresso

**`GET /api/v1/campaigns`** → `Paginated<CampaignSummary>`. Query: `?status=&q=&cursor=&limit=`.
Índice `(status, createdAt)` já existe. Sem filtro por dono (§0.1).

**`GET /api/v1/campaigns/:id`** → `CampaignDetail` = `CampaignSummary` + `settings` +
`renderedTemplateSnapshot` + `perInstance[]`.

**`GET /api/v1/campaigns/:id/targets`** → `Paginated<CampaignTargetItem>`, `?status=&cursor=&limit=`.
Índice `(campaignId, status)` já existe.

**De onde vem cada número (isto é contrato com o Cronos e com a Íris, não detalhe de implementação):**

| Campo | Origem | Regra |
|---|---|---|
| `stats.total`, `sent`, `delivered`, `read`, `responded`, `failed`, `skipped` | contadores de `Campaign` | **Incrementados.** São contadores de **funil**: um alvo que chegou a `responded` incrementou os quatro. Não são partição — não tente somar para achar o total |
| `stats.pending` | `COUNT(*) WHERE status='pending'` ao vivo | De propósito sem contador: é estado atual, não histórico (comentário do Cronos no schema) |
| `rates.deliveryRate` | `deliveredCount / sentCount` (0 se `sentCount = 0`) | — |
| `rates.responseRate` | `respondedCount / sentCount` | É o número que o §6.2 usa como freio de warmup |
| `nextSendAt` | `MIN(scheduledFor) WHERE status='pending'`, limitado por baixo pelo `nextSendAllowedAt` das instâncias | `null` se não há pendente ou a campanha não está `running`/`scheduled` |
| `perInstance[].sent` / `.failed` | 🆕 **contadores em `CampaignInstance`** — ver §4.5.8 | — |
| `perInstance[].quotaRemaining` | `effectiveDailyLimit(warmupDay, override) − InstanceDailyStat.sentCount` de hoje | Ao vivo. É cota **da instância**, compartilhada entre campanhas e com o envio manual |
| `perInstance[].status` | `deriveInstanceHealth(instance)` | Mesma função da §4.6 — não derivar de novo aqui |

> **Polling (D2):** a tela de campanha faz poll de 3s em `GET /campaigns/:id`, igual à de busca. Não
> introduzir SSE/WebSocket na Fase 4 — a dívida D2 está aceita e o gatilho dela (>50 usuários
> simultâneos) não vai acontecer num produto de uso próprio (§0.1).

#### 4.5.8 🔴 O único campo que falta no schema (pedido formal ao Cronos)

`CampaignDetail.perInstance[].sent` e `.failed` são **"quanto esta instância enviou NESTA campanha"**.
Hoje isso não existe em lugar nenhum:
- `InstanceDailyStat.sentCount` é por instância **por dia**, somando todas as campanhas e o envio manual;
- `Campaign.sentCount` é por campanha, somando todas as instâncias;
- descobrir o cruzamento exige `COUNT(*)` em `Message JOIN CampaignTarget`, a cada poll de 3s, numa
  tabela que cresce para sempre — exatamente o que a invariante "contadores incrementados, nunca
  `COUNT(*)`" existe para impedir.

**Pedido:** `CampaignInstance.sentCount Int @default(0)` e `failedCount Int @default(0)`, incrementados
na mesma transação do `advanceCampaignTargetStatus()` quando o alvo vai para `sent`/`failed`. É a única
adição de coluna que a §4.5 exige. As demais (`nextSendAllowedAt`, `sendsSinceMicroPause`,
`consecutiveUncertain`) são do §6.8 e ficam em `WhatsAppInstance`.

#### 4.5.9 Ações — `POST /api/v1/campaigns/:id/{action}`

| Action | De → Para | Body | Response |
|---|---|---|---|
| `start` | `draft`/`scheduled` → `running` | — | `200 { ok:true, status:'running', firstSendAt }` |
| `pause` | `running` → `paused` | — | `200 { ok:true, status:'paused', pendingTargets }` |
| `resume` | `paused`/`halted` → `running` | `{ acknowledgeHalt?: boolean }` | `200 { ok:true, status:'running' }` |
| `cancel` | `draft`/`scheduled`/`running`/`paused`/`halted` → `cancelled` | — | `200 { ok:true, cancelledTargets }` |

**`start` — a sequência exata, em uma transação:**
1. Transição válida? Senão `409 INVALID_CAMPAIGN_TRANSITION` (com o estado atual em `details[]`).
2. Todas as `instanceIds` estão `connected` e não banidas? Senão `409 INSTANCE_NOT_CONNECTED`, com
   **uma entrada por instância** em `details[]` (`path` = id, `message` = motivo). É a diferença entre
   "conecte um número" e "espere até amanhã".
3. **Validação de conteúdo da 1ª mensagem** (era 5.4, sobe para cá — ver §4.5.10):
   `MISSING_OPTOUT_NOTICE` · `MISSING_COMPANY_NAME`.
4. **Validação de spintax:** `variações < 10` e `alvos > 50` → `409 INSUFFICIENT_TEXT_VARIATION` com a
   mensagem do §6.4. **É bloqueio, não aviso.**
5. `eligible === 0` (todos os alvos já `skipped`) → `409 EMPTY_AUDIENCE`.
6. Congela `renderedTemplateSnapshot` = corpo **do template**, com spintax intacto e variáveis não
   resolvidas. A resolução por alvo acontece no envio (§6.8.4); o texto final de cada um fica em
   `Message.body`.
7. **Segunda passagem de exclusão** (§4.5.2): alvos que viraram opt-out ou foram contatados desde a
   criação → `skipped`, via `advanceCampaignTargetStatus()`.
8. `scheduledFor` de **todos** os alvos `pending` = `firstSendAt` (§6.8.2 explica por que nenhum alvo
   pode ficar com `scheduledFor = NULL` a partir daqui).
9. `status = 'running'`, `startedAt = now()`. Devolve `firstSendAt`.

**`pause`:** `status = 'paused'`. Envio em voo termina (não há como cancelar um `sendText` no meio, e
tentar produziria exatamente o resultado incerto que o §6.8.6 evita). Alvos ficam `pending`.

**`resume`:** de `halted` sem `acknowledgeHalt: true` → `409 HALT_NOT_ACKNOWLEDGED`, com o `haltReason`
em `details[]`. Ao retomar, **limpa `haltReason`** e reagenda os pendentes para a próxima abertura de
janela. Se a causa do halt ainda estiver de pé (instância ainda desconectada), o `start`/`resume`
recusa com o mesmo `INSTANCE_NOT_CONNECTED` — retomar para parar de novo em 30s é pior que recusar.

**`cancel`:** irreversível. Alvos `pending` → `cancelled`? **Não**: o enum de `CampaignTargetStatus` não
tem `cancelled`, e não vai ganhar um valor novo por isto. Os pendentes viram `skipped` com
`skipReason = 'campaign_cancelled'`, e `cancelledTargets` é quantos foram. `skippedCount` sobe.

**O que NÃO entra na Fase 4** (cortado de propósito, para a fase ser entregável):
- **Adicionar/remover leads de campanha viva** — crie outra campanha.
- **Duplicar campanha / reenviar para quem não respondeu** — é a Fase 6, e depende de ter dado real.
- **Agendamento recorrente.** `scheduledFor` é um instante, não um cron.
- **A/B de template.** Precisa de significância estatística para significar algo; não com 50 alvos.
- **Exportar resultado da campanha em CSV.** Já está na Onda 4 junto com `GET /leads/export`.

#### 4.5.10 Tabela consolidada de `reason` das rotas de campanha

Fechada. Todo nome em `MAIÚSCULA_COM_UNDERSCORE` abaixo é valor de `error.reason` (§4.0) — nenhum é
`error.code`, e **a Lyra só ramifica por `reason`**.

| HTTP | `code` | `reason` | Rota |
|---|---|---|---|
| 404 | `NOT_FOUND` | `CAMPAIGN_NOT_FOUND` · `TEMPLATE_NOT_FOUND` · `INSTANCE_NOT_FOUND` | todas |
| 409 | `CONFLICT` | `EMPTY_AUDIENCE` | `POST`, `start` |
| 409 | `CONFLICT` | `AUDIENCE_TOO_LARGE` | `POST`, `PATCH` |
| 409 | `CONFLICT` | `INVALID_CAMPAIGN_TRANSITION` | ações |
| 409 | `CONFLICT` | `INSTANCE_NOT_CONNECTED` | `start`, `resume` |
| 409 | `CONFLICT` | `INSUFFICIENT_TEXT_VARIATION` | `start` |
| 409 | `CONFLICT` | `MISSING_OPTOUT_NOTICE` · `MISSING_COMPANY_NAME` | `start` |
| 409 | `CONFLICT` | `HALT_NOT_ACKNOWLEDGED` | `resume` |
| 409 | `CONFLICT` | `CAMPAIGN_NOT_EDITABLE` · `FIELD_NOT_EDITABLE_IN_STATE` | `PATCH` |
| 409 | `CONFLICT` | `LAST_INSTANCE_REMOVED` | `PATCH` |
| 409 | `CONFLICT` | `CAMPAIGN_NOT_DELETABLE` | `DELETE` |

> **Por que `MISSING_OPTOUT_NOTICE` é erro do `start` e não do envio.** O snapshot é congelado no
> `start` e é **o mesmo para todos os alvos**. Se ele não tem aviso de descadastro, o portão G10 do
> §4.9.3 reprovaria os 430 alvos, um por um, transformando um erro de configuração em 430 falhas.
> Validar uma vez, na hora em que dá para consertar, é a única leitura razoável — e o G10 continua
> rodando no envio como defesa em profundidade, onde agora nunca deve disparar.
>
> **Como validar spintax + variável no `start`:** roda `hasOptOutNotice()` e `hasCompanyNameMention()`
> sobre a **parte fixa** do snapshot — grupos `{a|b}` removidos e `{{minha_empresa}}` resolvido com
> `APP_COMPANY_NAME`. Verificar todas as variações é combinatório; exigir o aviso na parte fixa é
> cheque O(1) e é a regra certa de qualquer jeito: aviso de descadastro que aparece só em 1 de 12
> variações não é aviso.

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
> ⚠️ Este endpoint chama `EvolutionClient.connect` — **SEMPRE (re)inicia o pareamento e emite um QR
> novo a cada chamada**. Buscar UMA vez ao abrir o modal, e de novo só quando o `expiresInSeconds`
> anterior vencer, ou sob pedido manual do operador. **Bug real de produção (2026-09-23):** a versão
> anterior desta nota dizia para a Lyra fazer poll de 2s aqui — isso invalidava o QR antes de dar tempo
> de escanear e ninguém conseguia conectar. Para saber a hora de fechar o modal, sonde
> `GET .../status` abaixo, não este.

#### `GET /api/v1/whatsapp/instances/:id/status`
`200` → `{ status: 'disconnected'|'connecting'|'qr_pending'|'connected'|'banned' }`.
`502 UPSTREAM_ERROR` se a Evolution API não responder.
> Leitura PURA (`EvolutionClient.getConnectionState`) — nunca reinicia o pareamento nem emite QR novo.
> **Lyra:** poll de 2s neste endpoint enquanto o modal do QR estiver aberto, só para detectar
> `status: 'connected'` e fechar o modal. Nunca chamar `.../qr` neste intervalo.

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
- Validação adicional: header `apikey` conferido em tempo constante. 🆕 Correção 2026-09-23 (webhook mudo em
  produção — a v2 da Evolution dá uma `apikey` PRÓPRIA por instância, distinta da global do servidor): a
  chave esperada aceita DUAS candidatas — a credencial própria da instância (`WhatsAppInstance.
  instanceApiKey*`, quando capturada) E a do `EvolutionServer`/`EVOLUTION_API_KEY` (fallback legado, Fase
  4.B) — nunca escolhe uma só, ver `lib/services/webhook.ts#resolveExpectedWebhookApiKeys`.
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

> 🔧 **O bloco acima é o desenho da v1.1. O arquivo real já divergiu dele três vezes, e as três
> divergências são melhorias — o documento é que estava atrasado:**
> 1. `facts.companyName: string | null` (adição do Vega). G10 não é verificável sem saber *qual* nome
>    procurar no texto; sem o campo a checagem adivinharia, o que é pior que declarar a dependência.
>    `packages/core` continua sem ler `process.env` — quem lê `APP_COMPANY_NAME` é o serviço.
> 2. `MAX_DECISION_TO_SEND_MS` (5s) — teto entre o veredito e a chamada de rede, medido **pelo
>    chamador**, não pelo guard. O carimbo do opt-out protege a leitura até a decisão; este protege a
>    decisão até o envio, que é o intervalo que a transação de write-ahead pode esticar.
> 3. `EvaluateSendGuardOptions` (`windowConfig`, `duplicateWindowMs`, `optOutMaxAgeMs`) — é o que
>    permite ao `dispatch-tick` passar a janela **da campanha** sem reimplementar nada (§6.8.3).
>
> **Adições da v1.2, detalhadas no §4.9.10:** `facts.lastInboundAt`,
> `facts.instance.nextSendAllowedAt`, `facts.overrides.ignorePaceLock`, e os `reason`
> `SEND_PACE_LOCKED` e `LEAD_CONTACT_COOLDOWN`.

O carimbo `optOut.checkedAt` converte uma regra de disciplina em **falha de runtime**: um chamador
que cachear a blacklist, ou que ler o opt-out no começo de uma função longa e enviar 3 segundos
depois, quebra em execução — não passa despercebido numa revisão de código. É o mesmo truque que o
`buildMachineUpdate()` usa para proteger dado humano no scraper, e que funcionou melhor do que a
regra escrita que eu tinha especificado. **Não substituir por um comentário `// não cachear`.**

Invariantes que o Órion verifica (§4.9.9): `evaluateSendGuard` é chamado **na mesma função** que
chama `sendText`. Entre a consulta de opt-out e o guard não há nenhum `await`. Entre o guard e o
`sendText` **não há nenhuma LEITURA adicional** (em particular, nenhuma segunda consulta de opt-out);
a única escrita permitida no intervalo é a transação de write-ahead do §4.9.5, que precisa ser rápida,
tem teto de tempo e não pode reabrir a decisão.

> Correção de 2026-09-22. A redação anterior dizia "sem nenhum `await` de I/O entre os dois", o que
> contradizia a §4.9.5: o write-ahead **obriga** uma escrita nesse intervalo, para a cota não se perder
> se o processo cair entre a reserva e o envio. O Órion julgou que o invariante protege a decisão de
> opt-out ser fresca, e isso a escrita não afeta, porque ela reserva cota e não relê a blacklist.
> Zero I/O entre decisão e rede é impossível para qualquer implementação real, porque o próprio
> `sendText` já é I/O.

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
| 409 | `CONFLICT` | 🆕 `LEAD_CONTACT_COOLDOWN` | 2º contato frio em 24h para quem nunca respondeu (§4.9.10) | informa quando libera; **não** oferece forçar |
| 409 | `CONFLICT` | 🆕 `SEND_PACE_LOCKED` | o número ainda está no intervalo do envio anterior (§4.9.10) | mostra o contador até `nextSendAllowedAt`; botão volta a habilitar sozinho |
| 409 | `CONFLICT` | `MISSING_OPTOUT_NOTICE` · `MISSING_COMPANY_NAME` | 1º contato frio sem saída fácil / sem remetente | leva ao editor do template |
| 429 | `RATE_LIMITED` | `MANUAL_SEND_RATE_LIMIT` | > `MANUAL_SEND_RATE_PER_MIN` por usuário | "aguarde" |
| 502 | `UPSTREAM_ERROR` | `EVOLUTION_*` (§4.9.5) | falha do provedor | "tente de novo"; a mensagem fica `failed` na timeline |

> 🔧 **Correção v1.2.** A v1.1 dizia aqui: "`DAILY_LIMIT_REACHED`, `QUIET_HOURS` e `OPTED_OUT` incluem
> `meta` útil em `details[]` (`resetsAt`, `nextWindowOpensAt`, `optedOutAt`)". Três coisas estavam
> erradas, e a §4.0 (v1.2) fecha a convenção: (a) **não existe campo `meta` no envelope** — o mapa do
> guard é achatado em `details[]` com `path` = nome da chave; (b) `resetsAt` e `optedOutAt` **não
> existem** em lugar nenhum (o guard nunca os produziu, e `OPTED_OUT` é terminal — não precisa de
> metadado, precisa de texto claro); (c) hoje o serviço só propaga `meta` de `QUIET_HOURS` e
> `OUTSIDE_BUSINESS_WINDOW`, descartando o de `DAILY_LIMIT_REACHED` (`dailyLimit`, `sentToday`),
> `LEAD_NOT_MOBILE` (`phoneType`), `INSTANCE_NOT_CONNECTED` (`status`) e `DUPLICATE_SEND`
> (`lastOutboundAt`), que o guard já devolve.
>
> **Regra que passa a valer:** sempre que `verdict.meta` existir, propagar **inteiro** para
> `details[]`. Nada de lista de `reason` privilegiados — a lista é o que envelhece quando entra um
> `reason` novo (e a v1.2 acabou de entrar com dois: `SEND_PACE_LOCKED`, `LEAD_CONTACT_COOLDOWN`).
> `SEND_PACE_LOCKED` traz `nextSendAllowedAt`; `LEAD_CONTACT_COOLDOWN` traz `lastOutboundAt` e
> `cooldownUntil` — sem eles a UI só sabe dizer "não deu".

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

#### 4.9.10 🆕 v1.2 — Cadência do manual × cadência da campanha (achado do Órion, 2026-09-22)

**O achado.** O endpoint unitário não tem jitter nem intervalo mínimo por instância. Ele tem três
controles — anti-duplo-clique de 60s **por lead** (G9), `MANUAL_SEND_RATE_PER_MIN` **por usuário** e
cota diária **por instância** (G8) — e nenhum deles impede o que interessa: um script autenticado
percorrendo 300 leads diferentes, um por um, dispara em ritmo de campanha **sem nenhum dos controles
de cadência do §6.3**. Fica dentro da cota diária e fora de qualquer intervalo mínimo. Severidade
média, e legítima: é literalmente o comportamento que o warmup existe para impedir.

**Decisão: cadência é propriedade do NÚMERO, não do chamador.**

Esse é o ponto que eu tinha errado ao desenhar dois caminhos. Eu estava tratando ritmo como atributo
de *quem chama* (manual é humano, logo é lento; campanha é robô, logo precisa de freio). Do lado do
WhatsApp isso não existe: o que ele observa é a **taxa de emissão de um número**. Dois caminhos
disciplinados separadamente somam, e a soma não tem dono.

**O mecanismo — um gate, uma coluna:** `WhatsAppInstance.nextSendAllowedAt DateTime?` (pedido ao
Cronos no §6.8.1). **Todo** envio bem-sucedido por aquela instância, venha de onde vier, empurra o
gate para frente com o jitter log-normal do §6.3.

Por que Postgres e não Redis: o Redis é volátil por desenho neste projeto, e um gate de cadência que
se perde no restart produz **rajada logo depois de um incidente** — o pior momento possível. É o
mesmo raciocínio que já fez `InstanceDailyStat` ser tabela e não contador em memória.

**As duas cadências, e como conversam:**

| Caminho | Respeita o gate? | Empurra o gate? | Racional |
|---|---|---|---|
| `dispatch-tick` (campanha) | **Sim, sempre.** Se `now < nextSendAllowedAt`, a instância simplesmente não é elegível neste tick | Sim, com jitter cheio | É o caso de uso para o qual o freio foi desenhado |
| Manual, **1º contato frio** (`isColdFirstContact === true`) | **Sim.** `409 CONFLICT` / `reason: SEND_PACE_LOCKED`, com `nextSendAllowedAt` em `details[]` | Sim, com jitter cheio | É exatamente o abuso que o Órion descreveu. Prospecção fria é prospecção fria, tenha ou não uma campanha em volta |
| Manual, **resposta em conversa aberta** (`isColdFirstContact === false`) | **Não** — `overrides.ignorePaceLock: true` | Sim, com o **piso** do jitter (`jitterSeconds.min`) | Responder alguém que escreveu primeiro é o tráfego menos parecido com bot que existe. Bloquear isso seria fazer o produto atrapalhar o trabalho que ele deveria acelerar. Mas a mensagem **sai pelo mesmo número**, então ela adia o próximo envio da campanha — o número não emite duas coisas ao mesmo tempo |

**Onde a regra mora: dentro do guard puro, não no chamador.** `evaluateSendGuard` ganha o override
`ignorePaceLock`, e **ele mesmo o anula quando `isColdFirstContact === true`**:

```ts
// packages/core/src/whatsapp/send-guard.ts — adições da v1.2
facts.lastInboundAt: Date | null;                    // 🆕 alimenta G9b
facts.instance.nextSendAllowedAt: Date | null;       // 🆕 alimenta G9c
facts.overrides.ignorePaceLock: boolean;             // 🆕 — ignorado se isColdFirstContact

// novos valores de SendBlockReason:
| 'SEND_PACE_LOCKED'          // G9c — o número ainda está no intervalo do envio anterior
| 'LEAD_CONTACT_COOLDOWN'     // G9b — 2º contato frio para quem nunca respondeu
```

Se a checagem ficasse no serviço, existiriam duas implementações da mesma política em duas semanas —
que é a coisa que o §4.9.9 item 5 existe para impedir. O `ignorePaceLock` entra no guard **e o guard
decide quando ele vale**: um chamador não consegue liberar o gate para um contato frio nem mentindo.

**G9b — `LEAD_CONTACT_COOLDOWN`, o "limite por lead" que o Órion pediu.** G9 (60s) impede duplo
clique; não impede insistir. Regra: **se o lead nunca respondeu (`lastInboundAt === null`) e já houve
outbound nas últimas `COLD_FOLLOWUP_COOLDOWN_H` (default 24h), bloqueia.** Segunda abordagem fria no
mesmo dia para quem não respondeu é o padrão que produz denúncia, e a denúncia derruba o número.
Simétrico ao `skipRecentlyContactedDays` da campanha (default 30 dias): no manual o teto é mais
frouxo, porque o operador tem contexto que o motor não tem — mas não é ilimitado.

**Portões atualizados (substitui a tabela do §4.9.3 nas linhas G9 em diante):**

| # | Portão | Falha → | `reason` | Manual | Campanha |
|---|---|---|---|---|---|
| G9 | Anti-duplo-clique (60s, mesmo lead) | 409 | `DUPLICATE_SEND` | ✅ | ✅ |
| G9b 🆕 | Cooldown de contato frio sem resposta (24h) | 409 | `LEAD_CONTACT_COOLDOWN` | ✅ | ✅ (vira `skipped/recently_contacted`) |
| G9c 🆕 | Gate de cadência da instância | 409 | `SEND_PACE_LOCKED` | ✅ salvo resposta em conversa | ✅ (não vira erro: a instância só não é elegível) |
| G10 | 1º contato frio: aviso + remetente | 409 | `MISSING_OPTOUT_NOTICE` · `MISSING_COMPANY_NAME` | ✅ | ✅ (validado no `start`, §4.5.10) |
| G11 | 🔴 OPT-OUT | 409 | `OPTED_OUT` | ✅ | ✅ (vira `skipped/opted_out`) |

**`warnings[]` novo:** `PACE_LOCK_BYPASSED_FOR_REPLY` — a resposta saiu antes do intervalo porque é
conversa aberta. Não bloqueia; existe para o desvio ficar **visível** no log e na tela, como toda
confirmação do §4.9.6. Desvio autorizado é aceitável; desvio invisível não.

### 4.10 Fila de disparo — pausa global (🔒 CONTRATO — 🆕 v1.2)

Espelho exato de `/api/v1/scraper/queue`, aplicado à fila `dispatch-tick`. Existe porque o operador
precisa de **um** botão que para todo o disparo num incidente, e não há terminal confiável (§0). O
motivo e a diferença entre esta pausa, `paused` e `halted` estão no §6.8.9.

#### `GET /api/v1/dispatch/queue`
`200` → `{ paused: boolean, pausedAt: string | null, pausedBy: string | null, reason: string | null,
runningCampaigns: number, pendingTargets: number, lastTickAt: string | null }`

`lastTickAt` é o heartbeat do motor (§6.8.8): sem ele, "nenhuma mensagem saiu hoje" e "o worker está
morto" são a mesma tela.

#### `POST /api/v1/dispatch/queue` — pausa
`{ reason?: string }` → `200 { ok: true, paused: true, pausedAt }`

#### `POST /api/v1/dispatch/queue/resume`
`200 { ok: true, paused: false, resumedTargets: number }`

Estado **persistido** (não `setTimeout` em memória — lição já paga na Onda 1). Nenhuma campanha muda
de status: elas seguem `running` e voltam de onde pararam. Papel: `operator` pausa, `operator` retoma.

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
  scrapeSearch: 'scrape-search',     // 1 job = 1 SearchTask (1 município)
  dispatchTick: 'dispatch-tick',
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
| **A1** | **Zero-streak** | As últimas **5** tasks concluídas retornaram `resultCount === 0` | `critical` | **Pausa a fila `scrape-search`**, cria `ScraperHealthEvent`, alerta |
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
    T["⏱️ dispatch-tick<br/>(job repetível, ~a cada 30s)"] --> A{"Campanha<br/>running?"}
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
>
> **v1.2 — a frase acima fica ainda mais simples: a campanha não sobrescreve nada.** Com o override
> `ignorePaceLock` da §4.9.10, são três, e o `dispatch-tick` passa os três em `false`:
> ```ts
> overrides: { allowNonMobile: false, confirmOutsideBusinessWindow: false, ignorePaceLock: false }
> ```
> A regra de leitura fica: **`overrides` é o vocabulário do envio manual; no motor, todo override é
> `false`.** Se um dia alguém precisar ligar um deles no worker, não é ajuste de configuração — é
> mudança de arquitetura e passa por aqui.
>
> O que a campanha acrescenta, e que o guard **não** faz, é traduzir o veredito em estado do alvo:
> `{ allow: false, reason }` vira `skipped`/`pending reagendado`/`halt` conforme a tabela do §6.8.5.
> Essa tradução é do worker, porque depende de `CampaignTarget`, que o `packages/core` não conhece.
>
> O fluxograma acima também está desatualizado em dois pontos, corrigidos no §6.8 (que manda):
> `retry c/ backoff (máx 3)` **não existe mais** para envio — `sendText` nunca é retentado
> (§6.8.6), e o desenho não previa o resultado **incerto**.

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
| Jitter entre envios | 45–180s, distribuição não-uniforme | sim (mín. 30s) | Intervalo constante é a assinatura de bot mais óbvia. **v1.2:** o jitter é materializado em `WhatsAppInstance.nextSendAllowedAt` (§6.8.7) — é um gate da INSTÂNCIA, compartilhado com o envio manual (§4.9.10), não um `sleep` dentro do job |
| Micro-pausa | 5–12min a cada 18–25 envios | sim, via env (§10) | Simula atendimento em lotes. **v1.2:** é o mesmo gate com outra distribuição, contado por `sendsSinceMicroPause` — não é um mecanismo separado |
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

> **v1.2 — o que entra na Fase 4 desta tabela, e o gatilho que faltava.** As linhas de webhook
> (`connection.update`) e a de ≥5 falhas consecutivas **já existem em produção** desde o envio
> unitário. Das linhas de `health-check`, só "Evolution fora do ar (3x)" e "taxa de falha > 30% em 50
> envios" entram na Fase 4; as duas heurísticas de shadow-ban ficam para depois, pelo critério do
> §6.9. E acrescenta-se um gatilho que a v1.1 não tinha como prever, porque o resultado **incerto** não
> existia: **≥3 incertos consecutivos → instância fora da rotação + alerta `high`; ≥5 → `halt`**
> (§6.8.6). É o único gatilho da tabela que dispara sem nenhuma falha confirmada — e é de propósito:
> não saber o que saiu é motivo suficiente para parar.

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

### 6.8 🆕 v1.2 — `dispatch-tick.job` ponta a ponta (🔒 CONTRATO — Vega implementa)

O §6.1 desenha a intenção. Esta seção é a especificação executável: o que o job lê, em que ordem, com
qual transação, e o que faz com **cada** resultado possível. Ela existe porque a v1.1 deixou o motor
como fluxograma, e fluxograma não responde "o que acontece se o processo morrer entre a reserva e o
envio" — que é a pergunta que decide se um lead recebe a mensagem duas vezes.

#### 6.8.0 🆕 v1.3 — Onde o envio mora (🔒 CONTRATO — Vega implementa antes de qualquer tick)

A v1.2 escreveu "o worker envia" sem dizer **com qual código**. O código que envia existe, está em
produção e está em `apps/web/src/lib/services/messages.ts` — do outro lado de uma fronteira que
`apps/worker` não pode atravessar (§2: só `packages/*` são compartilhados). Esta seção é a resposta,
e ela vem antes das outras porque nada em §6.8.2–§6.8.9 é implementável sem ela.

##### 6.8.0.1 O que `sendLeadMessage` realmente é

Ela parece uma função de rota e não é. Dentro dela convivem seis coisas com naturezas diferentes:

| Bloco | Natureza | Destino |
|---|---|---|
| Rate limit por usuário, `templateId` XOR `body`, envelope da resposta | fronteira HTTP | **fica em `apps/web`** |
| Resolução de instância (afinidade → maior cota restante) | política **do chamador** — o motor usa round-robin ponderado (§6.8.4), que é outra política | **fica em cada app** |
| Render do texto (template/snapshot + variáveis + spintax) | puro | **`packages/core`** |
| Leitura de opt-out → `evaluateSendGuard` → write-ahead → `sendText` → classificação → contabilidade → avanço do gate | **a sequência protegida** | 🔒 **`packages/sending`** |
| Tradução do veredito em `409/502` com `details[]` | vocabulário HTTP | **fica em `apps/web`** |
| Tradução do veredito em estado do alvo (§6.8.5) | vocabulário de campanha | **nasce no worker** |

**O corte cai exatamente onde o comentário do topo de `messages.ts` já cortava.** O arquivo declara um
invariante auditável ("entre a consulta de opt-out e `evaluateSendGuard` não há nenhum `await`; entre
o guard e `sendText` só existe a transação de write-ahead"). Esse invariante é uma propriedade de um
trecho contíguo de código — e é justamente esse trecho que vira o pacote. Não estou inventando uma
fronteira: estou promovendo a que já estava escrita em prosa a fronteira de módulo.

##### 6.8.0.2 A única mudança de forma: resultado em vez de exceção

`packages/sending` **não lança `ApiHttpError`**. `executeSendAttempt` devolve uma união discriminada:

```ts
type SendAttemptResult =
  | { outcome: 'blocked';   verdict: BlockedVerdict; optOutCreatedAt: Date | null }
  | { outcome: 'expired';   messageId: string }            // decisão venceu; reserva revertida
  | { outcome: 'sent';      messageId; providerMessageId; sentAt; pace; warnings }
  | { outcome: 'failed';    messageId; code: MessagingErrorCode; reason: string }
  | { outcome: 'uncertain'; messageId; code: MessagingErrorCode; reason: 'EVOLUTION_SEND_UNCERTAIN' }
```

Por que isto e não deixar o pacote lançar o erro de HTTP: um erro de HTTP é uma resposta a **um
pedido de um humano**. O motor não tem pedido nem humano — para ele, `409 SEND_PACE_LOCKED` não é um
erro, é a instrução "reagende este alvo para as 14h37". Fazer o worker aprender a ler status HTTP
para descobrir o que fazer com um alvo é control flow por exceção atravessando um processo que nem
HTTP fala. A união discriminada dá a mesma informação e obriga o `switch` a ser exaustivo dos dois
lados — se um `outcome` novo nascer, os dois chamadores param de compilar, que é o comportamento que
se quer de uma decisão que custa o número do dono.

`apps/web` mantém `throwForBlockedVerdict` e `mapSendErrorToApiError` **sem uma linha alterada**,
chamadas agora sobre o resultado devolvido. A superfície HTTP do §4.9 não muda em nada.

##### 6.8.0.3 Portas injetadas — e por que só duas

`executeSendAttempt(deps, input)` recebe `deps = { prisma, evolutionClient, logger, notify, now?, rng? }`.

- `prisma` vem de `@inno/db` nos dois lados (mesmo singleton) — poderia ser importado direto; entra
  como porta só para o teste poder passar o fake que `messages.test.ts` já tem.
- `logger` e `notify` **precisam** ser portas: `apps/web` e `apps/worker` já têm implementações
  próprias e **deliberadamente duplicadas** de log e alerta (uma com `console` JSON por causa do
  bundle do Next, outra com `pino`), com vocabulários de evento diferentes. Unificá-las agora é uma
  refatoração que não tem nada a ver com o motor.
- `now`/`rng` existem para a Íris testar distribuição de jitter e expiração de decisão sem relógio real.

Nada além disso é injetado. Toda porta a mais é um lugar onde os dois apps podem se comportar
diferente — que é exatamente o que este desenho existe para impedir.

##### 6.8.0.4 O que **não** pode ser reescrito no worker, item a item

Cada linha abaixo é uma duplicação plausível e o estrago específico que ela causa. Esta tabela é o
roteiro de revisão do Órion na 4.H:

| Se for duplicado | O que quebra, e quando se descobre |
|---|---|
| `advanceNextSendAllowedAt` (o `UPDATE ... WHERE nextSendAllowedAt < $novo`) | O motor é **o segundo escritor concorrente** que essa correção previu. Uma cópia sem a cláusula `WHERE` faz o gate anti-ban **recuar** quando um envio manual e um tick se cruzam. Não dá erro, não dá log: só sai uma rajada |
| Write-ahead + compensação de cota | Cota conta diferente nos dois caminhos → o teto de warmup é furado sem ninguém ver. É o modo de falha que o §6.2 inteiro existe para impedir |
| `EVOLUTION_ERROR_EFFECT` (falha confirmada × incerto) | Uma cópia que classifique `TIMEOUT` como retentável manda a **mesma abordagem duas vezes** para a mesma pessoa. É o pior resultado possível deste sistema (§6.8.6) |
| `advanceCampaignTargetStatus` | Contador de campanha dessincroniza no dia 1 — a regra que o Cronos pediu por escrito |
| A chave do dia da cota (`todayDateKey`) | Web e worker em fusos diferentes = **duas linhas de `InstanceDailyStat` por dia** = teto diário dobrado em silêncio |
| Os `*FromEnv` (clamps de janela, piso de jitter de 30s, micro-pausa, cooldown) | Uma cópia sem o clamp manda às 3h da manhã ou com 5s de intervalo. Os clamps **são** a regra; a env é só o parâmetro |

##### 6.8.0.5 Alternativas descartadas (e o que cada uma tinha de bom)

1. **Worker chama `POST /api/v1/leads/:id/messages` do `web`.** É a opção mais barata hoje: zero
   refatoração, uma implementação só, e funciona. Descartada por três motivos, em ordem de peso:
   (a) um restart/deploy do `web` no meio de uma campanha devolve erro de rede ao worker, e erro de
   rede no envio é **incerto** por definição (§6.8.6) — o alvo morre `failed`, a cota não volta e
   ninguém sabe se a mensagem saiu. Estaríamos **fabricando o pior caso do sistema em todo deploy**;
   (b) a rota exige sessão Auth.js — seria preciso criar uma credencial de serviço com poder de
   enviar, superfície nova que hoje não existe; (c) a rota tem rate limit por usuário
   (`MANUAL_SEND_RATE_PER_MIN`, 10/min), desenhado para um humano clicando: o motor seria estrangulado
   por um limite que não é sobre ele. Some-se a isso a regra de §2 ("web e worker não se chamam por
   HTTP") — que existe para o sistema continuar funcionando com um dos dois processos fora do ar.
2. **Mover `sendLeadMessage` inteira, inclusive o `ApiHttpError`, para o pacote.** Descartada porque
   `api-handler.ts` importa `next/server` e Auth.js: arrastar isso para `packages/*` coloca o Next no
   bundle do worker. A variante barata dessa ideia — mover só a classe `ApiHttpError` para
   `@inno/contracts` — foi considerada e descartada por §6.8.0.2: o worker passaria a ler status HTTP
   para decidir o destino de um alvo.
3. **Duplicar no worker e garantir a paridade com uma suíte de testes de contrato.** Descartada por
   histórico próprio: este projeto já tem quatro funções puras, testadas e sem chamador, e três cópias
   de `buildLeadTemplateValues`. Testes provam que as duas cópias concordam **hoje**; nada segura a
   terceira correção feita com pressa só de um lado. E a divergência é silenciosa (tabela acima).
4. **Rodar o motor dentro do `apps/web`** (rota de cron ou `setInterval`). Descartada: o worker já
   tem selftest de boot, heartbeat, pausa persistida e BullMQ. Apostar o gate anti-ban no ciclo de
   vida de um processo Next é trocar infraestrutura pronta por economia de import.
5. **Extrair só o miolo (opt-out → `sendText`) e deixar contadores de campanha em cada app.**
   Descartada por atomicidade: o status do alvo e `CampaignInstance.sentCount|failedCount` são
   escritos **na mesma transação** do resultado do envio. Separá-los significa duas transações — a
   janela exata que a regra do Cronos proíbe.

##### 6.8.0.6 Custo de mexer no que está em produção, e como não quebrar

`messages.ts` está em produção, auditado, e coberto por `messages.test.ts` (817 linhas, Prisma falso
local, `@inno/core` real). Esse teste é o que torna a extração segura, e ele define o critério:

> 🔒 **A extração é feita com zero mudança de comportamento, e `messages.test.ts` passa sem nenhuma
> alteração além de caminho de import.** Se o teste precisar ser "ajustado" para passar, a extração
> mudou comportamento e deve ser refeita — não reajustada.

Duas armadilhas de empacotamento, ambas com incidente real no histórico (§2, `tsup.config.ts`):

- **Worker:** `@inno/sending` precisa entrar nas `dependencies` de `apps/worker` **e** no
  `noExternal` do `tsup`. Fora do `noExternal`, o bundle mantém `import '@inno/sending'`, o Node
  resolve para o `.ts` fonte via symlink do pnpm e o processo morre no boot com
  `ERR_UNKNOWN_FILE_EXTENSION` — o mesmo erro de 22/09. `@inno/db` **continua external** (o engine
  nativo do Prisma é resolvido por `__dirname` do arquivo gerado): `@inno/sending` embutido
  importando `@inno/db` external é exatamente o arranjo que já funciona hoje.
- **Web:** acrescentar `@inno/sending` a `transpilePackages` no `next.config.ts`. Não assumir que
  funciona sem isso porque `@inno/messaging` funciona — isso é observação, não garantia.

**Nada disso se prova com `typecheck`, `lint` ou `build`.** Os cinco incidentes de 22–23/09 passaram
pelos quatro e só apareceram no boot do container. Por isso a fiação é o **passo 0** da 4.F, com
prova via `selftest` (§8), antes de existir uma linha do tick.

#### 6.8.1 Estado que precisa estar no Postgres (pedido ao Cronos)

Cadência é estado, e estado de cadência **não pode viver no Redis**: se ele se perde num restart, o
número volta emitindo em rajada logo depois do incidente — o pior momento possível. Três colunas em
`WhatsAppInstance`:

| Coluna | Tipo | Para quê |
|---|---|---|
| `nextSendAllowedAt` | `DateTime?` | O gate único de cadência (§4.9.10). Honrado pelo manual e pela campanha |
| `sendsSinceMicroPause` | `Int @default(0)` | Conta envios desde a última micro-pausa (§6.3). Sem isso a micro-pausa some no restart, que é quando ela mais importa |
| `consecutiveUncertain` | `Int @default(0)` | Distinto de `consecutiveFailures`: incerto **não é falha** e não pode punir a instância pelo mesmo caminho (§6.8.6) |

Mais `CampaignInstance.sentCount` / `failedCount` (§4.5.8). **Nenhuma outra migração é necessária** —
o índice do hot path, os contadores de funil e o `Message.campaignTargetId @unique` já existem.

#### 6.8.2 Seleção do alvo — `FOR UPDATE SKIP LOCKED` e o lease

```sql
-- dentro da transação de claim
SELECT id, "leadId", "phoneE164", attempt
  FROM campaign_targets
 WHERE "campaignId" = $1
   AND status = 'pending'
   AND "scheduledFor" <= now()
 ORDER BY "scheduledFor"
   FOR UPDATE SKIP LOCKED
 LIMIT 1;
```

**Duas decisões escondidas nessa query, e ambas são armadilha se erradas:**

1. **`scheduledFor` nunca é `NULL` a partir do `start`** (§4.5.9 passo 8). Parece detalhe e não é: em
   Postgres, `ORDER BY col ASC` é `NULLS LAST` por padrão, e é assim que o índice
   `(campaignId, status, scheduledFor)` está construído. Escrever `ORDER BY "scheduledFor" NULLS FIRST`
   para "pegar primeiro os sem agendamento" faz o planner **abandonar o índice** e varrer a tabela a
   cada 15 segundos. Preencher `scheduledFor` no `start` custa um `UPDATE` e elimina a questão.
2. **Não existe status `sending`.** Acrescentar um valor ao enum `CampaignTargetStatus` propagaria
   para os contratos, para a UI e para os filtros de `GET /targets` — caro por uma necessidade
   interna do worker. Em vez disso, **lease**: na mesma transação do `SELECT`, o alvo continua
   `pending` mas leva `scheduledFor = now() + DISPATCH_LEASE_S` (default 120s) e `attempt += 1`.

**O lease dá três coisas de graça:** dois workers nunca pegam o mesmo alvo (o `SKIP LOCKED` resolve o
instante; o lease resolve o minuto seguinte); se o processo morrer no meio, o alvo volta a ser
elegível sozinho depois do lease — **sem job de resgate**; e `attempt` passa a ser o contador natural
de tentativas, com `DISPATCH_MAX_ATTEMPTS` (default 3) virando `failed` / `skipReason='max_attempts'`
no claim seguinte.

> 🔒 **A garantia dura contra envio duplicado não é o lease — é `Message.campaignTargetId @unique`.**
> O write-ahead insere um `Message` amarrado ao alvo; um segundo write-ahead para o mesmo alvo
> **viola o índice único e a transação aborta**, aconteça o que acontecer com locks, leases e
> restarts. O lease é performance; o `@unique` é correção. É essa coluna que fecha o risco R7, e é
> por isso que a resposta a "e se o worker reiniciar no meio?" é curta.

#### 6.8.3 O tick, passo a passo

Job repetível BullMQ na fila `dispatch-tick` (já reservada em `apps/worker/src/queues.ts`), a cada
`DISPATCH_TICK_INTERVAL_S` (default 15s), **concorrência 1**. Um tick:

```
 1. Pausa global da fila ligada?  ─→ encerra (§6.8.9)
 2. Para cada Campaign status='running', ordenada por startedAt:
 2.1  Janela da campanha aberta agora?
        não → reagenda os pendentes para a próxima abertura; próxima campanha
 2.2  Monta a lista de instâncias ELEGÍVEIS:
        status='connected' · não banida · quota restante > 0 · nextSendAllowedAt <= now
        vazia, e a causa é quota/gate  → nada a fazer neste tick
        vazia, e a causa é conexão     → 🔴 halt (§6.6) + alerta
 2.3  Repete, até (a) acabarem alvos elegíveis ou (b) acabarem instâncias elegíveis:
        a) claim de 1 alvo (lease, §6.8.2)
        b) resolve a instância: AFINIDADE primeiro, senão round-robin ponderado (§6.8.4)
        c) renderiza o texto (snapshot + variáveis do lead + spintax semeado por targetId)
        d) SELECT de opt-out por phoneE164  ← sem nada entre isto e o passo (e)
        e) evaluateSendGuard(facts, { windowConfig: janela da campanha })
             allow:false → traduz pela tabela do §6.8.5 e volta para (a)
        f) write-ahead: Message(queued) + InstanceDailyStat.sentCount+1     [transação]
        g) EvolutionClient.sendText()   ← teto de MAX_DECISION_TO_SEND_MS desde (e)
        h) trata o resultado pelo §6.8.6                                    [transação]
        i) empurra o gate: nextSendAllowedAt = now + jitter (§6.8.7)
 3. Campanha sem nenhum alvo 'pending' restante → status='completed', finishedAt=now
```

**Por que um tick de 15s e não um job por mensagem agendado no futuro.** Agendar 5.000 jobs BullMQ com
`delay` calculado no `start` coloca a cadência dentro do Redis (volátil) e congela decisões que
mudam: cota, janela, instância caindo, opt-out. O tick relê o mundo a cada 15s e é **reconstruível a
partir do Postgres** — coerente com "Redis é volátil por design, Postgres é a verdade" (§1.3).

**Por que concorrência 1.** Um único processo worker, poucos milhares de mensagens/dia e um gate por
instância que já serializa o que importa. Concorrência >1 traria contenção no mesmo gate sem ganho de
vazão. `SKIP LOCKED` continua no lugar porque ele protege contra o caso real que **vai** acontecer:
duas instâncias do worker no ar durante um deploy.

**Teto por tick:** no máximo uma mensagem por instância elegível por tick. Com jitter mínimo de 30s e
tick de 15s, o gate é sempre o limitante — o teto existe só para um tick não virar laço longo.

#### 6.8.4 Escolha de instância, rotação e afinidade

**Ordem deliberada: primeiro o alvo, depois a instância.** O inverso (escolher instância e depois
buscar alvo) impede honrar a afinidade lead→instância, que depende de *qual lead* saiu da fila.

1. **Afinidade** (§6.5): se o lead já trocou mensagem (qualquer direção) com uma instância desta
   campanha, e ela está elegível **agora**, é ela. Trocar de número no meio de uma conversa confunde o
   prospect e parece spam.
2. Senão, **round-robin ponderado**: peso = `quotaRestante × (isDegraded ? 0.3 : 1)`, sorteio
   proporcional. Ponderar pela cota restante distribui naturalmente sem precisar guardar "de quem era
   a vez" — um estado a menos para dessincronizar.
3. Nenhuma elegível depois do claim: **solta o alvo** (`scheduledFor` = o menor `nextSendAllowedAt`
   entre as instâncias, ou a próxima abertura de janela) e encerra o loop desta campanha.

**Renderização:** `renderedTemplateSnapshot` (congelado no `start`) + variáveis do `CampaignTarget`/
`Lead` + spintax com semente **`campaignTargetId`** (§6.4). Semente por alvo, não por envio: se o
mesmo alvo for renderizado duas vezes, sai o mesmo texto. Duas versões da mesma mensagem chegando à
mesma pessoa é pior que nenhuma.

#### 6.8.5 🔒 Tradução do veredito do guard em estado do alvo

Esta tabela é o contrato que faltava. O guard devolve `reason`; o worker traduz. **Sem essa tabela,
cada `reason` novo vira uma decisão improvisada dentro do job.**

| `reason` do guard | Alvo vira | `skipReason` | Contador | Por quê |
|---|---|---|---|---|
| `OPTED_OUT` | `skipped` | `opted_out` | `skippedCount` | Terminal. Nunca reagendar |
| `LEAD_NOT_MOBILE` | `skipped` | `landline` | `skippedCount` | Não muda com o tempo |
| `LEAD_CONTACT_COOLDOWN` | `skipped` | `recently_contacted` | `skippedCount` | Se entrou aqui, outro caminho falou com o lead. Reagendar seria insistir |
| `DUPLICATE_SEND` | `skipped` | `recently_contacted` | `skippedCount` | Idem — e em 60s não há o que esperar num motor de cadência de minutos |
| `QUIET_HOURS` · `OUTSIDE_BUSINESS_WINDOW` | volta a `pending` | — | — | `scheduledFor` = próxima abertura. É espera, não recusa |
| `DAILY_LIMIT_REACHED` | volta a `pending` | — | — | `scheduledFor` = amanhã na abertura; **a instância sai da rotação até a virada do dia** |
| `SEND_PACE_LOCKED` | volta a `pending` | — | — | `scheduledFor` = `nextSendAllowedAt`. Em regime normal nem chega aqui (o passo 2.2 já filtrou) — é a corrida contra um envio manual simultâneo |
| `INSTANCE_NOT_CONNECTED` · `INSTANCE_BANNED` | volta a `pending` | — | — | Tira a instância da rotação e reavalia 2.2. Sem nenhuma sobrando → **halt** |
| `MISSING_OPTOUT_NOTICE` · `MISSING_COMPANY_NAME` | volta a `pending` | — | — | 🔴 **`halt` da campanha**, `haltReason` explicando. Nunca `skipped`: o texto é o mesmo para todos, então falhar alvo a alvo produziria N falhas de um erro único. Validado no `start` (§4.5.10) — chegar aqui é bug, e o halt é o que o torna visível |

**Regra de leitura:** *skip* é para o que é **do lead** e não muda; *reagendar* é para o que é **do
momento**; *halt* é para o que é **da campanha** e nenhum alvo vai resolver sozinho.

#### 6.8.6 O resultado do `sendText` — incluindo o caso `uncertain`, que não existia na v1.1

`sendText` roda com `retryable: false`. **Retry de envio duplica mensagem no WhatsApp do lead** — o
lead não vê "uma tentativa", vê duas mensagens. Isso vale no motor com ainda mais força do que no
manual, porque aqui não há humano olhando.

| Resultado | `Message` | `CampaignTarget` | Cota | Instância |
|---|---|---|---|---|
| **Sucesso** | `sent` + `providerMessageId` | `sent` + `sentAt` (via `advanceCampaignTargetStatus`) | debitada (já estava) | `consecutiveFailures=0`, `consecutiveUncertain=0`, gate empurrado |
| **Falha confirmada** (`INSTANCE_DISCONNECTED`, `INSTANCE_NOT_FOUND`, `INVALID_NUMBER`, `AUTH_ERROR`, `RATE_LIMITED`, `VALIDATION_ERROR`, `UNKNOWN`) | `failed` + `errorCode` | `failed`, `skipReason` = o `reason` | **compensada** (`sentCount−1`, `failedCount+1`) | efeitos colaterais da tabela do §4.9.5, idênticos ao manual |
| 🆕 **Incerto** (`TIMEOUT`, `TRANSIENT_ERROR` → `EVOLUTION_SEND_UNCERTAIN`) | `failed` + `errorCode='EVOLUTION_SEND_UNCERTAIN'` | **`failed`**, `skipReason='send_uncertain'` — **nunca retentado** | **NÃO compensada** | `consecutiveFailures` intacto; `consecutiveUncertain += 1`; gate empurrado normalmente |

**As três decisões do caso incerto, e o motivo de cada uma:**

1. **O alvo vira `failed` terminal, não volta para `pending`.** Incerto significa "pode ter chegado".
   Reagendar é a única opção que consegue mandar a mesma abordagem duas vezes para a mesma pessoa — e
   o dano de uma mensagem duplicada (denúncia, ban) é maior que o de uma não enviada. A linha fica
   visível na tela com um texto que diz "não confirmada", e o operador decide olhar a conversa. É o
   mesmo princípio de "a cota erra sempre para menos" do §4.9.5, aplicado ao alvo.
2. **A cota não volta.** Ela pode ter sido gasta de verdade. Devolver cota que talvez tenha saído é
   furar o warmup sem ninguém ver — o modo de falha que o §6.2 inteiro existe para impedir.
3. **A instância não é punida.** Timeout de rede não é a instância falhando, e marcar `degraded` por
   isso derrubaria um número saudável por causa de uma oscilação de rede.

> ⚠️ **O buraco que o item 3 abre, e como ele é fechado.** Se incerto não conta como falha, uma
> Evolution agonizante devolve incerto indefinidamente, o motor continua, a cota é queimada e nós
> perdemos o registro do que saiu — mensagens possivelmente entregues, contabilizadas como falha.
> Por isso existe `consecutiveUncertain`, com dois patamares:
> - **≥ 3 seguidos na mesma instância:** ela sai da rotação neste ciclo e sai alerta `high`.
> - **≥ 5 seguidos:** 🔴 **`halt` da campanha**, `haltReason` = "resultado incerto repetido — confira
>   no WhatsApp o que realmente saiu antes de retomar".
>
> Parar é o movimento conservador aqui **justamente porque não sabemos o que aconteceu**. Continuar
> às cegas é a única forma de mandar mensagem duplicada para centenas de pessoas sem perceber.
> Qualquer sucesso zera o contador.

**Ordem de chegada do webhook.** O `messages.update` da Evolution pode chegar antes de gravarmos o
`providerMessageId` — a §4.8 (v1.1) já cobre isso com a re-busca única após 2s e o `logger.warn`.
Vale igual aqui; nada novo.

#### 6.8.7 Jitter, micro-pausa e por que a distribuição importa

Depois de **todo** envio (sucesso, falha ou incerto), o gate é empurrado:

```ts
// packages/core/src/whatsapp/jitter.ts — puro, RNG injetável (Íris testa a distribuição)
nextSendAllowedAt = now + drawJitter({ min, max, rng })
```

- **Distribuição log-normal**, não uniforme, entre `jitterSeconds.min` e `max` (default 45–180s), com
  moda em torno de ~70s e cauda longa. Intervalo uniforme tem média perfeitamente estável e é
  estatisticamente identificável — é a assinatura de bot mais óbvia que existe. Custo zero, e é o
  tipo de detalhe que separa "funciona" de "funciona por meses".
- **Micro-pausa:** `sendsSinceMicroPause += 1` a cada envio; ao cruzar um limiar sorteado em 18–25, o
  jitter da vez é sorteado em **5–12 min** e o contador zera. Uma coisa só: micro-pausa é um jitter
  longo, não um mecanismo à parte. Um gate, duas distribuições.
- **O gate é da instância, não da campanha.** Duas campanhas usando o mesmo número compartilham o
  freio — é o número que emite, não a campanha (§4.9.10).

#### 6.8.8 Observabilidade mínima (sem ela, a Fase 4 não é verificável)

O `dispatch-tick` é o primeiro código do projeto que produz efeito irreversível no mundo sem um
humano olhando. Três sinais, todos usando o que já existe (`observability/logger.ts`,
`observability/alerts.ts`, heartbeat):

| Sinal | Quando | Onde aparece |
|---|---|---|
| `logger.info` por envio | sempre | `campaignId`, `targetId`, `instanceId`, `reason`/`ok`, `jitterMs`. **Nunca o texto da mensagem nem o telefone completo** |
| Alerta `high` | 3 incertos seguidos · instância `degraded` · campanha `halted` | `ALERT_WEBHOOK_URL` (já implementado) |
| Alerta `critical` | instância `banned` · Evolution fora do ar | idem |
| Heartbeat do tick | a cada tick | mesma tabela do heartbeat do scraper — "o motor está vivo" tem que ser observável **sem** haver campanha rodando, senão "parado" e "quebrado" ficam idênticos |

O último item é a lição do §8.0 regra 4 aplicada ao motor: o estado degradado precisa de um sinal
mais barulhento que o normal, e "nenhuma mensagem saiu hoje" é ambíguo por natureza.

#### 6.8.9 Pausa global do disparo — o botão único do incidente

Parar campanha por campanha funciona quando há duas. Num incidente ("a Evolution está mandando coisa
errada", "o número está estranho"), o operador precisa de **um** lugar que para tudo, e precisa dele
pela UI: não há terminal confiável neste ambiente (§0, correção v1.1), e um `halt` por campanha é
justamente o que ele não consegue fazer rápido sob estresse.

**Decisão: reusar o mecanismo de pausa persistida que o scraper já tem** (`apps/worker/src/lib/
queue-state.ts`), aplicado à fila `dispatch-tick`, com o par de rotas
`GET/POST /api/v1/dispatch/queue` e `POST /api/v1/dispatch/queue/resume` — espelho exato do que já
existe em `/api/v1/scraper/queue`. Nada novo para aprender, e a lição já paga vale igual aqui: a
pausa **não pode** ser um `setTimeout` em memória, senão o restart do worker a desfaz sem avisar.

**Pausa global ≠ `halted` ≠ `paused`:** a global não muda o status de nenhuma campanha (elas seguem
`running`, só não são atendidas), e por isso é a única das três que não precisa de decisão por
campanha para ser desfeita. A campanha volta exatamente de onde estava.

> 🔒 **🆕 v1.3 — O motor nasce PAUSADO, e o interruptor é este.** Ausência da chave de pausa no Redis
> significa **pausado**, ao contrário do scraper (onde ausência = rodando). A inversão é deliberada e
> está escrita aqui para ninguém "corrigir" depois achando que é bug de simetria.
>
> **Por que a pausa persistida, e não um `DISPATCH_ENGINE_ENABLED` na env.** Uma env é invisível na
> tela e só muda com redeploy. O motor é a primeira coisa deste sistema que age sem ninguém olhando;
> quem precisa desligá-lo às 2h da manhã é o dono, do celular, sem terminal (§0). Um interruptor que
> exige acesso ao painel de deploy não é um interruptor de incidente. A env pode existir como trava
> adicional de build ("este deploy não dispara"), nunca como a única.
>
> **Consequência boa e intencional:** um Redis limpo (volátil por desenho, §1.3) devolve o sistema ao
> estado *pausado*, não ao estado *disparando*. Default degradado é o default seguro.
>
> 🔴 **Ligar o motor com o canal de alerta desligado é uma decisão consciente, e ela tem um preço
> exato:** um incidente noturno só será **descoberto** na manhã seguinte. O que sustenta que isso seja
> aceitável não é otimismo — é que o sistema é desenhado para **parar sozinho** em vez de continuar às
> cegas: instância desconectada → `halt` (§6.6), 3 incertos seguidos → fora da rotação, 5 → `halt`
> (§6.8.6), cota e janela barram antes de qualquer envio. O canal de alerta muda a **duração** do
> incidente, não o **tamanho** dele. Por isso ele não bloqueia a construção — mas enquanto estiver
> desligado, **os patamares de parada não podem ser afrouxados** (`DISPATCH_UNCERTAIN_DEGRADE_AT`,
> `DISPATCH_UNCERTAIN_HALT_AT`, `DISPATCH_MAX_ATTEMPTS`): o orçamento de autonomia está gasto em parar,
> não em insistir. E a **primeira ativação** é com 1 instância, campanha curta, dentro da janela
> comercial e com alguém olhando — mesmo princípio do §4.9.1, que fez a cadência estrear com volume 1.

#### 6.8.10 🆕 v1.3 — Configuração de campanha que existe, aparece na tela e não é honrada por ninguém

Achado ao desenhar o corte contra o código: três campos de `Campaign` são gravados pelo `POST`,
devolvidos pelo `GET`, exibidos pela Lyra — e **nenhum código os lê na hora de enviar**. O motor é o
primeiro consumidor de todos os três. Sem esta seção, 4.F "funciona" e a configuração da campanha
continua sendo decoração — o mesmo modo de falha do `warmupDay` que nunca avançava (§6.9).

| Campo | Situação hoje | O que a 4.F precisa fazer |
|---|---|---|
| `sendWindowDaysOfWeek` (`Int[]`, default seg–sex) | Usado **só** em `campaign-estimate.ts` para estimar a data de término. `SendWindowConfig` (`@inno/core`) **não tem** `daysOfWeek`: `isWithinBusinessWindow` fixa "sábado e domingo nunca" no código | Acrescentar `daysOfWeek` opcional a `SendWindowConfig.businessWindow` e um `resolveCampaignWindow(pisoDaEnv, campanha)` puro, que **interseca** (a campanha só estreita, nunca alarga o piso — mesma regra do §10). Sem isso, campanha configurada para sábado não envia e ninguém entende por quê; e `DISPATCH_ALLOW_SATURDAY` (§10) segue sem implementação |
| `jitterMinSeconds` / `jitterMaxSeconds` | Gravados por campanha; `advanceSendPace` é alimentado pelos valores da **env** em `messages.ts` | O tick passa o intervalo **da campanha**, clampado por `MIN_JITTER_FLOOR_SECONDS` (30s) — o clamp mora no mesmo lugar do clamp da env, nunca numa segunda função |
| `dailyLimitPerInstance` | Gravado por campanha; o guard só conhece `effectiveDailyLimit(warmupDay, override)` | A elegibilidade do passo 2.2 usa `min(effectiveDailyLimit, dailyLimitPerInstance)`. O warmup continua sendo o teto absoluto: a campanha só **estreita** |

**Regra geral que os três casos instanciam:** configuração de campanha só pode **estreitar** um limite
de segurança, nunca alargá-lo. Vale para janela, ritmo e cota, e é a mesma regra que o §10 já aplica à
env. Onde essa regra não estiver implementada, a tela está prometendo ao operador um controle que ele
não tem.

---

### 6.9 🆕 v1.2 — Jobs periódicos: o que entra na Fase 4 e o que fica para depois

**O critério:** entra na Fase 4 o que é necessário para o sistema **parar**; fica para depois o que é
necessário para o sistema **otimizar**. Um segundo critério de corte, prático: se a regra precisa de
mais histórico do que o aceite da Fase 4 produz (50 alvos), ela não é testável agora — e regra não
testável entregue é exatamente como nasceram as quatro funções sem chamador deste projeto.

| Job | Fase | Por quê |
|---|---|---|
| **`warmup-roll.job`** | 🟠 **Fase 4 — obrigatório** | Sem ele `warmupDay` **nunca avança** e toda instância fica presa em 20 msgs/dia para sempre. Não é melhoria: é o que faz o §6.2 existir de fato. Hoje `WARMUP_TABLE`/`effectiveDailyLimit` são lidos, mas ninguém escreve `warmupDay` |
| **`health-check.job` (fatia mínima)** | 🟠 **Fase 4** | Só o que **para**: ping na Evolution (3 falhas seguidas → `halt` em todas as campanhas `running`) e taxa de falha > 30% em 50 envios → `degraded`. É o que impede queimar cota contra um provedor morto |
| `health-check` (heurísticas de shadow-ban) | 🔵 Fase 5/6 | "Resposta < 2% com ≥100 enviadas" e "ausência de resposta em 100+ envios" precisam de 100+ mensagens de histórico. Com 50 alvos no aceite, a regra nunca dispara — entregá-la agora seria entregar código que ninguém viu funcionar |
| **`retention.job`** | 🔵 **Fase 5** | Apaga dado. É o job mais destrutivo do sistema, e nenhum dado atinge o prazo de retenção durante a Fase 4 (a base tem dias de idade). Subir o motor de disparo e o apagador de dados na mesma semana é concentrar risco sem ganho |
| `requeue-orphans` (disparo) | ❌ não existe | O lease do §6.8.2 já devolve alvo órfão sozinho. Job de resgate seria uma segunda solução para um problema resolvido |

**`warmup-roll.job` — especificação curta** (diário, ~00:10 `APP_TIMEZONE`):
1. Para cada instância, se `InstanceDailyStat` de **ontem** tem `sentCount > 0` → `warmupDay += 1`.
   Instância parada não amadurece sozinha (§6.2).
2. Se a taxa de resposta de 48h estiver abaixo do piso **com amostra suficiente**, **congela** o
   avanço (não recua). O congelamento entra na Fase 4; o alerta de shadow-ban derivado dele, não.
3. Zera `sendsSinceMicroPause` e `consecutiveUncertain` do dia anterior.

**`regressWarmupDay` (recuo de 30% ao reconectar) é código escrito sem chamador desde a Fase 3.** Ele
não é um job: o gatilho é o webhook `connection.update` levando a instância de `disconnected`/`banned`
de volta a `connected`. **Ligar isso é entrega da Fase 4** — pela regra §8.0 nº 3, "função pura +
teste ≠ funcionalidade", o aceite é o `warmupDay` visivelmente menor na tela depois de uma reconexão,
não o teste unitário passando.

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
| **4** | Profissional: backup, CI, testes de integração, alertas, docs | operação diária confiável | Fase 5 + Fase 6 |

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
| 1.4 | `apps/worker` com fila `scrape-search`, retry/backoff, dedupe de Lead | **Vega** |
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

### 🟠 Fase 4 — "Campanha com anti-ban de verdade" (reescrita na v1.2)

**Objetivo:** o coração do produto. Só entra depois que a Fase 3 provou, **com número real**, que o
envio unitário funciona ponta a ponta.

**Princípio desta reescrita:** a v1.1 listava 8 itens que só podiam ser verificados juntos, no fim
("4.3 `dispatch-tick.job` com rotação, afinidade e retomada" é uma linha e três semanas). A v1.2
quebra em **6 entregas que fecham sozinhas**, cada uma com um critério de pronto que alguém consegue
executar sem esperar a seguinte. É a regra §8.0 nº 1 aplicada dentro da fase, não só no fim dela.

| # | Entrega | Dono | Critério de pronto (executável) |
|---|---|---|---|
| **4.A** | **Schema da cadência.** 3 colunas em `WhatsAppInstance` (`nextSendAllowedAt`, `sendsSinceMicroPause`, `consecutiveUncertain`) + 2 em `CampaignInstance` (`sentCount`, `failedCount`). Migração aplicada em produção | **Cronos** | `prisma migrate` roda contra o banco real; `EXPLAIN` da query do §6.8.2 usa `campaign_targets_campaignId_status_scheduledFor_idx` (Index Scan, não Seq Scan) com ≥5.000 alvos semeados |
| **4.B** | **Políticas puras** em `packages/core`: `drawJitter` log-normal com RNG injetável, micro-pausa, janela da campanha (`intersect(pisoEnv, campanha)`), e as **adições ao guard** do §4.9.10 (`lastInboundAt`, `nextSendAllowedAt`, `ignorePaceLock`, `SEND_PACE_LOCKED`, `LEAD_CONTACT_COOLDOWN`) | **Vega** | Testes provam: 10k amostras de `drawJitter` têm moda ~70s e cauda até `max`; `ignorePaceLock` é **ignorado** quando `isColdFirstContact`; guard continua com **um** arquivo e **zero** I/O |
| **4.C** | **Cadência ligada no envio unitário** — §4.9.10 no caminho que já existe: manual passa a respeitar e empurrar `nextSendAllowedAt`, G9b e G9c ativos, `warnings[PACE_LOCK_BYPASSED_FOR_REPLY]` | **Vega + Lyra** | Dois envios frios seguidos pela ficha: o 2º devolve `409 / SEND_PACE_LOCKED` com o horário de liberação na tela. **Responder** a uma conversa aberta no mesmo intervalo **passa**, com o aviso visível. Fecha o achado médio do Órion |
| **4.D** | **API de campanha sem motor**: `preview`, `POST`, `PATCH`, `DELETE`, `GET`s, `start`/`pause`/`resume`/`cancel` — tudo do §4.5, com o `start` congelando snapshot e agendando os alvos. O tick **ainda não existe** | **Vega** | Criar campanha de 50 alvos por filtro; `totalMatched = eligible + Σ excluded`; `start` congela o snapshot, marca os alvos com `scheduledFor` e **nada é enviado**; template sem "responda SAIR" recusa com `409 / MISSING_OPTOUT_NOTICE` |
| **4.E** | **UI de campanha**: montagem com painel de exclusões clicável (consumindo `preview` com debounce), lista, acompanhamento ao vivo (poll 3s), pausar/retomar com o diálogo de `acknowledgeHalt`, saúde das instâncias | **Lyra** | Operador monta, vê "800 → 430" discriminado por motivo **antes** de criar, inicia, pausa e retoma sem tocar em API. `blockers[]` aparece na montagem, não só no clique de iniciar |
| **4.F** | **O motor** — 🆕 v1.3 quebrada em 6 passos ordenados (tabela abaixo): fiação do pacote compartilhado, extração do envio para `@inno/sending` (§6.8.0), adições puras ao `@inno/core`, pausa global + heartbeat, o `dispatch-tick.job` (§6.8), e os periódicos (`warmup-roll`, fatia mínima do `health-check`, `regressWarmupDay` no webhook) | **Vega** | Aceite da fase (abaixo) — e cada passo tem o seu próprio, para não voltar a ser "uma linha e três semanas" |
| **4.G** | **Testes** | **Íris** | Ver "aceite" — e cada um dos 5 itens é um teste, não uma conferência visual |
| **4.H** | **Revisão dedicada**: nenhum caminho de código envia sem passar pelo guard; `grep -rn "sendText("` continua com **um** call site de produção por caminho, e o do worker importa o mesmo `evaluateSendGuard` | **Órion** | Sem achado `high`/`critical` aberto |

**Ordem e paralelismo (o quadro que o Atlas usa para distribuir):**

```
4.A (Cronos) ─┬─→ 4.C (Vega+Lyra) ────────────────┐
              │                                    ├─→ 4.F (Vega) ─→ 4.G (Íris) ─→ 4.H (Órion)
4.B (Vega) ───┴─→ 4.D (Vega) ──→ 4.E (Lyra) ──────┘
```
- **4.A e 4.B saem juntas, no primeiro dia** — não dependem uma da outra.
- **4.D e 4.E em paralelo** assim que o §4.5 estiver lido: o contrato existe, é o que ele serve para
  fazer. A Lyra trabalha contra os schemas de `packages/contracts`, não contra a rota pronta.
- **4.F é a última por desenho.** É a única entrega que produz efeito irreversível no mundo; ela entra
  depois que tudo em volta já foi exercitado. Se 4.F atrasar, 4.A–4.E **já entregaram valor**: dá para
  montar campanha, conferir exclusões e enviar manualmente com cadência — que é mais do que existe
  hoje.
- **4.C antes de 4.F, e isto não é negociável:** é o mesmo princípio do §4.9.1. A cadência estreia com
  volume 1 e um humano olhando, e o motor a **herda** exercitada.

**🆕 v1.3 — A 4.F por dentro (ordem que o Vega segue; cada passo fecha sozinho):**

| Passo | O que é | Critério de pronto (executável) |
|---|---|---|
| **4.F.0** | **Fiação, antes de qualquer lógica.** Criar `packages/sending` com **um** símbolo trivial; declarar em `apps/worker` (`dependencies` + `noExternal` do `tsup`) e em `apps/web` (`transpilePackages`); importar dos dois lados; acrescentar um passo ao `selftest` que importa o pacote | `pnpm --filter worker build && node apps/worker/dist/selftest.js` passa **no container**, não só na máquina. É o passo que existe porque typecheck/lint/build já deixaram passar 5 incidentes que só apareceram no boot |
| **4.F.1** | **Extração do envio** para `@inno/sending` (§6.8.0), sem mudar comportamento: `send-one`, `outcome`, `pace`, `campaign-targets`, `evolution-resolver`, `ports`. `sendLeadMessage` vira o chamador que traduz o resultado em HTTP | 🔒 `messages.test.ts` passa **sem alteração além de caminho de import**. `grep -rn "sendText(" apps/ packages/` devolve **um** call site de produção. Envio manual real pela tela continua idêntico |
| **4.F.2** | **Adições puras ao `@inno/core`**: `resolveSendPolicy(env)` (um único lugar com os clamps), `localDateKey(now, tz)`, `daysOfWeek` + `resolveCampaignWindow` (§6.8.10), `pickInstanceWeighted(candidates, rng)` (§6.8.4) | Testes: piso de jitter não é contornável por env; campanha só **estreita** a janela do piso; 10k sorteios de `pickInstanceWeighted` distribuem na proporção da cota restante. Zero `process.env` dentro de `packages/core` |
| **4.F.3** | **Interruptor e sinais vitais, antes do motor existir**: pausa global persistida (§4.10/§6.8.9, **ausente = pausado**), heartbeat do tick (`lastTickAt`), rotas `GET/POST /api/v1/dispatch/queue` e `/resume`, telas | Operador pausa e retoma pela tela, e a pausa **sobrevive a restart do worker**. `GET` mostra `lastTickAt` mesmo sem nenhuma campanha rodando — "parado" e "quebrado" deixam de ser a mesma tela |
| **4.F.4** | **O tick** (§6.8.2–§6.8.7): claim por lease, elegibilidade (incluindo `dailyLimitPerInstance` e a janela da campanha), rotação/afinidade, chamada ao executor, tradução `reason → estado do alvo` (§6.8.5), halts | Aceite da fase, itens 1–3 e 5–6. O `switch` da §6.8.5 é exaustivo em tipo (`reason` novo quebra a compilação, não vira decisão improvisada) |
| **4.F.5** | **Periódicos**: `warmup-roll.job` (§6.9), fatia mínima do `health-check`, e `regressWarmupDay` ligado no webhook `connection.update` — este último é `apps/web`, não worker, e é o que mais escapa por "parecer parte do motor" | `warmupDay` visivelmente **maior** no dia seguinte a uma instância que enviou, e visivelmente **menor** na tela depois de uma reconexão. Teste unitário passando não conta (§8.0 regra 3) |

**Por que 4.F.3 vem antes de 4.F.4, e não depois:** o freio é construído antes do acelerador. Se o
tick existir primeiro, a única forma de pará-lo num incidente é derrubar o worker — que é exatamente
a manobra que ninguém quer executar sob estresse, e que deixa o scraper parado junto.

**Depende de:** Fase 3 **executada com número real** (não só escrita) e Fase 1. A dependência é dura:
construir o motor sobre um acoplamento com a Evolution que nunca foi exercitado é empilhar em fundação
não testada — é precisamente o que a 3.7 existia para evitar, e o que a v1.1 documentou como erro.

**Aceite da fase (executado pela Íris, com Evolution real e 2 instâncias):**
1. Campanha de 50 alvos com 2 números respeita **cota** e **janela**: nenhum envio fora da janela
   configurada, nenhuma instância passa de `effectiveDailyLimit`.
2. Os intervalos entre envios **não são constantes** e há pelo menos uma micro-pausa observável no log.
3. Desconectar um número no meio → campanha **`halted`** (não `paused`), `haltReason` legível na tela,
   e `resume` sem `acknowledgeHalt` é **recusado**.
4. 🔴 **Um `OptOut` registrado durante a execução é honrado no envio seguinte.** **Critério de bloqueio
   de release** — se este falhar, a fase não fecha, por melhor que esteja o resto.
5. **Retomada sem duplicar:** matar o worker no meio do disparo e subir de novo não produz nenhuma
   mensagem repetida no celular de teste (`Message.campaignTargetId @unique` é quem garante, §6.8.2).
6. 🆕 **Incerto não vira mensagem dobrada:** com a Evolution artificialmente lenta (timeout forçado), o
   alvo termina `failed/send_uncertain`, a cota **não** volta, e o motor **não** tenta de novo.

**O que a v1.2 mudou em relação ao plano da v1.1:**
- 4.2 não escreve o guard do zero — **importa o `evaluateSendGuard` que está em produção desde a 3.7**.
  O que a Fase 4 acrescenta são três `overrides` em `false` (§6.1), dois fatos novos e a tradução
  `reason → estado do alvo` (§6.8.5). **Segunda implementação do portão = reprovação do Órion.**
- `warmup-roll` saiu de "junto com o kill switch" e virou item explícito, porque sem ele o warmup
  **nunca avança** — a tabela do §6.2 seria decoração.
- A validação de conteúdo da 1ª mensagem (era 5.4, Fase 5) **sobe para o `start`** (§4.5.10): deixá-la
  na Fase 5 significaria disparar a Fase 4 inteira sem ela.
- `retention.job` continua na Fase 5, agora com critério escrito (§6.9).

---

### 🔵 Fase 5 — "Seguro, auditado e no ar"
| # | Entrega | Responsável |
|---|---|---|
| 5.1 | Auditoria OWASP: authz por rota, IDOR, injeção, secrets, rate limit, headers, SSRF no webhook | **Órion** |
| 5.2 | Hardening: `apikey` do Evolution em comparação de tempo constante, `instanceKey` não enumerável, CSP | **Órion + Vega** |
| 5.3 | LGPD executável: `retention.job`, página pública de descadastro, ação de eliminação | **Vega** |
| ~~5.4~~ | ~~Validação do conteúdo obrigatório da 1ª mensagem no `start`~~ — ⬆️ **subiu para a Fase 4** (§4.5.10): deixá-la aqui significaria disparar a Fase 4 inteira sem ela | **Vega** |
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

### 8.9 🆕 Fase 5 — Camada de tendência: onde prospectar, em vez de às cegas

**Origem:** ideia do dono, 23/09/2026. Hoje ele escolhe nicho e UF por intuição.
A hipótese é que o Google Trends indique **em que região existe demanda** pelos
serviços que ele vende (sites, sistemas, plataformas, marketplaces, aplicativos,
automação, chatbots), e que prospectar nessas regiões converta mais.

**A tradução que faz a ideia funcionar — e o erro que ela evita.** O Trends mede
quem *procura* um serviço. Essas pessoas são anônimas: não há telefone, não há
nome, não há como alcançá-las pelo Maps. Traduzir "buscam criação de sites no CE"
em "raspe empresas de criação de sites no CE" traria **concorrentes**, não
clientes. A tradução correta é:

> alta busca por *criação de sites* no CE → no CE, o alvo são empresas **sem
> site**.

Ou seja: o sinal escolhe **onde** e **que perfil**, nunca **quem**.

**Mapeamento serviço → perfil de alvo → filtro** (todos os filtros já existem em
`leadFilterSchema`, exceto onde marcado):

| Serviço | Perfil do alvo | Filtro |
|---|---|---|
| Criação de sites | Empresa sem site | `hasWebsite=false` |
| Sistemas / plataformas | Movimento real, operação manual | `minRating` + `category` |
| Aplicativos | Base de clientes recorrente | `category` + avaliações |
| Marketplaces | Comércio com catálogo, sem site | `category` + `hasWebsite=false` |
| Automação / chatbots | Alto volume de atendimento | `category` + `phoneType=mobile` |
| Tráfego / presença | Tem site, quase sem avaliações | `hasWebsite=true` + **nº de avaliações (falta)** |

**Invariante da fase: a tendência é conselho, nunca engrenagem.** A coleta não
pode depender do Trends para funcionar. Se a fonte quebrar, o sistema continua
operando idêntico — só perde a sugestão. Isto não é preciosismo: o Trends não tem
API pública oficial, o endpoint usado pelas bibliotecas é interno e bloqueia por
IP, e seria a **segunda** superfície anti-bot do projeto, da mesma natureza que
custou uma semana de incidentes em 22-23/09.

**Duas leituras erradas a evitar no desenho:** o índice do Trends é **relativo**
(0-100 contra ele mesmo no período), não volume absoluto — "100 no RN" não é mais
buscas que "60 em SP"; e a granularidade por cidade some em termo de nicho, então
a unidade prática é a **UF**.

**Entrega mínima (só depois da Onda 1 de robustez):**
1. Expor na tela os filtros que já existem e ninguém vê (`hasWebsite`, `phoneType`,
   `minRating`), mais o filtro de nº de avaliações que falta.
2. Coleta periódica e isolada de poucos termos fixos por UF, com ranking na tela
   de nova busca ("demanda por criação de sites: CE, PB, RN em alta").
3. "Consultas em ascensão" do Trends como fonte de **nicho** a buscar — vale mais
   que o mapa geográfico, porque revela oportunidade que ninguém pensaria em
   procurar.

**Validação antes de construir:** rodar uma busca numa UF escolhida pelo Trends e
outra escolhida no escuro, e comparar fechamento. Se a diferença não aparecer, a
fase não se justifica.

**⚠️ "Ampliar para o mundo inteiro" é projeto próprio, não parâmetro.** Quatro
camadas são Brasil-específicas: a base de 5.570 municípios do IBGE com UF de duas
letras; a normalização de telefone (DDD, 9º dígito, fixo vs. móvel); o idioma da
query e dos seletores do Maps; e o regime jurídico — GDPR para prospecção fria na
Europa é ordem de grandeza mais restritivo que LGPD para dado B2B público no
Brasil, e o WhatsApp não é o canal dominante em vários países. Provar a tese
dentro do Brasil primeiro.

---

### 8.10 🆕 Fase 6 — Abordagem gerada por IA, ancorada no dado do lead

**Origem:** ideia do dono, 23/09/2026 — usar IA para gerar a mensagem de
abordagem já com as informações do lead, buscando mais credibilidade e menos
risco de banimento.

**A correção de premissa que precisa vir antes do desenho.** Reduzir banimento
e aumentar taxa de resposta são alavancas diferentes. O que dispara banimento,
em ordem de peso: (1) **denúncia do destinatário**, o sinal dominante;
(2) **comportamento do número** — número novo, volume alto, cadência rápida e
**baixa taxa de resposta**; (3) **conteúdo idêntico repetido**. Variação de
texto é o item 3, o mais fraco — e o spintax já cobre. **IA não é, por si, um
redutor de banimento.** Ela ataca os itens 1 e 2 por outro caminho: mensagem
específica é respondida, e conversa respondida é o oposto de spam aos olhos da
plataforma.

**Âncora obrigatória: só o que foi coletado.** O gerador recebe apenas os campos
que o scraping trouxe (`name`, `category`, `city`, `uf`, `rating`,
`reviewCount`, `website`, `offNiche`) e é **proibido de introduzir fato novo**.

**O risco que domina esta fase é alucinação, não estilo.** Um modelo instruído a
"ser persuasivo" inventa ("vi que vocês atendem desde 2015"). Numa abordagem
fria, um detalhe inventado é **pior que uma mensagem genérica**: a pessoa
percebe, e o efeito é exatamente a denúncia que a fase existe para evitar. A
mitigação é estrutural, não é pedir ao modelo que não invente — campos fechados
na entrada, e validadores duros na saída:
- tamanho máximo;
- nenhuma variável de template não substituída;
- frase de descadastro presente;
- nome da empresa remetente presente (regra G10, já em produção);
- sem URL não intencional.

**Invariante da fase — idêntica à da Fase 5: a IA é conselho, nunca
engrenagem.** Se a API falhar, o envio cai no template com spintax e a campanha
segue. Nada neste sistema pode depender de serviço externo para funcionar.

**Momento da geração: na materialização dos alvos, nunca no envio.** Três
razões, e a terceira decide: latência (centenas de gerações no meio do disparo
atrasam a cadência), falha (API fora do ar trava a campanha em andamento) e —
a que manda — **auditoria**: gerando antes, as mensagens ficam revisáveis antes
de sair e guardadas depois, então é possível saber exatamente o que foi enviado
para quem. O texto gerado é persistido no alvo, não recalculado.

**Ordem de entrega:**
1. **Assistente na ficha do lead** — botão "gerar abordagem", o operador lê,
   ajusta e envia. Risco zero e valor imediato; é assim que se descobre o que é
   uma boa mensagem **antes** de automatizar quinhentas.
2. Geração em lote na montagem da campanha, com revisão de amostra antes do
   `start`.
3. Medição por variante — **taxa de resposta e taxa de descadastro**, template
   fixo contra gerado. Sem isso, a fase é fé: o sistema já registra `Message` e
   `OptOut`, então consegue responder.

**Regra de conteúdo que vale mais que engenharia de prompt:** a primeira
mensagem **não vende** — faz uma pergunta que a pessoa responde em cinco
segundos. Conversa iniciada protege o número; proposta não solicitada o queima.

**Dependências novas que a fase traz:** chave de API e custo por geração, e o
envio de dado de lead a um provedor externo (dado comercial público, risco
baixo, mas é decisão a registrar).

> 🆕 **v1.4 — esta seção é ESTENDIDA pela §8.11**, que mantém os dois invariantes acima intactos e
> muda três coisas: a medição passa a ser a fase 0 (antes de qualquer geração), o ângulo da
> abordagem passa a ser calculado por regra pura em vez de escolhido pelo modelo, e a autonomia
> ganha uma escada de cinco degraus com guarda-corpo explícito em cada um. A ordem de entrega desta
> §8.10 foi revisada lá — leia a §8.11.7, não a lista acima.

---

### 8.11 🆕 v1.4 — Máquina de prospecção autônoma: o laço fechado

**Origem:** pedido do dono, 2026-09-26 — *"um fluxo coerente, robusto e profissional de prospecção
(…) campanhas com IA, de maneira autônoma, de acordo com os dados da busca/leads (…) como se fosse
uma equipe de agentes/vendedores/marketing criando e gerindo campanhas profissionais"*.

**Relação com a §8.10: ESTENDE, não substitui.** Os dois invariantes de lá continuam valendo sem
alteração (*IA é conselho, nunca engrenagem*; *geração na montagem da campanha, nunca no envio*), e
a âncora obrigatória ("só o que foi coletado") continua sendo a regra-mãe. Três coisas mudam:

| O que a §8.10 dizia | O que a §8.11 muda | Por quê |
|---|---|---|
| Ordem de entrega: 1) assistente na ficha, 2) lote, 3) **medição por variante** | **A medição vira a fase 0**, antes de qualquer geração | Uma máquina que gera sem medir não melhora: ela erra com confiança, em escala. E o braço de comparação ("o que o template fixo faz no mesmo nicho") precisa existir **antes** do braço gerado, senão "a IA converte mais" é incomparável |
| A IA gera a mensagem a partir dos campos do lead | **O ângulo é calculado por regra pura; a IA só escreve a frase** (A33) | Tira a seleção de fato do modelo. O que ele pode afirmar deixa de ser resultado de instrução e passa a ser resultado de tipo |
| Autonomia não era escopo | **Escada de 5 degraus (N0-N4), cada um com guarda-corpo explícito** (§8.11.4) | "IA escreve a abordagem" e "IA decide quem recebe" são riscos de ordem de grandeza diferente. O modelo de segurança inteiro deste sistema assume humano montando o público |

**Premissa de contexto declarada (confirmar se mudar):** uso próprio (A23), 1 dono + poucos
operadores, dezenas a poucas centenas de mensagens frias por semana, 1-3 números na rotação. Isso
descarta, de saída, qualquer desenho que precise de volume estatístico para funcionar. **Com esse
volume, "aprender" significa "não repetir o que já se mostrou ruim", não "otimizar continuamente".**
Quem desenhar para bandit contínuo aqui está dimensionando para um sistema que não existe.

---

#### 8.11.1 O laço completo, e onde cada peça mora

```
      ┌── HOJE (existe e está em produção) ──────────────────────────────┐
      │                                                                  │
  [busca] → [scraping] → [Lead] → [filtro/segmento] → [Campaign+Targets] │
      │                                                  │               │
      │                                    [template + spintax]          │
      │                                                  ↓               │
      │                            [dispatch-tick → @inno/sending → Evolution]
      │                                                  ↓               │
      │                                    [webhook: delivered/read/inbound]
      └──────────────────────────────────────────────────────────────────┘
                                                         ↓
      ┌── NOVO (§8.11) ──────────────────────────────────────────────────┐
      │  ① ÂNGULO calculado   ② REDAÇÃO gerada    ③ DESFECHO medido      │
      │  (@inno/core, puro)   (@inno/ai, porta)   (ApproachOutcome)      │
      │        ↑                     ↑                     │             │
      │        └─────────── ④ AJUSTE ───────────────────────┘             │
      │              (escolha de ângulo por desempenho, N3+)             │
      └──────────────────────────────────────────────────────────────────┘
```

| Peça | Mora em | Existe hoje? | Natureza |
|---|---|---|---|
| Segmentação (filtro de público) | `leadFilterSchema` + `POST /campaigns` | **Sim** (falta `minReviewCount`) | reuso — ⚠️ **detalhada e substituída na §8.11.11**: esta linha descreve o *universo*, não o *recorte* |
| **Cálculo do ângulo** | `packages/core/src/approach/angles.ts` | Não | **função pura, testável sem rede** |
| Biblioteca de ângulos (texto base por ângulo) | `MessageTemplate` + coluna `angle` | Parcial | dado, não código |
| **Redação** (opcional, por cima do ângulo) | `packages/ai` (porta + adaptador) | Não | I/O externo, **substituível por no-op** |
| Validação da saída gerada | `packages/core` (`validateGeneratedApproach`) | Não | função pura |
| Persistência do texto por alvo | `CampaignTarget.renderedBody` | **Não — buraco** | migração |
| Portão de envio (G1–G11) | `@inno/core` + `@inno/sending` | **Sim, auditado** | **não se toca** |
| **Gravação do desfecho** | `@inno/sending` (mesma transação do write-ahead) | Não | migração + 1 escritor |
| Atualização do desfecho | `apps/web/.../webhook.ts` | Parcial | 1 escritor |
| Leitura/decisão por desempenho | `apps/web` (tela) + `packages/core` (escolha) | Não | último a ser construído |

**A fronteira que decide o desenho inteiro:** tudo à esquerda da chamada a `executeSendAttempt`
pode mudar de nível de autonomia; **nada à direita muda.** O portão, o gate de ritmo, a cota de
warmup, a janela, o lease e o `@unique` continuam sendo o mesmo código, chamado do mesmo lugar, em
qualquer degrau da escada. É isso que permite subir e descer de degrau sem reescrever o sistema.

---

#### 8.11.2 A matéria-prima é magra — e os ângulos fortes saem exatamente dela

Confirmo a leitura do Atlas, com uma correção de ênfase. De cada lead sabemos `name`, `phoneE164`,
`phoneType`, `address`, `city`/`uf`, `website` (ou a ausência), `category`, `rating`, `reviewCount`,
`offNiche`, `lastSeenAt`. **Nada mais**, e a §7.1 proíbe ampliar (não é preguiça: é o que sustenta o
legítimo interesse).

Isso é **menos** que a fantasia de personalização profunda e **mais** que parece, porque os ângulos
comerciais fortes são combinações e **ausências**, não detalhes. E o ponto que muda a arquitetura:
cada ângulo é um **predicado determinístico** sobre campos coletados. Logo é calculável em código
puro, testável com fixture, e **auditável**. A IA não escolhe o que é verdade; ela escreve a frase
de um fato que o código já provou.

> **A33 — o ângulo é calculado, a frase é gerada.** O gerador nunca recebe "invente o gancho";
> recebe um `ApproachAngle` já decidido e um conjunto fechado de fatos citáveis. Se o modelo cair,
> o ângulo continua existindo e o texto base do ângulo é enviado. **Este é o motivo pelo qual a
> maior parte do valor desta fase não depende de IA nenhuma.**

**Catálogo inicial de ângulos (vocabulário aberto, como `LeadActivity.type` — ângulo novo não exige
migração):**

| `angle` | Predicado sobre campos coletados | O que a frase pode afirmar |
|---|---|---|
| `no_website` | `website == null` | não achamos site da empresa |
| `reputation_no_website` | `website == null && rating >= 4.5 && reviewCount >= 30` | boa reputação **e** sem site — o ângulo mais forte do catálogo |
| `high_volume` | `reviewCount >= 100` | muito movimento (→ atendimento manual dói) |
| `site_low_traction` | `website != null && reviewCount <= 10` | tem site, quase sem avaliação (→ presença/tráfego) |
| `low_visibility` | `reviewCount == null \|\| reviewCount <= 5` | pouca presença digital |
| `local_reference` | `rating >= 4.7 && reviewCount >= 50` | referência na cidade |
| `generic` | fallback — sempre existe | só nicho + cidade |

Regras de composição (puras, e é aqui que mora a robustez):

1. **Precedência fixa e determinística**, não "o melhor segundo o modelo". Mesmo lead → mesmo ângulo,
   sempre. Sem isso, não há como medir ângulo nenhum.
2. **`offNiche == true` força `generic`.** A `category` desse lead é sabidamente não confiável (foi
   assim que "escritório de arquitetura" trouxe Magazine Luiza). Uma frase do tipo *"vi que vocês
   trabalham com arquitetura"* para a loja errada é **exatamente** o detalhe inventado que esta fase
   existe para evitar — e o dado que produz o erro já está marcado no schema. **Recomendação mais
   forte: `offNiche` fora de campanha fria, não só fora da geração.**
3. **Números só são citáveis se frescos.** Se `lastSeenAt` tiver mais de 60 dias, o ângulo continua
   valendo mas `rating`/`reviewCount` **saem do conjunto de fatos citáveis** — o ângulo é escolhido
   pelo valor antigo, a frase não o cita. Citar "180 avaliações" de uma coleta de oito meses atrás é
   errar em público sobre um número que o destinatário conhece melhor que nós.
4. **`name` é razão social ou nome de fantasia com ruído** (`LTDA`, `- Matriz`, emoji). O ângulo
   nunca depende do nome; a renderização usa a variável `{{nome}}` que já existe.

**Conteúdo, que vale mais que engenharia de prompt (mantido da §8.10):** a primeira mensagem **não
vende** — faz uma pergunta que a pessoa responde em cinco segundos. Isso não é estilo: conversa
iniciada protege o número, proposta não solicitada o queima.

---

#### 8.11.3 🔒 A medição (CONTRATO — Cronos implementa)

**O problema, em uma frase:** hoje o sistema não consegue dizer qual abordagem converte, e não é por
falta de tela — é por falta de dado. Três buracos concretos, os três verificados no código:

1. **Não existe atribuição por abordagem.** `Campaign → templateId` é o grão mais fino que existe. Um
   público de 400 leads espalhado por 5 categorias e 12 cidades produz um único número agregado, com
   nicho, cidade, número usado e horário todos confundidos dentro dele.
2. 🔴 **`responded` inclui quem pediu para sair.** Em `webhook.ts#handleInboundMessage`, o alvo ativo
   avança para `responded` **antes** de `registerOptOutFromInbound` rodar, e nada o faz voltar. Ou
   seja: hoje, responder "SAIR" **conta como resposta**. Se um laço de aprendizado for ligado em cima
   disso, ele aprende a premiar a abordagem que mais irrita. Este é o defeito mais importante desta
   seção, e ele é anterior a qualquer IA.
3. **O histórico encolhe, e encolhe enviesado.** `CampaignTarget.leadId` é `onDelete: Cascade` (de
   propósito, para a eliminação LGPD conseguir completar). Logo, ao longo de 24 meses de retenção,
   os leads eliminados — desproporcionalmente os que se incomodaram — **somem do conjunto de
   aprendizado**, deixando toda abordagem parecer melhor do que foi. O `Campaign.*Count` já resolve
   isso para o funil da campanha, por este exato motivo; a medição por abordagem precisa da mesma
   proteção.

**Model novo — `ApproachOutcome`.** Fato anônimo, append-only na criação, com poucos campos
atualizados pelo desfecho. Um por MENSAGEM FRIA enviada, de qualquer caminho (campanha **e** envio
unitário).

```prisma
model ApproachOutcome {
  id       String   @id @default(cuid(2))
  sentAt   DateTime

  // ── ATRIBUIÇÃO (o "braço do experimento") ──
  source       ApproachSource        // template | ai | manual
  angle        String                // vocabulário ABERTO (como LeadActivity.type)
  templateId   String?               // SetNull — sobrevive ao template apagado
  campaignId   String?               // SetNull — envio unitário não tem campanha
  variantKey   String?               // qual variação de spintax/prompt saiu
  promptVersion String?              // só quando source = ai
  modelId      String?               // só quando source = ai

  // ── SEGMENTO (snapshot no envio, nunca join em tempo de leitura) ──
  uf            String  @db.VarChar(2)
  cityIbgeCode  String?
  categoryKey   String?              // category normalizada (slug), null se offNiche
  hasWebsite    Boolean
  ratingBucket  String?              // none | lt40 | 40_45 | gte45
  reviewBucket  String?              // b0 | b1_10 | b11_50 | b51_200 | b200p
  phoneType     PhoneType

  // ── CONFUNDIDORES CONHECIDOS (sem eles a comparação mente) ──
  instanceId String?                 // SetNull — número aquecido converte mais
  warmupDay  Int?
  hourOfDay  Int                     // 0-23 no fuso APP_TIMEZONE
  dayOfWeek  Int                     // 0=dom..6=sáb

  // ── ELO OPERACIONAL (cortado pela eliminação LGPD, o fato permanece) ──
  leadId    String?                  // SetNull
  messageId String?  @unique         // SetNull — é por aqui que o webhook acha a linha

  // ── DESFECHO ──
  delivered    Boolean   @default(false)
  read         Boolean   @default(false)
  replied      Boolean   @default(false)   // ⚠️ NÃO inclui pedido de descadastro
  optedOut     Boolean   @default(false)
  firstReplyAt DateTime?
  failed       Boolean   @default(false)
  failReason   String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([angle, sentAt])
  @@index([categoryKey, angle])
  @@index([uf, angle])
  @@index([source, sentAt])
  @@index([campaignId])
  @@map("approach_outcomes")
}

enum ApproachSource { template  ai  manual }
```

> ⚠️ **v1.5 — este model ganha cinco campos**, e eles precisam entrar na **mesma migração** (não
> adianta gravar desfecho sem saber com que score e com que fatia o alvo entrou): `replyCategory`,
> `replyClassifiedBy`, `score`, `scoringProfileId`, `exploreKind`. Contrato e porquês na §8.11.14.3 e
> na §8.11.15.

**Decisões de desenho, com o porquê de cada uma:**

| Decisão | Por quê |
|---|---|
| **Tabela separada, não colunas em `CampaignTarget`** | `CampaignTarget` cascateia na eliminação LGPD (e deve continuar cascateando). O aprendizado não pode desaparecer junto — e some enviesado, o que é pior que sumir |
| **`replied` exclui descadastro; `optedOut` é campo próprio** (A35) | Sem essa separação, o sinal de "funcionou" é incrementado pelo sinal de "irritou". É o defeito nº 2 acima, elevado a invariante |
| **Buckets em vez de `rating`/`reviewCount` crus** | A pergunta é "converte para qual **perfil**", não "para qual empresa". Bucket é o que a análise usa e o que impede a tabela de virar um segundo cadastro |
| **Segmento snapshotado, não obtido por join** | Depois da eliminação do lead o join não existe mais; e `category`/`rating` mudam entre coletas (são `MACHINE_UPDATABLE_FIELDS`) — join em tempo de leitura responderia sobre o lead de hoje, não sobre o lead que recebeu a mensagem |
| **`instanceId` + `warmupDay` + `hourOfDay` gravados** | São os confundidores que tornam a comparação honesta. "O ângulo B converteu mais" é vazio se B saiu do número aquecido às 10h e A do número novo às 19h |
| **Sem tabela de rollup/agregado** | Em milhares de linhas/ano, `GROUP BY` sobre os índices acima responde em milissegundos. Rollup agora é exatamente a função-sem-chamador que este projeto já produziu quatro vezes |
| **Sem coluna de desfecho de funil (`won`/`negotiating`)** | Exigiria um **terceiro** escritor (o `PATCH /leads/:id`), que é justamente o tipo de disciplina que se esquece. Enquanto o `leadId` existir, o funil sai por join. Aceito conscientemente: depois da eliminação, perde-se o desfecho profundo daquele lead — não o desfecho da mensagem |

**Onde é escrito — e por que só ali (A34).**

- **Criação:** dentro de `packages/sending`, **na mesma transação do write-ahead** de `Message`.
  Não é conveniência: é a única posição em que é impossível um segundo chamador esquecer de gravar.
  Se a criação ficasse no `dispatch-tick`, o envio unitário nunca registraria, e o conjunto de
  aprendizado nasceria enviesado para o caminho automático. `executeSendAttempt` já recebe um
  `campaignContext` opcional; ganha um `attribution` (obrigatório para contato frio, `null` para
  resposta em conversa aberta — resposta não é abordagem e não entra na medição).
- **Atualização de `delivered`/`read`:** `webhook.ts#handleMessageStatus`, por `messageId`.
- **Atualização de `replied`/`optedOut`/`firstReplyAt`:** `webhook.ts#handleInboundMessage`,
  **depois** de `event.isOptOutRequest` ser conhecido — é o mesmo ponto onde o defeito nº 2 se
  conserta.

**Correções pré-requisito (entram na mesma entrega, não depois):**

1. 🔴 **Descadastro deixa de contar como resposta.** No inbound com `isOptOutRequest`, o alvo vai
   para `skipped/opted_out` (ou um estado terminal equivalente), nunca `responded`; e o
   `Campaign.respondedCount` não incrementa.
2. 🔴 **A corrida de `recordInstanceResponseIfFirstToday`** (achado `medium` do Órion em 4.H, com
   gatilho datado "consertar antes da heurística de taxa de resposta"). **O gatilho chegou aqui.**
   Receita já existe no mesmo arquivo: constraint única + captura de `P2002`, como
   `registerOptOutFromInbound` faz.
3. **`minReviewCount` no `leadFilterSchema`** — já registrado como faltante na §8.9, e agora é
   requisito: dois dos sete ângulos segmentam por número de avaliações.

**A pergunta do dono, respondida em SQL (o critério de aceite da fase 0):**

```sql
SELECT "categoryKey", uf, angle, source,
       count(*)                                        AS enviadas,
       sum(("replied")::int)                           AS responderam,
       sum(("optedOut")::int)                          AS descadastraram,
       round(100.0 * sum(("replied")::int)  / count(*), 1) AS taxa_resposta,
       round(100.0 * sum(("optedOut")::int) / count(*), 1) AS taxa_descadastro
FROM approach_outcomes
WHERE "sentAt" >= now() - interval '90 days'
GROUP BY 1,2,3,4
HAVING count(*) >= 20
ORDER BY taxa_resposta DESC;
```

O `HAVING count(*) >= 20` não é enfeite: **é o piso abaixo do qual a tela não deve mostrar
percentual nenhum.** 1 resposta em 3 envios não é 33% de conversão; é ruído, e exibi-lo como número
é a forma mais eficiente de fazer o dono tomar uma decisão errada com confiança.

---

#### 8.11.4 🔒 A escada de autonomia (CONTRATO — o dono escolhe onde parar)

Cada degrau **acrescenta um autor** ao processo e mantém tudo o mais igual. O nível é **uma
configuração persistida, lida em runtime** (mesmo lugar e mesma semântica da pausa global do §4.10:
**chave ausente = N0**, o degrau mais conservador — A36). Descer de degrau é mudar o valor; não há
código a reverter.

| Nível | Quem faz o quê | Guarda-corpo obrigatório (sem ele o nível não existe) | O que arrisca |
|---|---|---|---|
| **N0** — hoje | Humano escreve o texto, monta o público, libera. Máquina só respeita o ritmo | Os que já existem (G1–G11, gate, warmup, janela, lease, `@unique`, pausa global) | Nada novo. Não escala a atenção do dono |
| **N1** — assistente | Humano pede sugestão **na ficha de um lead**; lê, edita, envia | Nada sai sem clique humano; o texto gerado passa pelos **mesmos** G1–G11; toda geração é registrada mesmo quando o humano reescreve | Praticamente zero. É aqui que se descobre o que é uma boa mensagem **antes** de automatizar quinhentas |
| **N2** — lote com revisão | Máquina gera o texto de **todos** os alvos na montagem da campanha; humano revisa **amostra por ângulo** e libera | `start` devolve **409** se existir alvo `source=ai` sem aprovação; a aprovação é **por ângulo**, não por texto (revisar 430 textos é teatro; revisar 3 por ângulo é revisão de verdade); teto de alvos na primeira campanha de cada ângulo novo | Um ângulo ruim vai para todos do ângulo de uma vez. Daí o teto |
| **N3** — escolha por desempenho | Máquina escolhe **qual ângulo** usar por alvo, dentro de um público que o humano montou | Só ângulos já aprovados em N2; **piso de amostra** por ângulo antes de considerar qualquer um vencedor; **fração mínima de exploração** (senão o laço congela no primeiro ângulo que teve sorte); sem dado suficiente → **rodízio uniforme**, nunca "o melhor até agora" | O sistema passa a reforçar o próprio viés. O piso e a exploração são o antídoto |
| **N4** — público autônomo | Máquina **monta o público e agenda** a campanha; humano tem veto | Ver os seis abaixo — todos, não "os principais" | É o degrau que pode custar o número em escala. O modelo de segurança inteiro foi desenhado supondo humano no público |

> ⚠️ **Revisado na v1.5 (§8.11.13):** o N4 desta tabela foi **partido em dois** — **N4a**, a máquina
> monta o público e a campanha nasce `draft` (humano aperta o disparo), e **N4b**, a máquina monta
> **e** dispara com janela de veto. Os seis guarda-corpos abaixo (A37) passam a se referir ao
> **N4b**; o N4a exige três deles (envelope, exclusões duras e teto de rascunhos não revisados).
> **Decisão do dono: para em N4a** — classificar e montar são automáticos, apertar o botão não.

**Os seis guarda-corpos de N4b (nenhum é opcional):**

1. **Envelope declarado pelo humano**, persistido: UFs permitidas, categorias permitidas, tamanho
   máximo de campanha, nº máximo de campanhas por dia. **Fora do envelope a máquina recusa, não
   pede.** Pedir cria um caminho em que o dono aprova no cansaço.
2. **Orçamento diário de contatos frios**, global e persistido, **independente** da cota por
   instância. São tetos de donos diferentes: a cota por número protege **o número**; o orçamento
   protege **a base** — queimar 5.000 leads em duas semanas com uma abordagem ruim não dispara
   nenhum limite de anti-ban, e destrói o ativo.
3. **Janela de veto**: a campanha nasce `scheduled` para daqui a N horas, com notificação. Silêncio
   = segue. Isso é veto real; "botão de pânico" depois de disparar não é.
4. **Uma só campanha autônoma em voo.** A máquina não abre a segunda antes de o dono ter visto o
   desfecho da primeira — senão um erro de julgamento se multiplica antes de existir qualquer
   feedback.
5. **Exclusões duras**, não configuráveis: `offNiche`, lead já contatado dentro de
   `skipRecentlyContactedDays`, lead que já recebeu K abordagens na vida sem nunca responder,
   telefone não-móvel.
6. 🔴 **Canal de alerta LIGADO.** Em N0–N3 o alerta muda a duração do incidente. Em N4 existe um ator
   autônomo de segundo grau (escolhe público **e** dispara) e o alerta passa a ser a única forma de
   o dono descobrir, na mesma noite, que a máquina escolheu errado. **`ALERT_WEBHOOK_URL` vazia
   bloqueia N4** — e isso é coerente com A31, que aceitou o motor sem alerta apenas porque os
   patamares de parada não foram afrouxados.

> **A metáfora do dono ("uma equipe de agentes/vendedores") é boa como descrição do resultado e ruim
> como desenho.** Uma equipe simulada de agentes conversando entre si é mais cara, mais lenta, menos
> auditável e — o que decide — **impossível de medir**: não há como dizer qual "agente" causou a
> resposta. O que entrega o mesmo resultado é um **pipeline determinístico com um passo de redação**:
> segmentar (regra) → escolher ângulo (regra, depois desempenho) → escrever (modelo) → validar
> (regra) → enviar (portão existente) → medir (fato). Cada passo é inspecionável isoladamente, e é
> isso que faz o conjunto parecer profissional em vez de só parecer inteligente.

---

#### 8.11.5 Contratos e migrações que a fase exige

**Migração (Cronos):**

| Mudança | Onde | Por quê |
|---|---|---|
| `CampaignTarget.renderedBody String?` | schema | **Buraco atual:** o texto é recalculado do snapshot em **três** lugares no momento do envio. Sem uma coluna por alvo, não há onde o texto gerado morar, e a §8.10 ("gerar antes, auditar antes de sair") é irrealizável |
| `CampaignTarget.approachAngle String?` / `approachSource` / `approvalState` | schema | Atribuição e portão de aprovação do N2 |
| `ApproachOutcome` + enum `ApproachSource` | schema | §8.11.3 |
| `MessageTemplate.angle String?` | schema | Liga o template base ao ângulo. É assim que "ler os templates de forma dinâmica" vira arquitetura: **os templates são a biblioteca de ângulos, lida do banco** |
| `minReviewCount` em `leadFilterSchema` | contracts | §8.9 + dois ângulos dependem |

**Regra de leitura do texto final (fecha a duplicação de três pontos):** quem envia lê
`target.renderedBody` se existir; **só cai** para `renderTemplate(snapshot) + resolveSpintax` se for
`null`. Uma linha, nos três chamadores, e o caminho gerado não abre um quarto.

**Contratos de API novos (Vega implementa, Lyra consome):**

| Rota | Corpo/resposta | Observação |
|---|---|---|
| `POST /api/v1/leads/:id/approach` | → `{ angle, angleLabel, facts[], text, source, generationId }` | N1. **Não envia nada.** `409 AI_DISABLED` quando não há provedor; `200` com `source:"template"` quando o modelo falha (degradação, não erro) |
| `POST /api/v1/campaigns/:id/approaches/generate` | → `{ generated, failed, byAngle[] }` | N2. Só em `draft`. Idempotente por alvo |
| `GET /api/v1/campaigns/:id/approaches/sample?angle=` | → amostra estratificada | N2. É o que o humano revisa |
| `POST /api/v1/campaigns/:id/approaches/approve` | `{ angle, approved }` | N2. Aprovação **por ângulo** |
| `GET /api/v1/insights/approaches` | filtros: período, uf, categoria, ângulo, source | Fase 0. A consulta do §8.11.3, paginada, **com o piso de amostra aplicado no servidor** |
| `PUT /api/v1/settings/autonomy` | `{ level: 'n0'..'n4', envelope }` | Ausente = `n0` |

**Erros novos em `error.reason`** (A20 — todo nome precisa de um campo onde morar):
`AI_DISABLED`, `AI_BUDGET_EXCEEDED`, `APPROACH_NOT_APPROVED`, `ANGLE_NOT_APPROVED`,
`AUTONOMY_LEVEL_TOO_LOW`, `OUTSIDE_AUTONOMY_ENVELOPE`, `GENERATED_TEXT_REJECTED`.

**Validação da saída gerada (`@inno/core`, pura — a mitigação estrutural de alucinação):**

1. **Fatos declarados ⊆ fatos fornecidos.** O modelo devolve saída estruturada
   (`output_config.format`) com `{ text, factsCited[] }`; qualquer fato citado fora do conjunto de
   entrada **rejeita a geração**. Isto é o que transforma "instruí o modelo a não inventar" em
   verificação de tipo.
2. Nenhum numeral no texto que não esteja no conjunto de fatos citáveis.
3. Nenhuma URL (link em primeiro contato de número novo — §6.4 item 4).
4. Nenhum `{{` remanescente.
5. Tamanho máximo, e `hasOptOutNotice` + `hasCompanyNameMention` — **os mesmos** `@inno/core` que o
   G10 já usa em produção, não uma segunda checagem.
6. Rejeição **nunca** propaga erro: cai no texto base do ângulo, grava `source='template'` e
   incrementa um contador visível. Se rejeitar muito, alguém precisa **ver** (regra 4 das lições de
   plano faseado: modo degradado com sinal mais barulhento que o normal).

---

#### 8.11.6 Stack de IA — opções, recomendação e custo

| Opção | Prós | Contras | Custo |
|---|---|---|---|
| **A. Sem IA generativa** — catálogo de ângulos + template por ângulo + spintax | Zero alucinação, zero custo, determinístico, mensurável no mesmo laço. **Entrega a maior parte do ganho**, porque o ganho vem de *escolher o ângulo certo*, não da prosa | O dono escreve 6-10 textos uma vez; não capta nuance | R$ 0 |
| **B. API Claude** — `claude-haiku-4-5` para volume, `claude-opus-5` para o raciocínio raro | Melhor qualidade em pt-BR comercial; saída estruturada com schema (essencial para o validador nº 1); prompt caching torna o sistema fixo quase gratuito; Batch API a 50% quando não é interativo | Dependência externa; dado comercial do lead sai da infra; chave a gerenciar | centavos — ver abaixo |
| **C. Modelo local na VPS** (Ollama/Llama) | Dado não sai; custo marginal zero | A VPS já roda Chromium + Postgres + Redis; modelo decente exige GPU; qualidade em pt-BR comercial bem inferior — **e o risco dominante é alucinação, exatamente onde modelo pequeno é pior** | hardware |

**Recomendação: A como base permanente, B como camada por cima, C descartada.**

O argumento não é de custo, é de arquitetura: **o motor de ângulos determinístico É o produto**; o
modelo é o redator. Construindo só o A, o dono já tem "uma equipe de vendas escolhendo a abordagem
certa para cada lead", com zero risco de alucinação — e o laço de medição funciona **idêntico**
(`source='template'`, `angle='reputation_no_website'`). Quando o B entrar, ele é medido **contra** o
A no mesmo ângulo, mesmo nicho, mesma cidade. Sem o braço A existindo primeiro, "a IA converte mais"
é uma frase sem comparação possível.

**Custo, em ordem de grandeza** (preços de tabela da API Anthropic, set/2026 — recalcular antes de
decidir):

| Modelo | US$/MTok entrada | US$/MTok saída |
|---|---|---|
| `claude-haiku-4-5` | 1,00 | 5,00 |
| `claude-sonnet-5` | 2,00 | 10,00 |
| `claude-opus-5` | 5,00 | 25,00 |

Uma geração = ~1.500 tokens de sistema (**fixo → cacheado, ~0,1× após a 1ª chamada**) + ~200 tokens
de fatos do lead + ~150 tokens de saída:

| Modelo | Por geração | **Campanha de 500 alvos** | 2.000 msgs/mês |
|---|---|---|---|
| Haiku 4.5 | ≈ US$ 0,0011 | ≈ **US$ 0,55** (~R$ 3) | ≈ US$ 2,20 (~R$ 12) |
| Sonnet 5 | ≈ US$ 0,0022 | ≈ US$ 1,10 | ≈ US$ 4,40 |
| Opus 5 | ≈ US$ 0,0055 | ≈ US$ 2,75 | ≈ US$ 11,00 |

**Conclusão honesta: custo não é a variável de decisão desta fase.** A campanha inteira custa menos
que um café em qualquer modelo. A variável é **risco de alucinação e capacidade de medir**. Por isso:

- **Redação (volume) → `claude-haiku-4-5`.** Tarefa curta, âncora fechada, saída validada por código.
- **Raciocínio de estratégia → `claude-opus-5`, raro, semanal, sobre AGREGADOS.** "Leia a tabela de
  desfecho e diga quais ângulos aposentar, quais nichos abandonar e que ângulo novo tentar." Entrada
  ~5k tokens de números, saída ~1,5k → **~US$ 0,06 por execução**.
- **A38 — o modelo caro nunca vê dado de lead; vê agregado.** Corta custo, corta latência e corta a
  superfície LGPD ao mesmo tempo: a análise estratégica não precisa de um único telefone.
- **Batch API (50%)** vale para a geração em lote de campanha criada pela máquina de madrugada (N4);
  **não** vale para o assistente da ficha (N1), que é interativo.
- **Teto de gasto mensal persistido**, com degradação para o template base quando estourar
  (`AI_BUDGET_EXCEEDED` visível na tela, nunca silencioso).

---

#### 8.11.7 Plano faseado — na ordem que entrega valor cedo

> ⚠️ **Revisado na v1.5:** a tabela abaixo continua valendo, mas **ganhou duas fases** (6.1R e 6.2R)
> e duas mudaram de escopo (6.1 absorve o score; 6.5 vira 6.5a/6.5b). A versão vigente do plano está
> na **§8.11.16** — é a que Cronos e Vega devem seguir.

A §8.10 recomendava começar pelo assistente na ficha do lead. **Depois de ver o pedido de autonomia,
discordo da ordem, não da ideia.** O assistente continua sendo o primeiro uso de IA; mas a primeira
coisa que o dono consegue **usar** não é IA nenhuma — é saber o que já está acontecendo, e mandar a
mensagem certa para o perfil certo. Ordem revisada:

| Fase | Entrega | Depende de | O que o dono passa a conseguir fazer |
|---|---|---|---|
| **6.0** 🔴 **Medir** | `ApproachOutcome` + escrita no `@inno/sending` + atualização no webhook + **separar `replied` de `optedOut`** + corrigir a corrida do `respondedCount` + `minReviewCount` | nada | Ver, sobre o que **já** está sendo enviado, taxa de resposta e de descadastro por nicho, cidade e horário. **Zero IA, valor imediato** |
| **6.1** **Ângulos** (sem IA) | `packages/core/src/approach/angles.ts` + `MessageTemplate.angle` + `CampaignTarget.renderedBody`/`approachAngle` + escolha do ângulo na materialização | 6.0 | Uma campanha em que cada lead recebe a abordagem adequada ao que ele é. **É a primeira coisa que muda resultado** |
| **6.2** **Assistente (N1)** | `packages/ai` + validadores + `POST /leads/:id/approach` | 6.1 | Gerar a abordagem de um lead, ler, ajustar, enviar. Descobrir o que é boa mensagem antes de automatizar |
| **6.3** **Lote com revisão (N2)** | geração em lote + amostra por ângulo + aprovação + `409` no `start` | 6.2 + ≥1 campanha medida em 6.1 | Campanha inteira escrita pela máquina, liberada pelo humano |
| **6.4** **Escolha por desempenho (N3)** | piso de amostra + exploração + fallback para rodízio | 6.3 + piso de amostra atingido | A máquina para de usar o que não funciona |
| **6.5** **Público autônomo (N4)** | envelope + orçamento + janela de veto + uma-em-voo | 6.4 + 🔴 **`ALERT_WEBHOOK_URL` ligada** | A máquina propõe e roda campanhas; o dono veta |

**Dependência externa desta fase inteira:** o **risco nº 1 do `PROGRESSO.md`** (ninguém é avisado
quando quebra). Ele é *forte* em 6.4 e **bloqueante** em 6.5.

**Critério de aceite de cada fase — o mesmo de sempre neste projeto:** comportamento observável
quando a regra dispara, não teste unitário da função. Para 6.0 especificamente: uma mensagem fria
real enviada, e a linha de `ApproachOutcome` aparecendo com `delivered=true` depois do webhook. Sem
isso, 6.0 é mais uma função sem chamador.

---

#### 8.11.8 O que eu recomendo NÃO fazer

Este projeto já entregou quatro funções sem chamador e três telas prometendo controle inexistente.
Cinco partes do pedido caem exatamente nessa armadilha:

1. **Não construir tabela de agregado/rollup, nem "dashboard de IA", antes de existir desfecho
   medido.** Tela de métrica sem dado é a terceira tela prometendo controle que não existe.
2. **Não montar "equipe de agentes" conversando entre si.** É a metáfora do dono, não a arquitetura
   dele: mais caro, mais lento, e — o que decide — impossível de atribuir. Pipeline determinístico
   com um passo de redação entrega o mesmo e é inspecionável passo a passo.
3. **Não pular para N4.** Autonomia de público antes de haver desfecho medido é a máquina escolhendo
   com base em nada, em escala, com o número do dono. É o erro caro desta fase.
4. **Não fazer fine-tuning nem RAG sobre o histórico próprio.** Com dezenas a centenas de respostas
   não há sinal a extrair; o retorno é zero e o custo de manutenção é permanente.
5. **Não gerar no envio**, e **não** deixar a saída do modelo contornar G1–G11. O texto gerado é
   **entrada** do portão, nunca substituto dele.
6. **Não ampliar a coleta para "enriquecer o contexto da IA".** Buscar sócio, e-mail, faturamento ou
   conteúdo do site derruba a base legal da §7.1. Mensagem melhor não vale a base legal.
7. **Não tratar "ler os templates de forma dinâmica" como o modelo lendo arquivos.** A tradução certa:
   os templates **são** a biblioteca de ângulos, lidos do banco, e a inteligência está em **escolher**
   qual serve para este lead.

---

#### 8.11.9 Riscos específicos da fase

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R-IA-1 | **Detalhe inventado numa abordagem fria** | média sem mitigação, **baixa com ela** | 🔴 destrói credibilidade na 1ª frase e vira denúncia (= ban) | Ângulo calculado (A33) + `factsCited[] ⊆` entrada + validadores puros + `offNiche → generic` |
| R-IA-2 | **O laço aprende do sinal errado** (descadastro contado como resposta) | **certa hoje** | 🔴 a máquina passa a preferir a abordagem que mais irrita | A35, na fase 6.0, antes de qualquer geração |
| R-IA-3 | **Número pequeno lido como tendência** (1 em 3 = "33%") | alta | decisão errada com confiança | Piso de amostra aplicado **no servidor**; sem piso, a tela não mostra percentual |
| R-IA-4 | **Viés de sobrevivência** no conjunto de aprendizado | média | toda abordagem parece melhor do que foi | `ApproachOutcome` não cascateia na eliminação |
| R-IA-5 | **Número citado envelhecido** (`rating`/`reviewCount` de 8 meses) | média | erro público sobre dado que o destinatário conhece melhor | Fatos citáveis expiram com `lastSeenAt` |
| R-IA-6 | **N4 queima a base** sem disparar nenhum limite de anti-ban | baixa, **alta se N4 chegar cedo** | 🔴 ativo destruído, e silenciosamente | Orçamento diário de contatos frios (teto de dono diferente da cota por número) |
| R-IA-7 | Provedor fora do ar / chave vencida / teto estourado | média | campanha travada | IA é conselho (§8.10): cai no texto base do ângulo, grava `source='template'`, contador visível |

**Continua na §8.11.16** com os riscos R-IA-8 a R-IA-13, que vêm das etapas ②, ③ e ④ (profecia
auto-realizável do ranking, texto de terceiro saindo da infra, descarte irreversível, recorte maior
que a cota, campanhas por ângulo serializando e resposta sumindo em silêncio).

---

#### 8.11.10 Decisões que dependem do dono

| # | Decisão | Por que não posso fechar sozinha |
|---|---|---|
| D-IA-1 | **Usar API externa (Anthropic) e aceitar que nome/categoria/cidade/avaliações do lead saiam da infra?** | É dado comercial público e o risco é baixo, mas é tratamento com operador externo — decisão do controlador, não da arquitetura. Se "não", a fase para na 6.1, que já entrega a maior parte do valor |
| D-IA-2 | **Até que degrau da escada ele quer chegar** — e confirma que N4 exige `ALERT_WEBHOOK_URL` ligada? | Define o tamanho da fase. N0→N3 é construção incremental; N4 é uma mudança de natureza do sistema |
| D-IA-3 | **Quais ângulos entram no catálogo v1** e quem escreve os 6-10 textos base | O catálogo tem que refletir o que ele vende (sites, sistemas, plataformas, marketplaces, apps, automação, chatbots — §8.9). É trabalho de vendedor, não de arquiteta |
| D-IA-4 | **Piso de amostra para declarar um ângulo vencedor.** Proponho **30 desfechos por ângulo** | É baixo estatisticamente e é o que o volume permite. Prefiro um número explícito e conservador a um critério implícito — mas o número é uma aposta dele |
| D-IA-5 | **Teto de gasto mensal com IA** | Tecnicamente irrelevante (unidades de dólares); serve como freio de sanidade contra laço acidental |
| D-IA-6 | **`ApproachOutcome` sobrevive a um pedido de eliminação LGPD?** Minha leitura: **sim** — não guarda telefone, nome nem `leadId` após o `SetNull` | Há um resíduo teórico (cidade + categoria + bucket pode ser raro em município pequeno). Avalio o risco como baixo e o benefício como estrutural, mas quem assume é o controlador |
| D-IA-7 | **`offNiche` sai das campanhas frias, ou só da geração?** Recomendo sair das campanhas | Colide com a decisão travada "marcar, nunca descartar" — que era sobre **coleta e listagem**. Estender para "não abordar" é decisão nova, dele |
| **D-IA-8** 🆕 | **Os pesos do score v1** (tabela da §8.11.12.1). Proponho `no_website +30`, `reputation +15`, `high_volume +10`, `fresh_data +10`, `niche_match +10`, `has_traction +5`, `never_contacted +10`, `stale_data −10`, `off_niche −25`, `no_rating −5` | A **existência** dos componentes é arquitetura; o **valor** de cada um é julgamento comercial de quem vende. Meus números são chute honesto e explícito, feitos para serem discordados — é para isso que o perfil é versionado |
| **D-IA-9** 🆕 | **O modo e o tamanho do recorte padrão.** Proponho `capacity` com **5 dias úteis** | É a pergunta "quantos leads eu quero olhar por semana?", e só ele sabe. 5 dias é o horizonte em que ainda dá para ler as respostas que voltam antes de montar a próxima |
| **D-IA-10** 🆕 | **Classificar resposta com modelo externo — sim ou não?** Recomendo **decidir depois**, com o número de `needs_human` da fase 6.1R na mão | É materialmente diferente de D-IA-1: ali sai dado comercial público; aqui sai **texto escrito por uma pessoa**, que pode conter qualquer coisa. Decisão do controlador, e só vale a pena se a triagem manual estiver de fato doendo (§8.11.14.4) |
| **D-IA-11** 🆕 | **Parar em N4a (monta e não dispara) ou seguir para N4b?** Ele já decidiu N4a; isto é só a confirmação de que N4b continua fora até a medição justificar | Já tomada por ele e honrada no desenho. Registrada aqui porque N4b muda a natureza do sistema e não deve entrar por inércia (§8.11.13) |
| **D-IA-12** 🆕 | **Aceita gastar ~10% da cota com leads que o score reprovou** (exploração de público)? | É cota escassa gasta de propósito em quem achamos pior. Se ele recusar, a consequência fica registrada: o score v1 vira opinião permanente e a v2 não tem como nascer (§8.11.15) |
| **D-IA-13** 🆕 | **As categorias de desfecho da etapa ④** — a lista da §8.11.14.1 é partida, não chegada | O vocabulário é aberto justamente porque a lista certa aparece depois de ele ler cem respostas reais. O que é arquitetura é o mapeamento para o funil (A44), não os nomes |
| **D-IA-14** 🆕 | **Lead com resposta `not_interested`/`wrong_person` sai das campanhas frias seguintes?** Recomendo **sim**, como exclusão (`negativeReply`), não como penalidade de score | É primo de D-IA-7 e da mesma família: "marcar, nunca descartar" foi decidido para coleta e listagem. Insistir com quem já disse não é onde o risco de denúncia mora, mas quem assume é ele |

---

#### 8.11.11 🆕 v1.5 — O fluxo de cinco etapas: o enquadramento que muda o resto

**Origem:** o dono descreveu o fluxo que quer, com as palavras dele — *"um sistema que faz a busca por
determinado nicho, classifica automaticamente os mais promissores leads, selecionando os melhores, e
depois faz uma campanha especificamente voltada para eles, (…) para filtrar quem realmente tem
interesse, para darmos continuidade ou não com esses leads"*. O Atlas apontou que o fluxo parava cedo
demais e o dono concordou. O escopo aprovado tem **cinco** etapas:

```
① busca  →  ② CLASSIFICAÇÃO  →  ③ CAMPANHA montada para o recorte
                                    →  ④ RESPOSTA lida e classificada  →  ⑤ continuar ou não
```

As etapas ②, ③ e ④ são novas. A ④ é a que fecha o laço: sem ela, o sistema automatiza o trabalho
**barato** (mandar) e devolve o **caro** (ler e decidir) na mão do dono, exatamente onde o volume dói.

**Três teses que este desenho precisa honrar — elas não são preâmbulo, são o que decide os
contratos abaixo.**

**1. Ranquear não é refinamento; é obrigatório, e o motivo é a cota.** A `WARMUP_TABLE`
(`packages/core/src/whatsapp/warmup.ts`, lida em produção) dá **20 mensagens/dia** a um número no dia
1, 40 no dia 3, 70 no dia 5 — 300 só a partir do dia 22. Com um número novo, uma campanha de 200
alvos leva **dez dias úteis**. Quando só dá para falar com 20 pessoas hoje, **quem** se escolhe é o
jogo inteiro. A classificação não existe para "melhorar a conversão": existe porque **a capacidade é
escassa por desenho** — e a escassez é anti-ban, ou seja, não vai embora comprando servidor.

**2. A pontuação mede ENCAIXE, não INTENÇÃO.** Tudo que coletamos (§8.11.2) diz *"este negócio
parece precisar do que você vende"*. **Nada** do que coletamos diz que ele tem orçamento, prioridade
ou vontade agora. Uma clínica 4.8 sem site pode ter **decidido** não ter site. Por isso, escrito com
estas palavras e repetido na tela:

> 🔒 **O ranking é a HIPÓTESE. A resposta é a EVIDÊNCIA.**
> A etapa ② ordena palpites; só a etapa ④ produz fato. Chamar o topo da lista de "os melhores leads"
> antes de qualquer resposta é prometer o que o dado não sustenta — e é assim que um ranking
> plausível vira crença imune a correção.

**3. Classificar a RESPOSTA é o uso de IA mais seguro e mais valioso deste sistema.** Comparado a
gerar a abordagem, a diferença não é de grau:

| | IA que **escreve** (§8.11.2, N1-N2) | IA que **lê** (etapa ④) |
|---|---|---|
| O que ela faz | produz afirmação sobre o negócio de um terceiro | interpreta uma frase que o terceiro escreveu |
| Pode inventar fato? | sim — é o risco R-IA-1, e toda a §8.11.2 existe para contê-lo | **não há fato a inventar**: a entrada é o texto, a saída é uma categoria de lista fechada |
| Chega no celular de alguém? | **sim** | **nunca** — a saída não é enviada a ninguém |
| Erro custa o quê? | credibilidade na primeira frase, denúncia, ban | um item classificado errado numa caixa que o humano revisa |
| Responde a pergunta do dono? | indiretamente | **diretamente**: "continuar ou não com esse lead" |

Se houvesse **um só** lugar para colocar IA neste produto, seria este. É por isso que a etapa ④ ganha
contrato próprio (§8.11.14) e entra no plano **antes** do assistente de redação em lote.

**Atualização da tabela de peças da §8.11.1** — a linha "Segmentação (filtro de público) · reuso"
estava incompleta: ela descreve o **universo**, não o **recorte**. Substituir por:

| Peça | Mora em | Existe hoje? | Natureza |
|---|---|---|---|
| Filtro do universo (nicho, cidade, UF) | `leadFilterSchema` + `POST /campaigns` | **Sim** (falta `minReviewCount`) | reuso |
| **Elegibilidade** (6 exclusões + contagem por motivo) | `campaigns.ts#classifyAudience` | **Sim, e já devolve os números** | reuso — **nada de score aqui** (A39) |
| **Pontuação e recorte** | `packages/core/src/approach/score.ts` (puro) | Não | função pura, mesma passagem do ângulo (A42) |
| Perfil de pesos versionado | `ScoringProfile` (Postgres) | Não | dado, não código |
| Ordem de envio dentro do recorte | materialização em `campaigns.ts` | Parcial (`scheduledFor`) | regra pura (A48) |
| **Triagem da resposta por regra** | `packages/core/src/inbox/classify.ts` (puro) | Parcial (só `detectOptOut`) | função pura |
| **Classificação assistida da resposta** | `packages/ai` + job `classify-reply` | Não | I/O externo, **substituível por no-op** (A45) |
| Caixa de entrada / decisão de funil | `apps/web` (tela) + `PATCH /leads/:id` | Parcial | **humano decide** (A44) |

---

#### 8.11.12 🔒 Etapa ② — classificação e recorte (CONTRATO — Cronos e Vega implementam)

**O que já existe e não será reescrito.** `classifyAudience` (`apps/web/src/lib/services/campaigns.ts`)
já retira do público, **em ordem e contando cada lead em um motivo só**: sem telefone, `phoneType !==
'mobile'`, opt-out, telefone duplicado, contatado nos últimos N dias, e pendente em outra campanha não
terminal. E já devolve `audience.excluded` com os seis contadores, de modo que
`totalMatched = eligible + Σ excluded`. **Isto é elegibilidade, e está certo.**

**O que muda é a ORDEM, e é aqui que mora o erro caro.**

> 🔒 **A39 — elegibilidade corta antes; o score só ordena depois, e nunca exclui.**
> Ranquear o universo e depois cortar os 200 melhores entrega um recorte que a elegibilidade
> esvazia: sobram 120, e — pior que o número — **os 80 que faltam não são substituídos pelos 201º a
> 280º**, que eram elegíveis e ficaram de fora. O portão de envio confirma o motivo: G4
> (`send-guard.ts`, `phone.type !== 'mobile'` → `LEAD_NOT_MOBILE`) manda o alvo para
> `skipped/landline`, que é **terminal** (§6.8.5). **Regra geral: o que o portão vai recusar
> terminalmente não deveria ter entrado no recorte.** Celular, opt-out e contato recente são
> **elegibilidade**; nota, avaliações e ausência de site são **ranking**. Nenhum critério de
> elegibilidade vale pontos, e nenhum ponto vira exclusão.

Pipeline da montagem, na ordem exata:

```
filtro (universo)  →  classifyAudience (elegibilidade, já existe)
                   →  scoreAndAngle (puro, uma passagem)      ← NOVO
                   →  recorte (quantos cabem)                  ← NOVO
                   →  ordem de envio (intercalada por ângulo)  ← NOVO (A48)
                   →  materialização dos alvos (já existe, A27)
```

**Uma nova exclusão, vinda da etapa ④:** `negativeReply` — lead cuja última resposta foi classificada
`not_interested` ou `wrong_person`. É consulta, **não coluna nova no `Lead`** (o dado já está em
`ReplyClassification`, §8.11.14), e entra como sétimo motivo em `campaignAudienceExcludedSchema`.
Motivo de ser exclusão e não penalidade de score: quem já disse "não" e continua na lista é o caso em
que insistir custa denúncia, e penalidade só empurra para baixo — não impede.

##### 8.11.12.1 A pontuação: explicável por componente, ou não é pontuação

> 🔒 **A40 — score sem decomposição não existe.** Todo score persistido guarda os **componentes que o
> formaram** e o **`scoringProfileId`** que os pesou. A tela mostra "sem site +30 · nota 4.8 e 180
> avaliações +15 · dado fresco +10 = 55", nunca "55". Dois motivos, e o segundo é o que decide: o dono
> precisa **confiar** ("por que este e não aquele?") e precisa poder **discordar ajustando os pesos**,
> em vez de brigar com a máquina. Um número opaco não admite discordância — só obediência ou rejeição.

```ts
// packages/core/src/approach/score.ts — puro, sem I/O, testável com fixture
export type ScoreComponent = { key: string; label: string; points: number };
export type LeadScore = {
  score: number;                 // 0..100, clamp
  components: ScoreComponent[];  // Σ points (antes do clamp) === rawScore
  rawScore: number;
};
export type ScoredLead = LeadScore & { angle: ApproachAngle; citableFacts: ApproachFact[] };

/** ÚNICA passagem: ângulo, fatos citáveis e score saem juntos (A42). */
export function scoreAndAngle(lead: ScorableLead, weights: ScoringWeights, now: Date): ScoredLead;
```

> 🔒 **A42 — ângulo e score saem da MESMA passagem.** Um lead bem pontuado *porque* tem nota alta e
> não tem site **é** o `reputation_no_website` do catálogo da §8.11.2. Calcular os dois em funções
> separadas garante duas coisas: que eles divergem (o topo do ranking recebendo o ângulo `generic`) e
> que alguém escreve o mesmo predicado duas vezes. Este projeto já pagou esse padrão quatro vezes — a
> última, três cópias manuais da chave do dia civil. **Uma função, uma entrada, dois campos na saída.**

**Catálogo de componentes v1** (os pesos são chute honesto e são do dono — D-IA-8; a **existência** dos
componentes é arquitetura, o **valor** não é):

| `key` | Predicado | Pontos (default) | Por quê |
|---|---|---|---|
| `no_website` | `website == null` | **+30** | o ângulo mais forte do catálogo §8.11.2 |
| `reputation` | `rating >= 4.5 && reviewCount >= 30` | +15 | negócio que funciona tem com o que pagar |
| `high_volume` | `reviewCount >= 100` | +10 | movimento = dor de atendimento manual |
| `has_traction` | `reviewCount >= 10` | +5 | existe de verdade, não é ficha morta |
| `fresh_data` | `lastSeenAt <= 60 dias` | +10 | mesmo corte que libera citar números (§8.11.2 regra 3) |
| `niche_match` | `offNiche == false` | +10 | a `category` é confiável neste lead |
| `never_contacted` | nenhuma `Message` outbound | +10 | primeiro contato rende mais que reinsistência |
| `stale_data` | `lastSeenAt > 180 dias` | **−10** | pode ter fechado |
| `off_niche` | `offNiche == true` | **−25** | ângulo forçado a `generic` (§8.11.2) → abordagem mais fraca |
| `no_rating` | `rating == null` | −5 | invisível no Maps, e não sabemos por quê |

**O que NÃO pontua, por decisão:** `phoneType` (é A39), opt-out (é A39), cidade/UF (é escolha
comercial do filtro, não qualidade do lead), e `name` (é razão social com ruído, §8.11.2 regra 4).

**De onde vem o critério — os dois, e separados de propósito:**

| Camada | Quem define | Escopo | Onde mora |
|---|---|---|---|
| **Filtro** — *quem entra no universo* | o dono, **por campanha** | nicho, cidade, UF, faixa de avaliações | `leadFilterSchema` (já existe) |
| **Perfil de pesos** — *como se ordena dentro dele* | o dono, **uma vez, reusável** | os componentes acima | `ScoringProfile` (novo) |

Juntar os dois obrigaria a redescrever "o que é um lead bom" em cada campanha, e tornaria duas
campanhas **incomparáveis** sem ninguém perceber. Separados, o `scoringProfileId` é o que autoriza
comparar o score de janeiro com o de março.

```prisma
/// Perfil de pesos da pontuação de leads (ARQUITETURA §8.11.12). IMUTÁVEL:
/// editar pesos CRIA uma versão nova, nunca altera a linha existente — o
/// score guardado no alvo aponta para o perfil que o produziu, e um perfil
/// mutável faria a explicação de ontem ser reescrita com os pesos de hoje
/// (mesma razão de `Campaign.renderedTemplateSnapshot` existir).
model ScoringProfile {
  id        String   @id @default(cuid(2))
  name      String
  version   Int
  /// `ScoringWeights` — validado por Zod em `@inno/contracts` na leitura.
  weights   Json
  notes     String?
  createdAt DateTime @default(now())

  createdById String?
  createdBy   User?   @relation("ScoringProfileAuthor", fields: [createdById], references: [id], onDelete: SetNull)

  campaignTargets CampaignTarget[]

  @@unique([name, version])
  @@map("scoring_profiles")
}
```

##### 8.11.12.2 Quando roda, e por que não é no fim do scraping

**Roda na montagem da campanha** (na pré-visualização e no `POST /campaigns`), sobre o conjunto **já
elegível**, em memória — e o resultado é **snapshotado no alvo**.

| Alternativa | Por que não |
|---|---|
| Calcular no fim do scraping e persistir em `Lead.score` | `rating`, `reviewCount`, `website` e `category` são `MACHINE_UPDATABLE_FIELDS`: mudam a cada re-coleta. O score persistido no lead **envelhece em silêncio** e exige recálculo em todo upsert — e um recálculo que ninguém chama é a quinta função-sem-chamador deste projeto |
| Calcular sempre na hora e **não** persistir | Nada explica, seis meses depois, por que aquele lead entrou na campanha — e dois recortes feitos em datas diferentes deixam de ser comparáveis, porque os pesos podem ter mudado no meio |
| **Calcular na montagem + snapshot no alvo** ✅ | O score é fresco quando decide, e **congelado** quando é auditado. Mesma decisão já tomada para o telefone (`CampaignTarget.phoneE164`) e para o texto (`renderedTemplateSnapshot`) |

**Limite honesto de escala, porque o código é assim hoje:** `loadCandidateLeads` faz `findMany` **sem
`take`** — carrega o universo inteiro do filtro em memória, e o ranking precisa disso para ordenar.
Com centenas ou poucos milhares de candidatos (a realidade de uso próprio, A23) é irrelevante; com
200 mil não é. Portanto: **`SCORING_MAX_CANDIDATES` (default 20.000)** — acima disso a rota recusa com
`422 AUDIENCE_TOO_BROAD_TO_RANK` e pede um filtro mais estreito. Recusar é melhor que ranquear 200 mil
linhas no Node e descobrir isso pelo timeout. `loadCandidateLeads` precisa passar a selecionar também
`website, category, rating, reviewCount, offNiche, lastSeenAt, uf, cityId` — hoje traz só
`id, phoneE164, phoneType, createdAt`.

##### 8.11.12.3 Quantos entram: a conta da cota, na tela, antes de criar

> 🔒 **A41 — o recorte é dimensionado pela CAPACIDADE, não pelo tamanho do filtro.** Montar uma
> campanha de 500 quando o número faz 20/dia produz uma campanha de **25 dias úteis** — cinco semanas
> em que os alvos 300 a 500 esperam sem que ninguém tenha decidido isso. A conta (`alvos ÷ cota/dia =
> dias`) aparece **na montagem**, não é descoberta depois. O default não é "todos".

O contrato **já tem metade disso**: `campaignEstimateSchema` devolve `{ days, messagesPerDay,
finishesAround }`, e `computeEstimate` já soma a cota efetiva de cada instância escolhida hoje. O que
falta é (a) o recorte que usa esse número e (b) ver a conta **antes** de materializar os alvos — hoje
o `POST` já cria tudo (A27), então "criar para ver" custa uma campanha descartada.

```ts
// packages/contracts/src/campaign.contract.ts — NOVO
export const audienceSelectionSchema = z.discriminatedUnion('mode', [
  /** default — "o que cabe em N dias úteis de cota". `days` default 5. */
  z.object({ mode: z.literal('capacity'), days: z.number().int().min(1).max(30).default(5) }),
  z.object({ mode: z.literal('topN'), n: z.number().int().min(1) }),
  z.object({ mode: z.literal('minScore'), min: z.number().int().min(0).max(100) }),
  /** explícito, nunca default — exige `acknowledge: true` quando days > 10. */
  z.object({ mode: z.literal('all'), acknowledge: z.boolean().optional() }),
]);

export const audienceRankedSchema = z.object({
  scoringProfileId: idSchema,
  selected: z.number().int().min(0),
  leftOut: z.number().int().min(0),        // elegíveis que não couberam
  scoreRange: z.object({ min: z.number(), max: z.number() }),
  explore: z.object({ count: z.number().int().min(0), pct: z.number() }), // §8.11.15
  byAngle: z.array(z.object({ angle: z.string(), count: z.number().int(), avgScore: z.number() })),
});
```

| Rota | Corpo/resposta | Observação |
|---|---|---|
| `POST /api/v1/campaigns/preview` | `{ audience, selection, scoringProfileId?, settings?, instanceIds }` → `{ audience: {...}, ranked, estimate, sample[] }` | **Dry-run: não cria nada.** É a tela onde o dono vê "412 elegíveis · cabem 100 em 5 dias · sobram 312" antes de decidir. `sample[]` = 10 alvos do topo com score decomposto |
| `POST /api/v1/campaigns` | ganha `selection` e `scoringProfileId` opcionais | Sem `selection`, comportamento atual (`all`) — **compatível**, mas a tela sempre manda `selection` |

E a resposta de criação passa a devolver `ranked`, além do `audience`/`estimate` que já devolve.
`computeEstimate` passa a receber o tamanho **do recorte**, não o de `eligible` — hoje recebe
`classification.eligible.length`, o que sobrestima os dias assim que o recorte existir.

**Sobre `minScore`:** é o modo mais perigoso dos três, porque um corte de "≥60" pode devolver 3 ou
3.000 e o dono não tem como saber qual antes. Por isso ele **só existe atrás do `preview`**, que
mostra a contagem. Recomendação de default: `capacity` com 5 dias — uma semana útil de trabalho, que
é o horizonte em que o dono consegue de fato olhar as respostas que voltam.

##### 8.11.12.4 v1 é heurística. v2 aprende. E "ranking inteligente" não é nenhuma das duas

Dito explicitamente, porque **"ranking inteligente" é a expressão que vira caixa-preta** se ninguém
escrever o contrário:

- **v1 (fase 6.1): heurística explicável.** Pesos escritos por uma pessoa, componentes visíveis,
  perfil versionado. Não aprende nada. É uma opinião organizada — e é honesta sobre isso.
- **v2 (depois de `ApproachOutcome` ter dado):** o job estratégico semanal (§8.11.6, modelo caro sobre
  **agregado**, A38) lê a tabela de desfecho e **propõe** um perfil novo: *"leads com `no_website`
  responderam 3,1× mais; `high_volume` não separou nada; sugiro 40/0"*. O dono lê, discorda ou aceita,
  e a aceitação **cria uma versão nova** do perfil.
- **O que NUNCA acontece: ajuste automático de pesos.** Dois motivos, e os dois são deste projeto, não
  genéricos. (1) Com dezenas a centenas de respostas (A23), a diferença entre 3,1× e 1,0× é ruído —
  o mesmo argumento do piso de amostra da §8.11.3. (2) Pesos que mudam sozinhos **invalidam toda
  comparação histórica em silêncio**: o score de março deixa de significar o que significava em
  janeiro, e ninguém recebe aviso. O perfil imutável e versionado é o que impede isso.

---

#### 8.11.13 🔒 Etapa ③ — a campanha montada para o recorte (CONTRATO)

**A pergunta:** se os 200 do recorte têm quatro ângulos diferentes, mandar uma mensagem única joga
fora a razão de ter classificado. Então: **quatro campanhas (uma por ângulo)** ou **uma campanha com
ângulo por alvo**?

> 🔒 **A48 — um recorte é UMA campanha, com ângulo por alvo e ordem intercalada entre ângulos.**

**O argumento que decide não é de ergonomia; é do motor, e está no código.** `dispatch-tick.job.ts`
busca `campaign.findMany({ where: { status: 'running' }, orderBy: { startedAt: 'asc' } })` e processa
uma campanha por vez, em laço, até a **cota da instância** se esgotar — e a cota é lida de
`InstanceDailyStat.sentToday` (`loadInstanceGateInfo`), ou seja, é **do número**, compartilhada por
todas as campanhas. Consequências, nesta ordem:

1. **Campanhas paralelas não somam capacidade.** Quatro campanhas sobre o mesmo número continuam
   fazendo 20 mensagens/dia no total.
2. **Elas não se intercalam: serializam.** A mais antiga (`startedAt asc`) consome a cota do dia
   inteira antes de a segunda receber qualquer coisa.
3. **E aí a medição morre.** O ângulo A sai nos dias 1-3, com `warmupDay` 5 e nos horários da manhã;
   o ângulo B sai nos dias 4-6, com `warmupDay` 8 e em outros horários. A comparação entre ângulos
   vira comparação entre **semanas diferentes** — exatamente os confundidores que a §8.11.3 gravou em
   `ApproachOutcome` (`instanceId`, `warmupDay`, `hourOfDay`) para poder controlar. Separar em
   campanhas **cria** o confundidor que o resto da fase existe para eliminar.
4. **E o `estimate` de cada campanha mentiria**: `computeEstimate` calcula os dias como se aquela
   campanha tivesse a cota inteira. Quatro campanhas mostrando "3 dias" cada, que na prática levam 12.

**Ordem de envio dentro da campanha — round-robin entre ângulos, score desc dentro de cada ângulo.**
Não é detalhe: ordenar o recorte só por score desc faz os primeiros dias saírem com um ou dois ângulos
só (os que pontuam mais alto) — e se a campanha for `halted` no dia 2 (§6.6, acontece), mediu-se um
ângulo e nenhum outro. Intercalar dá a cada ângulo a mesma distribuição de dias, horas, instâncias e
`warmupDay`, que é a condição para a comparação ser honesta. O "melhor primeiro" continua valendo —
**dentro** de cada ângulo.

**O custo aceito, e como pagá-lo:** numa campanha só, o dono não consegue pausar **um** ângulo com a
pausa que existe (que é da campanha). Ação nova: `POST /api/v1/campaigns/:id/angles/:angle/suspend` →
`updateMany` dos alvos `pending` daquele ângulo para `status='skipped', skipReason='angle_suspended'`.
É **terminal** e é assim de propósito: não toco no `claimNextCampaignTarget`, que é hot path auditado
(o `ORDER BY "scheduledFor"` sem `NULLS FIRST` está lá por uma razão de planner documentada, e
"estacionar" alvo com `scheduledFor` nulo quebraria a invariante "nunca é NULL a partir do `start`").
Se o dono mudar de ideia, os leads voltam numa campanha nova — ação normal, e rara.

**Duas consequências de contrato, ambas obrigatórias:**

1. **`Campaign.templateId` continua obrigatório, e passa a significar "o template base do ângulo de
   fallback"** (`generic`). O texto que sai é `target.renderedBody` quando existe (regra já fixada na
   §8.11.5); `renderedTemplateSnapshot` vira o caminho de fallback, não o caminho principal.
2. 🔴 **A validação de nota de descadastro no `start` precisa cobrir TODOS os corpos.** Hoje
   `startCampaign` chama `hasOptOutNotice(fixedPart)` sobre **o template da campanha** e devolve
   `409 MISSING_OPTOUT_NOTICE`. Com ângulo por alvo, um template de ângulo sem a nota passaria por ali
   e só seria barrado no envio, alvo a alvo, pelo G10 — cada um virando `failed`, um por um, com a
   campanha parecendo quebrada. O `start` valida **cada `renderedBody` distinto** (ou cada template de
   ângulo presente no recorte) e lista no erro **quais** ângulos falharam.

**Onde isso cai na escada — e por que a escada ganha um degrau.** Montar o público automaticamente é
N4 na tabela da §8.11.4, mas **montar e não disparar** é outra coisa: o autor que N4 acrescenta é
"escolhe quem recebe"; "aperta o botão" continua sendo o humano. Os dois juntos é que fazem o ator
autônomo de segundo grau que justifica os seis guarda-corpos. Então a §8.11.4 passa a ter:

| Nível | Quem escreve o texto | Quem monta o público | **Quem aperta o disparo** | Guarda-corpos |
|---|---|---|---|---|
| N0 | humano | humano | humano | os que já existem |
| N1 | humano + assistente | humano | humano | §8.11.4 |
| N2 | máquina (revisão por ângulo) | humano | humano | §8.11.4 |
| N3 | máquina (escolhe o ângulo) | humano | humano | §8.11.4 |
| **N4a** 🆕 | máquina | **máquina** — a campanha nasce `draft` | **humano** | envelope declarado · exclusões duras · teto de rascunhos não revisados |
| **N4b** | máquina | máquina | **máquina**, com janela de veto | **os seis de A37**, nenhum opcional |

**Decisão do dono, já tomada, que esta arquitetura honra: para em N4a.** Classificar e montar são
automáticos; **apertar o disparo continua humano**, porque hoje "os melhores" é palpite com zero
retorno de dado (tese 2 da §8.11.11). No dia em que a medição mostrar "o ângulo X converte 3×", a
autonomia **conquista** a confiança em vez de tomá-la emprestada. A37 passa a se referir ao **N4b**;
o N4a tem três dos seis, e não inclui a janela de veto nem o `ALERT_WEBHOOK_URL` obrigatório — porque
sem disparo automático, o pior caso de uma noite mal dormida é uma campanha `draft` esquisita na tela.

---

#### 8.11.14 🔒 Etapa ④ — ler e classificar a resposta (CONTRATO — a peça nova)

**O que existe hoje, verificado no código.** O funil `LeadStatus` é
`new → validated → contacted → responded → negotiating → won`, mais `discarded` alcançável de qualquer
ponto (`packages/core/src/leads/status.ts`). `contacted` e `responded` são `SYSTEM_ONLY_STATUSES`; o
webhook seta `responded` quando chega qualquer inbound. De `responded` em diante **não há automação
nenhuma**: existe caminho manual (ficha do lead e ação em massa, ambos por `checkStatusTransition` com
ator `'human'`), e **nada lê o conteúdo da resposta**. O sistema automatiza mandar e devolve ler na mão.

**Dois fatos do código que decidem o desenho desta etapa:**

1. 🔴 **`discarded` é IRREVERSÍVEL.** `checkStatusTransition` responde `não é possível sair de
   'discarded'` para **qualquer** destino e **qualquer** ator — nem o humano desfaz. E `to ===
   'discarded'` é liberado **antes** da checagem de ator, ou seja, uma regra automática *pode*
   descartar. Pode, e não vai: descartar por palpite de modelo é apagar um lead para sempre sem volta.
2. **Já existe um classificador determinístico, e ele é autoritativo.** `findOptOutTrigger`
   (`packages/core/src/optout/detect.ts`) casa uma lista fechada de 16 gatilhos, propositalmente
   permissiva ("na dúvida, bloqueia"). Note que **`sem interesse` já está na lista** — ou seja, parte
   do que o dono chamaria de "não tem interesse" hoje **já é opt-out duro**, com bloqueio permanente
   do telefone. A categoria `not_interested` da etapa ④ só existe para o que a regra **não** pegou.

##### 8.11.14.1 As categorias de desfecho

Vocabulário **aberto** (`String` validada por Zod), pelo mesmo motivo de `LeadActivity.type` e de
`angle`: categoria nova não pode exigir migração, e esta lista vai mudar com a experiência do dono.

| `category` | O que é | Quem detecta | Move o funil? | Sugestão exibida |
|---|---|---|---|---|
| `opt_out` | pediu para sair | **regra**, autoritativa | **nunca** `responded`; alvo → `skipped/opted_out` | nenhuma — já está feito |
| `interested` | quer saber mais, marcar conversa | modelo ou humano | não | "mover para `negotiating`" |
| `pricing` | pediu preço/proposta | modelo ou humano | não | "mover para `negotiating`" |
| `not_now` | interesse futuro ("me chama em março") | modelo ou humano | não | "lembrete + manter em `responded`" |
| `wrong_person` | não é o responsável / número trocado | modelo ou humano | não | "descartar" — **sempre com clique** |
| `not_interested` | recusa **sem** pedir para sair | modelo ou humano | não | "descartar" — **sempre com clique** |
| `noise` | figurinha, "ok", engano, áudio, vCard | regra + modelo | não | nenhuma |
| `needs_human` | não classificável, IA fora do ar, confiança baixa | **fallback** | não | "precisa de olho humano" |

**Mapeamento para o funil, e por que ele é quase todo vazio:**

> 🔒 **A44 — classificar é automático; mover o funil não é.** Nenhuma classificação de resposta
> escreve `LeadStatus` além do `responded` que o webhook já escreve. `negotiating` e `won` exigem
> clique humano (o sistema não sabe se houve negociação — sabe que houve *uma frase*), e **`discarded`
> automático é proibido** porque a máquina de estados não tem volta de lá. O ator da sugestão é
> `'system'` (`LeadActivityActor.system`), nunca `'human'`: a sugestão vira `LeadActivity`
> `type='reply_classified'` na timeline do lead, e a transição continua saindo do `PATCH /leads/:id`
> com ator `'human'` — que é o que já funciona hoje.

Corolário técnico: `checkStatusTransition('responded','won')` é **ilegal** mesmo para humano (o funil
avança de um em um). Uma tela que ofereça "marcar como ganho" a partir de `responded` precisa fazer
dois passos, ou o `PATCH` devolve `422 INVALID_STATUS_TRANSITION`. Isso não é novo, mas fica aqui
porque a caixa de entrada é justamente onde alguém vai tentar.

##### 8.11.14.2 O caso "pediu para sair" — o defeito anterior que atravessa esta etapa

🔴 **Confirmado no código, de novo e com a linha:** em `handleInboundMessage`
(`apps/web/src/lib/services/webhook.ts`), a ordem é (a) `lead.status → 'responded'`, (b) `activeTarget`
com status em `sent|delivered|read` → `advanceCampaignTargetStatus(..., 'responded')`, e **só depois**
(c) `if (event.isOptOutRequest) registerOptOutFromInbound(...)`. E `registerOptOutFromInbound` chama
`skipPendingCampaignTargetsForPhone`, que — pelo nome e pelo efeito — só alcança alvos **`pending`**.
O alvo que acabou de ir para `responded` **fica lá**. Responder "SAIR" conta como resposta, hoje.

**O conserto é de ORDEM, não de mecanismo** — e isso é bom notícia para o Vega.
`advanceCampaignTargetStatus` já aceita levar um alvo de **qualquer** estado não-terminal direto para
`skipped` (só estado terminal é que não reabre). O que não dá para desfazer é o **contador**: passar
por `responded` incrementa `Campaign.respondedCount`, e o `skipped` depois incrementa
`skippedCount` — o alvo conta **duas vezes**, e o `respondedCount` fica permanentemente inflado pelos
descadastros. Por isso a correção não é "skipar depois": é **registrar o opt-out antes**, e nunca
deixar o alvo tocar `responded`.

**Como a etapa ④ trata isso: ela não trata — ela depende do conserto, e o conserto é da fase 6.0.**
Essa separação é deliberada. A etapa ④ precisa funcionar com zero IA (A45), e o opt-out é regra pura
que roda antes de qualquer classificação. Se a correção morasse aqui, ela chegaria junto com o
modelo — e o laço de aprendizado da §8.11.3 seria ligado antes dela.

Ordem correta no inbound, depois do conserto (é o contrato do 6.0, repetido aqui porque a etapa ④ se
encaixa exatamente nos dois ramos):

```
inbound → parser (regra) → isOptOutRequest?
  ├── SIM  → registerOptOut PRIMEIRO
  │          alvo ativo → skipped/opted_out   (não `responded`)
  │          lead.status NÃO avança para `responded`
  │          Campaign.respondedCount NÃO incrementa
  │          ApproachOutcome: optedOut=true, replied=false          (A35)
  │          ReplyClassification: category='opt_out', by='rule'
  │          ⛔ nenhuma chamada de modelo. O texto NÃO sai da infra.
  └── NÃO  → fluxo atual (`responded`) + ApproachOutcome.replied=true
             + ReplyClassification nasce `needs_human` e o job classifica
```

> 🔒 **A43 — a regra de opt-out é autoritativa e unidirecional.** A classificação pode **acrescentar**
> um `opt_out` que a regra não pegou ("por favor não me mande mais nada disso" sem gatilho literal);
> **nunca pode revogar** um que a regra pegou. Não há caminho, nem de humano, para "isto não era um
> pedido de saída" — porque o custo dos dois erros é assimétrico (§6.7: falso positivo custa 1 lead,
> falso negativo custa uma denúncia), e porque um modelo capaz de desfazer opt-out é um modelo capaz
> de esvaziar a proteção inteira num dia ruim.

**E o laço de aprendizado:** um sinal de desfecho ligado a `responded` sem esse conserto **aprende a
premiar a abordagem que mais irrita** — é o R-IA-2, e a etapa ④ o agrava, porque agora não é só uma
métrica errada na tela: é uma categoria (`opt_out`) que existiria misturada com `interested` dentro do
mesmo balde de "respondeu". A dependência é dura: **6.1R não começa antes de 6.0 estar em produção.**

##### 8.11.14.3 Onde a classificação roda — e por que não no webhook

**Nunca dentro da transação do webhook.** O webhook precisa ser rápido, não pode falhar porque um
provedor externo está fora, e já faz um `$transaction` que toca `Message`, `Lead`, `CampaignTarget`,
`OptOut`, `LeadActivity` e `InstanceDailyStat`. Chamada de rede lá dentro é transação longa segurando
locks em tabela quente.

```
webhook (síncrono, regra pura)  →  cria ReplyClassification { category: 'needs_human', by: 'pending' }
                                →  enfileira job `classify-reply` (BullMQ)
job classify-reply (assíncrono) →  passada 1: REGRA (palavras-chave: "quanto custa", "qual valor",
                                     "quem fala", "não sou eu", "manda mais", "ok", "obrigado")
                                →  passada 2 (opcional): MODELO, só sobre o que a regra não resolveu
                                →  atualiza ReplyClassification + ApproachOutcome.replyCategory
```

> 🔒 **A45 — resposta não classificada é "precisa de olho humano", nunca "ruído".** O estado
> **inicial** da linha é `needs_human` — não é o estado de erro, é o default, e a classificação só o
> melhora. Se o job nunca rodar, se o provedor cair, se o teto de gasto estourar ou se a confiança
> vier baixa, a resposta aparece na caixa marcada para revisão e **nada se perde**. Modo degradado com
> sinal mais barulhento que o normal (regra 4 das lições de plano faseado): o contador de
> `needs_human` fica visível na tela, porque "a IA está fora há três dias" precisa parecer diferente
> de "ninguém respondeu".

```prisma
/// Classificação de uma resposta recebida (ARQUITETURA §8.11.14). NÃO guarda
/// texto: aponta para a `Message`, que já tem `body` (retenção de 12 meses,
/// §7.5). Cascade com a Message/Lead — o SINAL de aprendizado que precisa
/// sobreviver à eliminação LGPD é `ApproachOutcome.replyCategory`, anônimo.
model ReplyClassification {
  id        String  @id @default(cuid(2))

  messageId String  @unique
  message   Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  leadId String
  lead   Lead   @relation(fields: [leadId], references: [id], onDelete: Cascade)

  /// Vocabulário ABERTO, validado por Zod (como `angle` e `LeadActivity.type`).
  category     String
  /// `pending` | `rule` | `model` | `human` — quem produziu a categoria ATUAL.
  classifiedBy String
  /// 0..1, só quando `classifiedBy = 'model'`. Abaixo do piso → `needs_human`.
  confidence   Float?
  modelId       String?
  promptVersion String?

  /// Transição de funil SUGERIDA — nunca aplicada por este registro (A44).
  suggestedStatus String?
  /// Preenchido quando o humano revisa: confirma, corrige a categoria, ou ignora.
  reviewedAt      DateTime?
  reviewedById    String?
  reviewedBy      User?     @relation("ReplyReviewer", fields: [reviewedById], references: [id], onDelete: SetNull)
  /// Categoria que o humano disse ser a certa, quando diferente. É o único
  /// conjunto de treino honesto que este sistema vai ter — não sobrescrever
  /// `category`, senão o erro do modelo some e nunca é medido.
  humanCategory   String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  /// A caixa de entrada: "o que precisa de olho humano, mais recente primeiro".
  @@index([category, createdAt])
  @@index([reviewedAt, createdAt])
  @@map("reply_classifications")
}
```

**`ApproachOutcome` ganha três campos** (anônimos, sobrevivem à eliminação — é o sinal do laço):

```prisma
  replyCategory     String?    // categoria consolidada (humana vence a do modelo)
  replyClassifiedBy String?    // rule | model | human
  score             Int?       // §8.11.12 — o score do alvo no momento do envio
  scoringProfileId  String?    // SetNull — sem ele o score não é comparável
  exploreKind       String?    // null | 'audience' | 'angle'  (§8.11.15)
```

**Rotas:**

| Rota | Resposta | Observação |
|---|---|---|
| `GET /api/v1/inbox` | filtros: `category`, `needsReview`, período → lista paginada com lead, trecho e sugestão | É a tela da etapa ⑤ ("continuar ou não") |
| `PATCH /api/v1/inbox/:id` | `{ category?, reviewed: true }` | Correção humana. Grava `humanCategory`, **não** sobrescreve `category` |
| `POST /api/v1/inbox/:id/apply` | `{ status }` → delega ao `PATCH /leads/:id` | Atalho de UI; a regra de transição continua sendo a de sempre, com ator `'human'` |

Erros novos: `REPLY_CLASSIFICATION_UNAVAILABLE`, `SCORING_PROFILE_NOT_FOUND`,
`AUDIENCE_TOO_BROAD_TO_RANK`.

##### 8.11.14.4 LGPD: classificar resposta é mandar texto de terceiro para fora

Esta é a diferença material entre a etapa ④ e tudo que a §8.11 tinha até aqui. Mandar
`rating`/`categoria`/`cidade` para um operador externo é mandar **dado comercial público que a própria
empresa publicou** (§7.1). Mandar a resposta é mandar **texto livre escrito por uma pessoa**, que pode
conter nome próprio, e-mail, telefone pessoal, dado de saúde ("preciso remarcar minha consulta"), e o
que mais a pessoa tiver decidido escrever. Não é a mesma decisão, e não deve ser tomada junto.

**Fato atenuante, verificado:** o texto **já é persistido** em `Message.body` (o webhook grava todo
inbound) com retenção de 12 meses (§7.5). Classificar não cria armazenamento novo de texto — o
`ReplyClassification` de propósito **não guarda trecho nenhum**, só aponta. O que muda é a
**transmissão a um operador externo**.

**Escada de opções, da mais segura para a menos:**

| Opção | O texto sai? | Cobertura esperada | Veredito |
|---|---|---|---|
| **1. Só regra** (palavras-chave, como `detectOptOut` já faz) | **não** | alta nos casos frequentes: preço, "quem fala", "ok", agradecimento, "não sou eu" | ✅ **é por onde começa** (fase 6.1R) |
| **2. Regra + modelo sobre texto MINIMIZADO** | sim, redigido | quase total | ✅ recomendado **se e quando** o `needs_human` incomodar |
| 3. Modelo sobre o texto cru, com identificação do lead | sim, inteiro | total | ❌ desnecessário: a categoria não depende de saber **quem** escreveu |

> 🔒 **A46 — texto de terceiro só sai da infra minimizado e sem identidade.** Se a classificação por
> modelo for ligada: (a) sai o texto **redigido** — sequências de 4+ dígitos, e-mails e URLs
> substituídos por marcadores, em função pura testável em `@inno/core`; (b) **não** vão junto nome,
> telefone, `leadId`, cidade nem empresa — a categoria não precisa deles; (c) o modelo devolve
> **categoria + confiança**, nunca texto livre; (d) nada é enviado quando a regra já resolveu — e
> **nunca** no ramo `opt_out`; (e) provedor configurado sem retenção e sem treino sobre o enviado, e
> registrado no ROPA (`docs/lgpd.md`, §7.5) como operador, com a finalidade escrita: *triagem de
> resposta recebida*.

**Medir antes de ligar.** A recomendação operacional é a mesma do resto desta fase: rodar 6.1R (só
regra) e **contar** quantas respostas ficam em `needs_human`. Se forem poucas — e com dezenas de
respostas por semana, é o cenário provável — o modelo é custo, risco e um operador a mais no ROPA para
resolver um problema que não existe. A decisão fica com o dono (D-IA-10), com o número na mão.

---

#### 8.11.15 Os dois vieses de seleção — e eles não se confundem

Se só abordarmos os "melhores", nunca saberemos se os "piores" respondiam — e o perfil de pesos v2,
treinado nesse dado, **confirma o preconceito da v1 para sempre**. Isso tem nome (restrição de
amplitude: o preditor só é observado na faixa em que ele mesmo selecionou) e tem uma única cura
barata: mandar, de propósito, para alguns que o score reprovou.

**São DOIS problemas diferentes, com duas fatias diferentes:**

| | Exploração de **PÚBLICO** | Exploração de **ÂNGULO** |
|---|---|---|
| Pergunta | *o score prevê resposta?* | *qual abordagem converte mais?* |
| O que varia | **quem recebe** | **o que se diz** |
| Como é escolhido | sorteio **uniforme** entre os elegíveis **fora** do recorte | alvo já do recorte, recebe um ângulo que não é o vencedor |
| Quando existe | **desde o dia um** (fase 6.1) | só no **N3** (§8.11.4) |
| Marca | `exploreKind = 'audience'` | `exploreKind = 'angle'` |
| Sem ela | o score nunca é validável; a v2 herda o viés da v1 | o laço congela no primeiro ângulo que teve sorte |

> 🔒 **A47 — as duas fatias são disjuntas: um envio tem no máximo um `exploreKind`.** Um alvo de
> exploração de público usa **sempre o ângulo canônico** do lead (o calculado), nunca um experimental;
> um alvo de exploração de ângulo vem **sempre** do recorte por score. Cruzar as duas produz um envio
> cujo resultado ruim não é atribuível: foi o público errado ou a mensagem errada? Sem separação não
> há resposta, e o dado fica inutilizável para as duas perguntas ao mesmo tempo.

**Como a fatia de público é medida — e é aqui que ela paga o preço dela.** A pergunta "o score prevê
resposta?" é respondida **dentro da fatia aleatória**, e só lá: é o único conjunto em que a seleção
não decidiu quem entrou, e portanto o único em que a relação entre `score` e `replied` é lida sem o
próprio score no meio. Comparar "topo × exploração" diretamente mistura o efeito do score com o efeito
de ser topo. Por isso `ApproachOutcome.score` é gravado **cru**, não em bucket (ao contrário de
`rating`): a pergunta precisa do contínuo, e o número é derivado nosso — não identifica ninguém.

**Dimensionamento, com o custo dito em voz alta:** default **10% do recorte**, arredondado para cima,
**mínimo 5 alvos**, e **zero** quando o recorte tem menos de 20 (fatia minúscula não responde nada e
gasta cota escassa). Sim, isso significa gastar 10% da cota com leads que acreditamos ser piores. É o
preço de saber se acreditamos certo — e ele é pago **uma vez**, enquanto o preço de não pagar é um
ranking que nunca pode ser questionado. A fatia **aparece na tela da montagem**
(`ranked.explore.count`), porque um recorte com 10% de "não escolhidos por pontuação" precisa ser uma
decisão do dono, não uma surpresa. Se ele recusar (D-IA-12), a consequência é explícita e fica
registrada: o score v1 permanece uma opinião, para sempre, e a v2 não tem como nascer.

**Nada disso relaxa portão nenhum.** Alvo de exploração passa por G1-G11, cota, janela, gate e lease
igual a qualquer outro. Exploração escolhe **quem/o quê**, nunca **se pode**.

---

#### 8.11.16 O que muda no plano faseado, e o que passa a ser configuração

**Plano (substitui a tabela da §8.11.7 — as fases 6.0 a 6.5 continuam com o mesmo número e o mesmo
conteúdo; entram duas novas e duas ganham escopo):**

| Fase | Entrega | Depende de | O que o dono passa a conseguir fazer |
|---|---|---|---|
| **6.0** 🔴 **Medir** | inalterada — `ApproachOutcome`, escrita em `@inno/sending`, webhook, **separar `replied` de `optedOut`**, corrida do `respondedCount`, `minReviewCount` | nada | Ver taxa de resposta e de descadastro por nicho, cidade e horário |
| **6.1** **Ângulos + SCORE** (sem IA) | **escopo ampliado**: `angles.ts` **e** `score.ts` na mesma passagem (A42) · `ScoringProfile` · `CampaignTarget.renderedBody`/`approachAngle`/`score`/`scoreComponents`/`scoringProfileId`/`exploreKind` · `POST /campaigns/preview` · `selection` · ordem intercalada (A48) · fatia de exploração de público | 6.0 | **As etapas ② e ③ inteiras.** Recorte do tamanho da cota, cada lead com a abordagem do que ele é, e a conta dos dias na tela antes de criar |
| **6.1R** 🆕 **Triagem da resposta por regra** (sem IA) | `packages/core/src/inbox/classify.ts` · `ReplyClassification` · job `classify-reply` (só passada 1) · `GET /inbox` · sugestão de funil sem aplicar (A44) | **6.0** (o conserto do "SAIR") | **A etapa ④ funcionando com zero IA.** As respostas chegam separadas por tipo, e "precisa de olho humano" é uma lista, não a caixa inteira |
| **6.2** **Assistente (N1)** | inalterada — `packages/ai` + validadores + `POST /leads/:id/approach` | 6.1 | Gerar a abordagem de um lead, ler, ajustar, enviar |
| **6.2R** 🆕 **Classificação assistida da resposta** | passada 2 do job · redação/minimização (A46) · confiança mínima · teto de gasto | 6.2 **e** o número de `needs_human` de 6.1R justificar | Menos triagem manual — **se** a medição mostrar que dói |
| **6.3** **Lote com revisão (N2)** | inalterada | 6.2 + ≥1 campanha medida | Campanha inteira escrita pela máquina, liberada pelo humano |
| **6.4** **Escolha por desempenho (N3)** | inalterada + exploração de **ângulo** (A47) | 6.3 + piso de amostra | A máquina para de usar o que não funciona |
| **6.5a** 🆕 **Monta o público (N4a)** | envelope · exclusões duras · teto de rascunhos · campanha nasce `draft` | 6.4 | **A máquina propõe o recorte; o dono aperta o botão.** É onde o dono decidiu parar |
| **6.5b** **Dispara sozinha (N4b)** | janela de veto · orçamento diário · uma-em-voo · 🔴 `ALERT_WEBHOOK_URL` ligada | 6.5a + medição que justifique | A máquina roda campanhas; o dono veta |

**Ordem que importa:** 6.1R vem **antes** de 6.2 de propósito. Ele não usa IA, fecha o laço que o dono
pediu ("filtrar quem tem interesse") e produz o número que decide se 6.2R vale a pena. Construir o
redator antes do leitor é o mesmo erro de ordem que a §8.11.7 já corrigiu uma vez.

**Onde a configuração mora — correção à §8.11.4.** Aquela seção disse "mesmo lugar e mesma semântica
da pausa global do §4.10". Conferi: a pausa global mora no **Redis** (`lib/dispatch-state.ts`;
"ausência da chave = pausado", e Redis limpo devolve o sistema ao estado seguro). Isso está certo para
**a pausa** e não deve ser mexido. Mas não serve para o que a etapa ② precisa guardar: um Redis limpo
apagaria o envelope de autonomia e o ponteiro do perfil de pesos padrão **sem aviso**, e a campanha
seguinte sairia ordenada por outro critério sem ninguém ter mudado nada.

```prisma
/// Configuração persistida do sistema (ARQUITETURA §8.11.16). Saco de
/// chave→JSON de propósito: são poucas chaves, todas validadas por Zod em
/// `@inno/contracts` NA LEITURA, e `parse` que falha resolve para o valor
/// MAIS SEGURO (nível de autonomia → `n0`), nunca para o default otimista.
/// ⚠️ A pausa global do disparo NÃO migra para cá: ela é Redis por desenho
/// (§6.8.9), e "Redis limpo = pausado" é a propriedade, não o efeito colateral.
model AppSetting {
  key   String @id           // 'autonomy.level' | 'autonomy.envelope'
                             // 'scoring.defaultProfileId' | 'ai.monthlyBudgetCents'
                             // 'inbox.minConfidence' | 'explore.audiencePct'
  value Json
  updatedAt   DateTime @updatedAt
  updatedById String?
  updatedBy   User?    @relation("AppSettingAuthor", fields: [updatedById], references: [id], onDelete: SetNull)
  @@map("app_settings")
}
```

`PUT /api/v1/settings/autonomy` (§8.11.5) passa a escrever aqui; chave ausente continua valendo **N0**
(A36, intacto).

**Riscos novos, acrescentados à tabela da §8.11.9:**

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R-IA-8 | **O ranking vira profecia auto-realizável** — só o topo é abordado, o score nunca é testado, a v2 confirma a v1 | **alta sem mitigação** | o sistema fica confiante e errado para sempre | Fatia de exploração de **público** desde a fase 6.1, medida separada da de ângulo (A47) |
| R-IA-9 | **Texto escrito por terceiro sai da infra** para um operador externo | média | 🔴 base legal do §7.1 é o ativo mais frágil do produto | Regra primeiro (6.1R); modelo só sobre texto minimizado, sem identidade, com finalidade no ROPA (A46) |
| R-IA-10 | **Lead descartado por engano de classificação** | baixa | 🔴 `discarded` é **irreversível** na máquina de estados — nem humano volta | Nada move o funil sozinho; `discarded` exige clique (A44) |
| R-IA-11 | **Recorte montado maior que a cota** — campanha de 25 dias que ninguém decidiu | **alta hoje** | alvos do fim esperam cinco semanas; a medição envelhece junto | Recorte por capacidade + a conta no `preview` (A41) |
| R-IA-12 | **Campanhas por ângulo serializam** e a comparação vira "semana A × semana B" | certa, se separadas | o confundidor que a §8.11.3 existe para eliminar entra pela porta da frente | Uma campanha, ângulo por alvo, ordem intercalada (A48) |
| R-IA-13 | **Resposta some em silêncio** quando o classificador está fora | média | o dono acha que ninguém respondeu | `needs_human` é o estado inicial, não o de erro; contador visível (A45) |

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
| ~~D3~~ | ~~Sem multi-tenancy real (só `ownerId`)~~ | 🔒 **ENCERRADA em 2026-09-22 (v1.2), não adiada.** O dono decidiu que o produto é de **uso próprio** (§0.1): não existe "primeiro cliente que exige isolamento". `ownerId` no `Lead` permanece como **atribuição de responsável** entre operadores, não como fronteira de segurança | **Nunca.** Não construir `orgId`, escopo por organização nem tela de organizações |
| D4 | Sem subdivisão de cidades saturadas | Não sabemos o tamanho do problema; a flag `saturated` vai medir | Fase 6, com dado real |
| D5 | Só texto no disparo (sem mídia) | Texto puro tem menor risco de ban e cobre o caso de uso | Após 60 dias de operação estável |
| D6 | Feriados em tabela estática | Baixo custo de manutenção anual vs. dependência de API | Se o usuário pedir feriado municipal |
| D7 | Sem versionamento de template | Snapshot na campanha já resolve o problema real (corrupção de campanha ativa) | Se houver necessidade de auditoria histórica |
| **D8** | **Sem reconciliação de status de mensagem** — se um `messages.update` chegar durante um restart do `web`, o evento se perde (respondemos sempre 200 por desenho) e a `Message` fica `sent` para sempre. Idem para `Message` `queued` órfã do write-ahead do §4.9.5 | O impacto é **métrica de entrega subestimada**, não mensagem duplicada nem envio perdido. O paliativo do §4.8 (re-busca única após 2s) cobre a corrida comum, e o `logger.warn` mede se o resto importa | Quando o `warn` aparecer com frequência, ou quando a taxa de entrega virar número de venda |
| **D9** | **Não existe model de configuração** (`Settings`/`Organization`) — `{{minha_empresa}}` é lido de `APP_COMPANY_NAME` (env) | 🔒 **ACEITA EM DEFINITIVO (v1.2).** Com uso próprio (§0.1) há uma única empresa remetente, e um model de configuração para uma linha é cerimônia. O custo residual — trocar o nome do remetente exige redeploy — é evento raro. O gatilho antigo ("primeiro cliente com marca própria") foi cancelado junto com a D3 | Só se um dia o dono operar sob mais de uma marca |

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
# DISPATCH_ALLOW_SATURDAY — REMOVIDA em 24/09/2026 por decisão do dono: envio
# de campanha é seg-sex, ponto. Sábado e domingo nunca, e não é configurável.
# Motivo: mensagem comercial fria no fim de semana incomoda mais e é
# respondida menos — e resposta baixa é justamente o sinal que a plataforma
# lê como spam. Não reintroduzir sem o dono pedir.

# Envio unitário (§4.9)
MANUAL_SEND_RATE_PER_MIN=10         # por usuário; 429 acima disso
MANUAL_SEND_DUPLICATE_WINDOW_S=60   # anti-duplo-clique por lead
COLD_FOLLOWUP_COOLDOWN_H=24         # 🆕 v1.2 (§4.9.10, G9b) — 2º contato frio para quem nunca
                                    # respondeu. Vale para o manual E para a campanha

# Motor de disparo (§6.8) — 🆕 v1.2
DISPATCH_TICK_INTERVAL_S=15         # período do job repetível dispatch-tick
DISPATCH_LEASE_S=120                # lease do alvo reservado; expirado, ele volta sozinho
DISPATCH_MAX_ATTEMPTS=3             # acima disso o alvo vira failed/max_attempts
DISPATCH_MICRO_PAUSE_EVERY_MIN=18   # micro-pausa a cada 18..25 envios (§6.3)
DISPATCH_MICRO_PAUSE_EVERY_MAX=25
DISPATCH_MICRO_PAUSE_MIN_S=300      # duração da micro-pausa: 5..12 min
DISPATCH_MICRO_PAUSE_MAX_S=720
DISPATCH_UNCERTAIN_DEGRADE_AT=3     # incertos seguidos → instância sai da rotação + alerta high
DISPATCH_UNCERTAIN_HALT_AT=5        # incertos seguidos → halt da campanha (§6.8.6)
CAMPAIGN_MAX_TARGETS=5000           # teto de alvos por campanha no POST (§4.5.4)

# 🆕 v1.3 — NÃO existe DISPATCH_ENGINE_ENABLED aqui, e isso é decisão, não esquecimento.
# O motor nasce pausado pela pausa GLOBAL persistida no Redis (§4.10/§6.8.9): chave ausente
# = pausado. O interruptor precisa estar ao alcance do dono às 2h da manhã, pela tela, sem
# terminal e sem redeploy (§0). Uma env como ÚNICA trava seria invisível e irreversível
# no momento em que mais importa.

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
| **A23** | 🔒 **Uso próprio.** Sem venda, sem conta por cliente, sem isolamento por organização. **D3 encerrada, não adiada**; D9 aceita em definitivo. LGPD, auth e anti-ban continuam valendo integralmente | **§0.1, §9.2** |
| **A24** | **Cadência é propriedade do NÚMERO, não do chamador.** Um gate (`WhatsAppInstance.nextSendAllowedAt`) honrado pelo motor e pelo envio manual; resposta em conversa aberta passa, contato frio não | **§4.9.10, §6.8.7** |
| **A25** | **Resultado incerto não é retentado, e a cota não volta.** Alvo vira `failed/send_uncertain`; 3 incertos seguidos tiram a instância da rotação, 5 dão `halt` na campanha | **§6.8.6** |
| **A26** | **Claim de alvo por lease sobre `scheduledFor`**, sem status `sending` no enum. A garantia dura contra envio duplicado é `Message.campaignTargetId @unique`, não o lock | **§6.8.2** |
| **A27** | **Alvos materializados no `POST`, não no `start`** — o operador confere *quais* leads entraram, não só quantos; `start` reavalia opt-out numa segunda passagem | **§4.5.2** |
| **A28** | **Campanha `running` não é editável.** Pausar primeiro custa um clique e elimina a classe inteira de bug de cadência lida antes e gravada depois | **§4.5.5** |
| **A29** | **`meta` não existe no envelope**: o mapa do guard viaja em `details[]` com `path` = nome da chave, e é propagado **sempre** que existir — não por lista de `reason` privilegiados | **§4.0, §4.9.7** |
| **A30** | 🆕 **O ato de enviar mora em `packages/sending`**, importado por web e worker. O pacote devolve resultado, nunca erro de HTTP; `apps/web` traduz em `409/502`, o worker traduz em estado do alvo. Worker chamando rota HTTP do web foi descartado — deploy do `web` no meio da campanha viraria envio **incerto** em massa | **§6.8.0, §2** |
| **A31** | 🆕 **O motor nasce PAUSADO**, e o interruptor é a pausa global persistida (chave ausente = pausado), não uma variável de ambiente. Ligar sem canal de alerta é aceitar descobrir incidente noturno no dia seguinte — aceitável só porque o sistema é desenhado para **parar sozinho**, e por isso os patamares de parada não podem ser afrouxados enquanto o alerta estiver desligado | **§6.8.9** |
| **A32** | 🆕 **Configuração de campanha só estreita limite de segurança, nunca alarga.** Janela, ritmo e cota da campanha achatam contra o piso da env e contra o warmup. Três campos gravados e exibidos não eram lidos por ninguém — o motor é o primeiro consumidor deles | **§6.8.10** |
| **A33** | 🆕 **O ângulo da abordagem é CALCULADO, a frase é gerada.** Predicado puro sobre campos coletados decide o ângulo; o modelo recebe um conjunto fechado de fatos citáveis e declara quais usou (`factsCited[] ⊆` entrada, verificado em código). O modelo nunca seleciona fato. `offNiche` força o ângulo genérico — a `category` dele é sabidamente não confiável | **§8.11.2, §8.11.5** |
| **A34** | 🆕 **Todo contato frio grava um fato de desfecho anônimo** (`ApproachOutcome`) na MESMA transação do write-ahead, dentro de `@inno/sending`. Envio sem atribuição não existe — se a gravação ficasse no motor, o envio unitário nunca registraria e o conjunto de aprendizado nasceria enviesado | **§8.11.3** |
| **A35** | 🆕 **`replied` e `optedOut` são desfechos DISTINTOS. Descadastro nunca conta como resposta.** Hoje conta (`webhook.ts#handleInboundMessage`), e é o defeito que faria o laço premiar a abordagem que mais irrita. Corolário: percentual só aparece na tela acima do piso de amostra | **§8.11.3, §8.11.9** |
| **A36** | 🆕 **Nível de autonomia é configuração persistida lida em runtime; ausente = N0** (mesma assimetria da pausa global, A31). Subir de degrau acrescenta um autor e **não altera nada à direita de `executeSendAttempt`** — portão, gate, cota, janela e lease são os mesmos em qualquer nível. É isso que permite descer de degrau sem reverter código | **§8.11.4** |
| **A37** | 🆕 **Autonomia de público (N4) exige os seis guarda-corpos, nenhum opcional**: envelope declarado (fora dele a máquina RECUSA, não pede), orçamento diário de contatos frios independente da cota por número, janela de veto antes de disparar, uma só campanha autônoma em voo, exclusões duras não-configuráveis e **canal de alerta ligado** | **§8.11.4** |
| **A38** | 🆕 **O modelo caro nunca vê dado de lead; vê agregado.** Redação de volume roda em modelo barato sobre os fatos de um lead; raciocínio de estratégia roda raramente sobre a tabela de desfecho anônima. Corta custo, latência e superfície LGPD na mesma decisão | **§8.11.6** |
| **A39** | 🆕 **Elegibilidade corta antes; o score só ordena depois, e nunca exclui.** Celular, opt-out e contato recente são elegibilidade (o portão G4 já recusa terminalmente); nota, avaliações e ausência de site são ranking. Ranquear antes de filtrar entrega um recorte que a elegibilidade esvazia — e os que faltam **não** são repostos pelos seguintes da fila | **§8.11.12** |
| **A40** | 🆕 **Score sem decomposição não existe.** Todo score persistido guarda os componentes e o `scoringProfileId` que os pesou; o perfil de pesos é **imutável e versionado** (editar cria versão). O dono precisa poder discordar **ajustando os pesos**, e um número opaco não admite discordância | **§8.11.12.1** |
| **A41** | 🆕 **O recorte é dimensionado pela CAPACIDADE, não pelo tamanho do filtro.** A conta `alvos ÷ cota/dia = dias` aparece na montagem, num `preview` que não cria nada. O default não é "todos" | **§8.11.12.3** |
| **A42** | 🆕 **Ângulo e score saem da MESMA passagem.** Uma função pura, uma entrada, os dois na saída — calcular em lugares separados garante que divergem e que o mesmo predicado é escrito duas vezes | **§8.11.12.1** |
| **A43** | 🆕 **A regra de opt-out é autoritativa e unidirecional.** A classificação pode acrescentar um `opt_out` que a regra não pegou; **nunca** revogar um que ela pegou — nem por humano. Falso positivo custa 1 lead, falso negativo custa uma denúncia | **§8.11.14.2** |
| **A44** | 🆕 **Classificar é automático; mover o funil não é.** Nada além do `responded` que o webhook já escreve. `negotiating`/`won` exigem clique humano, e **`discarded` automático é proibido** — a máquina de estados não tem volta de `discarded`, nem para humano | **§8.11.14.1** |
| **A45** | 🆕 **Resposta não classificada é "precisa de olho humano", nunca "ruído".** `needs_human` é o estado **inicial** da linha, não o de erro: provedor fora, teto estourado ou confiança baixa deixam a resposta visível na caixa, com contador barulhento | **§8.11.14.3** |
| **A46** | 🆕 **Texto de terceiro só sai da infra minimizado e sem identidade.** Redação de dígitos/e-mail/URL em função pura, sem nome/telefone/`leadId`/cidade junto, modelo devolvendo só categoria e confiança, nada enviado no ramo `opt_out`, operador no ROPA | **§8.11.14.4** |
| **A47** | 🆕 **Exploração de PÚBLICO e de ÂNGULO são fatias disjuntas** — um envio tem no máximo um `exploreKind`. Sem público explorado desde o dia um, o score nunca é validável e a v2 confirma o preconceito da v1; cruzar as duas produz resultado não atribuível | **§8.11.15** |
| **A48** | 🆕 **Um recorte é UMA campanha, com ângulo por alvo e ordem intercalada entre ângulos.** O motor processa campanhas por `startedAt asc` sobre a cota **do número**: campanhas por ângulo não rodam em paralelo, serializam — e a comparação entre ângulos vira comparação entre semanas, com `warmupDay` e horário diferentes | **§8.11.13** |
