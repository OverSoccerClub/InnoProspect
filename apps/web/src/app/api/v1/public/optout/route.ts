/**
 * POST /api/v1/public/optout — ARQUITETURA §4.7. Rota PÚBLICA (sem sessão),
 * consumida pela página `/descadastro/:token` (Lyra). Autenticação é o
 * próprio token HMAC no corpo (ver `lib/services/optouts.ts#publicOptOut`),
 * não cookie — por isso `requireAuth: false` aqui E `/api/v1/public` isento
 * em `middleware.ts`.
 */
import { NextResponse } from 'next/server';
import { publicOptOutBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { publicOptOut } from '@/lib/services/optouts';

export const POST = apiRoute({
  requireAuth: false,
  bodySchema: publicOptOutBodySchema,
  handler: async ({ body }) => {
    const result = await publicOptOut(body.token);
    return NextResponse.json(result);
  },
});
