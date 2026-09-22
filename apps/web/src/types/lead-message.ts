// Fonte da verdade: @inno/contracts (ARQUITETURA.md §4.9.2), publicado pelo
// Vega (`packages/contracts/src/whatsapp.contract.ts`, 2026-09-22) enquanto
// eu implementava a UI em paralelo. Reexporta com os nomes já usados em
// lib/api/leads.ts, mocks/leads.ts e nos componentes desta pasta.
export type {
  SendLeadMessageBody as SendLeadMessageRequest,
  SendLeadMessageResponse,
  SendLeadMessageWarning as SendMessageWarning,
} from '@inno/contracts';

/**
 * Preview de uma variação de spintax já com as variáveis do lead resolvidas
 * — não é `@inno/contracts` porque `POST /templates/:id/preview` ainda não
 * devolve `spintaxSeed` por variação (ARQUITETURA §4.9.4, ainda pendente do
 * lado do Vega). Ver TODO no handoff.
 */
export type LeadMessagePreviewItem = {
  text: string;
  length: number;
  spintaxSeed: string;
};

export type LeadMessagePreviewResponse = {
  previews: LeadMessagePreviewItem[];
  /** Variáveis que o template usa mas o lead não tem valor (ex.: sem site). */
  missingVariables: string[];
};

/**
 * `error.reason` (§4.9.7) — confirmado contra `lib/services/messages.ts` do
 * Vega (2026-09-22): estes são os valores que o serviço real de fato emite.
 * `@inno/contracts` tipa `reason` como `z.string()` aberto (cresce por rota
 * sem migração de schema — ver nota em `common.ts`), então este union é só
 * documentação local para não ramificar em string solta; não é um contrato.
 */
export type SendMessageErrorReason =
  | 'LEAD_NOT_FOUND'
  | 'INSTANCE_NOT_FOUND'
  | 'BODY_OR_TEMPLATE_REQUIRED'
  | 'BODY_TOO_LONG'
  | 'UNKNOWN_VARIABLE'
  | 'INVALID_SPINTAX'
  | 'LEAD_HAS_NO_PHONE'
  | 'LEAD_NOT_MOBILE'
  | 'QUIET_HOURS'
  | 'OUTSIDE_BUSINESS_WINDOW'
  | 'INSTANCE_NOT_CONNECTED'
  | 'INSTANCE_BANNED'
  | 'INSTANCE_MISSING_UPSTREAM'
  | 'DAILY_LIMIT_REACHED'
  | 'DUPLICATE_SEND'
  | 'MISSING_OPTOUT_NOTICE'
  | 'MISSING_COMPANY_NAME'
  | 'NUMBER_HAS_NO_WHATSAPP'
  | 'MANUAL_SEND_RATE_LIMIT'
  | 'EVOLUTION_AUTH'
  | 'EVOLUTION_RATE_LIMITED'
  | 'EVOLUTION_TRANSIENT'
  | 'EVOLUTION_UNKNOWN';
