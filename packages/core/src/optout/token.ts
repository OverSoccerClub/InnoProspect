/**
 * optout/token.ts — token público de descadastro (ARQUITETURA §4.7, §7.4).
 * "Token é HMAC do phoneE164 + segredo (não enumerável)." O segredo
 * (`OPTOUT_TOKEN_SECRET`, ARQUITETURA §10) é responsabilidade de quem chama
 * — este módulo não lê variável de ambiente (core não faz I/O), só recebe o
 * segredo já resolvido.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type OptOutTokenOptions = {
  /** Valor de `OPTOUT_TOKEN_SECRET`. Nunca logar. */
  secret: string;
};

/**
 * Gera o token da URL pública `/descadastro/:token` — HMAC-SHA256 do
 * telefone em E.164, hex. Determinístico (mesmo telefone + mesmo segredo =
 * mesmo token sempre), o que permite verificar sem guardar o token em
 * banco: recalcula e compara.
 */
export function generateOptOutToken(phoneE164: string, opts: OptOutTokenOptions): string {
  return createHmac('sha256', opts.secret).update(phoneE164).digest('hex');
}

/**
 * Confere `token` contra o HMAC recalculado de `phoneE164`, em tempo
 * constante (evita side-channel de timing na comparação — mesma
 * preocupação do `apikey` do Evolution em ARQUITETURA §5.2/§4.8).
 */
export function verifyOptOutToken(token: string, phoneE164: string, opts: OptOutTokenOptions): boolean {
  if (!/^[0-9a-f]+$/i.test(token)) return false;

  const expected = generateOptOutToken(phoneE164, opts);
  const expectedBuf = Buffer.from(expected, 'hex');
  const tokenBuf = Buffer.from(token, 'hex');

  if (expectedBuf.length !== tokenBuf.length) return false;
  return timingSafeEqual(expectedBuf, tokenBuf);
}

// ─────────────────────────────────────────────────────────────────────────
// Token PÚBLICO de URL — `/descadastro/:token` (ARQUITETURA §4.7/§7.4)
// ─────────────────────────────────────────────────────────────────────────
//
// `generateOptOutToken`/`verifyOptOutToken` acima operam sobre um HMAC PURO
// (função de mão única): verificar exige já saber o `phoneE164` candidato.
// Isso é suficiente para o worker (que já tem o Lead/telefone em mãos), mas
// NÃO para a rota pública `POST /api/v1/public/optout`, que recebe só
// `{ token, confirm }` (ver `packages/contracts/optout.contract.ts`
// `publicOptOutBodySchema`) — sem o telefone, não há o que verificar.
//
// Decisão de implementação do Vega (não estava especificada em detalhe pela
// Nova): o token que vai na URL é uma string COMPOSTA
// `${base64url(phoneE164)}.${HMAC-SHA256(phoneE164)}`. O telefone viaja
// visível (não é segredo — é o próprio número de quem vai clicar no link
// endereçado a ele); o HMAC é o que impede FORJAR um link de opt-out válido
// para o telefone de outra pessoa sem conhecer `OPTOUT_TOKEN_SECRET`. Isso
// preserva a garantia de "não enumerável" da ARQUITETURA (não dá para gerar
// um token que passe na verificação sem o segredo), só muda ONDE o telefone
// é carregado (no próprio token, não em estado do servidor).

/** Codifica `phoneE164` em base64url (sem padding) — seguro para path de URL. */
function encodePhoneForToken(phoneE164: string): string {
  return Buffer.from(phoneE164, 'utf8').toString('base64url');
}

function decodePhoneFromToken(encoded: string): string | null {
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    // Round-trip check: base64url de entrada corrompida ainda pode "decodificar"
    // para lixo sem lançar — reencoda e compara para ter certeza de que é válido.
    return encodePhoneForToken(decoded) === encoded ? decoded : null;
  } catch {
    return null;
  }
}

/** Monta o token público completo usado em `/descadastro/:token` (link enviado na 1ª mensagem, ARQUITETURA §7.4). */
export function buildPublicOptOutToken(phoneE164: string, opts: OptOutTokenOptions): string {
  return `${encodePhoneForToken(phoneE164)}.${generateOptOutToken(phoneE164, opts)}`;
}

/**
 * Decompõe e verifica um token público. Devolve o `phoneE164` só se a
 * assinatura HMAC bater — nunca lança (entrada não confiável vinda de URL
 * pública; mesmo espírito de `parseEvolutionWebhookEvent`).
 */
export function parsePublicOptOutToken(publicToken: string, opts: OptOutTokenOptions): string | null {
  const sep = publicToken.indexOf('.');
  if (sep <= 0 || sep === publicToken.length - 1) return null;

  const phone = decodePhoneFromToken(publicToken.slice(0, sep));
  if (!phone) return null;

  const hmac = publicToken.slice(sep + 1);
  return verifyOptOutToken(hmac, phone, opts) ? phone : null;
}
