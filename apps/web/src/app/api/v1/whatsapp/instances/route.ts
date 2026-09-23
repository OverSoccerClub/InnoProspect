/**
 * GET /api/v1/whatsapp/instances, POST /api/v1/whatsapp/instances — ARQUITETURA §4.6.
 * `requireRole: 'admin'` (Onda 4): instância de WhatsApp é infraestrutura de
 * disparo compartilhada por todos os operadores — administrar QUEM ela é
 * (criar/ver/apagar) é papel de admin, não de quem só usa o sistema para
 * buscar/enviar. Ver `lib/api-handler.ts#ApiRouteOptions.requireRole`.
 */
import { NextResponse } from 'next/server';
import { createWhatsAppInstanceBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { createWhatsAppInstance, listWhatsAppInstances } from '@/lib/services/whatsapp-instances';

export const GET = apiRoute({
  requireRole: 'admin',
  handler: async () => {
    const result = await listWhatsAppInstances();
    return NextResponse.json(result);
  },
});

export const POST = apiRoute({
  requireRole: 'admin',
  bodySchema: createWhatsAppInstanceBodySchema,
  handler: async ({ body, session }) => {
    const result = await createWhatsAppInstance(body, session!.user.id);
    return NextResponse.json(result, { status: 201 });
  },
});
