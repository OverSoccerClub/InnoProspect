import { ApiRequestError } from '@/lib/fetcher';
import type { PublicOptOutResponse } from '@/types/optout';

/**
 * Regras de demonstração (não existe endpoint real ainda):
 * - token "invalido" (ou vazio/curto)  → 404, simula link quebrado/expirado.
 * - token "limite"                     → 429, simula rate limit (§4.7: 10 req/min por IP).
 * - token "usado"                      → 409, simula pedido que já tinha sido confirmado antes.
 * - qualquer outro token               → sucesso.
 * Visitar /descadastro/invalido, /descadastro/limite, /descadastro/usado ou
 * /descadastro/qualquer-coisa exercita os quatro estados na tela pública.
 */
export function mockConfirmPublicOptOut(token: string): PublicOptOutResponse {
  const normalized = token.trim().toLowerCase();

  if (normalized === 'limite') {
    throw new ApiRequestError(429, {
      code: 'RATE_LIMITED',
      message: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.',
      requestId: 'mock',
    });
  }

  if (normalized === 'usado') {
    throw new ApiRequestError(409, {
      code: 'CONFLICT',
      message: 'Este número já estava descadastrado.',
      requestId: 'mock',
    });
  }

  if (!normalized || normalized === 'invalido' || normalized.length < 6) {
    throw new ApiRequestError(404, {
      code: 'NOT_FOUND',
      message: 'Este link de descadastro não é válido ou já expirou.',
      requestId: 'mock',
    });
  }

  return { ok: true, message: 'Você não receberá mais mensagens.' };
}
