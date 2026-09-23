/**
 * lib/services/optouts.ts — Opt-out / blacklist (ARQUITETURA §4.7, §6.7).
 * "A tabela mais importante do sistema em termos de risco" — LGPD, risco de
 * banimento e reputação. Nenhuma exceção, nenhum cache: ver
 * `packages/db/prisma/schema.prisma` (`OptOut.phoneE164 @unique`) e
 * `apps/web/src/lib/services/campaign-targets.ts#skipPendingCampaignTargetsForPhone`
 * (efeito retroativo na mesma transação, §6.7 item 4).
 */
import { prisma } from '@inno/db';
import { parsePublicOptOutToken } from '@inno/core';
import type {
  CreateOptOutBody,
  CreateOptOutResponse,
  ListOptOutsQuery,
  ListOptOutsResponse,
  PublicOptOutResponse,
} from '@inno/contracts';
import { badRequest, conflict, notFound } from '@/lib/api-handler';
import { skipPendingCampaignTargetsForPhone } from '@/lib/services/campaign-targets';
import { logger } from '@/lib/logger';

export async function listOptOuts(query: ListOptOutsQuery): Promise<ListOptOutsResponse> {
  const [total, rows] = await Promise.all([
    prisma.optOut.count(),
    prisma.optOut.findMany({
      include: { lead: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  return {
    data: page.map((row) => ({
      id: row.id,
      phoneE164: row.phoneE164,
      source: row.source,
      leadName: row.lead?.name ?? null,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
    page: { cursor: query.cursor ?? null, nextCursor, limit: query.limit, total },
  };
}

/**
 * Registro manual/por solicitação (operador autenticado, `POST
 * /api/v1/optouts`). Efeito imediato e retroativo na MESMA transação
 * (ARQUITETURA §6.7 item 4) — nenhum `CampaignTarget` pendente daquele
 * telefone sobrevive à criação do `OptOut`.
 */
export async function createOptOut(body: CreateOptOutBody, actorUserId: string): Promise<CreateOptOutResponse> {
  const existing = await prisma.optOut.findUnique({ where: { phoneE164: body.phoneE164 } });
  if (existing) {
    conflict(`O telefone ${body.phoneE164} já está na lista de opt-out (id: ${existing.id}).`);
  }

  // Melhor esforço: se o telefone corresponder a um Lead conhecido, guarda a
  // referência (opcional, `OptOut.leadId` é nullable) e registra a auditoria
  // na timeline dele. Não é erro se não houver Lead com este telefone — o
  // opt-out É por telefone, funciona sem Lead nenhum (ARQUITETURA §3.2 regra 3).
  const matchingLead = await prisma.lead.findFirst({
    where: { phoneE164: body.phoneE164 },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true },
  });

  const { optOut, affectedTargets } = await prisma.$transaction(async (tx) => {
    const created = await tx.optOut.create({
      data: {
        phoneE164: body.phoneE164,
        source: body.source,
        reason: body.reason,
        leadId: matchingLead?.id,
      },
    });

    const affected = await skipPendingCampaignTargetsForPhone(tx, body.phoneE164, 'opted_out');

    if (matchingLead) {
      await tx.leadActivity.create({
        data: {
          leadId: matchingLead.id,
          type: 'opt_out',
          payload: { source: body.source, reason: body.reason ?? null },
          actor: 'user',
          actorUserId,
        },
      });
    }

    return { optOut: created, affectedTargets: affected };
  });

  logger.info('opt-out registrado', {
    optOutId: optOut.id,
    source: optOut.source,
    affectedTargets,
    actorUserId,
  });

  return {
    id: optOut.id,
    phoneE164: optOut.phoneE164,
    createdAt: optOut.createdAt.toISOString(),
    affectedTargets,
  };
}

/**
 * `DELETE /api/v1/optouts/:id` — exige `role=admin` (ARQUITETURA §6.7 item 5),
 * gera auditoria. NÃO é operação de rotina. A checagem de papel é feita pela
 * rota (`requireRole: 'admin'` em `apiRoute`, `lib/api-handler.ts` — Onda 4)
 * ANTES de chamar esta função; não repetida aqui de propósito (mecanismo
 * único de autorização, ver comentário em `ApiRouteOptions.requireRole`).
 */
export async function deleteOptOut(id: string, actorUserId: string): Promise<void> {
  const optOut = await prisma.optOut.findUnique({ where: { id } });
  if (!optOut) notFound('Opt-out não encontrado.');

  await prisma.$transaction(async (tx) => {
    await tx.optOut.delete({ where: { id } });
    if (optOut.leadId) {
      await tx.leadActivity.create({
        data: {
          leadId: optOut.leadId,
          type: 'opt_out_removed',
          payload: { phoneE164: optOut.phoneE164 },
          actor: 'user',
          actorUserId,
        },
      });
    }
  });

  logger.info('opt-out removido', { optOutId: id, actorUserId });
}

/**
 * `POST /api/v1/public/optout` — página pública `/descadastro/:token`
 * (ARQUITETURA §4.7), SEM sessão. `token` é a string composta descrita em
 * `packages/core/optout/token.ts` (`buildPublicOptOutToken`/
 * `parsePublicOptOutToken`) — decompõe para o `phoneE164` só se a assinatura
 * HMAC bater contra `OPTOUT_TOKEN_SECRET`.
 *
 * Idempotente por desenho: telefone já opt-out (re-clique no mesmo link, ou
 * 2 abas) devolve a MESMA resposta de sucesso — nunca `409` aqui. É um
 * exercício de direito do titular (LGPD §7.3), não uma criação de recurso
 * "de negócio" onde duplicata é erro; e o link pode legitimamente ser
 * clicado mais de uma vez pela mesma pessoa.
 */
export async function publicOptOut(token: string): Promise<PublicOptOutResponse> {
  const secret = process.env.OPTOUT_TOKEN_SECRET;
  if (!secret) {
    // Erro de configuração de infra, não do titular — mas a resposta pro
    // titular continua genérica (nunca expor detalhe interno numa rota pública).
    logger.error('OPTOUT_TOKEN_SECRET ausente — não é possível validar token de descadastro público');
    badRequest('Não foi possível processar o descadastro no momento. Tente novamente mais tarde.');
  }

  const phoneE164 = parsePublicOptOutToken(token, { secret });
  if (!phoneE164) {
    badRequest('Link de descadastro inválido ou expirado.', [{ path: 'token', message: 'Token inválido.' }]);
  }

  const existing = await prisma.optOut.findUnique({ where: { phoneE164 } });
  if (existing) {
    return { ok: true, message: 'Você não receberá mais mensagens.' };
  }

  const matchingLead = await prisma.lead.findFirst({
    where: { phoneE164 },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Corrida entre 2 cliques simultâneos do mesmo link: o `@unique` em
    // `phoneE164` faz o segundo `create` estourar `P2002`, que
    // `api-handler.ts` já traduz para `409 CONFLICT` — mas aqui a resposta
    // certa para o titular é sucesso (idempotência), não erro. Por isso o
    // `try/catch` local: absorve só essa corrida específica.
    try {
      await tx.optOut.create({
        data: { phoneE164, source: 'public_link', leadId: matchingLead?.id },
      });
    } catch (err) {
      const isUniqueViolation =
        typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002';
      if (!isUniqueViolation) throw err;
      return;
    }

    await skipPendingCampaignTargetsForPhone(tx, phoneE164, 'opted_out');

    if (matchingLead) {
      await tx.leadActivity.create({
        data: {
          leadId: matchingLead.id,
          type: 'opt_out',
          payload: { source: 'public_link' },
          actor: 'lead',
        },
      });
    }
  });

  logger.info('opt-out público registrado', { hasMatchingLead: Boolean(matchingLead) });

  return { ok: true, message: 'Você não receberá mais mensagens.' };
}
