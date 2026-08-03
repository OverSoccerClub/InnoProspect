/**
 * GET /api/v1/whatsapp/instances, POST /api/v1/whatsapp/instances — ARQUITETURA §4.6.
 */
import { NextResponse } from 'next/server';
import { createWhatsAppInstanceBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { createWhatsAppInstance, listWhatsAppInstances } from '@/lib/services/whatsapp-instances';

export const GET = apiRoute({
  handler: async () => {
    const result = await listWhatsAppInstances();
    return NextResponse.json(result);
  },
});

export const POST = apiRoute({
  bodySchema: createWhatsAppInstanceBodySchema,
  handler: async ({ body, session }) => {
    const result = await createWhatsAppInstance(body, session!.user.id);
    return NextResponse.json(result, { status: 201 });
  },
});
