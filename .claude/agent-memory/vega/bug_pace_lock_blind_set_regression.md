---
name: bug-pace-lock-blind-set-regression
description: Bug do Órion — WhatsAppInstance.nextSendAllowedAt gravado com SET cego deixava a trava anti-banimento recuar sob concorrência; corrigido com UPDATE condicional no banco (monotonicidade)
metadata:
  type: project
---

Corrigido 2026-09-23 (mesma rodada da Entrega 1 de servidores Evolution — ver
[[convention-evolution-servers-multiserver]]). Único arquivo de produção
tocado: `apps/web/src/lib/services/messages.ts` (+ teste correspondente).

**Causa raiz:** `nextSendAllowedAt` (o "gate" de cadência anti-banimento,
ARQUITETURA §4.9.10/§6.8.7) era só mais um campo dentro do objeto `data` de
`tx.whatsAppInstance.update(...)` — um `SET` CEGO, calculado inteiramente em
JS (`advanceSendPace`, `@inno/core`) a partir do estado da instância lido
ANTES da transação. Com dois envios CONCORRENTES na MESMA instância, o
commit que chega por último vence, **mesmo que o valor dele seja MENOR** que
o que já estava gravado (ex.: envio A sorteia jitter/micro-pausa longa —
gate 10min no futuro — e comita DEPOIS de envio B, que sorteou jitter curto
— gate 45s). A trava recua silenciosamente, sem erro, sem alarme.

**Correção:** extraí a escrita de `nextSendAllowedAt` para uma função
própria, `advanceNextSendAllowedAt(tx, instanceId, candidate)`, que faz
`UPDATE ... SET "nextSendAllowedAt" = $candidate WHERE id = $instanceId AND
("nextSendAllowedAt" IS NULL OR "nextSendAllowedAt" < $candidate)` via
`tx.$executeRaw` — a comparação "só avança" acontece NO PRÓPRIO POSTGRES, na
mesma UPDATE, nunca em duas etapas no processo Node (ler-decidir-escrever
teria exatamente a mesma corrida). `IS NULL` conta como "-infinito" (toda
instância nasce com o campo nulo). Chamada nos 3 pontos que tocavam o campo
(sucesso, `recordSendFailure`, `recordSendUncertain`), dentro da MESMA
transação do resto do envio — não é uma transação própria.
`paceFieldsForUpdate` deixou de incluir `nextSendAllowedAt` (só
`sendsSinceMicroPause`, que continua `{increment}`/`0` incondicional, sem
mudança).

**Teste que prova a monotonicidade** (`messages.test.ts`): simula a corrida
de verdade — grava um gate BEM mais no futuro (10min) que o candidato deste
envio (45s, modo `floor`/bypass de resposta), e confirma que o valor MAIOR
persiste depois do envio (não regride para 45s). Par com um segundo teste
provando que o gate AVANÇA normalmente quando o candidato é de fato maior.
O mock de `$executeRaw` no teste replica a MESMA semântica do `WHERE` real
(não é só "foi chamado") — se o serviço algum dia trocar por `SELECT`+`if`
em JS, o mock some de refletir produção, não finge que passou.

**Achado colateral do mesmo teste:** o teste PRÉ-EXISTENTE de "resposta a
conversa aberta bypassa o pace lock" (`messages.test.ts`, Fase 4.C) tinha um
cenário que — sem essa correção — regredia o gate de 60s para 45s, e a
asserção antiga aceitava isso como certo. Ajustei o cenário (gate inicial
10s, menor que o piso de 45s) para continuar testando o cálculo do jitter
sem colidir com a nova regra de monotonicidade.

**Como evitar de novo:** qualquer campo que representa um "gate"/"teto" lido
por MÚLTIPLOS escritores concorrentes (distinto de um contador simples, que
já usa `{increment}`) precisa da MESMA técnica — comparar e escrever no
banco, nunca no processo. Se aparecer um segundo campo desse tipo (o próprio
`dispatch-tick.job` da Fase 4.F provavelmente vai escrever no mesmo
`nextSendAllowedAt`), ele PRECISA passar por `advanceNextSendAllowedAt`
também — não reimplementar um segundo `SET` cego em paralelo.

**Não pude validar:** contra Postgres real (mesma limitação de sempre nesta
máquina) — a semântica do `WHERE` foi replicada fielmente no mock do teste,
mas o comportamento definitivo sob concorrência REAL de duas conexões
simultâneas só se prova em ambiente com Postgres de verdade.

**Atualização 2026-09-24 (Fase 4.F.1):** `advanceNextSendAllowedAt` mudou de
arquivo (`apps/web/src/lib/services/messages.ts` → `packages/sending/src/
pace.ts`) na extração para o pacote compartilhado com o worker — a correção
sobreviveu BYTE A BYTE (mesmo SQL, mesmo comentário de causa raiz) e ganhou
um teste PRÓPRIO no pacote (`pace.test.ts`), além do teste ponta-a-ponta que
já existia em `messages.test.ts`. Ver [[convention-sending-extraction-fase4f]].

Ver também [[project-innoprospect]], [[convention-cadencia-ligada-envio-manual]]
(o código que introduziu o bug, mesma rodada anterior).
