/**
 * pace.ts — persistência da cadência (ARQUITETURA §4.9.10/§6.8.7), extraída
 * de `apps/web/src/lib/services/messages.ts` byte a byte (mesmo SQL, mesmos
 * comentários de causa raiz) — ver `[[bug-pace-lock-blind-set-regression]]`
 * na memória do Vega.
 */
import type { Prisma } from '@inno/db';
import type { AdvanceSendPaceResult, PaceAdvanceMode } from '@inno/core';

/**
 * `sendsSinceMicroPause` que TODO envio (sucesso, falha confirmada OU
 * incerto — ARQUITETURA §6.8.7 "depois de TODO envio") escreve para avançar
 * a cadência, computado PURAMENTE a partir do `AdvanceSendPaceResult`
 * (`@inno/core`), sem 2ª leitura de banco.
 *
 * ⚠️ Usa `{ increment: 1 }` — NUNCA o valor absoluto que `advanceSendPace`
 * calculou — para o incremento em si continuar atômico no Postgres mesmo se
 * a leitura que alimentou `advanceSendPace` (feita ao resolver a instância,
 * antes do `sendText`) já estivesse um passo atrás de outra escrita
 * concorrente (Cronos: "sempre incremento atômico em SQL, nunca
 * read-modify-write em JS"). Só a DECISÃO de disparar a micro-pausa (o
 * sorteio em `shouldTriggerMicroPause`) pode ficar levemente desatualizada
 * sob concorrência real — nunca o contador persistido, que nunca perde um
 * incremento. Reset para `0` (micro-pausa disparou) é SET incondicional,
 * sem essa janela.
 *
 * `nextSendAllowedAt` NÃO está mais aqui de propósito — ver
 * `advanceNextSendAllowedAt` abaixo (correção do Órion, monotonicidade).
 */
export function paceFieldsForUpdate(
  mode: PaceAdvanceMode,
  result: AdvanceSendPaceResult,
): Pick<Prisma.WhatsAppInstanceUpdateInput, 'sendsSinceMicroPause'> {
  if (mode === 'floor') {
    // Resposta a conversa aberta (`ignorePaceLock` honrado) não toca o
    // contador de micro-pausa — decisão da Fase 4.B, `packages/core/whatsapp/jitter.ts`.
    return {};
  }
  return {
    sendsSinceMicroPause: result.microPauseTriggered ? 0 : { increment: 1 },
  };
}

/**
 * Avança `WhatsAppInstance.nextSendAllowedAt` de forma MONOTÔNICA — o campo
 * só pode ANDAR PARA A FRENTE, nunca recuar (achado do Órion, revisão de
 * 2026-09-23 — ver `[[bug-pace-lock-blind-set-regression]]`).
 *
 * CAUSA RAIZ do bug original: `nextSendAllowedAt` era só mais um campo
 * dentro do objeto `data` de `tx.whatsAppInstance.update(...)` — um `SET`
 * CEGO, calculado inteiramente em JS a partir do estado da instância lido
 * ANTES da transação. Com dois envios CONCORRENTES na MESMA instância (duas
 * abas, OU um envio manual correndo junto do `dispatch-tick`, Fase 4.F), o
 * `UPDATE` que COMITA por último vence, mesmo que o valor dele seja MENOR
 * que o já gravado — a trava anti-banimento recuava, sem erro, sem alarme.
 *
 * CORREÇÃO: a comparação "só avança" acontece NO PRÓPRIO POSTGRES (cláusula
 * `WHERE` da mesma `UPDATE`), nunca em duas etapas no processo Node (ler o
 * valor atual, decidir em JS, escrever) — um "ler antes de escrever" teria
 * EXATAMENTE a mesma corrida. `nextSendAllowedAt IS NULL` conta como
 * "-infinito" (toda instância nasce com o campo nulo — precisa aceitar o
 * primeiro valor sem comparação, senão NENHUM envio jamais setaria o gate).
 * `$executeRaw` (não `$queryRaw`) porque não há linha para ler de volta.
 *
 * Roda DENTRO da mesma transação que o resto do envio — participa do mesmo
 * commit atômico; não é uma transação própria.
 *
 * ⚠️ O MOTOR (Fase 4.F.4) é o SEGUNDO escritor concorrente que esta correção
 * previu — se ela se perder numa cópia futura, a trava anti-banimento volta
 * a recuar em silêncio. Qualquer campo que representa um "gate"/"teto" lido
 * por MÚLTIPLOS escritores concorrentes precisa da MESMA técnica.
 */
export async function advanceNextSendAllowedAt(tx: Prisma.TransactionClient, instanceId: string, candidate: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE "whatsapp_instances"
    SET "nextSendAllowedAt" = ${candidate}
    WHERE "id" = ${instanceId}
      AND ("nextSendAllowedAt" IS NULL OR "nextSendAllowedAt" < ${candidate})
  `;
}
