/**
 * GET /api/v1/whatsapp/instances/:id/qr — ARQUITETURA §4.6. Lyra faz poll de
 * 2s neste endpoint enquanto o modal do QR estiver aberto.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { getWhatsAppInstanceQr } from '@/lib/services/whatsapp-instances';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    const result = await getWhatsAppInstanceQr(params.id);
    return NextResponse.json(result);
  },
});
