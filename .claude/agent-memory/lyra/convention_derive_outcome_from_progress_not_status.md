---
name: convention-derive-outcome-from-progress-not-status
description: Quando um status terminal da API (ex. "completed") não distingue sucesso/falha parcial/falha total, derive o resultado visual localmente a partir dos contadores de progresso — nunca confie num campo agregado ambíguo (ex. `percent`) pra desenhar barra/selo
metadata:
  type: feedback
---

**Bug real relatado pelo dono em produção (Onda 2B, 2026-09-22):** uma busca
em que os 5 municípios falharam e 0 leads foram coletados aparecia com selo
**verde "Concluída"** — e a barra de progresso aparecia parcial/totalmente
cheia ao lado do rótulo "0/5 municípios". Duas mentiras na mesma tela.

**Causa raiz:** `SearchJobStatus` (`search.contract.ts`) só tem `completed`
como "o job terminou de processar todas as tasks" — não diz nada sobre o
RESULTADO. E `progress.percent` é um campo agregado cuja fórmula não é
especificada no contrato (pode contar só concluídos, ou concluídos+falhos,
dependendo de quem implementou) — usá-lo direto pra desenhar a barra criava
a segunda contradição.

**Correção (sem pedir nada novo à API — os campos já existem):**
1. `lib/search-job-outcome.ts` — `getSearchJobOutcome(job)` deriva um tipo
   maior (`completed_success` / `completed_partial` / `completed_empty` +
   os status originais) a partir de `progress.done`/`progress.failed`/
   `progress.total`, nunca de `percent`. `SearchJobStatusBadge` passou a
   receber `job` inteiro (não só `status`) e escolhe cor/ícone/rótulo por
   esse outcome — 3 selos hoje: verde "Concluída", âmbar "Concluída com
   falhas", vermelho "Sem resultados" (distinto do vermelho "Falhou", que é
   o job travando no meio, não terminando com tudo falho).
2. `components/searches/search-progress-bar.tsx` — barra com 2 segmentos
   (`done`→verde, `failed`→vermelho) calculados localmente de
   `done`/`failed`/`total`, nunca de `percent`. Geometricamente impossível
   contradizer o rótulo textual ao lado, porque os dois vêm da mesma conta.

**Como aplicar em qualquer entidade nova com esse formato "status terminal +
contadores"** (candidato óbvio: `CampaignStatus`/`CampaignTarget` na Fase 4,
que tem a mesma forma `completed`/`failed`/contadores de alvo) — nunca
mapear 1:1 status→cor sem checar se aquele status pode esconder um "terminou
mas o resultado foi ruim". Se a API expuser um campo `percent`/agregado sem
fórmula documentada no contrato, prefira recalcular a partir dos contadores
brutos (`done`/`failed`/`total`) em vez de confiar nele para UI crítica.

Mocks de teste ficam em `mocks/searches.ts` (`failAll`/`failCount` no tipo
`MockJob`) — sempre que um bug de produção for consertado, adicionar o
cenário que o reproduz no mock, não só corrigir o componente.
