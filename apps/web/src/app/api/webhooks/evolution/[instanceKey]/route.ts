/**
 * POST /api/webhooks/evolution/:instanceKey — ARQUITETURA §4.8. Rota PÚBLICA
 * (sem sessão de usuário — quem chama é a própria Evolution API), autenticada
 * por dois fatores: `:instanceKey` (segredo por instância, gerado por nós) +
 * header `apikey` (segredo global, `EVOLUTION_API_KEY`).
 *
 * Regras de contrato (não violar sem avisar Nova/Órion):
 *   1. `:instanceKey` que não bate com nenhuma instância → `404`, NUNCA
 *      `401` — não confirmar existência.
 *   2. `apikey` errado tem o MESMO tratamento (`404`) — ver comentário no
 *      handler: expor um status diferente aqui vazaria "o instanceKey
 *      existe, só a chave está errada", o mesmo oráculo que a regra 1 evita.
 *   3. Comparação de `apikey` em TEMPO CONSTANTE (`constantTimeEqual`,
 *      `@inno/messaging`) — nunca `===`.
 *   4. A partir daí, SEMPRE `200 { received: true }`, mesmo se o
 *      processamento falhar internamente — a Evolution reenvia em não-200 e
 *      pode entrar em loop; erro de processamento vira log, não resposta de erro.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@inno/db';
import { constantTimeEqual } from '@inno/messaging';
import { apiRoute, notFound } from '@/lib/api-handler';
import { processEvolutionWebhookEvent } from '@/lib/services/webhook';
import { logger } from '@/lib/logger';

const paramsSchema = z.object({ instanceKey: z.string().min(1) });

export const POST = apiRoute({
  requireAuth: false,
  paramsSchema,
  bodySchema: z.unknown(),
  handler: async ({ params, body, req }) => {
    const instance = await prisma.whatsAppInstance.findUnique({ where: { instanceKey: params.instanceKey } });
    if (!instance) notFound('Não encontrado.');

    const expectedApiKey = process.env.EVOLUTION_API_KEY ?? '';
    const receivedApiKey = req.headers.get('apikey') ?? '';
    if (expectedApiKey.length === 0 || !constantTimeEqual(receivedApiKey, expectedApiKey)) {
      notFound('Não encontrado.');
    }

    try {
      await processEvolutionWebhookEvent(instance, body);
    } catch (err) {
      logger.error('falha ao processar webhook da Evolution API', {
        instanceId: instance.id,
        err: err instanceof Error ? err : new Error(String(err)),
      });
    }

    return NextResponse.json({ received: true });
  },
});
