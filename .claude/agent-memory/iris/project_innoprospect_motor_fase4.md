---
name: project-innoprospect-motor-fase4
description: Auditoria da Fase 4.F (motor de disparo, dispatch-tick.job) — o que os 815 testes verdes NÃO provam, e o gap de UI do freio global. Consultar antes de testar qualquer coisa em packages/sending ou apps/worker/src/jobs/dispatch-tick.job.ts.
metadata:
  type: project
---

Auditoria de 2026-09-25 (Fase 4.G). Roteiro humano de aceite entregue em
`ACEITE-FASE-4.md` (raiz). Ver `[[project-innoprospect-testing]]` para o
resto da infra de teste do projeto.

## O que fica provado só "na forma", nunca contra infraestrutura real

`packages/sending/src/send-one.ts` (`executeSendAttempt`) e
`campaign-targets.ts` (`advanceCampaignTargetStatus`,
`haltCampaignsSoleInstanceDisconnected`) **não têm arquivo de teste próprio**
dentro de `packages/sending` (só `pace.test.ts`, `outcome.test.ts`,
`evolution-crypto.test.ts` existem lá). A cobertura real desses dois arquivos
vem de FORA, por dois call sites que os exercitam de verdade (não mockados):
- `apps/web/src/lib/services/messages.test.ts` (829 linhas, via
  `sendLeadMessage`).
- `apps/worker/src/jobs/dispatch-tick.job.test.ts` (via `runDispatchTick`).

**Os dois usam o MESMO padrão de fake**: `prismaMock.$transaction = vi.fn(fn
=> fn(prismaMock))` — chama a callback direto contra o mesmo mock, sem
nenhuma semântica de rollback real. Consequência: nenhum teste do repo prova
— nem pode provar, sem Postgres real —
1. `FOR UPDATE SKIP LOCKED` excluindo dois processos concorrentes de verdade
   (`lib/dispatch-claim.ts`) — o fake simula o CONTRATO da query (claim 1
   alvo pending, avança scheduledFor/attempt) por parsing de texto SQL, não
   exclusão mútua real.
2. `Message.campaignTargetId @unique` (`schema.prisma:1062`, migração real
   confirmada em `20260801130000_add_messaging_and_campaigns/migration.sql`)
   travando de verdade uma segunda escrita — o fake joga um erro `P2002`
   manualmente quando detecta colisão em `store.messages`, o que prova a
   LÓGICA que reage ao erro (não reenvia), mas não prova que o Postgres real
   de fato geraria esse erro nem que a transação faria rollback completo.
3. Atomicidade das transações de write-ahead/resultado — como `$transaction`
   é só uma chamada direta, um throw no meio de uma transação fake **não
   desfaz** escritas anteriores dela (só não corrompe porque, na prática, o
   throw de `message.create` acontece ANTES de qualquer mutação do fake
   nesses testes específicos — coincidência de ordem, não uma garantia do
   fake).

**Conclusão prática:** os 3 invariantes duros do motor (claim atômico,
anti-duplicata, atomicidade) estão provados **em lógica/forma**, não em
comportamento contra o banco real. O aceite manual (`ACEITE-FASE-4.md` item
5) é quem fecha essa lacuna — e mesmo ele só prova "não duplicou", não prova
a exclusão mútua entre dois workers rodando ao mesmo tempo (cenário do
`SKIP LOCKED`, que exigiria dois processos worker de verdade competindo pelo
mesmo alvo — nenhum teste, automatizado ou manual, cobre isso ainda).

## `dispatch-state.ts` (pausa global) — zero teste, nem mockado nem real

`apps/worker/src/lib/dispatch-state.ts` (`isDispatchEnabled`,
`recordDispatchTickHeartbeat`, semântica **ausente=pausado**, invertida de
propósito em relação ao scraper) não tem `.test.ts` próprio — em
`dispatch-tick.job.test.ts` ele é 100% `vi.mock`ado (as duas funções são
`vi.fn()` que o teste controla diretamente). Mesma situação para
`apps/web/src/lib/dispatch-state.ts`/`dispatch-queue.ts` (equivalente do lado
que ESCREVE a chave) e para `apps/worker/src/lib/queue-state.ts` (irmão do
scraper). **A lógica real de leitura/escrita da chave no Redis nunca foi
exercitada por nenhum teste** — só a decisão de "o que fazer quando ela diz
pausado/rodando" (isso sim está testado, via os mocks). O item "0.bis" do
`ACEITE-FASE-4.md` existe por causa disso.

## Gap de UI real, achado nesta auditoria (não é teste — é ausência de tela)

`ARQUITETURA.md §8` (tabela 4.F.3) promete rotas **e tela** para
pausar/retomar o motor globalmente
(`GET/POST /api/v1/dispatch/queue[/resume]`). As rotas existem
(`apps/web/src/app/api/v1/dispatch/queue/**`); **não existe nenhum
componente de UI que as consuma.** `QueueHealthBanner`
(`apps/web/src/components/dashboard/queue-health-banner.tsx`) é do
**scraper** (`/api/v1/scraper/queue`), não do motor — confirmado lendo o
import (`@/lib/api/scraper`). Hoje pausar o motor exige chamar a API na mão.
Contradiz o próprio `§6.8.9` ("do celular, sem terminal"). Registrado como
pendência no veredito da Fase 4.G, não como bug do `dispatch-tick.job` —
é escopo de Lyra/Vega (tela), não do motor em si.

## D8 não é bug novo — não reportar de novo

Se, ao reler `send-one.ts`, parecer que uma `Message` pode ficar presa em
`status='queued'` para sempre depois de um crash entre o write-ahead e o
avanço de status (2ª tentativa bate no `@unique`, joga exceção não
capturada, o alvo eventualmente vira `failed/max_attempts` sem a mensagem
original nunca resolver) — **isto já é dívida aceita e documentada**
(`ARQUITETURA.md §9.2`, dívida **D8**, herdada do envio manual desde a Fase
3, não introduzida pelo motor). Confirmado lendo `§4.9.5` ("linha `queued`
órfã... é o resíduo aceito dessa escolha"). Não é achado novo — é o motor
herdando corretamente um comportamento já assumido, o que é o esperado por
`§6.8.0` ("segunda implementação = reprovação"). Só vale mencionar de novo se
o padrão mudar (ex.: alguém adicionar uma reconciliação sem atualizar a
dívida D8 no documento).

## Estado do `pnpm test` nesta rodada (2026-09-25)

815 testes, todos verdes: `packages/scraper` 54, `packages/contracts` 13,
`packages/core` 215, `packages/messaging` 59, `packages/sending` 22,
`apps/web` 378, `apps/worker` 74. Bate com o número citado pelo Atlas antes
de eu rodar — não precisa reconferir na próxima sessão a menos que algo
tenha mudado.
