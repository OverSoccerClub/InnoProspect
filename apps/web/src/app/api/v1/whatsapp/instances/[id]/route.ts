/**
 * GET /api/v1/whatsapp/instances/:id, DELETE /api/v1/whatsapp/instances/:id — ARQUITETURA §4.6.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { deleteWhatsAppInstance, getWhatsAppInstanceDetail } from '@/lib/services/whatsapp-instances';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    const result = await getWhatsAppInstanceDetail(params.id);
    return NextResponse.json(result);
  },
});

export const DELETE = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    await deleteWhatsAppInstance(params.id);
    return new NextResponse(null, { status: 204 });
  },
});
