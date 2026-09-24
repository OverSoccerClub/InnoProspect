/**
 * POST /api/v1/whatsapp/instances/reconcile — reconciliação FORÇADA de
 * status contra a Evolution API (ARQUITETURA §4.6, correção do incidente
 * 2026-09-24: "mesmo desconectado, o sistema ainda mostra como conectado").
 * `requireRole: 'admin'` (mesma convenção de `whatsapp/instances/route.ts`).
 *
 * Diferente da reconciliação AUTOMÁTICA de `GET /whatsapp/instances` (que só
 * olha para instância `connected` e com `statusCheckedAt` obsoleto), esta
 * rota ignora o limite de frescor e cobre TODA instância — pedido explícito
 * do operador, que aceita esperar a chamada extra. Sem corpo. Resposta no
 * MESMO shape de `GET /whatsapp/instances` — a tela só substitui os dados
 * que já tem.
 */
import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api-handler';
import { reconcileAllWhatsAppInstances } from '@/lib/services/whatsapp-instances';

export const POST = apiRoute({
  requireRole: 'admin',
  handler: async () => {
    const result = await reconcileAllWhatsAppInstances();
    return NextResponse.json(result);
  },
});
