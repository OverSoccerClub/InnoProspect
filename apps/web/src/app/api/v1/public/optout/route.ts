/**
 * POST /api/v1/public/optout — ARQUITETURA §4.7. Rota PÚBLICA (sem sessão),
 * consumida pela página `/descadastro/:token` (Lyra). Autenticação é o
 * próprio token HMAC no corpo (ver `lib/services/optouts.ts#publicOptOut`),
 * não cookie — por isso `requireAuth: false` aqui E `/api/v1/public` isento
 * em `middleware.ts`.
 *
 * Rate limit: 10 req/min por IP — valor já definido em ARQUITETURA §4.7,
 * nunca implementado até 2026-08-03 (achado do Órion). O `err.code ===
 * 'RATE_LIMITED'` que este limite passa a emitir já é tratado pela tela
 * (`components/public/unsubscribe-view.tsx:37`) — não mudar o código do erro
 * sem avisar a Lyra.
 */
import { NextResponse } from 'next/server';
import { publicOptOutBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { publicOptOut } from '@/lib/services/optouts';

const PUBLIC_OPTOUT_RATE_LIMIT_PER_MIN = Number(process.env.PUBLIC_OPTOUT_RATE_LIMIT_PER_MIN ?? 10);
const PUBLIC_OPTOUT_MAX_BODY_BYTES = 4_096; // corpo é só { token, confirm } — algumas centenas de bytes no máximo.

export const POST = apiRoute({
  requireAuth: false,
  rateLimit: { windowMs: 60_000, max: PUBLIC_OPTOUT_RATE_LIMIT_PER_MIN, bucket: 'public-optout' },
  maxBodyBytes: PUBLIC_OPTOUT_MAX_BODY_BYTES,
  bodySchema: publicOptOutBodySchema,
  handler: async ({ body }) => {
    const result = await publicOptOut(body.token);
    return NextResponse.json(result);
  },
});
