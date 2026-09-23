/**
 * lib/api-handler.ts — wrapper único de toda rota `/api/v1/*`
 * (ARQUITETURA §2/§4.0): auth (sessão Auth.js) + validação Zod
 * (`@inno/contracts`) + envelope de erro padrão com `requestId` + log
 * estruturado de entrada/erro. Nenhuma rota deve montar `NextResponse.json`
 * de erro à mão — sempre por aqui, para o formato nunca divergir do que
 * `lib/fetcher.ts` (Lyra) sabe interpretar.
 *
 * Camadas dentro de uma rota (regra de qualidade do Vega): rota → validação
 * (aqui) → lógica de negócio (função de serviço chamada pelo `handler`) →
 * dados (Prisma). Rotas não devem ter lógica de negócio inline além de
 * orquestrar chamadas.
 */
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { ZodError, ZodType } from 'zod';
import { API_ERROR_HTTP_STATUS, apiError, type ApiErrorCode, type ApiErrorDetail } from '@inno/contracts';
import { Prisma } from '@inno/db';
import { auth } from './auth';
import { logger } from './logger';
import { checkRateLimit, clientIp } from './rate-limit';

/**
 * Erro de negócio/validação que uma rota (ou uma função de serviço chamada
 * por ela) pode lançar a qualquer momento — o wrapper converte para o
 * envelope de erro certo. Use os helpers abaixo (`notFound`, `conflict`,
 * etc.) em vez de instanciar direto, para manter a mensagem consistente.
 */
export class ApiHttpError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];
  /** Sub-código `SCREAMING_SNAKE` (ARQUITETURA §4.0 v1.1, `@inno/contracts#apiErrorSchema`) — ver comentário em `common.ts`. */
  readonly reason?: string;

  constructor(code: ApiErrorCode, message: string, details?: ApiErrorDetail[], reason?: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.code = code;
    this.details = details;
    this.reason = reason;
  }
}

export function badRequest(message: string, details?: ApiErrorDetail[], reason?: string): never {
  throw new ApiHttpError('VALIDATION_ERROR', message, details, reason);
}
export function unauthorized(message = 'Sessão inválida ou expirada. Faça login novamente.'): never {
  throw new ApiHttpError('UNAUTHORIZED', message);
}
export function forbidden(message = 'Você não tem permissão para esta ação.'): never {
  throw new ApiHttpError('FORBIDDEN', message);
}
export function notFound(message: string, reason?: string): never {
  throw new ApiHttpError('NOT_FOUND', message, undefined, reason);
}
export function conflict(message: string, details?: ApiErrorDetail[], reason?: string): never {
  throw new ApiHttpError('CONFLICT', message, details, reason);
}
export function upstreamError(message: string, reason?: string): never {
  throw new ApiHttpError('UPSTREAM_ERROR', message, undefined, reason);
}
/**
 * `429 RATE_LIMITED` com `reason` — distinto do rate limit por IP embutido em
 * `apiRoute({ rateLimit })` (que é para rota PÚBLICA, sem sessão). Este
 * helper é para limite por USUÁRIO autenticado (ex.: `MANUAL_SEND_RATE_PER_MIN`,
 * ARQUITETURA §4.9/§10) — a rota chama `checkRateLimit` (`lib/rate-limit.ts`)
 * com uma chave por `userId` e lança isto quando estourar.
 */
export function rateLimited(message: string, reason?: string): never {
  throw new ApiHttpError('RATE_LIMITED', message, undefined, reason);
}

function zodIssuesToDetails(err: ZodError): ApiErrorDetail[] {
  return err.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

function parseOrThrow<T>(schema: ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiHttpError(
      'VALIDATION_ERROR',
      `Dados inválidos em ${what}.`,
      zodIssuesToDetails(result.error),
    );
  }
  return result.data;
}

export type AuthedSession = { user: { id: string; role: 'admin' | 'operator'; email?: string | null; name?: string | null } };

export type ApiHandlerArgs<TQuery, TBody, TParams> = {
  req: NextRequest;
  query: TQuery;
  body: TBody;
  params: TParams;
  /** `null` só é possível em rota com `requireAuth: false` (ex.: `GET /api/v1/health`). */
  session: AuthedSession | null;
  requestId: string;
};

export type RouteParamsPromise = { params: Promise<Record<string, string>> };

export type ApiRouteOptions<TQuery, TBody, TParams> = {
  /** Default `true` — quase toda rota `/api/v1/*` exige sessão (ARQUITETURA §4.0). Só `false` para rotas públicas explícitas. */
  requireAuth?: boolean;
  /**
   * Limite de taxa por IP, aplicado como o PRIMEIRO passo do handler — antes
   * de sessão, antes de ler o corpo. Só faz sentido em rota `requireAuth:
   * false` (rota autenticada já é limitada implicitamente por exigir login);
   * usado hoje no webhook da Evolution e no opt-out público (achado do Órion,
   * 2026-08-03: nenhuma rota pública tinha rate limit). `bucket` identifica a
   * rota no contador compartilhado (`lib/rate-limit.ts`) — obrigatório para
   * duas rotas com `rateLimit` não dividirem o mesmo balde.
   */
  rateLimit?: { windowMs: number; max: number; bucket: string };
  /**
   * Rejeita o corpo (antes do `JSON.parse`) se exceder este tamanho em bytes.
   * Sem isto uma rota sem sessão paga o custo de ler/parsear qualquer payload
   * que o cliente mandar. Só use em rota pública — rota autenticada não
   * precisa (o operador já passou por login).
   */
  maxBodyBytes?: number;
  /**
   * Exige que a sessão tenha este `role` — MECANISMO ÚNICO de autorização por
   * papel (CRUD de usuários, Onda 4): nenhuma rota deve voltar a copiar
   * `if (session.user.role !== 'admin') forbidden(...)` por conta própria
   * (era o padrão em `lib/services/optouts.ts#deleteOptOut` antes desta
   * rodada — centralizado aqui). Roda logo depois de resolver a sessão, ANTES
   * de parsear params/query/body (mesma lógica de "falhar rápido, antes do
   * trabalho caro" do `rateLimit` acima). Pressupõe `requireAuth` (default
   * `true`) — combinar com `requireAuth: false` não faz sentido (não há
   * sessão para checar o papel) e aqui vira `401`, não `403`, se ainda assim
   * acontecer.
   *
   * Só o papel salvo no JWT no momento do LOGIN é considerado — se um admin
   * rebaixar/desativar outro usuário, uma sessão já aberta daquele usuário
   * continua com o papel antigo até expirar/logar de novo (limitação
   * conhecida da estratégia `session: { strategy: 'jwt' }`, documentada no
   * handoff; não há storage de sessão server-side para revogar na hora).
   */
  requireRole?: 'admin' | 'operator';
  querySchema?: ZodType<TQuery>;
  bodySchema?: ZodType<TBody>;
  paramsSchema?: ZodType<TParams>;
  handler: (args: ApiHandlerArgs<TQuery, TBody, TParams>) => Promise<NextResponse> | NextResponse;
};

/**
 * Traduz erros conhecidos do Prisma para o envelope padrão sem vazar detalhe
 * de schema/SQL pro cliente. `P2002` (unique constraint) é o único caso
 * comum que uma rota pode legitimamente deixar borbulhar até aqui (ex.:
 * corrida rara entre 2 requisições concorrentes criando o mesmo recurso) —
 * o resto é bug e deve virar `500` para aparecer no log.
 */
function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): ApiHttpError | null {
  if (err.code === 'P2002') {
    return new ApiHttpError('CONFLICT', 'Este recurso já existe ou conflita com um registro ativo.');
  }
  if (err.code === 'P2025') {
    return new ApiHttpError('NOT_FOUND', 'Registro não encontrado.');
  }
  return null;
}

export function apiRoute<TQuery = undefined, TBody = undefined, TParams = Record<string, string>>(
  options: ApiRouteOptions<TQuery, TBody, TParams>,
): (req: NextRequest, ctx: RouteParamsPromise) => Promise<NextResponse> {
  const requireAuth = options.requireAuth ?? true;

  return async function routeHandler(req: NextRequest, ctx: RouteParamsPromise): Promise<NextResponse> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const method = req.method;
    const path = req.nextUrl.pathname;

    try {
      // Rate limit é o PRIMEIRO passo, antes de sessão e de ler o corpo —
      // uma requisição que estoura o limite não deve custar Postgres (auth
      // já não roda em rota pública) nem `req.text()`/`JSON.parse`.
      if (options.rateLimit) {
        const key = `${options.rateLimit.bucket}:${clientIp(req)}`;
        const result = checkRateLimit(key, options.rateLimit.windowMs, options.rateLimit.max);
        if (!result.allowed) {
          throw new ApiHttpError('RATE_LIMITED', 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.');
        }
      }

      let session: AuthedSession | null = null;
      if (requireAuth) {
        const authSession = await auth();
        if (!authSession?.user) unauthorized();
        session = authSession as AuthedSession;
      }

      if (options.requireRole) {
        if (!session) unauthorized();
        if (session.user.role !== options.requireRole) {
          forbidden(
            options.requireRole === 'admin'
              ? 'Esta ação exige permissão de administrador.'
              : `Esta ação exige o papel "${options.requireRole}".`,
          );
        }
      }

      const rawParams = (await ctx.params) ?? {};
      const params = options.paramsSchema
        ? parseOrThrow(options.paramsSchema, rawParams, 'parâmetros da rota')
        : (rawParams as TParams);

      const query = options.querySchema
        ? parseOrThrow(options.querySchema, Object.fromEntries(req.nextUrl.searchParams.entries()), 'query string')
        : (undefined as TQuery);

      let rawBody: unknown;
      if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
        if (options.maxBodyBytes !== undefined) {
          const declaredLength = Number(req.headers.get('content-length') ?? NaN);
          if (Number.isFinite(declaredLength) && declaredLength > options.maxBodyBytes) {
            badRequest('Corpo da requisição excede o tamanho máximo permitido.');
          }
        }

        const text = await req.text();

        if (options.maxBodyBytes !== undefined && Buffer.byteLength(text, 'utf8') > options.maxBodyBytes) {
          // Defesa de segunda linha para o caso raro de corpo sem
          // `content-length` (ex.: transfer-encoding chunked) — o header já
          // barra a maioria dos casos antes de gastar a leitura acima.
          badRequest('Corpo da requisição excede o tamanho máximo permitido.');
        }

        if (text.length > 0) {
          try {
            rawBody = JSON.parse(text);
          } catch {
            badRequest('Corpo da requisição não é um JSON válido.');
          }
        }
      }
      const body = options.bodySchema ? parseOrThrow(options.bodySchema, rawBody, 'corpo da requisição') : (undefined as TBody);

      const response = await options.handler({
        req,
        query,
        body,
        params,
        session,
        requestId,
      });

      logger.info('api request', {
        requestId,
        method,
        path,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      response.headers.set('x-request-id', requestId);
      return response;
    } catch (err) {
      return handleRouteError(err, { requestId, method, path, startedAt });
    }
  };
}

function handleRouteError(
  err: unknown,
  ctx: { requestId: string; method: string; path: string; startedAt: number },
): NextResponse {
  const { requestId, method, path, startedAt } = ctx;
  const durationMs = Date.now() - startedAt;

  let apiErr: ApiHttpError;
  if (err instanceof ApiHttpError) {
    apiErr = err;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    apiErr = mapPrismaError(err) ?? new ApiHttpError('INTERNAL_ERROR', 'Erro interno. Tente novamente em instantes.');
  } else {
    apiErr = new ApiHttpError('INTERNAL_ERROR', 'Erro interno. Tente novamente em instantes.');
  }

  const status = API_ERROR_HTTP_STATUS[apiErr.code];
  const logFields = { requestId, method, path, status, durationMs };

  if (status >= 500) {
    logger.error('api request failed', { ...logFields, err: err instanceof Error ? err : new Error(String(err)) });
  } else {
    logger.warn('api request rejected', { ...logFields, code: apiErr.code, reason: apiErr.reason });
  }

  const body = apiError(apiErr.code, apiErr.message, { details: apiErr.details, requestId, reason: apiErr.reason });
  const res = NextResponse.json(body, { status });
  res.headers.set('x-request-id', requestId);
  return res;
}
