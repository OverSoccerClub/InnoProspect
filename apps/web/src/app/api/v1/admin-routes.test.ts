/**
 * admin-routes.test.ts — para CADA rota que passou a exigir `role=admin`
 * nesta rodada (CRUD de usuários, Onda 4), prova o pedido literal do dono:
 * "operador recebe 403, admin recebe 200" — através do `apiRoute()` REAL
 * (`lib/api-handler.ts`), não de um mock que pule a autenticação. Os
 * serviços de cada rota são mockados (o que eles fazem já está testado nos
 * `lib/services/*.test.ts` correspondentes) — aqui o alvo é só a FIAÇÃO
 * `route.ts` → `requireRole: 'admin'`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});
vi.mock('@/lib/services/whatsapp-instances', () => ({
  listWhatsAppInstances: vi.fn(async () => ({ data: [], page: { cursor: null, nextCursor: null, limit: 25, total: 0 } })),
  createWhatsAppInstance: vi.fn(async () => ({ id: 'inst-1', name: 'Inst', status: 'qr_pending', evolutionInstanceName: 'inno_inst_1' })),
  getWhatsAppInstanceDetail: vi.fn(async () => ({ id: 'inst-1' })),
  deleteWhatsAppInstance: vi.fn(async () => undefined),
  getWhatsAppInstanceQr: vi.fn(async () => ({ qrCode: 'data:image/png;base64,x' })),
  connectWhatsAppInstance: vi.fn(async () => ({ id: 'inst-1', status: 'qr_pending' })),
  disconnectWhatsAppInstance: vi.fn(async () => ({ id: 'inst-1', status: 'disconnected' })),
}));
vi.mock('@/lib/services/scraper-health', () => ({
  resumeScraperQueue: vi.fn(async () => ({ ok: true, status: 'running', resolvedIncidents: 1 })),
}));
vi.mock('@/lib/services/optouts', () => ({
  deleteOptOut: vi.fn(async () => undefined),
}));
vi.mock('@/lib/services/evolution-servers', () => ({
  listEvolutionServers: vi.fn(async () => ({ data: [] })),
  createEvolutionServer: vi.fn(async () => ({
    id: 'srv-1',
    name: 'Servidor 1',
    baseUrl: 'https://evolution1.example.com',
    isActive: true,
    hasApiKey: true,
    instancesCount: 0,
    createdAt: 'x',
    updatedAt: 'x',
  })),
  getEvolutionServerDetail: vi.fn(async () => ({
    id: 'srv-1',
    name: 'Servidor 1',
    baseUrl: 'https://evolution1.example.com',
    isActive: true,
    hasApiKey: true,
    instancesCount: 0,
    createdAt: 'x',
    updatedAt: 'x',
  })),
  updateEvolutionServer: vi.fn(async () => ({
    id: 'srv-1',
    name: 'Servidor renomeado',
    baseUrl: 'https://evolution1.example.com',
    isActive: true,
    hasApiKey: true,
    instancesCount: 0,
    createdAt: 'x',
    updatedAt: 'x',
  })),
  deactivateEvolutionServer: vi.fn(async () => undefined),
  testEvolutionServerConnection: vi.fn(async () => ({ ok: true, latencyMs: 42, checkedAt: 'x', error: null })),
}));
vi.mock('@/lib/services/users', () => ({
  listUsers: vi.fn(async () => ({ data: [], page: { cursor: null, nextCursor: null, limit: 25, total: 0 } })),
  createUser: vi.fn(async () => ({ id: 'u1', email: 'novo@x.local', name: 'Novo', role: 'operator', isActive: true, createdAt: 'x', updatedAt: 'x' })),
  getUser: vi.fn(async () => ({ id: 'u1', email: 'u1@x.local', name: 'U1', role: 'operator', isActive: true, createdAt: 'x', updatedAt: 'x' })),
  updateUser: vi.fn(async () => ({ id: 'u1', email: 'u1@x.local', name: 'U1', role: 'operator', isActive: true, createdAt: 'x', updatedAt: 'x' })),
  deactivateUser: vi.fn(async () => undefined),
}));

const { auth } = await import('@/lib/auth');
const authMock = auth as unknown as ReturnType<typeof vi.fn>;

function session(role: 'admin' | 'operator') {
  return { user: { id: `${role}-1`, role, email: `${role}@x.local`, name: role } };
}

function jsonReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  });
}

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  vi.clearAllMocks();
});

/** Roda `handler(req, ctx)` como operador (espera 403) e depois como admin (espera `expectedAdminStatus`). */
async function expectAdminOnly(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  buildReq: () => NextRequest,
  params: Record<string, string>,
  expectedAdminStatus: number,
) {
  authMock.mockResolvedValue(session('operator'));
  const operatorRes = await handler(buildReq(), ctx(params));
  expect(operatorRes.status).toBe(403);
  expect((await operatorRes.json()).error.code).toBe('FORBIDDEN');

  authMock.mockResolvedValue(session('admin'));
  const adminRes = await handler(buildReq(), ctx(params));
  expect(adminRes.status).toBe(expectedAdminStatus);
}

describe('rotas admin-only — operador 403 / admin passa', () => {
  it('GET /api/v1/users', async () => {
    const { GET } = await import('./users/route');
    await expectAdminOnly(GET, () => jsonReq('https://x.local/api/v1/users', 'GET'), {}, 200);
  });

  it('POST /api/v1/users', async () => {
    const { POST } = await import('./users/route');
    const body = { email: 'novo@x.local', password: 'senha-forte-123', name: 'Novo', role: 'operator' };
    await expectAdminOnly(POST, () => jsonReq('https://x.local/api/v1/users', 'POST', body), {}, 201);
  });

  it('GET /api/v1/users/:id', async () => {
    const { GET } = await import('./users/[id]/route');
    await expectAdminOnly(GET, () => jsonReq('https://x.local/api/v1/users/u1', 'GET'), { id: 'ckzz1234567890abcdefghijk' }, 200);
  });

  it('PATCH /api/v1/users/:id', async () => {
    const { PATCH } = await import('./users/[id]/route');
    await expectAdminOnly(
      PATCH,
      () => jsonReq('https://x.local/api/v1/users/u1', 'PATCH', { name: 'Outro' }),
      { id: 'ckzz1234567890abcdefghijk' },
      200,
    );
  });

  it('DELETE /api/v1/users/:id', async () => {
    const { DELETE } = await import('./users/[id]/route');
    await expectAdminOnly(DELETE, () => jsonReq('https://x.local/api/v1/users/u1', 'DELETE'), { id: 'ckzz1234567890abcdefghijk' }, 204);
  });

  it('GET /api/v1/whatsapp/instances', async () => {
    const { GET } = await import('./whatsapp/instances/route');
    await expectAdminOnly(GET, () => jsonReq('https://x.local/api/v1/whatsapp/instances', 'GET'), {}, 200);
  });

  it('POST /api/v1/whatsapp/instances', async () => {
    const { POST } = await import('./whatsapp/instances/route');
    await expectAdminOnly(
      POST,
      // 🆕 Fase 4.B — evolutionServerId é obrigatório no corpo (ver whatsapp.contract.ts).
      () => jsonReq('https://x.local/api/v1/whatsapp/instances', 'POST', { name: 'Instância 1', evolutionServerId: 'ckzz1234567890abcdefghijk' }),
      {},
      201,
    );
  });

  it('GET /api/v1/whatsapp/instances/:id', async () => {
    const { GET } = await import('./whatsapp/instances/[id]/route');
    await expectAdminOnly(GET, () => jsonReq('https://x.local/api/v1/whatsapp/instances/i1', 'GET'), { id: 'ckzz1234567890abcdefghijk' }, 200);
  });

  it('DELETE /api/v1/whatsapp/instances/:id', async () => {
    const { DELETE } = await import('./whatsapp/instances/[id]/route');
    await expectAdminOnly(
      DELETE,
      () => jsonReq('https://x.local/api/v1/whatsapp/instances/i1', 'DELETE'),
      { id: 'ckzz1234567890abcdefghijk' },
      204,
    );
  });

  it('GET /api/v1/whatsapp/instances/:id/qr', async () => {
    const { GET } = await import('./whatsapp/instances/[id]/qr/route');
    await expectAdminOnly(GET, () => jsonReq('https://x.local/api/v1/whatsapp/instances/i1/qr', 'GET'), { id: 'ckzz1234567890abcdefghijk' }, 200);
  });

  it('POST /api/v1/whatsapp/instances/:id/connect', async () => {
    const { POST } = await import('./whatsapp/instances/[id]/[action]/route');
    await expectAdminOnly(
      POST,
      () => jsonReq('https://x.local/api/v1/whatsapp/instances/i1/connect', 'POST'),
      { id: 'ckzz1234567890abcdefghijk', action: 'connect' },
      202,
    );
  });

  it('POST /api/v1/scraper/queue/resume', async () => {
    const { POST } = await import('./scraper/queue/resume/route');
    await expectAdminOnly(
      POST,
      () => jsonReq('https://x.local/api/v1/scraper/queue/resume', 'POST', { acknowledge: true }),
      {},
      200,
    );
  });

  it('DELETE /api/v1/optouts/:id', async () => {
    const { DELETE } = await import('./optouts/[id]/route');
    await expectAdminOnly(DELETE, () => jsonReq('https://x.local/api/v1/optouts/o1', 'DELETE'), { id: 'ckzz1234567890abcdefghijk' }, 204);
  });

  // 🆕 Fase 4.B — servidores Evolution API (multi-servidor).
  it('GET /api/v1/evolution-servers', async () => {
    const { GET } = await import('./evolution-servers/route');
    await expectAdminOnly(GET, () => jsonReq('https://x.local/api/v1/evolution-servers', 'GET'), {}, 200);
  });

  it('POST /api/v1/evolution-servers', async () => {
    const { POST } = await import('./evolution-servers/route');
    const body = { name: 'Servidor 1', baseUrl: 'https://evolution1.example.com', apiKey: 'chave-secreta-abc' };
    await expectAdminOnly(POST, () => jsonReq('https://x.local/api/v1/evolution-servers', 'POST', body), {}, 201);
  });

  it('GET /api/v1/evolution-servers/:id', async () => {
    const { GET } = await import('./evolution-servers/[id]/route');
    await expectAdminOnly(GET, () => jsonReq('https://x.local/api/v1/evolution-servers/s1', 'GET'), { id: 'ckzz1234567890abcdefghijk' }, 200);
  });

  it('PATCH /api/v1/evolution-servers/:id', async () => {
    const { PATCH } = await import('./evolution-servers/[id]/route');
    await expectAdminOnly(
      PATCH,
      () => jsonReq('https://x.local/api/v1/evolution-servers/s1', 'PATCH', { name: 'Novo nome' }),
      { id: 'ckzz1234567890abcdefghijk' },
      200,
    );
  });

  it('DELETE /api/v1/evolution-servers/:id', async () => {
    const { DELETE } = await import('./evolution-servers/[id]/route');
    await expectAdminOnly(DELETE, () => jsonReq('https://x.local/api/v1/evolution-servers/s1', 'DELETE'), { id: 'ckzz1234567890abcdefghijk' }, 204);
  });

  it('POST /api/v1/evolution-servers/:id/test-connection', async () => {
    const { POST } = await import('./evolution-servers/[id]/test-connection/route');
    await expectAdminOnly(
      POST,
      () => jsonReq('https://x.local/api/v1/evolution-servers/s1/test-connection', 'POST'),
      { id: 'ckzz1234567890abcdefghijk' },
      200,
    );
  });
});
