/**
 * POST /api/webhooks/evolution/:instanceKey — ARQUITETURA §4.8. Rota PÚBLICA
 * (sem sessão de usuário — quem chama é a própria Evolution API), autenticada
 * por dois fatores: `:instanceKey` (segredo por instância, gerado por nós) +
 * header `apikey`.
 *
 * 🆕 Fase 4.B — MULTI-SERVIDOR: antes desta rodada, `apikey` era comparado
 * contra UMA variável global (`EVOLUTION_API_KEY`) — um único servidor
 * Evolution possível. Agora a chave esperada é resolvida pela cadeia
 * `instanceKey → instância → EvolutionServer → chave` (decifrada,
 * `lib/services/webhook.ts#resolveExpectedWebhookApiKey`) — cada servidor
 * tem sua PRÓPRIA credencial, então o webhook de um servidor não pode ser
 * aceito com a chave de outro. `evolutionServerId` NULO (instância legada,
 * ANTES do bootstrap — ver `packages/db/prisma/evolution-servers.ts`) cai
 * no fallback de `EVOLUTION_API_KEY` (env), MESMO comportamento
 * pré-Fase-4.B — nunca derruba a atualização de status de mensagens de uma
 * instância legada só porque ela ainda não foi migrada.
 *
 * Regras de contrato (não violar sem avisar Nova/Órion):
 *   1. `:instanceKey` que não bate com nenhuma instância → `404`, NUNCA
 *      `401` — não confirmar existência.
 *   2. `apikey` errado (ou servidor sem credencial resolvível — inativo,
 *      erro de decifra) tem o MESMO tratamento (`404`) — expor um status
 *      diferente aqui vazaria "o instanceKey existe, só a chave está
 *      errada", o mesmo oráculo que a regra 1 evita.
 *   3. Comparação de `apikey` em TEMPO CONSTANTE (`constantTimeEqual`,
 *      `@inno/messaging`) — nunca `===`. Isto NÃO regrediu com o
 *      multi-servidor: a chave agora vem decifrada em vez de lida direto da
 *      env, mas a comparação final continua pelo mesmo helper.
 *   4. A partir daí, SEMPRE `200 { received: true }`, mesmo se o
 *      processamento falhar internamente — a Evolution reenvia em não-200 e
 *      pode entrar em loop; erro de processamento vira log, não resposta de erro.
 *
 * Rate limit + limite de corpo (achado do Órion, 2026-08-03): rota sem
 * sessão, autenticada só depois do `req.text()`/`JSON.parse` — sem isto,
 * qualquer flood anônimo já custava 1 consulta ao Postgres por requisição
 * (busca do `instanceKey`) antes de rejeitar. `apiRoute` agora corta isso no
 * primeiro passo, antes de qualquer I/O. Limite generoso (bem acima do
 * volume esperado de eventos reais da Evolution) porque isto não é anti-abuso
 * de usuário final — é o provedor de WhatsApp mandando webhook.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@inno/db';
import { constantTimeEqual } from '@inno/messaging';
import { apiRoute, notFound } from '@/lib/api-handler';
import { processEvolutionWebhookEvent, resolveExpectedWebhookApiKey } from '@/lib/services/webhook';
import { logger } from '@/lib/logger';

const paramsSchema = z.object({ instanceKey: z.string().min(1) });

const WEBHOOK_RATE_LIMIT_PER_MIN = Number(process.env.WEBHOOK_RATE_LIMIT_PER_MIN ?? 300);
const WEBHOOK_MAX_BODY_BYTES = 1_000_000; // 1MB — payload de evento é JSON pequeno; folga generosa para metadados de mídia.

export const POST = apiRoute({
  requireAuth: false,
  rateLimit: { windowMs: 60_000, max: WEBHOOK_RATE_LIMIT_PER_MIN, bucket: 'webhook-evolution' },
  maxBodyBytes: WEBHOOK_MAX_BODY_BYTES,
  paramsSchema,
  bodySchema: z.unknown(),
  handler: async ({ params, body, req }) => {
    const instance = await prisma.whatsAppInstance.findUnique({ where: { instanceKey: params.instanceKey } });
    if (!instance) notFound('Não encontrado.');

    const expectedApiKey = await resolveExpectedWebhookApiKey(instance);
    const receivedApiKey = req.headers.get('apikey') ?? '';
    if (expectedApiKey === null || !constantTimeEqual(receivedApiKey, expectedApiKey)) {
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
