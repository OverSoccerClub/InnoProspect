/**
 * POST /api/webhooks/evolution/:instanceKey — ARQUITETURA §4.8. Rota PÚBLICA
 * (sem sessão de usuário — quem chama é a própria Evolution API), autenticada
 * por dois fatores: `:instanceKey` (segredo por instância, gerado por nós) +
 * `apikey`.
 *
 * 🆕 Correção do incidente 2026-09-23 #1 (webhook mudo em produção — nenhum
 * retorno da Evolution era aceito). A `apikey` esperada aceita DUAS
 * credenciais candidatas (`lib/services/webhook.ts#
 * resolveExpectedWebhookApiKeys`/`isWebhookApiKeyAccepted`, mesma chamada
 * única que faz a decisão — mantém esta rota fina):
 *   1. A credencial PRÓPRIA da instância (achado do dono no painel da
 *      Evolution: cada instância v2 tem a sua, distinta da global do
 *      servidor).
 *   2. A chave do `EvolutionServer` (ou `EVOLUTION_API_KEY`/env, fallback
 *      legado — comportamento da Fase 4.B, intocado).
 * Aceitar as duas nunca afrouxa a validação — são dois segredos legítimos
 * do MESMO servidor.
 *
 * 🆕 Correção do incidente 2026-09-23 #2 (log novo confirmou: mesmo com as
 * duas credenciais acima, o webhook AINDA era recusado — `instanceId`
 * resolvido, `apikey` sem correspondência). A `apikey` RECEBIDA também passou
 * a ter duas fontes candidatas — a Evolution v2.3.7 pode mandá-la no CORPO do
 * JSON (`{ apikey, event, instance, data, ... }`) em vez do (ou além do)
 * cabeçalho `apikey`:
 *   1. `req.headers.get('apikey')` — comportamento original.
 *   2. `extractApiKeyFromBody(body)` — novo.
 * `isWebhookApiKeyAccepted` recebe a lista das que existirem (0 a 2 itens) e
 * compara CADA UMA contra CADA credencial aceita, em tempo constante, sem
 * short-circuit que revele qual combinação bateu.
 *
 * Regras de contrato (não violar sem avisar Nova/Órion):
 *   1. `:instanceKey` que não bate com nenhuma instância → `404`, NUNCA
 *      `401` — não confirmar existência.
 *   2. `apikey` (de qualquer fonte) que não bate com NENHUMA candidata (ou
 *      nenhuma fonte resolvível — servidor inativo, erro de decifra, chave
 *      ausente no cabeçalho E no corpo) tem o MESMO tratamento (`404`) —
 *      expor um status diferente aqui vazaria "o instanceKey existe, só a
 *      chave está errada", o mesmo oráculo que a regra 1 evita. A RESPOSTA
 *      HTTP nunca distingue os motivos — só o LOG (`logger.warn` abaixo)
 *      registra qual foi (incluindo DE ONDE a chave recebida veio — nunca o
 *      valor dela), para diagnóstico.
 *   3. A partir daí, SEMPRE `200 { received: true }`, mesmo se o
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
import { apiRoute, notFound } from '@/lib/api-handler';
import { extractApiKeyFromBody, isWebhookApiKeyAccepted, processEvolutionWebhookEvent } from '@/lib/services/webhook';
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
    if (!instance) {
      // Diagnóstico distinguível SÓ NO LOG (regra 2 acima) — motivo do
      // incidente 2026-09-23 ter passado despercebido por horas: um `apikey`
      // sem correspondência e um `instanceKey` desconhecido davam o MESMO
      // 404 sem nenhum log, indistinguíveis de fora e de dentro.
      logger.warn('webhook evolution: instanceKey desconhecida — requisição recusada (404)', {
        instanceKeyPreview: params.instanceKey.slice(0, 8),
      });
      notFound('Não encontrado.');
    }

    // 🆕 Correção do incidente 2026-09-23 #2: a Evolution v2.3.7 pode mandar a
    // `apikey` no CORPO do webhook em vez do (ou além do) cabeçalho — ver
    // comentário grande em `lib/services/webhook.ts#isWebhookApiKeyAccepted`.
    // As DUAS fontes são candidatas; nenhuma tem prioridade sobre a outra.
    const receivedApiKeyFromHeader = req.headers.get('apikey');
    const receivedApiKeyFromBody = extractApiKeyFromBody(body);
    const receivedApiKeys = [receivedApiKeyFromHeader, receivedApiKeyFromBody].filter(
      (key): key is string => typeof key === 'string' && key.length > 0,
    );

    const accepted = await isWebhookApiKeyAccepted(instance, receivedApiKeys);
    if (!accepted) {
      // Diagnóstico DE ONDE a chave recebida veio — nunca o VALOR dela (nem
      // parcial). Sem isto, "não bateu" e "não veio de lugar nenhum" davam o
      // mesmo log, e foi exatamente essa cegueira que prolongou o incidente
      // 2026-09-23 #1 (achado do dono: log novo, mas ainda sem esta distinção).
      const apiKeySource =
        receivedApiKeyFromHeader && receivedApiKeyFromBody
          ? 'cabeçalho e corpo'
          : receivedApiKeyFromHeader
            ? 'cabeçalho'
            : receivedApiKeyFromBody
              ? 'corpo'
              : 'nenhum (ausente no cabeçalho e no corpo)';
      logger.warn('webhook evolution: apikey sem correspondência com nenhuma credencial aceita — requisição recusada (404)', {
        instanceId: instance.id,
        apiKeySource,
      });
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
