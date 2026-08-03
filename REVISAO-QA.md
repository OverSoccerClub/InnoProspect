# Revisão de QA — InnoProspect (antes da Fase 4)

> Autora: Íris (QA). Data: 2026-08-03.
> Escopo: qualidade e confiança do que já existe (Fases 1–3 + schema
> pré-modelado da Fase 4). Não cobre arquitetura (Nova) nem segurança (Órion)
> — só cito achados de segurança que apareceram no caminho, para eles
> confirmarem.
> Rodei os 164 testes existentes: **todos passam** (core 81, messaging 48,
> scraper 35, contracts). Não escrevi testes novos nesta rodada — o
> documento é a entrega, com um plano de execução concreto. Ver §6 do porquê.

---

## 1. Mapa de cobertura honesto

| Pacote/área | Testes | O que cobre de verdade | Risco da lacuna |
|---|---|---|---|
| `packages/core` | 81 | dedupe, phone (BR, DDD, nono dígito), status (funil), spintax, render, optout/detect, optout/token, uf, warmup, health | Baixo — é a camada mais bem testada do projeto, e é exatamente a que deveria estar |
| `packages/messaging` | 48 | evolution-client (24), webhook-parser (14), errors (10) | Baixo-médio — o *parser* está testado; o *processamento* dos eventos parseados (quem grava no banco) não tem nenhum teste, ver §2 |
| `packages/scraper` | 35 | extract-card, normalize, assertions A1-A4, errors, engine (2, superficial) | Baixo para extração pura; **zero** teste de fixture "seletor quebrou → alarme dispara de ponta a ponta" apesar do critério de aceite da Fase 2 pedir isso |
| `apps/web/src/lib/services/*` (7 arquivos, ~1400 linhas) | **0** | nada | **Alto** — é onde vivem opt-out, contador de campanha, webhook, dedupe de disparo |
| `apps/web/src/app/api/**` (21 rotas) | **0** | nada | **Alto** — nenhuma rota tem teste de contrato (200/4xx), nenhuma de auth (401/403), nenhuma de idempotência |
| `apps/web/src/lib/api-handler.ts` | **0** | nada | Médio-alto — é o único lugar que traduz erro de negócio → HTTP em TODAS as rotas; um bug aqui é sistêmico, não pontual |
| `apps/worker/src/jobs/scrape-search.job.ts` | **0** | nada | Alto — é quem faz o `upsert` de dedupe de verdade em produção; `buildMachineUpdate` é testado isoladamente no core, mas ninguém testa que o job o usa corretamente nem a lógica de retry/backoff/pausa de fila |
| `apps/web` componentes React (Lyra) | **0** | nada | Baixo-médio para este momento — fora do escopo pedido, mas registro que `LeadTable`/`lead-detail` exibem `isOptedOut` que hoje é sempre `false` (§5) |

**Números:** ~13.400 linhas de código, 164 testes, **zero** nos dois lugares
onde a lógica de negócio mais arriscada roda de fato (`apps/web/src/lib`,
`apps/worker/src/jobs`). A pirâmide está invertida na direção errada: a base
pura está bem coberta, mas o andar de cima — onde tudo se conecta e onde
dinheiro/reputação são perdidos — está no vácuo.

---

## 2. Caminhos críticos que ninguém verifica hoje

Ordenados por risco real (probabilidade × dano), com arquivo:linha.

### 2.1 🔴 Contador de campanha dessincronizando do status — `campaign-targets.ts`
`apps/web/src/lib/services/campaign-targets.ts:56-113` (`advanceCampaignTargetStatus`)

Esta função é o **único** lugar autorizado a mudar `CampaignTarget.status`, e
o comentário do próprio Cronos avisa: "senão dessincroniza desde o dia 1".
Ela tem regras sutis que ninguém testa:
- Reaplicar o mesmo status (retry de webhook) não deve incrementar contador
  de novo — depende de `nextIndex <= currentIndex` (linha 88).
- Pular estágios (ex.: `sent → responded` direto, porque o WhatsApp nunca
  manda confirmação de leitura) precisa incrementar **todos** os contadores
  intermediários (`delivered`, `read`) retroativamente (linhas 90-100) —
  para sustentar a invariante `sentCount >= deliveredCount >= readCount >=
  respondedCount`. Um off-by-one aqui (`slice(currentIndex, nextIndex+1)` em
  vez de `slice(currentIndex + 1, ...)`) dobraria a contagem do estágio atual
  silenciosamente — e como isso incrementa um `Int` no Postgres, **nada
  quebra, nenhum teste existente falha, nenhuma exceção é lançada.** É
  exatamente o "sucesso silencioso" que a ARQUITETURA teme no scraper (§5.7),
  só que aqui não existe nenhuma assertion de sanidade equivalente.
- Alvo em estado terminal (`failed`/`skipped`) não pode ser reaberto (linha
  67) — um evento tardio da Evolution chegando depois de um `skipped` por
  opt-out não deve reverter isso.

**Zero testes.** Isto é o item #1 da lista de prioridade (§4).

### 2.2 🔴 Webhook processando a mesma mensagem duas vezes — `webhook.ts`
`apps/web/src/lib/services/webhook.ts`

- `handleInboundMessage` (linha 68): idempotência depende do `upsert` por
  `providerMessageId` (linha 87-99) — mas o `update: {}` vazio significa que
  um evento duplicado **não re-executa** a mudança de status do lead nem a
  detecção de opt-out (o `if (event.isOptOutRequest)` na linha 118 roda
  **sempre**, mesmo se a mensagem já existia). Consequência prática: como
  `registerOptOutFromInbound` também é idempotente (verifica `existing` antes
  de criar), isso é seguro hoje — mas é uma cadeia de duas idempotências
  distintas que ninguém testou juntas. Se uma das duas perder a proteção num
  refactor futuro, o bug só aparece em produção sob reenvio real da Evolution.
- `handleMessageStatus` (linha 124): se o evento `messages.update` chegar
  **antes** de existir `Message.providerMessageId` correspondente (corrida
  possível quando o dispatch worker existir na Fase 4 — grava o `Message` e
  manda o `sendText` quase ao mesmo tempo que a Evolution pode responder via
  webhook), a atualização é **descartada silenciosamente** (linha 127-130,
  só um `logger.warn`) — **sem retry, sem fila de reprocessamento.** Hoje é
  inofensivo (Fase 3 não dispara em massa), mas quando o `dispatch-tick.job`
  nascer (Fase 4), essa é uma janela de corrida real que vai perder
  atualizações de `delivered`/`read` esporadicamente. Vale um teste de
  regressão **agora**, documentando o comportamento esperado, antes que a
  Fase 4 dependa dele sem saber que existe.

**Zero testes** de idempotência de webhook. É o único componente do sistema
com uma superfície pública sem sessão (`requireAuth: false`), e ninguém
verifica que reenvio = no-op.

### 2.3 🟠 Opt-out ignorado por ordem de execução errada
Duas frentes:

1. **A regra "guard pré-envio consulta opt-out no worker, sem cache" (§6.7)
   ainda não existe** — `dispatch-tick.job.ts` não foi escrito. Não é bug
   hoje porque não há disparo em massa ainda, mas é o item mais citado como
   "critério de bloqueio de release" na ARQUITETURA (§4.5 aceite da Fase 4).
   **Íris precisa estar pronta para testar isso no dia em que Vega entregar**
   — ver §4, prioridade #2.
2. **O que já existe hoje tem uma lacuna real:** `leads.ts` (ver §5.1) marca
   `isOptedOut: false` sempre, **mesmo com a tabela `OptOut` já existindo em
   produção desde o commit `ff3d794`**. Qualquer tela ou fluxo futuro que
   confie em `LeadListItem.isOptedOut` (por exemplo, uma futura seleção de
   público de campanha por "não descarta opt-out") está lendo um valor morto.
   Isso não é "não fizemos ainda" — é código que **parece certo, roda sem
   erro, e mente**.

### 2.4 🟠 Mensagem fora da janela ou acima do teto
`policies/send-window.ts`, `policies/quota.ts`, `policies/jitter.ts`,
`policies/guard.ts` (ARQUITETURA §2) **não existem no repositório ainda** —
só o `WARMUP_TABLE` (`packages/core/src/whatsapp/warmup.ts`, bem testado,
§1) e o campo `sendWindowStartHour`/`EndHour`/`DaysOfWeek` no schema. Isto
não é uma lacuna de teste — é trabalho da Fase 4 que ainda não começou.
Sinalizo aqui só para reforçar: **quando existir, o teste de janela +
quota + jitter tem que nascer junto**, não depois.

### 2.5 🟡 Dedupe de lead gravando duplicata
`apps/worker/src/jobs/scrape-search.job.ts:140-202`. A garantia de verdade é
o `@unique` em `Lead.dedupeKey` (constraint de banco) + `computeDedupeKey`
(testado no core, 9 testes). O que **não** está testado é a integração: que
o job realmente monta o `where`/`create`/`update` do `upsert` corretamente,
que `buildMachineUpdate` é de fato usado (e não um spread solto — o próprio
comentário do arquivo, linha 181-184, avisa do risco de alguém "vazar" isso
num refactor futuro sem que nenhum teste pegue). Risco médio: a proteção de
runtime (`buildMachineUpdate` lança se receber campo fora da allowlist) só
dispara se o campo **está presente no objeto passado**; ela não impede
alguém de adicionar um `tx.lead.update({ where, data: { status: 'won' } })`
solto em outro lugar do job, fora do `buildMachineUpdate`. Vale um teste de
integração (com Prisma mockado) que também funciona como "trip wire": se
algum dia esse job for reescrito, o teste força a nova versão a continuar
passando por `buildMachineUpdate`.

### 2.6 🟡 Kill switch — `every`/`some` do Prisma
`apps/web/src/lib/services/campaign-targets.ts:148-167`
(`haltCampaignsSoleInstanceDisconnected`). A query usa
`instances: { every: { instanceId }, some: {} }` para achar campanhas que
usam **só** aquela instância. Isso é um padrão conhecido por ser
contraintuitivo no Prisma: `every` sobre uma relação **vazia** retorna `true`
vacuosamente (é lógica de conjuntos: "para todo elemento de um conjunto
vazio, P é verdadeiro"), por isso o `some: {}` é obrigatório para não capturar
campanhas **sem nenhuma instância associada**. O código está certo, mas é
exatamente o tipo de linha que alguém "simplifica" num refactor futuro
removendo o `some: {}` porque parece redundante — e o bug resultante (halt
de campanhas sem instância nenhuma, ou falha em haltar campanhas que
deveriam) só aparece com dado real. Merece teste de regressão dedicado,
citando o motivo (§4, prioridade #6).

---

## 3. Estratégia de teste viável (sem Postgres/Redis vivos aqui)

### O que dá para testar **sem banco, hoje, nesta máquina**

1. **Serviços com Prisma mockado.** Todos os arquivos em
   `apps/web/src/lib/services/*.ts` recebem `prisma` (ou `tx`) como
   import de nível de módulo ou parâmetro. Duas opções, em ordem de
   preferência:
   - **Fake objects manuais** (sem lib nova): para funções como
     `advanceCampaignTargetStatus` e `skipPendingCampaignTargetsForPhone`,
     que recebem `tx: Prisma.TransactionClient` como **parâmetro**, um objeto
     literal implementando só os métodos usados (`campaignTarget.findUnique`,
     `.update`, `.findMany`, `campaign.update`) já basta — zero dependência
     nova, rápido, e força o teste a documentar exatamente o contrato usado.
   - **`vitest-mock-extended`** (ou `prismock`) para os serviços que importam
     `prisma` direto do módulo `@inno/db` (a maioria) — precisa de
     `vi.mock('@inno/db', ...)`. Vale a pena introduzir essa dependência
     porque quase todo `apps/web/src/lib/services/*.ts` segue o mesmo padrão.
   Isso cobre **§2.1, §2.2, §2.3, §2.6** inteiros — é regra de negócio pura
   disfarçada de código com I/O; o I/O em si (o Postgres executar a query
   certa) é a única parte que fica de fora.

2. **Teste de contrato das rotas** com `NextRequest`/`Response` reais e
   `apiRoute()` de verdade, mas com os serviços mockados via
   `vi.mock('@/lib/services/...')`. Cobre `api-handler.ts` (auth 401,
   validação Zod 422 com `details[]`, mapeamento de erro Prisma P2002→409,
   `x-request-id` no header) sem precisar de sessão real nem banco real —
   é só JS.

3. **Fixture de seletor quebrado end-to-end** (`packages/scraper`): já existe
   a infraestrutura de fixtures HTML; falta o teste que adultera um seletor
   em `SELECTORS` (via injeção de config de teste, não editando o arquivo de
   produção) e confirma que a assertion A2 (fill-rate de nome) dispara. Isso
   é o critério de aceite da Fase 2 (`ARQUITETURA §8`) que nunca foi escrito.
   100% executável sem rede nem banco.

4. **`packages/core` — mais edge cases**, sem infra nova: `phone.ts` já é bem
   testado, mas faltam casos como "8 dígitos começando em 6-9 mas com DDD
   inválido" (deve retornar `unknown`, não celular), e `dedupe.ts` não testa
   colisão real entre dois negócios com nomes que geram o mesmo slug na
   mesma cidade (dedupe por nome é o fallback menos confiável — vale garantir
   que o comportamento nesse caso é "o segundo sobrescreve como
   re-scraping", que é o esperado, mas não está documentado em teste).

### O que **exige** ambiente vivo

- **Concorrência real** (`claimTask` em `scrape-search.job.ts:67-73`, o
  `updateMany WHERE status='pending'` que substitui `FOR UPDATE SKIP
  LOCKED`): só um Postgres de verdade prova que duas chamadas simultâneas
  não roubam a mesma task. Mock de Prisma não simula corrida de transação.
- **Índice único / `P2002` de verdade** (`dedupeKey`, `phoneE164` do
  `OptOut`, `providerMessageId`): mock pode *simular* o erro, mas não prova
  que a constraint existe e está no lugar certo na migration.
- **`gin_trgm_ops`** (índice trigram para busca de `Lead.name`/`address`,
  `schema.prisma:487-488`): é uma extensão específica do Postgres
  (`pg_trgm`). **SQLite não serve, como já avisado** — nem para isso, nem
  para `@db.Date`, nem para os enums nativos do Postgres que o Prisma usa
  aqui.
- **Migração de verdade rodando** (`migrate deploy` da Fase 2/3/4 sobre um
  banco com dado — "primeira migração deste projeto a rodar em banco com
  dado dentro", `PROGRESSO.md`): só se testa em Postgres real.

**Proposta concreta, viável sem Docker nesta máquina:**
1. **Curto prazo (esta semana): testcontainers-node com Postgres.** Não
   precisa de Docker Compose nem de infra permanente — só Docker instalado
   (que hoje falta nesta máquina, mas é trivial no CI/EasyPanel ou na máquina
   de qualquer agente que tenha Docker). `pnpm add -D testcontainers` na raiz,
   um `vitest.integration.config.ts` separado do `vitest.config.ts` unitário,
   rodando `prisma migrate deploy` contra o container antes da suíte. Isso
   resolve os 4 itens acima de uma vez, incluindo migração real.
2. **Se Docker continuar indisponível na máquina de dev:** banco de teste
   dedicado no EasyPanel (`inno-prospect-test`, apagado/recriado a cada CI
   run) — mais lento e com custo de rede, mas destrava enquanto ninguém
   instala Docker localmente. **Não usar o banco de produção nem um clone
   dele** — dado de teste tem que ser fixture determinística, nunca dado
   real de lead/telefone.
3. **CI (Vulcano):** os testes com Prisma mockado (item 1-2 acima) rodam em
   todo PR, rápidos, sem infra. Os de testcontainers rodam num job separado
   (mais lento, precisa de Docker-in-Docker ou runner com Docker) — só
   bloqueiam merge se tocarem em `apps/web/src/lib/services` ou
   `apps/worker/src/jobs`.

---

## 4. O que eu priorizaria — em ordem, com justificativa de risco

1. **`apps/web/src/lib/services/campaign-targets.test.ts`** (Prisma
   mockado/fake `tx`). Verifica: incremento correto de contador por estágio
   pulado; não-regressão em reprocessamento do mesmo status; estado terminal
   nunca reaberto; `skipPendingCampaignTargetsForPhone` retorna a contagem
   certa e só afeta `pending`. **Motivo:** é o coração do "contador de
   campanha dessincronizando do status" citado no pedido — a função mais
   crítica sem nenhum teste, e bug aqui é silencioso por design (nenhuma
   exceção, só número errado).

2. **`apps/web/src/lib/services/webhook.test.ts`** (Prisma mockado).
   Verifica: `messages.upsert` duplicado (mesmo `providerMessageId`) não
   duplica `Message` nem reprocessa a mudança de status do lead;
   `messages.update` para `providerMessageId` desconhecido não lança, só
   loga; `connection.update` com `banned=true` dispara
   `haltCampaignsSoleInstanceDisconnected` só quando é a única instância;
   opt-out automático detectado cria `OptOut` e reflete no
   `CampaignTarget` **na mesma transação** (mock de `tx` compartilhado entre
   as duas chamadas). **Motivo:** é a superfície pública sem sessão, e
   idempotência de webhook é o tipo de bug que só aparece em produção sob
   reenvio real — impossível de pegar manualmente.

3. **`apps/web/src/lib/services/optouts.test.ts`** (Prisma mockado).
   Verifica: `createOptOut` volta `409` se já existir; efeito retroativo
   (pending targets → skipped) na mesma transação; `publicOptOut` é
   idempotente (dois cliques, sempre `200`, nunca `409` — comportamento
   deliberadamente diferente do opt-out manual, fácil de inverter por
   engano); `deleteOptOut` exige `role=admin`. **Motivo:** "a tabela mais
   importante do sistema em termos de risco" nas palavras do próprio Vega —
   zero teste hoje.

4. **`apps/web/src/app/api/webhooks/evolution/[instanceKey]/route.test.ts`**
   (rota real + prisma/messaging mockados). Verifica: `instanceKey` inválido
   → `404` (nunca `401`); `apikey` errado → **também `404`**, não `403`, para
   não vazar a existência do `instanceKey` (o oráculo que o comentário do
   Vega descreve); resposta é **sempre** `200 { received: true }` mesmo se
   `processEvolutionWebhookEvent` lançar. **Motivo:** é regra de segurança
   codificada em comentário, sem nenhum teste que a trave — a próxima pessoa
   que mexer aqui não tem rede de proteção.

5. **`apps/worker/src/jobs/scrape-search.job.test.ts`** (Prisma mockado,
   `runSearch` mockado retornando fixtures). Verifica: `newCount` só conta
   leads realmente novos; `update` do upsert passa exclusivamente por
   `buildMachineUpdate` (spy nele, ou verificação de que as chaves do
   `data` recebido pelo mock de `lead.upsert` batem 1:1 com
   `MACHINE_UPDATABLE_FIELDS`); falha `LAYOUT_CHANGED` pausa a fila
   indefinidamente e não reagenda; falha `RATE_LIMITED` pausa e reagenda com
   o backoff certo; `SearchTask` esgotando tentativas marca `failed` e o
   `SearchJob` continua (não vira `failed` também). **Motivo:** é o único
   lugar que grava lead de verdade em produção — e é o próximo código que
   vai rodar pela primeira vez contra o Google Maps real (ver PROGRESSO.md
   passo 3), sem nenhuma rede de segurança hoje.

6. **`apps/web/src/lib/services/campaign-targets.test.ts`** (mesma suíte do
   #1 ou arquivo separado) — caso específico de `haltCampaignsSoleInstanceDisconnected`:
   campanha com 1 instância → halted; campanha com 2 instâncias, 1
   desconecta → NÃO halted; campanha sem nenhuma instância associada (edge
   case do `every` vacuosamente verdadeiro) → NÃO halted.
   **Motivo:** §2.6 — bug clássico de Prisma, silencioso, fácil de
   reintroduzir num refactor "de limpeza".

7. **`apps/web/src/lib/api-handler.ts` — `api-handler.test.ts`**. Verifica:
   `ApiHttpError` → status certo do `API_ERROR_HTTP_STATUS`; `ZodError` de
   `bodySchema`/`querySchema`/`paramsSchema` → `422` com `details[]`
   preenchido; `Prisma.PrismaClientKnownRequestError P2002` → `409` sem
   vazar mensagem do Postgres; erro desconhecido → `500` genérico (nunca
   `err.message` cru na resposta — checagem de vazamento de informação).
   **Motivo:** é usado por **todas** as 21 rotas; um bug aqui não é local, é
   sistêmico, e nenhuma rota tem teste próprio que o exercitasse
   incidentalmente.

8. **Regressão do bug já encontrado**: depois que Vega corrigir `leads.ts`
   (§5.1), `leads.test.ts` cobrindo `isOptedOut` refletindo `OptOut` de
   verdade e o filtro `optedOut` realmente filtrando. **Motivo:** é bug
   de fato, achado nesta revisão — precisa de teste de regressão assim que
   corrigido, senão volta.

*(Itens 9+ — fixture de seletor quebrado end-to-end no scraper, edge cases
extras de `phone.ts`/`dedupe.ts`, e-mail do admin extraído como função pura
testável — ficam em PENDÊNCIAS, §7, por serem risco menor que os 8 acima.)*

---

## 5. Fragilidades que já vejo lendo o código

### 5.1 🔴 `isOptedOut` morto — bug real, não hipotético
`apps/web/src/lib/services/leads.ts:7, 32, 66`

```ts
// linha 7 (comentário, desatualizado):
//   - `isOptedOut` / filtro `optedOut`: sempre `false` (sem `OptOut`, Fase 3).
// linha 32:
    isOptedOut: false,
// linha 66:
  // `optedOut`/`contactedInCampaign`: sem tabela correspondente na Fase 1
  // (ver cabeçalho do arquivo) — não filtram nada ainda, de propósito.
```

O comentário diz "sem `OptOut`, Fase 3" — mas a Fase 3 **já foi commitada**
(`OptOut` existe em `schema.prisma`, populada e usada por
`optouts.ts`/`webhook.ts`). Este arquivo não foi atualizado no handoff.
Resultado: `GET /api/v1/leads` sempre devolve `isOptedOut: false` para todo
mundo, e o parâmetro `?optedOut=` é aceito pelo contrato Zod mas **não faz
nada** — a UI (`lead-table.tsx:34`, `lead-detail.tsx:120`) confia nesse
campo para mostrar o badge de opt-out e nunca vai mostrar. **Corrigir antes
da Fase 4**, porque a Fase 4 vai (eventualmente) usar filtro de leads para
montar público de campanha — se alguém reusar `listLeads`/`buildWhere` para
isso, o `optedOut` que deveria excluir opt-outs do público simplesmente não
vai funcionar, e o guard pré-envio (`§2.3`) é a única rede de segurança
restante. Redundância é boa aqui (defesa em profundidade), mas cada camada
tem que fazer o que diz que faz.

### 5.2 🟡 Corrida de "quem responde primeiro" quando o telefone é ambíguo
`apps/web/src/lib/services/webhook.ts:72-74` (`handleInboundMessage`)

```ts
const lead = phoneE164
  ? await tx.lead.findFirst({ where: { phoneE164 }, orderBy: { lastSeenAt: 'desc' } })
  : null;
```

`Lead.phoneE164` **não é `@unique`** (só `dedupeKey` é) — por desenho, dois
leads podem legitimamente compartilhar telefone (ex.: uma rede com número
central atendendo várias unidades, capturadas com `externalRef` diferentes).
Uma resposta inbound sempre gruda no lead **mais recentemente visto**, o que
é uma heurística razoável mas silenciosa: se o telefone for de uma central,
a resposta pode grudar no lead errado da rede, e o funil (`contacted →
responded`) muda no lead errado. Não é um bug do dia 1 (baixo volume,
Fase 3), mas fica mais provável assim que houver campanhas em massa contra
o mesmo nicho (Fase 4) — franquias e redes são comuns em nichos como
"clínica odontológica". **Recomendo**: documentar esse comportamento com um
teste de regressão explícito (o comportamento atual É o esperado — só falta
estar provado, não hipotetizado) e considerar, na Fase 4, desambiguar por
`CampaignTarget` ativo em vez de "lead mais recente" quando existir uma
campanha em voo (o código já tenta algo parecido logo abaixo, linha
109-115, para o link com `CampaignTarget` — mas a escolha do `Lead` em si
ainda é pela heurística de `lastSeenAt`).

### 5.3 🟡 Normalização de e-mail do admin não é testável isoladamente
`apps/web/src/lib/auth.ts:38`

```ts
const email = typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : '';
```

Este é exatamente o bug já pago e registrado em `PROGRESSO.md` ("o e-mail do
admin precisa ser gravado em minúsculas — o `authorize` normaliza antes de
buscar"). A correção está inline dentro do `authorize()` do Auth.js, que
**não dá para chamar em teste unitário sem montar sessão/JWT/Auth.js inteiro**
— então o bug já corrigido não tem, e não pode ter facilmente, um teste de
regressão de verdade. **Recomendo** extrair `normalizeLoginEmail(raw:
unknown): string` para `packages/core` (ou um `lib/auth-helpers.ts` puro em
`apps/web`, sem importar Auth.js), e um teste de 3 linhas junto. Baixo
esforço, fecha um buraco de regressão real (bug já aconteceu uma vez).

### 5.4 🟡 `handleMessageStatus` descarta silenciosamente, sem fila de retry
Já coberto em §2.2 — repito aqui porque é uma fragilidade de *design*, não
só de teste: quando o `dispatch-tick.job` nascer, esse `logger.warn` sem
retry é uma perda de dado (status de entrega) sob corrida. Vale avisar Vega
para considerar (Fase 4) uma tabela de "eventos órfãos" ou um pequeno delay
de reprocessamento, não só um teste — mas o teste de regressão documentando
o comportamento *atual* deve nascer agora, antes da mudança.

### 5.5 🟢 Coisas que li e gostei (para não parecer só reprovação)
- `buildMachineUpdate` com excess-property-check em tempo de compilação **e**
  checagem em runtime — dupla proteção bem pensada.
- `computeDedupeKey` com precedência clara e comentário do "porquê" de não
  prefixar artificialmente as chaves.
- `constantTimeEqual` no webhook, `404` uniforme para instanceKey/apikey
  errados — exatamente o que a ARQUITETURA pediu, implementado à risca.
- `api-handler.ts` centralizado e nunca contornado nas rotas que li — Vega
  seguiu a "regra de ouro" de não montar `NextResponse.json` de erro à mão.
- Warmup (`regressWarmupDay`, `effectiveDailyLimit`) já testado com os casos
  de borda certos (override tentando aumentar acima do teto, override
  negativo) antes mesmo de ser consumido pelo dispatch worker.

---

## 6. Por que não escrevi os testes agora

`apps/web` e `apps/worker` **não têm nenhuma dependência de teste
instalada** (`package.json` sem `vitest`, sem script `test`). Escrever os 6
arquivos prioritários de verdade exige primeiro decidir e instalar a
estratégia de mock de Prisma (fake objects vs `vitest-mock-extended` vs
`prismock`) — é uma decisão de convenção que afeta todo o time (Vega vai
seguir o mesmo padrão daqui pra frente), não algo que eu devesse fixar
sozinha no meio de uma revisão. Registro isso como a **primeira ação
concreta** antes de qualquer teste de `apps/web`/`apps/worker` poder existir
— ver PARA O PRÓXIMO.

---

## 7. Veredito

# REPROVADO para a Fase 4 começar sem ressalvas atendidas

Não é reprovação por "poucos testes" em abstrato — é reprovação porque as
peças que a própria ARQUITETURA chama de mais críticas (`campaign-targets.ts`
contador, `webhook.ts` idempotência, `optouts.ts` cascata) têm **zero**
cobertura, e a Fase 4 é exatamente o que vai colocar volume de verdade
passando por elas pela primeira vez. Hoje, se um desses três arquivos
regredir num PR da Fase 4, **nada no CI pega isso** — só apareceria em
produção, com leads/números reais.

### O que precisa existir para virar APROVADO

1. Infra mínima de teste em `apps/web` e `apps/worker` (vitest + decisão de
   mock de Prisma) — sem isso, nada do resto é possível.
2. Os testes de prioridade **#1 a #4** da lista (§4) escritos e passando:
   `campaign-targets.test.ts`, `webhook.test.ts`, `optouts.test.ts`, e o
   teste de auth do webhook route. Estes quatro cobrem os três caminhos
   citados no pedido do dono (dedupe/contador, idempotência de webhook,
   opt-out honrado) que ainda não têm rede de segurança nenhuma.
3. O bug de `isOptedOut`/`optedOut` (§5.1) corrigido, com teste de
   regressão.
4. `scrape-search.job.test.ts` (prioridade #5) — porque é o próximo código
   que vai tocar produção pela primeira vez de verdade (busca real no Google
   Maps, PROGRESSO.md passo 3), e hoje não tem nenhuma proteção contra
   dedupe quebrado gravando duplicata em massa.

Com esses 4 pontos resolvidos, libero a Fase 4 com as seguintes **ressalvas**
que não bloqueiam início, mas devem ser resolvidas durante:
- Testcontainers/banco de teste (§3) para validar concorrência real
  (`claimTask`, `FOR UPDATE SKIP LOCKED` equivalente do futuro
  `dispatch-tick.job`) antes desse job ir para produção — não precisa estar
  pronto no dia 1 da Fase 4, mas precisa estar pronto antes do primeiro
  disparo real em massa.
- Prioridades #6, #7, #8 (§4) e a fixture de seletor quebrado end-to-end
  (§3, item 3) — importantes, não bloqueantes.

---

## RESULTADO

Rodei os 164 testes existentes (`packages/core`, `messaging`, `scraper`,
`contracts`) — todos passam, sem flakiness observada. Li a fundo os 7
serviços de `apps/web/src/lib/services`, `api-handler.ts`, o webhook route,
`scrape-search.job.ts`, e os módulos-chave de `packages/core`
(dedupe/phone/status/spintax/optout/warmup). `apps/web` e `apps/worker` têm
**zero testes** — confirmado por ausência de `vitest`/script `test` nos
`package.json` e ausência de arquivos `*.test.ts`. Encontrei um bug real em
produção (`isOptedOut` hardcoded `false`, §5.1) e uma fragilidade de query
Prisma (`every`/`some`, §2.6) que passam despercebidos hoje só porque
ninguém os exercitou.

## PARA O PRÓXIMO

**Vega** (ou quem pegar Fase 4): antes de escrever `dispatch-tick.job.ts`,
1) decidir e instalar a estratégia de mock de Prisma para `apps/web`/`apps/worker`
(fake objects vs `vitest-mock-extended`/`prismock`); 2) corrigir o bug de
`isOptedOut`/`optedOut` em `leads.ts` (§5.1); 3) considerar extrair
`normalizeLoginEmail` como função pura testável (§5.3, baixo esforço).
**Cronos**: nenhuma mudança de schema pedida — o índice
`campaignId_status_scheduledFor` já está pronto para o hot path do
dispatch worker.
**Órion**: revisar §2.6 (a mesma query `every`/`some` é usada duas vezes —
webhook e `disconnect` manual — vale confirmar que não há um terceiro
caminho que desconecta instância sem passar por
`haltCampaignsSoleInstanceDisconnected`); e confirmar minha leitura de que
`apikey`/`instanceKey` errados devolvendo o mesmo `404` está correto do
ponto de vista de enumeration (concordo com a decisão do Vega, mas é
revisão de segurança, não minha alçada final).
**Íris (eu, próxima rodada):** assim que a infra de teste existir, escrever
os itens #1-#8 de §4 nesta ordem.

## PENDÊNCIAS (não bloqueiam, mas ficam registradas)

- Fixture de seletor quebrado end-to-end no scraper (§3, item 3) — critério
  de aceite da Fase 2 que nunca foi verificado por teste.
- Edge cases extras em `phone.ts`/`dedupe.ts` (§3, item 4).
- Teste de regressão para §5.2 (ambiguidade de telefone compartilhado entre
  leads) — documentar o comportamento atual antes de qualquer mudança.
- Teste de regressão para §5.4 (`handleMessageStatus` descartando evento
  órfão) — documentar antes que a Fase 4 crie o cenário de corrida de verdade.
- Canário diário do scraper (ARQUITETURA §5.7, "padaria em Campinas, SP") —
  mencionado na arquitetura, não implementado, não testável ainda porque não
  existe.

## APRENDIZADO (registrado na memória)

- Este projeto tem uma cultura forte de comentários "por que", o que ajudou
  muito a auditoria — mas também escondeu uma armadilha: comentários que
  documentam uma decisão de uma fase anterior (`leads.ts:7`, "sem OptOut,
  Fase 3") **não foram revisados quando a fase seguinte mudou a premissa**.
  Vale um lembrete de processo: comentário que descreve "por enquanto X
  porque Y não existe" precisa de um `TODO(fase)` ou ficar na lista de
  handoff da fase seguinte para reconferência.
- A pirâmide de testes deste projeto está fisicamente invertida em relação
  ao risco: a camada mais testada (`packages/core`) é a que menos muda e
  tem menos I/O; a camada com zero testes (`apps/web/src/lib/services`,
  `apps/worker/src/jobs`) é a que concentra transação, efeito colateral e
  contato com produção real.
