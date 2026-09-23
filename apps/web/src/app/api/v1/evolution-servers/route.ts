/**
 * GET /api/v1/evolution-servers, POST /api/v1/evolution-servers — servidores
 * Evolution API (multi-servidor, Fase 4.B). `requireRole: 'admin'` (mesmo
 * mecanismo do CRUD de usuários/instâncias — ver
 * `lib/api-handler.ts#ApiRouteOptions.requireRole`): administrar infra de
 * disparo compartilhada é papel de admin, não uso rotineiro.
 */
import { NextResponse } from 'next/server';
import { createEvolutionServerBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { createEvolutionServer, listEvolutionServers } from '@/lib/services/evolution-servers';

export const GET = apiRoute({
  requireRole: 'admin',
  handler: async () => {
    const result = await listEvolutionServers();
    return NextResponse.json(result);
  },
});

export const POST = apiRoute({
  requireRole: 'admin',
  bodySchema: createEvolutionServerBodySchema,
  handler: async ({ body, session }) => {
    const result = await createEvolutionServer(body, session!.user.id);
    return NextResponse.json(result, { status: 201 });
  },
});
