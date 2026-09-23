---
name: gate-nullable-e-contadores-concorrentes
description: Como modelar um gate de cadência nullable ("NULL = sem restrição") e contadores mutáveis escritos por processos diferentes (web + worker) sem corrida — Fase 4.A (WhatsAppInstance.nextSendAllowedAt/sendsSinceMicroPause/consecutiveUncertain).
metadata:
  type: project
---

Padrão estabelecido na Fase 4.A (`20260923130000_dispatch_cadence`,
ARQUITETURA §4.9.10/§6.8.1/§6.8.7) para colunas de estado compartilhadas por
múltiplos escritores concorrentes — provavelmente vai se repetir quando o
motor de campanhas (§6.8, ainda não implementado) entrar de verdade.

**1. Gate `DateTime?` nullable: NULL tem que significar "sem restrição", nunca
"bloqueado".** `WhatsAppInstance.nextSendAllowedAt` nasce `NULL` em toda
instância já existente (migração aditiva, sem backfill). Isso só é seguro
porque a regra de leitura é `nextSendAllowedAt IS NULL OR nextSendAllowedAt
<= now()` — nunca `nextSendAllowedAt <= now()` sozinho. Em SQL,
`NULL <= now()` avalia para `NULL` (falso na prática de um `WHERE`), então
sem o `IS NULL` a comparação EXCLUIRIA da elegibilidade toda instância que
nunca tocou a coluna — inclusive as de produção que já enviam hoje sem freio
nenhum. Isso quebraria o envio manual (que precisa continuar funcionando) no
exato momento em que a migração roda. Qualquer coluna nova de "instante a
partir do qual X é permitido", nullable, onde o estado inicial de produção
precisa ser "permitido", segue esse padrão — documentar a regra de leitura
tanto no comentário do campo em `schema.prisma` quanto no cabeçalho da
migração, porque quem escreve a policy (Vega, `packages/core`) não vê o
schema.

**2. Contador mutável com MAIS DE UM escritor em processo diferente exige
incremento atômico em SQL, nunca read-modify-write em JS.**
`sendsSinceMicroPause`/`consecutiveUncertain` são escritos pelo envio manual
(`apps/web`), pelo `dispatch-tick.job` (`apps/worker`) E por um job diário
(`warmup-roll.job`) que zera os dois — três escritores, dois processos
distintos, na MESMA linha. Regra: sempre `UPDATE ... SET col = col + 1` (SQL
cru) ou `{ increment: 1 }`/`{ decrement: 1 }` (Prisma) — nunca `SELECT`
seguido de `UPDATE` com o valor somado em JavaScript. A segunda forma tem uma
janela entre leitura e escrita onde a outra transação escreve por cima; a
conta perde 1 incremento sem erro visível (lost update), e só aparece sob
carga real, nunca em teste sequencial. Reset incondicional para 0 pode ser um
`SET col = 0` direto (não depende do valor anterior, não tem essa janela).

**Como aplicar:** ao modelar qualquer contador/gate novo, perguntar
explicitamente "quem escreve esta coluna, e em que processos?" antes de
aceitar — se a resposta for "mais de um caminho, em paralelo", o aviso de
atomicidade vai no comentário do campo E no cabeçalho da migração (não
confiar que quem implementa a política vai adivinhar). Ver também
[[lgpd-cascade-vs-historical-counters]] para o padrão irmão de contadores
agregados (que não tem esse problema de concorrência porque cada evento só é
processado uma vez, por um escritor).
