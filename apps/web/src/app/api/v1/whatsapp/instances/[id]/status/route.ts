/**
 * GET /api/v1/whatsapp/instances/:id/status — leitura pura do estado de
 * conexão na Evolution (ver nota de bug em
 * `lib/services/whatsapp-instances.ts#getWhatsAppInstanceQr`, 2026-09-23).
 * Separado de `.../qr` de propósito: este endpoint NUNCA (re)inicia o
 * pareamento nem emite QR novo, por isso é seguro sondar a cada 2s (o modal
 * de QR faz isso para saber a hora de fechar). `requireRole: 'admin'`
 * (Onda 4) — ver `whatsapp/instances/route.ts`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { getWhatsAppInstanceStatus } from '@/lib/services/whatsapp-instances';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  handler: async ({ params }) => {
    const result = await getWhatsAppInstanceStatus(params.id);
    return NextResponse.json(result);
  },
});
