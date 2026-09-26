---
name: innoprospect_fase4h_motor_disparo_go_live
description: Auditoria de go-live do dispatch-tick.job (Fase 4.H, 2026-09-26) — veredito, o único achado real e o que ficou provado só por leitura de código.
metadata:
  type: project
---

Auditoria de liberação do motor de disparo (`apps/worker/src/jobs/dispatch-tick.job.ts`) contra leads
reais, 2026-09-26, commit `ce6f727`, 866 testes verdes (54 scraper + 13 contracts + 215 core + 59
messaging + 22 sending + 410 web + 93 worker).

**Veredito: LIBERADO.** 0 critical, 0 high, 1 medium.

## Confirmado (não só aceito por documento — verificado no código):

- Portão único: `grep -rn "sendText(" apps/ packages/` dá exatamente 1 call site de produção
  (`packages/sending/src/send-one.ts:198`). `apps/web/src/lib/services/messages.ts` (manual) e
  `apps/worker/src/jobs/dispatch-tick.job.ts` (motor) chamam o MESMO `executeSendAttempt` →
  `evaluateSendGuard` (`packages/core/src/whatsapp/send-guard.ts`), sem segunda implementação. O worker
  passa os três `overrides` como literais `false` hardcoded — nenhum input externo influencia.
- Sequência protegida (`send-one.ts:97-220`): zero `await` entre a leitura de opt-out e
  `evaluateSendGuard`; entre o guard e `sendText` só a transação de write-ahead + o teto síncrono
  `maxDecisionToSendMs` (o conserto de 22/09, [[innoprospect_onda_a_envio_unitario]], continua vivo).
- Duplicata: `Message.campaignTargetId @unique` no schema; write-ahead cria o `Message` antes de
  `sendText`, único ponto de criação de `Message` outbound de lead no repo.
- Freio: `isDispatchEnabled` fail-closed (ausência OU JSON corrompido = pausado); chave Redis idêntica
  nos dois apps (`inno:dispatch:queue:enabled-meta`); `requireRole:'admin'` é gate REAL em
  `api-handler.ts` (`forbidden()` se role não bate), não só documentado.
- Segredo/log: `evolution-crypto.ts`/`evolution-resolver.ts` (movidos para `packages/sending` esta
  semana) nunca logam chave-mestre/ciphertext/apiKey decifrada; `evolution-servers.ts` monta a resposta
  campo a campo (nunca spread da row do Prisma) — ciphertext não escapa por acidente.
- LGPD: `hasOptOutNotice`/`MISSING_OPTOUT_NOTICE` bloqueiam no `start` da campanha E em runtime (G10 do
  guard) — dupla camada. Lead apagado por retenção enquanto alvo `pending` não crasha o worker.
- O conserto do `nextSendAllowedAt` (SET cego → `UPDATE ... WHERE nextSendAllowedAt IS NULL OR <
  candidate`, [[innoprospect_fase4c_cadencia_ligada]]) sobreviveu exatamente ao cenário que eu tinha
  avisado ("crítico quando o motor ganhar um segundo escritor concorrente") — `packages/sending/src/pace.ts:73-80`.

## O único achado real (MEDIUM, não bloqueante)

`apps/web/src/lib/services/webhook.ts:229` (`recordInstanceResponseIfFirstToday`): checa "lead já
respondeu hoje?" com `tx.message.findFirst` dentro de `$transaction` SEM `isolationLevel` explícito em
lugar nenhum do projeto (Prisma default = Read Committed do Postgres) e SEM unique constraint. Duas
respostas quase simultâneas do mesmo lead podem inflar `InstanceDailyStat.respondedCount` (conta 2 em
vez de 1). Não é crítico porque `respondedCount` hoje só alimenta o card de dashboard (confirmei via
grep — nenhuma decisão de negócio/guard/kill-switch lê esse campo ainda). Vai importar quando a
heurística de taxa de resposta (§6.2, Fase 5/6) começar a consumi-lo — resolver antes disso, não depois.
Padrão de referência já existe NO MESMO ARQUIVO: `registerOptOutFromInbound` usa `OptOut.phoneE164
@unique` + captura de `P2002` para a mesma classe de corrida — não foi replicado aqui (decisão do Vega
de não tocar o schema nesta rodada).

## Não verificado (honestidade de auditoria "em forma", não em banco real)

- Claim atômico (`dispatch-claim.ts`, `UPDATE ... FOR UPDATE SKIP LOCKED`) é padrão correto por leitura,
  mas não exercitado contra Postgres real — mesma ressalva que a Íris já tinha registrado em
  `ACEITE-FASE-4.md`.
- A corrida do `respondedCount` acima é raciocínio sobre isolamento de transação (Read Committed), não
  um teste que reproduziu o cenário contra banco real.
- Qual campo (chave própria da instância vs. chave do `EvolutionServer`) a Evolution v2.3.7 realmente
  usa para assinar o webhook continua incerto — o próprio código já documenta essa incerteza.
