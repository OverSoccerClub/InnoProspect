/**
 * whatsapp/send-guard.ts — `evaluateSendGuard`, o portão único de envio
 * (ARQUITETURA §4.9.3, G4-G11). Puro, sem Prisma/rede — compartilhado entre
 * o envio unitário (`apps/web/src/lib/services/messages.ts`) e o futuro
 * `dispatch-tick.job` (worker, Fase 4): a mesma função decide "pode enviar?"
 * nos dois caminhos, para o portão nascer exercitado em produção com volume
 * 1 em vez de estrear num disparo de 500 mensagens (ver memória da Nova,
 * `decision_envio_unitario_guard`).
 *
 * G1 (lead/instância existem), G2 (payload) e G3 (lead tem telefone) NÃO
 * entram aqui — acontecem ANTES, na camada de serviço, porque dependem de
 * Prisma (existência) ou de dado que o `facts` já pressupõe presente
 * (`phone.e164: string`, não `string | null`). Este módulo cobre G4 a G11.
 *
 * ⚠️ G11 (opt-out) é o portão que o Órion audita: `optOut.checkedAt` tem que
 * ser o carimbo de uma consulta feita SEGUNDOS atrás, não cacheada. Por isso
 * esta função LANÇA (não retorna `{allow:false}`) quando o carimbo é velho
 * demais — é a diferença entre "regra de disciplina" (alguém pode ignorar
 * numa revisão apressada) e "falha de runtime" (quebra sozinha em produção).
 * NÃO trocar por comentário `// não cachear`.
 *
 * 🆕 v1.2 (Fase 4.B, ARQUITETURA §4.9.10/§6.8): G9b (`LEAD_CONTACT_COOLDOWN`)
 * e G9c (`SEND_PACE_LOCKED`) chegam aqui, não em `packages/core/whatsapp/jitter.ts`
 * nem no chamador — porque cadência é decisão de negócio ("pode enviar
 * AGORA?"), e este é o único portão que decide isso. `jitter.ts` só calcula
 * QUANTO empurrar `nextSendAllowedAt` depois de um envio; quem lê esse valor
 * e decide bloquear é sempre este arquivo. Os três facts novos
 * (`instance.nextSendAllowedAt`, `lastInboundAt`, `overrides.ignorePaceLock`)
 * são opcionais de propósito: nenhum chamador existente foi tocado nesta
 * rodada (a ligação é da Fase 4.C), então `undefined` preserva o
 * comportamento de hoje byte a byte — só `null`/`Date` explícitos ativam os
 * gates novos.
 */
import type { PhoneType, WhatsAppInstanceStatus } from '@inno/contracts';
import { hasCompanyNameMention, hasOptOutNotice } from '../templates/optout-notice.js';
import { effectiveDailyLimit } from './warmup.js';
import {
  DEFAULT_SEND_WINDOW_CONFIG,
  isWithinBusinessWindow,
  isWithinQuietHoursFloor,
  nextBusinessWindowOpensAt,
  nextQuietHoursFloorOpensAt,
  type SendWindowConfig,
} from './send-window.js';

/** Carimbo máximo aceito para `optOut.checkedAt` (ARQUITETURA §4.9.3) — 5 segundos. */
export const OPT_OUT_MAX_AGE_MS = 5_000;

/**
 * Teto entre a decisão do guard (G4-G11 = `allow`) e a chamada real a
 * `sendText` (achado do Órion, revisão de 2026-09-22). O carimbo do opt-out
 * (`OPT_OUT_MAX_AGE_MS`) só protege a leitura ATÉ a decisão — se a transação
 * de write-ahead (§4.9.5) atrasar (lock, banco sob carga), o tempo entre
 * "decidimos que pode enviar" e "de fato enviamos" cresce sem limite, e a
 * decisão pode ficar velha demais para continuar valendo (ex.: a janela de
 * horário fechou nesse meio-tempo). Este módulo não mede isso (é sobre I/O
 * real, não sobre decisão pura) — quem mede é o CHAMADOR
 * (`apps/web/src/lib/services/messages.ts`), imediatamente antes de chamar
 * `sendText`; a constante mora aqui só para o número "5s" não se duplicar em
 * dois arquivos.
 */
export const MAX_DECISION_TO_SEND_MS = 5_000;

/** Janela padrão de anti-duplo-clique (ARQUITETURA §10 `MANUAL_SEND_DUPLICATE_WINDOW_S`) — 60 segundos. */
export const DEFAULT_DUPLICATE_SEND_WINDOW_MS = 60_000;

/**
 * Cooldown padrão de 2º contato frio (ARQUITETURA §4.9.10/§10 `COLD_FOLLOWUP_COOLDOWN_H`) — 24h.
 * G9 (60s) impede duplo clique; isto impede INSISTIR: 2ª abordagem fria no
 * mesmo dia para quem nunca respondeu é o padrão que produz denúncia.
 */
export const DEFAULT_COLD_FOLLOWUP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Lançado quando `optOut.checkedAt` é mais velho que `OPT_OUT_MAX_AGE_MS`
 * (ou o valor passado em `options.optOutMaxAgeMs`, só para teste). Sinal de
 * que a checagem de opt-out foi cacheada/reaproveitada — nunca deveria
 * acontecer com uma consulta feita imediatamente antes desta chamada.
 */
export class StaleOptOutCheckError extends Error {
  readonly ageMs: number;
  readonly maxAgeMs: number;

  constructor(ageMs: number, maxAgeMs: number) {
    super(
      `optOut.checkedAt tem ${ageMs}ms — acima do máximo permitido (${maxAgeMs}ms). ` +
        'A consulta de opt-out (SELECT por phoneE164) não pode ser cacheada nem reaproveitada ' +
        'de uma checagem anterior: refaça-a imediatamente antes de chamar evaluateSendGuard.',
    );
    this.name = 'StaleOptOutCheckError';
    this.ageMs = ageMs;
    this.maxAgeMs = maxAgeMs;
  }
}

export type SendBlockReason =
  | 'LEAD_NOT_MOBILE'
  | 'QUIET_HOURS'
  | 'OUTSIDE_BUSINESS_WINDOW'
  | 'INSTANCE_NOT_CONNECTED'
  | 'INSTANCE_BANNED'
  | 'DAILY_LIMIT_REACHED'
  | 'DUPLICATE_SEND'
  | 'LEAD_CONTACT_COOLDOWN' // 🆕 v1.2 — G9b (§4.9.10)
  | 'SEND_PACE_LOCKED' // 🆕 v1.2 — G9c (§4.9.10)
  | 'MISSING_OPTOUT_NOTICE'
  | 'MISSING_COMPANY_NAME'
  | 'OPTED_OUT';

export type SendGuardWarning = { code: string; message: string };

/**
 * Estado necessário para decidir G4-G11. Fechado em ARQUITETURA §4.9.3, com
 * UMA adição do Vega: `companyName`. O documento não listava esse campo, mas
 * G10/`MISSING_COMPANY_NAME` não é verificável sem saber QUAL nome procurar
 * no texto final — sem ele a checagem teria que adivinhar, o que é pior que
 * declarar a dependência. `packages/core` continua sem ler `process.env`
 * (ver `templates/optout-notice.ts`): quem lê `APP_COMPANY_NAME` é o
 * serviço, que preenche este campo.
 */
export type SendGuardFacts = {
  now: Date;
  phone: { e164: string; type: PhoneType };
  instance: {
    status: WhatsAppInstanceStatus;
    isDegraded: boolean;
    warmupDay: number;
    dailyLimitOverride: number | null;
    /**
     * 🆕 v1.2 (ARQUITETURA §4.9.10/§6.8.1) — `WhatsAppInstance.nextSendAllowedAt`,
     * o gate único de cadência (alimenta G9c). Três estados, de propósito:
     * - `undefined`: o chamador ainda não foi ligado a este gate (a Fase 4.C liga
     *   o manual/dispatch-tick a este campo). G9c não avalia — comportamento
     *   IDÊNTICO ao de antes desta rodada, para não quebrar quem ainda não
     *   passa este fact (compat retroativa, sem tocar `apps/web` aqui).
     * - `null`: o chamador já foi ligado, e o gate está livre agora.
     * - `Date`: a trava está ativa até este instante.
     */
    nextSendAllowedAt?: Date | null;
  };
  quota: { sentToday: number };
  /** ⚠️ `checkedAt` precisa ser o instante da consulta feita AGORA — ver `StaleOptOutCheckError`. */
  optOut: { exists: boolean; checkedAt: Date };
  lastOutboundAt: Date | null;
  /**
   * 🆕 v1.2 (ARQUITETURA §4.9.10, alimenta G9b) — último inbound deste lead
   * (qualquer instância). Mesma semântica de três estados de
   * `instance.nextSendAllowedAt`: `undefined` = chamador não ligado ainda
   * (G9b não avalia); `null` = lead nunca respondeu; `Date` = respondeu nesta
   * data. Ver `=== null` estrito no corpo da função — é o que distingue
   * "não sei" de "sei que não respondeu".
   */
  lastInboundAt?: Date | null;
  /** "Não existe nenhuma Message outbound para este lead" (ARQUITETURA §7.4, v1.1). */
  isColdFirstContact: boolean;
  /** Texto FINAL (já renderizado + spintaxado, ou `body` cru) que será enviado. */
  text: string;
  /** `null`/vazio = `APP_COMPANY_NAME` não configurado (dívida D9) — G10 trata isso como "empresa não identificada", nunca como "não sei, deixa passar". */
  companyName: string | null;
  overrides: {
    allowNonMobile: boolean;
    confirmOutsideBusinessWindow: boolean;
    /**
     * 🆕 v1.2 (ARQUITETURA §4.9.10) — só tem efeito quando `isColdFirstContact
     * === false`: o próprio guard anula o override em contato frio (G9c),
     * para nenhum chamador conseguir liberar o gate para um contato frio nem
     * "mentindo" a flag. `undefined`/`false` = comportamento de hoje.
     */
    ignorePaceLock?: boolean;
  };
};

export type SendGuardVerdict =
  | { allow: true; warnings: SendGuardWarning[] }
  | { allow: false; reason: SendBlockReason; message: string; meta?: Record<string, unknown> };

export type EvaluateSendGuardOptions = {
  /** Default `DEFAULT_SEND_WINDOW_CONFIG` — a camada de serviço monta a partir da env (`DISPATCH_QUIET_HOURS_START/END`, `DISPATCH_WINDOW_START/END`, `APP_TIMEZONE`). */
  windowConfig?: SendWindowConfig;
  /** Default `DEFAULT_DUPLICATE_SEND_WINDOW_MS` (60s) — a camada de serviço lê `MANUAL_SEND_DUPLICATE_WINDOW_S`. */
  duplicateWindowMs?: number;
  /** Default `OPT_OUT_MAX_AGE_MS` — parametrizado só para teste (simular carimbo velho sem `setTimeout` real). Produção nunca deve passar isto. */
  optOutMaxAgeMs?: number;
  /** Default `DEFAULT_COLD_FOLLOWUP_COOLDOWN_MS` (24h) — a camada de serviço lê `COLD_FOLLOWUP_COOLDOWN_H`. Alimenta G9b. */
  coldFollowupCooldownMs?: number;
};

function blocked(reason: SendBlockReason, message: string, meta?: Record<string, unknown>): SendGuardVerdict {
  return meta ? { allow: false, reason, message, meta } : { allow: false, reason, message };
}

/** `Math.ceil` do percentual de aviso de cota baixa (ARQUITETURA §4.9.6 `warnings[]`: "≤10% do teto"). */
const LOW_QUOTA_WARNING_RATIO = 0.1;

export function evaluateSendGuard(facts: SendGuardFacts, options: EvaluateSendGuardOptions = {}): SendGuardVerdict {
  const windowConfig = options.windowConfig ?? DEFAULT_SEND_WINDOW_CONFIG;
  const duplicateWindowMs = options.duplicateWindowMs ?? DEFAULT_DUPLICATE_SEND_WINDOW_MS;
  const optOutMaxAgeMs = options.optOutMaxAgeMs ?? OPT_OUT_MAX_AGE_MS;
  const coldFollowupCooldownMs = options.coldFollowupCooldownMs ?? DEFAULT_COLD_FOLLOWUP_COOLDOWN_MS;

  // Carimbo do opt-out — a PRIMEIRA coisa verificada, antes de qualquer
  // gate de negócio. Não é um "bloqueio" (não tem `reason`): é bug de quem
  // chamou, e quebra em runtime por desenho (ver comentário do arquivo).
  const optOutAgeMs = facts.now.getTime() - facts.optOut.checkedAt.getTime();
  if (optOutAgeMs > optOutMaxAgeMs) {
    throw new StaleOptOutCheckError(optOutAgeMs, optOutMaxAgeMs);
  }

  const warnings: SendGuardWarning[] = [];

  // G4 — celular (ou confirmação explícita)
  if (facts.phone.type !== 'mobile') {
    if (!facts.overrides.allowNonMobile) {
      return blocked(
        'LEAD_NOT_MOBILE',
        'Este telefone não está classificado como celular. Confirme "allowNonMobile" para enviar mesmo assim.',
        { phoneType: facts.phone.type },
      );
    }
    warnings.push({ code: 'NON_MOBILE_CONFIRMED', message: 'Envio confirmado para telefone não classificado como celular.' });
  }

  // G5 — piso duro (nunca contornável)
  if (!isWithinQuietHoursFloor(facts.now, windowConfig)) {
    return blocked('QUIET_HOURS', 'Fora do horário permitido para envio (piso legal). Não há confirmação que libere isto.', {
      nextWindowOpensAt: nextQuietHoursFloorOpensAt(facts.now, windowConfig)?.toISOString() ?? null,
    });
  }

  // G6 — janela comercial (mole no manual — quem chama decide se `overrides.confirmOutsideBusinessWindow` é aceitável; no dispatch worker essa flag deve vir sempre `false`, ARQUITETURA §6.1)
  if (!isWithinBusinessWindow(facts.now, windowConfig)) {
    if (!facts.overrides.confirmOutsideBusinessWindow) {
      return blocked('OUTSIDE_BUSINESS_WINDOW', 'Fora do horário comercial. Confirme "confirmOutsideBusinessWindow" para enviar mesmo assim.', {
        nextWindowOpensAt: nextBusinessWindowOpensAt(facts.now, windowConfig)?.toISOString() ?? null,
      });
    }
    warnings.push({ code: 'OUTSIDE_BUSINESS_WINDOW_CONFIRMED', message: 'Envio confirmado fora do horário comercial.' });
  }

  // G7 — instância apta
  if (facts.instance.status === 'banned') {
    return blocked('INSTANCE_BANNED', 'Esta instância de WhatsApp foi banida pelo provedor.');
  }
  if (facts.instance.status !== 'connected') {
    return blocked('INSTANCE_NOT_CONNECTED', 'Esta instância de WhatsApp não está conectada.', { status: facts.instance.status });
  }

  // G8 — cota diária do warmup
  const dailyLimit = effectiveDailyLimit(facts.instance.warmupDay, facts.instance.dailyLimitOverride);
  const remaining = dailyLimit - facts.quota.sentToday;
  if (remaining <= 0) {
    return blocked('DAILY_LIMIT_REACHED', 'A cota diária desta instância já foi atingida.', {
      dailyLimit,
      sentToday: facts.quota.sentToday,
    });
  }
  if (remaining <= Math.ceil(dailyLimit * LOW_QUOTA_WARNING_RATIO)) {
    warnings.push({ code: 'LOW_QUOTA_REMAINING', message: `Restam apenas ${remaining} de ${dailyLimit} envios hoje nesta instância.` });
  }

  // G9 — anti-duplo-clique
  if (facts.lastOutboundAt) {
    const sinceLastMs = facts.now.getTime() - facts.lastOutboundAt.getTime();
    if (sinceLastMs >= 0 && sinceLastMs < duplicateWindowMs) {
      return blocked('DUPLICATE_SEND', 'Já foi enviada uma mensagem para este lead há poucos segundos.', {
        lastOutboundAt: facts.lastOutboundAt.toISOString(),
      });
    }
  }

  // G9b — cooldown de 2º contato frio (ARQUITETURA §4.9.10, `COLD_FOLLOWUP_COOLDOWN_H`).
  // Diferente de G9 (60s, duplo-clique): a janela aqui é de HORAS e a condição
  // extra é "o lead nunca respondeu" — insistir com quem nunca respondeu no
  // mesmo dia é o padrão que produz denúncia, e denúncia é o que derruba o
  // número. `=== null` estrito (não `!facts.lastInboundAt`) é o que faz este
  // gate ficar inerte para chamadores que ainda não foram ligados a ele: só
  // dispara quando alguém DECLAROU explicitamente "sei que não respondeu".
  if (facts.lastInboundAt === null && facts.lastOutboundAt) {
    const sinceLastOutboundMs = facts.now.getTime() - facts.lastOutboundAt.getTime();
    if (sinceLastOutboundMs >= 0 && sinceLastOutboundMs < coldFollowupCooldownMs) {
      return blocked('LEAD_CONTACT_COOLDOWN', 'Este lead ainda não respondeu ao contato anterior — aguarde antes de insistir.', {
        lastOutboundAt: facts.lastOutboundAt.toISOString(),
      });
    }
  }

  // G9c — trava de ritmo do NÚMERO (ARQUITETURA §4.9.10/§6.8.7). Cadência é
  // propriedade da INSTÂNCIA, não de quem chama: o mesmo portão serve o envio
  // manual e o `dispatch-tick`, e é AQUI DENTRO que `ignorePaceLock` é
  // avaliado — nunca no chamador. Isso é o que impede um chamador de liberar
  // o gate para um contato frio "mentindo" a flag: o próprio guard anula o
  // override quando `isColdFirstContact` é verdadeiro, sempre. Gate ausente
  // (`undefined`) ou livre (`null`) não bloqueia — mesma semântica de "não
  // ligado ainda" do G9b.
  if (facts.instance.nextSendAllowedAt && facts.now.getTime() < facts.instance.nextSendAllowedAt.getTime()) {
    const bypassAllowed = Boolean(facts.overrides.ignorePaceLock) && !facts.isColdFirstContact;
    if (!bypassAllowed) {
      return blocked('SEND_PACE_LOCKED', 'Este número ainda está no intervalo mínimo desde o envio anterior.', {
        nextSendAllowedAt: facts.instance.nextSendAllowedAt.toISOString(),
      });
    }
    // Desvio AUTORIZADO (responder conversa aberta não pode esperar o gate),
    // mas nunca invisível — é para isto que este warning existe (ARQUITETURA
    // §4.9.10: "desvio autorizado é aceitável; desvio invisível não").
    warnings.push({
      code: 'PACE_LOCK_BYPASSED_FOR_REPLY',
      message: 'Enviado antes do intervalo normal por ser resposta a uma conversa em aberto.',
    });
  }

  // G10 — 1º contato frio: aviso de descadastro + identificação do remetente (ARQUITETURA §7.4)
  if (facts.isColdFirstContact) {
    if (!hasOptOutNotice(facts.text)) {
      return blocked('MISSING_OPTOUT_NOTICE', 'A mensagem não contém uma instrução de descadastro (ex.: "responda SAIR").');
    }
    if (!hasCompanyNameMention(facts.text, facts.companyName)) {
      return blocked('MISSING_COMPANY_NAME', 'A mensagem não identifica o remetente. Configure APP_COMPANY_NAME ou mencione a empresa no texto.');
    }
  } else if (!hasOptOutNotice(facts.text)) {
    // Conversa em curso (já existe inbound) — exigir "responda SAIR" numa
    // resposta a "qual o preço?" seria ruído, não proteção (ARQUITETURA
    // §7.4). Aviso, não bloqueio.
    warnings.push({ code: 'NO_OPTOUT_NOTICE_IN_REPLY', message: 'Esta resposta não repete a instrução de descadastro (ok — não é o 1º contato).' });
  }

  // G11 — OPT-OUT, o portão inegociável. Terminal e sem override possível.
  if (facts.optOut.exists) {
    return blocked('OPTED_OUT', 'Este telefone pediu para não receber mais mensagens.');
  }

  if (facts.instance.isDegraded) {
    warnings.push({ code: 'INSTANCE_DEGRADED', message: 'Esta instância está degradada (falhas consecutivas recentes) — considere trocar de número.' });
  }

  return { allow: true, warnings };
}
