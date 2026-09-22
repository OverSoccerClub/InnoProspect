/**
 * templates/optout-notice.ts — detecção de conteúdo obrigatório do 1º
 * contato frio (ARQUITETURA §7.4, §4.9.3 portão G10). Duas checagens
 * textuais, puras, sobre o texto FINAL (já renderizado/spintaxado) que vai
 * para `sendText`:
 *   1. `hasOptOutNotice` — existe uma instrução literal de descadastro
 *      ("responda SAIR", link público, etc.)?
 *   2. `hasCompanyNameMention` — o texto realmente menciona quem está
 *      falando?
 *
 * Distinto de `optout/detect.ts` (que detecta um PEDIDO de descadastro numa
 * mensagem INBOUND do lead) — este arquivo verifica o lado OUTBOUND: se a
 * PRÓPRIA mensagem que estamos enviando oferece a saída fácil que a LGPD
 * exige. Vocabulário sobreposto (a palavra "sair" aparece nos dois) por
 * coincidência de domínio, não por reuso de código — não têm o mesmo shape
 * de entrada nem a mesma pergunta.
 */

/**
 * Padrões aceitos como "aviso de descadastro" (ARQUITETURA §7.4 item 2):
 * instrução literal tipo "responda SAIR", menção a descadastro/unsubscribe,
 * ou a variante de link público. Permissivo de propósito (mesmo espírito de
 * `optout/detect.ts`: falso positivo aqui custa uma mensagem sem o aviso
 * passando despercebida — mais arriscado que bloquear demais).
 */
const OPT_OUT_NOTICE_PATTERNS: readonly RegExp[] = [
  /respond\w*[^.!?]{0,20}\bsair\b/i,
  /descadastr\w*/i,
  /unsubscribe/i,
  /n[aã]o\s+(quer\w*\s+)?receber\s+mais/i,
];

/** `true` se `text` contiver uma instrução de descadastro reconhecível (ARQUITETURA §7.4 item 2). */
export function hasOptOutNotice(text: string): boolean {
  return OPT_OUT_NOTICE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * `true` se `text` mencionar literalmente `companyName` (ARQUITETURA §7.4
 * item 1 — "quem fala"). `companyName` nulo/vazio é sempre `false`: sem saber
 * o nome configurado (`APP_COMPANY_NAME`, dívida D9), não há como confirmar
 * que a mensagem se identifica — e "não sei" tem que virar bloqueio, não
 * passe livre (mesmo princípio de "na dúvida, bloqueia" do opt-out).
 */
export function hasCompanyNameMention(text: string, companyName: string | null | undefined): boolean {
  const needle = companyName?.trim().toLowerCase();
  if (!needle) return false;
  return text.toLowerCase().includes(needle);
}
