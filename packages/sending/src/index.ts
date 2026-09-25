/**
 * @inno/sending — a sequência protegida de envio de mensagem (ARQUITETURA
 * §6.8.0). Único ponto de entrada — `apps/web` e `apps/worker` importam SÓ
 * daqui, nunca de um arquivo interno (`send-one.js`/`campaign-targets.js`
 * etc.) diretamente.
 */
export { executeSendAttempt } from './send-one.js';
export type { CampaignSendContext, ExecuteSendAttemptInput, SendAttemptActor } from './send-one.js';

export { advanceCampaignTargetStatus, skipPendingCampaignTargetsForPhone, haltCampaignsSoleInstanceDisconnected } from './campaign-targets.js';
export type { AdvanceCampaignTargetStatusOptions } from './campaign-targets.js';

export { paceFieldsForUpdate, advanceNextSendAllowedAt } from './pace.js';

export { EVOLUTION_ERROR_EFFECT } from './outcome.js';
export type { SendAttemptResult, BlockedVerdict, EvolutionErrorEffect } from './outcome.js';

export type { SendAttemptDeps, SendTextClient, SendingLogger, SendingLogFields, SendNotifyEvent, SendingNotify, SendingRandomSource } from './ports.js';

// 🆕 Fase 4.F.4 — cifra + resolução do EvolutionClient por instância,
// compartilhadas entre apps/web e apps/worker (ARQUITETURA §6.8.0.1).
export {
  currentEvolutionMasterKeyVersion,
  decryptEvolutionApiKey,
  encryptEvolutionApiKey,
  EvolutionCryptoError,
  resolveEvolutionMasterKey,
  toPrismaBytes,
} from './evolution-crypto.js';
export type { EncryptedEvolutionApiKey, EvolutionCryptoEnv } from './evolution-crypto.js';

export {
  buildEvolutionClientFromServer,
  buildLegacyEnvEvolutionClient,
  resolveInstanceEvolutionClient,
} from './evolution-resolver.js';
export type {
  EvolutionServerRow,
  ResolveInstanceEvolutionClientDeps,
  ResolveInstanceEvolutionClientResult,
} from './evolution-resolver.js';
