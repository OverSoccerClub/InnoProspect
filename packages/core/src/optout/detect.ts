/**
 * optout/detect.ts — detecção textual de descadastro em resposta do lead.
 * Ver ARQUITETURA §6.7, item 3 ("Automática por resposta"): "Na dúvida,
 * opta por bloquear — falso positivo custa 1 lead; falso negativo custa uma
 * denúncia." Por isso o matching é propositalmente permissivo (case
 * insensitive, sem acento), mas ainda por palavra/frase isolada — não
 * substring solta (evita, por ex., casar "pare" dentro de "aparecer").
 */

/**
 * Lista fechada de gatilhos (ARQUITETURA §6.7) — já normalizada (minúscula,
 * sem acento) porque `normalizeForMatching` remove acento do texto de
 * entrada antes de comparar; manter as duas formas ("não"/"nao") no texto de
 * entrada aqui seria redundante.
 */
export const OPT_OUT_TRIGGERS = [
  'sair',
  'parar',
  'pare',
  'remover',
  'remova',
  'descadastrar',
  'descadastre',
  'cancelar',
  'nao quero',
  'nao me mande',
  'me tira',
  'me tire',
  'stop',
  'unsubscribe',
  'sem interesse',
  'nao perturbe',
] as const;

function normalizeForMatching(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TRIGGER_PATTERNS = OPT_OUT_TRIGGERS.map(
  (trigger) => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(trigger)}(?:[^a-z0-9]|$)`, 'i'),
);

/**
 * Retorna o gatilho (da lista `OPT_OUT_TRIGGERS`) que casou com `text`, ou
 * `null` se nenhum casar. Útil para log/auditoria (`LeadActivity.payload`) —
 * saber QUAL palavra disparou o opt-out automático.
 */
export function findOptOutTrigger(text: string): (typeof OPT_OUT_TRIGGERS)[number] | null {
  const normalized = normalizeForMatching(text);
  for (let i = 0; i < TRIGGER_PATTERNS.length; i++) {
    if (TRIGGER_PATTERNS[i]?.test(normalized)) {
      return OPT_OUT_TRIGGERS[i] as (typeof OPT_OUT_TRIGGERS)[number];
    }
  }
  return null;
}

/**
 * `true` se `text` (uma mensagem inbound do lead) contiver pedido de
 * descadastro. Roda em TODO inbound (`messages.upsert`, ARQUITETURA §4.8) —
 * quando `true`, o webhook cria `OptOut` imediatamente (§6.7 item 4).
 */
export function detectOptOut(text: string): boolean {
  return findOptOutTrigger(text) !== null;
}
