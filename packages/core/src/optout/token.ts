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
