---
name: convention-dashboard-summary
description: Padrão estabelecido para GET /api/v1/dashboard/summary — helpers de fuso América/São_Paulo, $queryRaw parametrizado, e como testar SQL cru sem Postgres
metadata:
  type: project
---

Primeira rota do InnoProspect que precisa de `$queryRaw` de verdade (`byDay` agregado por dia-calendário,
`optedOut` via `EXISTS`) — ver `apps/web/src/lib/services/dashboard.ts` (+ `dashboard.test.ts`),
`apps/web/src/app/api/v1/dashboard/summary/route.ts`, `packages/contracts/src/dashboard.contract.ts`.
Reaproveitar este padrão em vez de reinventar na próxima vez que aparecer "métrica agregada por dia" ou
"contagem que depende de EXISTS entre duas tabelas".

1. **Fuso América/São_Paulo com offset FIXO -03:00** — o Brasil não tem horário de verão desde 2019, o que
   permite `toSaoPauloDateKey` (`Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',...})`, formato
   `YYYY-MM-DD`) e `saoPauloDayStartUtc` (`new Date(`${dateKey}T03:00:00.000Z`)`) sem precisar de uma lib de
   fuso horário completa. Se essa lei mudar, os dois precisam ser reescritos. Documentado no topo do arquivo.
2. **Duas convenções de "janela de N dias" DIFERENTES, de propósito:**
   - Séries que aparecem como dia-a-dia na UI (`byDay`) e os totais que precisam BATER com a soma dela
     (`createdLast7d`/`createdPrev7d`) usam limites de DIA-CALENDÁRIO em SP (`saoPauloDayStartUtc`).
   - Contadores sem série ao lado (`searches.completedLast30d`/`tasksFailedLast30d`) usam janela ROLANTE
     simples (`generatedAt.getTime() - 30*24h`, UTC puro) — não precisam bater com nada, não vale a
     complexidade extra.
3. **`$queryRaw` sempre tagged template parametrizado, nunca `$queryRawUnsafe`/interpolação de string.**
   `COUNT(*)::int` (cast explícito) evita o `bigint` que o Postgres devolve por padrão — ver
   [[bug-bullmq-client-not-ioredis]] para o estilo de gotcha equivalente (tipo que a lib devolve ≠ tipo que
   o código espera). `to_char(..., 'YYYY-MM-DD')` formata a data DENTRO do SQL — evita reconverter um
   `date`/`timestamp` do driver de volta pro fuso certo no lado do Node (fonte comum de off-by-one).
3b. **⚠️ CORREÇÃO (Atlas, 2026-09-22): `AT TIME ZONE` tem que ser DUPLO.** A primeira versão desta rota
   usava `"createdAt" AT TIME ZONE 'America/Sao_Paulo'` e estava ERRADA. O Prisma mapeia `DateTime` para
   `TIMESTAMP(3)` SEM fuso (confira na migração: nenhum `@db.Timestamptz` no schema) e grava em UTC.
   Em timestamp sem fuso, um único `AT TIME ZONE 'America/Sao_Paulo'` interpreta o valor UTC COMO SE fosse
   horário de SP e desloca 3h no sentido errado: todo lead das 21h às 0h de SP ia para o dia seguinte.
   Forma certa: `("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'` (1º declara que o
   valor é UTC, 2º converte para o relógio de SP). **Por que os testes não pegaram:** o mock de
   `$queryRaw` reimplementa o agrupamento em JS, então passa com qualquer SQL. Mock de SQL cru nunca
   prova semântica de fuso; só prova forma. Há agora um teste que trava a expressão literal.
4. **Preencher dias vazios SEMPRE no código** (`buildByDay` faz `Map` das linhas devolvidas + itera as 30
   chaves esperadas, default `0`) — nunca confiar que `GROUP BY` devolve todos os dias (dia sem lead
   simplesmente não aparece na query).
5. **Teste de `$queryRaw` sem Postgres:** mock roteado pelo TEXTO da query (`strings.join('').includes(...)`),
   não pela ORDEM de chamada no `Promise.all` — a ordem pode mudar sem ninguém perceber que quebrou o teste.
   O fake reimplementa a semântica em memória (groupby/EXISTS sobre um fixture array), não devolve valores
   fixos por chamada — é o que dá cobertura de verdade pra matemática de fuso horário (peguei bug de
   off-by-one comigo mesmo escrevendo o teste desta forma, antes de rodar).
6. **`vi.useFakeTimers()` + `vi.setSystemTime(...)` para controlar `new Date()` interno do serviço** —
   `getDashboardSummary()` não recebe "agora" por parâmetro (calcula `new Date()` internamente), então é
   assim que o teste fixa os limites de dia-calendário/janela de 7 dias de forma determinística. Mesmo
   mecanismo de fake timers de [[bug-vitest-fake-timers-retry-backoff]], aplicado a `Date` em vez de
   `setTimeout`.
7. **Índices que faltam pra estas queries em produção (NÃO criei — schema é do Cronos):**
   - `Lead`: nenhum índice cobre filtro/scan só por `createdAt` (o único hoje é `[status, createdAt]`,
     composto, não ajuda `WHERE "createdAt" >= X` sozinho). Usado por `byDay`, `createdLast7d`/`Prev7d`,
     `optedOut`. Sugestão: `@@index([createdAt])`.
   - `SearchJob`: nenhum índice cobre `finishedAt` (só `[status, createdAt]`/`[uf, createdAt]`). Usado por
     `completedLast30d`. Sugestão: `@@index([status, finishedAt])`.
   - `SearchTask`: nenhum índice cobre `finishedAt` (só `[searchJobId, status]`/`[status, priority]`). Usado
     por `tasksFailedLast30d`. Sugestão: `@@index([status, finishedAt])`.
   No volume atual (produção ainda não coletou lead nenhum, ver `bloqueio-docker` na memória do Atlas) isto
   não trava nada — mas assim que `Lead` crescer, essas 4 queries do dashboard viram sequential scan.

Relacionado: [[project-innoprospect]], [[convention-api-routes-fase1]], [[bug-bullmq-client-not-ioredis]],
[[bug-vitest-fake-timers-retry-backoff]].
