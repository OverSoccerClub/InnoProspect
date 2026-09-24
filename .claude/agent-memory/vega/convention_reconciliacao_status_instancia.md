---
name: convention-reconciliacao-status-instancia
description: Fase 4.G (2026-09-24) — reconciliação de status de WhatsAppInstance contra a Evolution (statusCheckedAt, listagem com limite de frescor, rota forçada) e a extração de applyInstanceConnectionTransition
metadata:
  type: project
---

Incidente do dono: "mesmo o número estando desconectado o sistema ainda fica
mostrando como se ele estivesse conectado". Causa raiz confirmada (Atlas já
tinha diagnosticado, eu só confirmei lendo o código): até esta rodada, o
ÚNICO caminho que tirava uma `WhatsAppInstance` de `status: 'connected'` era
o webhook `connection.update` (`webhook.ts#handleConnectionUpdate`) — toda
leitura pura (`getWhatsAppInstanceStatus`/`getWhatsAppInstanceQr`) só
sobrescrevia o banco NA TRANSIÇÃO PARA `connected`, nunca na direção
contrária, de propósito (documentado no comentário da função — evitar dar
kill switch fora da transação completa). Um evento de webhook perdido
(restart nosso, blip de rede, Evolution reiniciando) deixava o banco mentindo
PARA SEMPRE, porque nenhuma leitura jamais voltava a perguntar.

**O que entreguei:**

1. `WhatsAppInstance.statusCheckedAt DateTime?` (migração
   `20260924100000_instance_status_checked_at`, aditiva, sem backfill) — "a
   última vez que este `status` foi CONFIRMADO contra a Evolution", não "a
   última vez que mudou" (isso já é `updatedAt`). `null` = nunca confirmado.
2. `apps/web/src/lib/services/instance-connection.ts` (NOVO) —
   `applyInstanceConnectionTransition`, extraído de
   `webhook.ts#handleConnectionUpdate` para existir UM corpo só (update +
   kill switch na mesma transação + alerta fora dela, só na transição real
   para queda). `webhook.ts` agora CHAMA esta função em vez de ter a lógica
   inline — comportamento idêntico, provado pelos 33 testes de
   `webhook.test.ts` passando sem alteração de asserção. Sempre grava
   `statusCheckedAt: now()` (webhook: evento recebido também é confirmação;
   reconciliação: nós perguntamos e ela respondeu).
3. `listWhatsAppInstances` (`whatsapp-instances.ts`) — reconcilia, em
   paralelo (`Promise.allSettled`), toda instância `connected` cujo
   `statusCheckedAt` é `null` ou mais velho que `STATUS_FRESHNESS_MS` (60s,
   constante nomeada). Timeout DURO próprio (`RECONCILE_TIMEOUT_MS`, 5s) via
   `withHardTimeout` (Promise.race caseiro — o `EvolutionClient` não aceita
   `signal` externo hoje; a chamada de rede não é cancelada, só deixamos de
   esperar por ela, inofensivo porque é leitura pura). Falha/timeout NUNCA
   quebra a lista e NUNCA avança `statusCheckedAt` — é isso que sustenta a
   tela dizer "não confirmo desde X" quando a Evolution está fora do ar.
4. `POST /api/v1/whatsapp/instances/reconcile` (NOVO, `requireRole:'admin'`)
   — reconciliação FORÇADA: ignora o limite de frescor, cobre TODA instância
   (não só `connected`), mesmo shape de `ListWhatsAppInstancesResponse`
   (`ReconcileWhatsAppInstancesResponse` = alias do mesmo tipo).
5. Contrato: `WhatsAppInstanceItem.statusCheckedAt: string | null` (ISO) em
   `whatsapp.contract.ts` — a Lyra ainda não consome.

**A regra de "o que é seguro corrigir" (3 casos, comentada no código em
`reconcileOneInstance`)** — o estado bruto da Evolution só distingue 3
valores (`connected`/`connecting`/`disconnected`), o nosso enum tem 5:
- Evolution diz `connected` → SEMPRE sobe para `connected`, venha o banco de
  onde vier (mesma direção segura que `getWhatsAppInstanceQr`/`Status` já
  usavam). Só nesta direção a reconciliação toca instância que NÃO estava
  `connected` (relevante só no modo FORÇADO — a listagem só olha `connected`
  pra começo de análise).
- Banco achava `connected` e Evolution diz `disconnected` (explícito) →
  QUEDA confirmada: transição completa (status + kill switch + alerta) — a
  correção do incidente em si.
- Banco achava `connected` e Evolution diz `connecting` → **decisão minha,
  pedida explicitamente pelo Atlas para eu decidir e comentar**: NÃO é
  queda (Evolution reconectando sozinha, dar kill switch seria falso
  positivo), mas TAMBÉM não fica `connected` (seria continuar mentindo) —
  vira `status:'connecting'` SEM kill switch e SEM alerta. Pode piscar
  connected→connecting→connected entre polls; isso é FIEL à realidade, não
  bug.
- Banco já não achava `connected` (qualquer nuance) e Evolution confirma
  "não conectada" → nada de seguro a corrigir (não sobrescreve `qr_pending`
  — protegeria o modal de QR aberto, mesmo bug de 2026-09-23 em
  `getWhatsAppInstanceQr`) — só confirma `statusCheckedAt`.

**Por que a reconciliação vive na LEITURA (`apps/web`), não num job do
worker:** o factory do `EvolutionClient` por instância
(`getEvolutionClientForInstance`, `@/lib/evolution.ts`) depende de
`api-handler`/crypto que moram em `apps/web` — extrair isso pertence à Fase
4.F.4 (quando o `dispatch-tick.job` precisar resolver o cliente por
instância para ENVIAR, não só para status), e o tick vai conferir a
instância antes de enviar de qualquer forma. Comentado no código para o
próximo não achar descuido.

**Testes novos:** 9 em `whatsapp-instances.test.ts` — o principal (Evolution
confirma desconectada → muda status E halta só as campanhas que dependiam
só dela + alerta), Evolution fora do ar (lista responde com estado antigo,
`statusCheckedAt` não avança), `qr_pending` intocado, freschor evita 2ª
chamada em 2 leituras seguidas, `connected`→`connected` sem alerta, timeout
duro (fake timers, Evolution nunca responde), 3 no bloco de
`reconcileAllWhatsAppInstances` (ignora frescor, sobe instância não-connected
quando Evolution confirma, não sobrescreve `qr_pending`). Mais 1 em
`admin-routes.test.ts` (403/200 da rota nova). `webhook.test.ts` (33) passou
INTACTO — prova que a extração não mudou comportamento.

**Fake-db (`@/test/fake-db.ts`) ganhou:** `FakeWhatsAppInstance.statusCheckedAt`
(default `null` no `create`), `campaignInstance.count` (modela a partir de
`FakeCampaign.instanceIds`, mesma fonte que `campaign.findMany` já usa —
não duplica um 2º array), `instanceDailyStat.findMany`/`findUnique` (stubs
vazios — nenhum teste desta rodada precisa de estatística diária real).

**Não pude validar:** nada disto rodou contra Postgres/Evolution reais (mesma
limitação de sempre). `pnpm typecheck`/`test`/`lint` (668 testes no
`pnpm -w test`) passaram limpos — a ÚNICA falha de typecheck é
`apps/web/src/mocks/whatsapp.ts` (território da Lyra, `mocks/**`), que não
tem `statusCheckedAt` nos objetos mock — mesma classe de pendência já
registrada em [[convention-evolution-servers-multiserver]] (evolutionServerId
obrigatório quebrando `create-instance-dialog.tsx`). Não editei.

Ver também [[project-innoprospect]], [[convention-web-alerts]] (o
`instance_disconnected` reusado sem alteração), [[bug-qr-poll-invalidava-codigo]]
(por que `qr_pending` nunca é tocado por nenhuma reconciliação automática).
