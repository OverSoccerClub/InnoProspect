---
name: convention-api-routes-fase1
description: Padrões estabelecidos para as rotas /api/v1/* do InnoProspect (api-handler, camadas, filas)
metadata:
  type: project
---

Padrões fixados ao implementar a Fase 1 das rotas de API (ARQUITETURA §4) — seguir nas próximas fases
(templates, campanhas, whatsapp) em vez de inventar de novo.

1. **Toda rota passa por `apps/web/src/lib/api-handler.ts` (`apiRoute({...})`).** Ele faz auth (Auth.js,
   `requireAuth: true` por default), valida `querySchema`/`bodySchema`/`paramsSchema` (Zod de
   `@inno/contracts`) e converte qualquer erro pro envelope padrão (`ApiHttpError` + helpers
   `badRequest`/`notFound`/`conflict`/`forbidden`/`unauthorized`/`upstreamError`, todos `: never`, lança
   direto). Nunca montar `NextResponse.json` de erro à mão numa rota.
2. **Camadas: rota (fina) → `lib/services/<domínio>.ts` (lógica de negócio) → Prisma.** Rotas só chamam
   a função de serviço e envolvem em `NextResponse.json`. Ver `lib/services/searches.ts` e
   `lib/services/leads.ts` como referência de como estruturar a próxima (`templates.ts`,
   `campaigns.ts`, `whatsapp.ts` nas Fases 3/4).
3. **Códigos de erro `code` são só os 8 da `apiErrorCodeSchema`** (VALIDATION_ERROR, UNAUTHORIZED,
   FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, UPSTREAM_ERROR, INTERNAL_ERROR). Nomes específicos que
   a ARQUITETURA menciona por seção (`SEARCH_ALREADY_RUNNING`, `INVALID_STATUS_TRANSITION`,
   `TEMPLATE_IN_USE`, `INSUFFICIENT_TEXT_VARIATION`...) NÃO são valores de `code` — são só o rótulo
   semântico da situação; a distinção real chega pro cliente via `message` (+ `details[].path`/`message`
   quando aplicável). Já confirmado com a Lyra: o form de nova busca (`new-search-form.tsx`) já trata
   exatamente assim (`err.code === 'CONFLICT'`, mensagem fixa; `err.code === 'VALIDATION_ERROR'` +
   `err.details` mapeado por `path`).
4. **`apps/web` NUNCA importa `@inno/scraper`.** `engine/browser.ts` importa `playwright` (Chromium) no
   nível de módulo — puxar isso pro bundle do servidor Next é peso morto (e quebra build: erros
   `node:child_process`/`node:fs` no bundle, ver [[bug-nextjs-workspace-ts-source-imports]] se for
   Edge). Quando uma rota precisa da MESMA lógica que vive lá (ex.: `buildQueryString` de
   `engine/playwright-engine.ts`), duplicar a função pura localmente com comentário apontando a fonte —
   é o que fiz em `lib/services/searches.ts`.
5. **`apps/web` não importa `apps/worker`** (regra de dependência do monorepo — só `packages/*` são
   compartilhados entre apps). Nome de fila BullMQ (`'scrape:search'`) e a fórmula de prioridade
   (`priorityFromPopulation`) estão duplicados, de propósito, em `apps/web/src/lib/queue.ts` (produtor)
   e `apps/worker/src/queues.ts` (consumidor) — é contrato de protocolo (nome de canal Redis), não
   código compartilhável. Se mudar a fórmula/nome num lado, mudar no outro.
6. **Paginação por cursor:** todo endpoint de listagem usa `orderBy: [{campo}, {id}]` +
   `cursor: {id}` + `skip: 1` (quando há cursor) + `take: limit + 1` pra saber se tem próxima página.
   `page.total` sempre via `count()` separado (aceitável no volume da Fase 1; se a Fase 2 trouxer
   500k leads e isso pesar, considerar `count` estimado).
7. **`GET /leads` `facets`:** `byStatus`/`total` são calculados com o filtro completo MENOS `status`
   (pra abas de status não colapsarem pra elas mesmas), enquanto `page.total` usa o filtro completo
   (COM `status`, pra paginação da lista atual bater). Ver `buildWhere(filter, { includeStatus })` em
   `lib/services/leads.ts`.
8. **Campos de fase futura sem model ainda** (`isOptedOut`, `lastContactedAt`, `messages`,
   `contactedInCampaign`) ficam com valor neutro documentado no topo do arquivo de serviço, não
   inventados — procurar o comentário "sem tabela correspondente na Fase 1" antes de tentar
   "completar" isso sem o Cronos ter modelado `OptOut`/`Message`/`CampaignTarget`.
9. **Idempotência/concorrência do `SearchJob`/`SearchTask`:** claim atômico de task é
   `updateMany({where:{id, status:'pending'}, data:{status:'running', attempt:{increment:1}}})` —
   `count===1` confirma que ESTE worker ganhou a task (equivalente em efeito a
   `SELECT ... FOR UPDATE SKIP LOCKED`, mais simples de expressar via Prisma). Fechar `SearchJob` como
   `completed` usa a mesma técnica (`updateMany where status='running'`) pra não fechar 2x sob corrida.
   Contadores (`doneTasks`/`failedTasks`/`leadsFound`/`leadsNew`) SEMPRE via `{increment}` dentro de
   `$transaction`, nunca `COUNT(*)` (tela faz polling de 3s).
10. **Retry do scraper é manual, não via `attempts` nativo do BullMQ**, porque
    `SCRAPE_ERROR_POLICY` (`@inno/scraper/errors.ts`) tem `maxAttempts`/backoff DIFERENTES por
    `ScrapeErrorCode`, e o BullMQ só aceita um número fixo por job. Ver
    `apps/worker/src/jobs/scrape-search.job.ts` — cada job roda com retry próprio via
    `scrapeQueue.add(..., {delay})`, nunca relança pro BullMQ tentar de novo por cima.

Relacionado: [[project-innoprospect]], [[bug-nextauth-edge-prisma-split]],
[[bug-nextjs-workspace-ts-source-imports]].
