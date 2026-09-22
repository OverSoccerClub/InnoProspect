---
name: convention-leads-export-bulk
description: GET /leads/export (CSV streaming) e POST /leads/bulk (ações em massa) — decisões de design e por que o contrato original foi revisado
metadata:
  type: project
---

Entregue 2026-09-22 (decisão do dono: uso próprio, sem multi-cliente — por isso sem isolamento por
cliente aqui). Escopo: `apps/web/src/app/api/v1/leads/export/route.ts`,
`.../leads/bulk/route.ts`, `lib/services/leads.ts` (funções novas), `packages/contracts/src/lead.contract.ts`.

**O contrato de export/bulk já existia como RASCUNHO desde a Fase 1** (commit `83f02a9`, nunca
consumido por rota nenhuma) e ficou provado insuficiente antes de qualquer implementação — por isso
foi REVISADO, não versionado por cima. Duas mudanças de fundo, ambas documentadas com comentário
"🆕 Revisão de 2026-09-22" no próprio `lead.contract.ts` (não é uma nota perdida em memória):

1. **`POST /leads/bulk`**: `{ ok, affected }` → `{ ok, updatedIds, skipped, summary }` +
   `expectedCount` obrigatório com `filter` (proibido com `leadIds`). `leadBulkActionSchema` perdeu
   `discard`/`opt_out` (não pedidos neste escopo — `discard` é só `set_status` com
   `value.status:'discarded'`; `opt_out` grava em `OptOut` com `source`, escopo de endpoint próprio).
2. **`GET /leads/export`**: separador `;` (ARQUITETURA §4.3 dizia `,` — Excel PT-BR usa vírgula como
   separador DECIMAL, então `,` quebra `nota` em duas colunas) + coluna `descadastrado` adicionada
   (o rascunho original não trazia `isOptedOut` nenhuma). **ARQUITETURA §4.3 ainda não reflete isto**
   — fora do meu escopo tocar o arquivo, reportar para a Nova/Alexandria reconciliarem.

**Decisões de implementação (para não redescobrir):**

- **CSV/escape moram em `lib/services/leads.ts`, não na rota** (`escapeCsvField`, `buildCsvLine`,
  `CSV_BOM`, `CSV_SEPARATOR`, `leadExportFilename`, todos exportados). Motivo: qualquer arquivo que
  importe `lib/api-handler.ts` (a rota importa) puxa `lib/auth.ts` → `next-auth`, que quebra em
  Vitest puro (ver [[bug-nextauth-vitest-server-import]]). Mantendo a lógica pura no serviço, o teste
  de escape/filtro não precisa mockar `next-auth`.
- **Escape de fórmula (CWE-1236):** valor que comece com `=`,`+`,`-`,`@` recebe prefixo `'` (convenção
  do próprio Excel de "forçar texto"). Aspas duplas quando o valor contém `;`/`"`/quebra de linha (RFC
  4180). `nota` (rating) troca `.` por `,` (decimal PT-BR). `tags` juntadas com `|` (nunca `,`/`;`,
  que colidiriam com separador/decimal).
- **`resolveLeadWhere(filter)`** (`lib/services/leads.ts`) é o ÚNICO ponto que decide "buscar
  `fetchTodosOptedOut` ou não" pra montar o `where` completo (COM status) — usado por `bulk` E
  `export`. `buildWhere` (a mesma de `listLeads`) teve o tipo do parâmetro trocado de `ListLeadsQuery`
  pra `LeadFilter` (mais geral) pra aceitar os três chamadores sem duplicar a função.
- **Streaming do export:** `iterateLeadsForExport` pagina por cursor (`orderBy: [createdAt, id]`,
  `LEAD_EXPORT_PAGE_SIZE=1000`), NUNCA usa o `sort` da tela (é um dump completo do filtro, não uma
  página de UI — ordem estável e indexada é o que importa). `countLeadsForExport` roda ANTES de abrir
  o `ReadableStream`, pra nunca começar uma resposta `200` que seria cortada por `LEAD_EXPORT_MAX_ROWS`
  no meio. Limitação aceita e documentada no código: se a consulta falhar DEPOIS do stream já ter
  começado (headers já enviados), `controller.error` só consegue abortar a conexão — o cliente recebe
  arquivo truncado, não um erro estruturado.
- **`expectedCount` (proteção "mudei 4.000 leads sem querer"):** só existe quando `filter` é usado.
  `resolveBulkTargetIds` reconsulta o filtro NO MOMENTO da chamada e compara com `expectedCount` da
  tela; diferença → `409 CONFLICT`/`EXPECTED_COUNT_MISMATCH`, ANTES de ler o estado de qualquer lead
  (nada é lido/alterado). Contagem acima de `LEAD_BULK_MAX_IDS` (10.000) → `422`/`TOO_MANY_ITEMS`.
- **Chunking do bulk (`LEAD_BULK_CHUNK_SIZE=200`):** cada lote de até 200 itens roda na SUA PRÓPRIA
  `$transaction` (array form: `[update, activityCreate, update, activityCreate, ...]` via `flatMap`),
  não uma transação única pros até 10.000 itens — evitaria segurar lock/conexão tempo demais. Não há
  atomicidade ENTRE lotes (aceito: o contrato já pede "não falhar tudo por um item ruim").
- **Motivos de skip (`bulkLeadsSkipReasonSchema`):** `NOT_FOUND` (id não existe),
  `INVALID_STATUS_TRANSITION` (mesma `checkStatusTransition` do `PATCH /leads/:id`, nunca uma segunda
  regra), `NO_CHANGE` (já estava no estado/tags pedidos — não é erro, só não gera `LeadActivity`,
  ruído zero na timeline).
- **`LeadActivity.type` novos:** `tags_added`/`tags_removed` (vocabulário aberto, mesmo padrão de
  `status_changed`/`note_added` já existentes). **Pendência pra Lyra:** a timeline da ficha do lead
  mapeia `type` pra rótulo em português (PROGRESSO.md menciona isso) — conferir se esses dois tipos
  novos têm rótulo, senão caem no `type` cru.

**Não validado (mesma limitação de sempre):** nada disto rodou contra Postgres real — paginação por
cursor do export com múltiplas páginas de verdade, e o `$transaction` chunkado do bulk sob volume real
(milhares de leads), só têm a lógica provada por mock em `leads-export.test.ts`/`leads-bulk.test.ts`
(12+8 testes), não o comportamento sob carga/concorrência real.

Relacionado: [[project-innoprospect]], [[convention-api-routes-fase1]] (regra 8: campos de fase futura
com valor neutro — aqui o padrão inverso, um contrato-rascunho revisado ANTES de qualquer consumidor
existir), [[bug-nextauth-vitest-server-import]].
