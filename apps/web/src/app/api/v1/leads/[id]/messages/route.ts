/**
 * POST /api/v1/leads/:id/messages — envio unitário de mensagem (ARQUITETURA
 * §4.9.2). Rota fina: só valida forma (Zod) e delega para
 * `lib/services/messages.ts#sendLeadMessage`, que concentra os portões
 * G1-G11. `201 Created` no sucesso (cria um recurso `Message`).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema, sendLeadMessageBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { sendLeadMessage } from '@/lib/services/messages';

const paramsSchema = z.object({ id: idSchema });

export const POST = apiRoute({
  paramsSchema,
  bodySchema: sendLeadMessageBodySchema,
  handler: async ({ params, body, session }) => {
    const result = await sendLeadMessage(params.id, body, { id: session!.user.id, role: session!.user.role });
    return NextResponse.json(result, { status: 201 });
  },
});
