---
name: bug-instance-daily-stat-responded-count-never-written
description: Card de instância jurava "0 respondidas hoje" pra sempre — InstanceDailyStat.respondedCount nunca era escrito; fix em webhook.ts#recordInstanceResponseIfFirstToday. Segundo contador na mesma situação (blockedCount) identificado e NÃO corrigido.
metadata:
  type: project
---

Entregue 2026-09-26. Causa raiz: `InstanceDailyStat.respondedCount`
(`packages/db/prisma/schema.prisma`) era escrito só no `create` do write-ahead
de `packages/sending/src/send-one.ts` (sempre `0`, nunca incrementado depois)
— eu mesmo já tinha CONFIRMADO isso por grep na 4.F.5
(`[[convention-periodicos-warmup-fase4f5]]`, ao decidir não implementar as
heurísticas de shadow-ban) mas não fechei o buraco na época, por estar fora
do escopo daquela rodada. `apps/web/src/lib/services/whatsapp-instances.ts#
toInstanceItem` expunha `todayStat?.respondedCount ?? 0` — sempre zero na
tela, para sempre, é o mesmo padrão de bug de "tela afirma com confiança um
número que ninguém mantém" do `warmupDay`/campos de campanha órfãos.

## O que decidi (pedido explicitamente para eu decidir)

1. **O que conta como "respondida":** no máximo 1 incremento por (lead,
   instância, DIA) — mede ENGAJAMENTO do número, não volume de mensagens. Um
   lead que manda 5 mensagens no mesmo dia soma 1, não 5. Regra DIFERENTE de
   `Campaign.respondedCount` (funil por ALVO, nunca reconta o mesmo alvo) —
   aqui a chave é lead+dia, porque o mesmo lead pode gerar um novo dado de
   engajamento em outro dia ou fora de qualquer campanha.
2. **Fuso do "dia":** `localDateKey` (`@inno/core`) do `event.timestamp` (a
   hora que a resposta chegou), não do instante de processamento do webhook —
   mesma granularidade que `Message.createdAt` já grava.
3. **Resposta sem alvo de campanha ativo:** conta igual — a métrica é da
   INSTÂNCIA (engajamento do número), não do funil de uma campanha.
4. **Idempotência:** checagem PRÉ-upsert do `providerMessageId` (mesmo padrão
   de `registerOptOutFromInbound` — "checa antes de agir"), feita ANTES da
   query "já respondeu hoje?" e ANTES do `message.upsert`. Reenvio do MESMO
   evento nunca soma 2x.
5. **`upsert`**, não `update` — a linha do dia pode não existir (nasce só no
   primeiro ENVIO). `create` não deixa os outros contadores indefinidos: eles
   nascem no `@default(0)` do schema, mesmo padrão do write-ahead de
   `send-one.ts`.

Implementação: `recordInstanceResponseIfFirstToday(tx, instanceId, leadId,
eventTimestampIso)` em `apps/web/src/lib/services/webhook.ts`, chamada dentro
de `handleInboundMessage` só quando `existingMessage` (checado por
`providerMessageId`) é `null` — ANTES do `message.upsert` que de fato grava a
mensagem (para a query "já existe inbound hoje?" não se auto-encontrar, sem
precisar de filtro de exclusão).

## Gotcha de teste (não é bug de produção)

As fixtures compartilhadas de `webhook.test.ts` usam `messageTimestamp:
1735689600` fixo — esse instante (`2025-01-01T00:00:00Z`) cai EXATAMENTE na
virada de meia-noite em `America/Sao_Paulo` (limite EXCLUSIVO do dia,
`localDateKey`+24h). Um teste que precisa de DUAS mensagens no MESMO dia civil
não pode reusar esse valor cru — precisa de um timestamp deslocado para
dentro do dia (ver `webhook.test.ts`, teste "lead tagarela", timestamp
`1735689600 - 36000`/`- 32400`). Puramente uma coincidência da fixture, não
revela bug em `localDateKey` nem no código de produção.

## Segundo contador na MESMA situação — encontrado, NÃO corrigido (fora do escopo pedido)

`InstanceDailyStat.blockedCount` é lido em `whatsapp-instances.ts#
getWhatsAppInstanceDetail` (exposto no histórico de 30 dias, `GET
/whatsapp/instances/:id`) e **nunca é escrito em lugar nenhum do código de
produção** (confirmado por grep, mesma técnica desta rodada). Mesmo padrão:
tela mostra um número que ninguém mantém — hoje é sempre `0`. Avisado ao
dono, não corrigido por pedido explícito ("se encontrar um segundo, me avise,
não conserte por conta própria — quero saber o tamanho do padrão antes de
decidir o escopo").

## Fora de escopo, de propósito

As heurísticas de shadow-ban por taxa de RESPOSTA (ARQUITETURA §6.6) — Fase
5/6, mesma decisão de `[[convention-periodicos-warmup-fase4f5]]`. Esta rodada
só fecha o buraco de DADO; não implementa a heurística.

## Números

866 testes (`pnpm -w test`, era 862) — +4 em `webhook.test.ts`
(`recordInstanceResponseIfFirstToday`: soma na primeira resposta do dia,
idempotência de reenvio, lead tagarela não dobra, resposta sem alvo de
campanha ainda soma). `pnpm typecheck` (10 pacotes) e `pnpm lint` limpos.

`apps/web/src/test/fake-db.ts` ganhou: `FakeInstanceDailyStat` +
`instanceDailyStats` no seed/store, `message.findFirst` (não existia — só
`findUnique`), `instanceDailyStat.upsert` (roteado por `instanceId_date`
comparando `date` por VALOR via `getTime()`, não por referência — mesma
semântica do Postgres real, `@db.Date`). `instanceDailyStat.findMany`/
`findUnique` passaram a de fato consultar o seed (antes eram stubs cegos
`[]`/`null`).

Ver também `[[convention-periodicos-warmup-fase4f5]]` (onde o buraco foi
confirmado por grep pela 1ª vez), `[[convention-send-policy-local-date-key-fase4f2]]`
(`localDateKey`), `[[prisma-datetime-sem-fuso]]` (por que `@db.Date` precisa
de comparação por valor, não instância).
