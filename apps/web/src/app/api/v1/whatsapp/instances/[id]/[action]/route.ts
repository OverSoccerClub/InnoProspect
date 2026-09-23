/**
 * POST /api/v1/whatsapp/instances/:id/connect
 * POST /api/v1/whatsapp/instances/:id/disconnect — ARQUITETURA §4.6.
 * `requireRole: 'admin'` (Onda 4) — ver `whatsapp/instances/route.ts`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@inno/contracts';
import { apiRoute, badRequest } from '@/lib/api-handler';
import { connectWhatsAppInstance, disconnectWhatsAppInstance } from '@/lib/services/whatsapp-instances';

const paramsSchema = z.object({ id: idSchema, action: z.enum(['connect', 'disconnect']) });

export const POST = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  handler: async ({ params }) => {
    if (params.action === 'connect') {
      const result = await connectWhatsAppInstance(params.id);
      return NextResponse.json(result, { status: 202 });
    }
    if (params.action === 'disconnect') {
      const result = await disconnectWhatsAppInstance(params.id);
      return NextResponse.json(result);
    }
    badRequest(`Ação desconhecida: "${params.action}".`);
  },
});
