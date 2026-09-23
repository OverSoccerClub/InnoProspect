/**
 * api-handler.test.ts — mecanismo ÚNICO de autorização por papel
 * (`requireRole`, CRUD de usuários — Onda 4). Testa o `apiRoute()` REAL (não
 * o `apiHandlerMockFactory` que os testes de `lib/services/*` usam para
 * ISOLAR da autenticação — aqui é exatamente a autenticação que queremos
 * exercitar). Só `./auth` é mockado (evita o problema de importar
 * `next-auth` em Vitest+node, ver [[bug-nextauth-vitest-server-import]] na
 * memória do Vega) — `checkRateLimit`/`clientIp`/`@inno/contracts` são reais.
 *
 * Cobre o contrato pedido pelo dono: "operador recebe 403, admin recebe 200"
 * — de forma central aqui, e por rota específica em
 * `apps/web/src/app/api/v1/admin-routes.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

vi.mock('./auth', () => ({ auth: vi.fn() }));
vi.mock('./logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});

const { apiRoute } = await import('./api-handler');
const { auth } = await import('./auth');
const authMock = auth as unknown as ReturnType<typeof vi.fn>;

function req(url = 'https://innoprospect.local/api/v1/admin-only'): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}
const ctx = { params: Promise.resolve({}) };

function session(role: 'admin' | 'operator', id = 'user-1') {
  return { user: { id, role, email: `${id}@x.local`, name: id } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('apiRoute — requireRole (mecanismo único de autorização por papel)', () => {
  const adminOnlyRoute = apiRoute({
    requireRole: 'admin',
    handler: async () => NextResponse.json({ ok: true }),
  });

  it('sem sessão: 401 UNAUTHORIZED, não 403 (distinção "não autenticado" vs "sem permissão")', async () => {
    authMock.mockResolvedValue(null);

    const res = await adminOnlyRoute(req(), ctx);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('sessão de operador: 403 FORBIDDEN, envelope padrão', async () => {
    authMock.mockResolvedValue(session('operator'));

    const res = await adminOnlyRoute(req(), ctx);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.requestId).toBeTruthy();
  });

  it('sessão de admin: 200, handler executa', async () => {
    authMock.mockResolvedValue(session('admin'));

    const res = await adminOnlyRoute(req(), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rota SEM requireRole continua aceitando qualquer papel autenticado (não regrediu)', async () => {
    const openRoute = apiRoute({ handler: async () => NextResponse.json({ ok: true }) });
    authMock.mockResolvedValue(session('operator'));

    const res = await openRoute(req(), ctx);

    expect(res.status).toBe(200);
  });

  it('requireRole roda ANTES da validação de query/body (403 sem nem olhar a query inválida)', async () => {
    const strictRoute = apiRoute({
      requireRole: 'admin',
      querySchema: z.object({ mustExist: z.string() }),
      handler: async () => NextResponse.json({ ok: true }),
    });
    authMock.mockResolvedValue(session('operator'));

    const res = await strictRoute(req('https://innoprospect.local/api/v1/admin-only'), ctx); // sem `mustExist` na query

    expect(res.status).toBe(403); // não 422 — prova que a ordem é auth/role antes de parse
  });
});
