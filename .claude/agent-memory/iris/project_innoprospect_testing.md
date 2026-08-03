---
name: project-innoprospect-testing
description: Estado da infra de teste do InnoProspect (apps/web, apps/worker) — onde está, como os mocks de Prisma funcionam, e as áreas de negócio já cobertas vs. as que seguem frágeis.
metadata:
  type: project
---

Até 2026-08-03, `packages/*` (core/messaging/scraper/contracts) tinham 164
testes vitest; `apps/web` e `apps/worker` tinham ZERO (nem `vitest`
instalado, nem script `test`). Reprovei a Fase 4 por isso em
`REVISAO-QA.md` e depois entreguei a correção na mesma sessão — ver
`PROGRESSO.md`/handoff do Atlas para o contexto completo do pedido.

## Infra criada
- `apps/web/vitest.config.ts` e `apps/worker/vitest.config.ts` — ambos
  `environment: 'node'`, `include: ['src/**/*.test.ts']`.
- `apps/web` tem alias `@` → `./src` configurado no `resolve.alias` do
  vitest.config (o `tsconfig.json` já tinha o path, mas o Vitest/Vite
  precisa do próprio).
- `apps/worker/vitest.config.ts` usa `passWithNoTests: true` DE PROPÓSITO
  enquanto `apps/worker/src/**` está em fluxo ativo (Vega reescrevendo) —
  remover essa flag assim que `scrape-search.job.test.ts` (ou qualquer
  teste do worker) existir, para o CI voltar a exigir cobertura ali.
- Script `test` na raiz: `pnpm -r --if-present run test` (NÃO usa
  `turbo run test` — `turbo.json` não tem task `test` e não é
  propriedade da Íris; se o Vulcano criar essa task depois, dá pra trocar
  por `turbo run test` para ganhar cache/paralelismo).

## Estratégia de mock do Prisma (decisão tomada, vale para o resto do projeto)
Dois padrões usados, conforme a assinatura da função testada:

1. **Funções que recebem `tx: Prisma.TransactionClient` como PARÂMETRO**
   (ex.: tudo em `lib/services/campaign-targets.ts`): fake object manual
   passado direto como argumento, sem `vi.mock` nenhum. Mais simples,
   zero risco de hoisting.

2. **Serviços que importam `prisma` do módulo `@inno/db`** (webhook.ts,
   optouts.ts, leads.ts, templates.ts): `vi.mock('@inno/db', ...)`
   trocando `prisma` por um fake. Construí um "fake db" ÚNICO e
   REUTILIZÁVEL em `apps/web/src/test/fake-db.ts` — um mini banco em
   memória (arrays de lead/message/campaignTarget/campaign/optOut/
   whatsAppInstance/leadActivity) que implementa só os métodos que
   `campaign-targets.ts`/`webhook.ts`/`optouts.ts` realmente chamam.
   Ponto importante: o `campaign.findMany` do fake reproduz a semântica
   REAL do Prisma para `instances: { every, some }` (every sobre relação
   vazia é vacuosamente verdadeiro; só a presença da chave `some` exige
   >=1 relação) — isso faz o teste do kill switch pegar de verdade uma
   regressão que remova `some: {}` da query de produção, não só testar
   "a função foi chamada". Ver `REVISAO-QA.md §2.6` para o motivo.
   `leads.test.ts` e `templates.test.ts` usam mocks mais simples e
   pontuais (não precisam do fake db compartilhado, são read-only ou
   não usam transação composta) — `vi.hoisted()` com `vi.fn()` direto.

3. Para `templates.ts` especificamente, que faz
   `err instanceof Prisma.PrismaClientKnownRequestError`, o mock usa
   `importOriginal` para manter o namespace `Prisma` REAL (classes puras,
   sem I/O) e só trocar o `prisma` (client):
   ```ts
   vi.mock('@inno/db', async (importOriginal) => {
     const actual = await importOriginal<typeof InnoDb>();
     return { ...actual, prisma: prismaMock };
   });
   ```

4. `lib/api-handler.ts` (badRequest/conflict/forbidden/notFound) é
   mockado via `apps/web/src/test/api-handler-mock.ts` em vez de importado
   de verdade — ele importa `next-auth`/`next/server` (peso desnecessário
   para testar regra de negócio pura) e, na rodada de 2026-08-03, estava
   sendo alterado em paralelo pelo Vega (acoplar a ele quebraria os testes
   sob os pés de quem mexia nele). Se/quando ele estabilizar, vale trocar
   pelo real num teste de contrato de rota (prioridade #4/#7 da
   REVISAO-QA.md).

## O que já está coberto (não repetir do zero)
`campaign-targets.ts` (contador/kill-switch), `webhook.ts` (idempotência
de mensagem/status/opt-out automático), `optouts.ts` (409 duplicata,
efeito retroativo, idempotência pública, admin-only delete),
`leads.ts` (regressão do bug `isOptedOut`/filtro `optedOut`, addc7d4),
`templates.ts` (validação de variável/spintax, dupla proteção de delete).

## O que ainda falta (ordem de prioridade, ver REVISAO-QA.md §4)
- `scrape-search.job.test.ts` (apps/worker) — só depois do Vega estabilizar
  `apps/worker/src/**`.
- `api-handler.test.ts` + teste de contrato da rota de webhook — só depois
  do Vega estabilizar `apps/web/src/lib/api-handler.ts`.
- Testes de integração com Postgres/Redis reais (concorrência de
  claimTask, P2002 de verdade, migração rodando) — exige testcontainers ou
  banco de teste dedicado; não dá pra fazer nesta máquina (sem Docker).
- Ver `[[feedback_vitest_mock_hoisting]]` para a armadilha de hoisting que
  vai aparecer de novo em qualquer teste futuro que compartilhe mock entre
  arquivos.
