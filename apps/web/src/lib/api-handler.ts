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

/**
 * Erro de negócio/validação que uma rota (ou uma função de serviço chamada
 * por ela) pode lançar a qualquer momento — o wrapper converte para o
 * envelope de erro certo. Use os helpers abaixo (`notFound`, `conflict`,
 * etc.) em vez de instanciar direto, para manter a mensagem consistente.
 */
export class ApiHttpError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];

  constructor(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiHttpError';
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: ApiErrorDetail[]): never {
  throw new ApiHttpError('VALIDATION_ERROR', message, details);
}
export function unauthorized(message = 'Sessão inválida ou expirada. Faça login novamente.'): never {
  throw new ApiHttpError('UNAUTHORIZED', message);
}
export function forbidden(message = 'Você não tem permissão para esta ação.'): never {
  throw new ApiHttpError('FORBIDDEN', message);
}
export function notFound(message: string): never {
  throw new ApiHttpError('NOT_FOUND', message);
}
export function conflict(message: string, details?: ApiErrorDetail[]): never {
  throw new ApiHttpError('CONFLICT', message, details);
}
export function upstreamError(message: string): never {
  throw new ApiHttpError('UPSTREAM_ERROR', message);
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
      let session: AuthedSession | null = null;
      if (requireAuth) {
        const authSession = await auth();
        if (!authSession?.user) unauthorized();
        session = authSession as AuthedSession;
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
        const text = await req.text();
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
    logger.warn('api request rejected', { ...logFields, code: apiErr.code });
  }

  const body = apiError(apiErr.code, apiErr.message, { details: apiErr.details, requestId });
  const res = NextResponse.json(body, { status });
  res.headers.set('x-request-id', requestId);
  return res;
}
