/**
 * auth.test.ts — rate limit de login por e-mail e por IP (`authorizeCredentials`,
 * pendência do Órion desde a Fase 1: "login público não limita tentativas").
 * Testa a função extraída direto (sem passar pelo `NextAuth(...)` inteiro),
 * com Prisma/bcrypt/logger mockados. `vi.useFakeTimers()` porque
 * `checkRateLimit` usa `Date.now()` para a janela (ver
 * [[bug-vitest-fake-timers-retry-backoff]] na memória — mesmo cuidado geral
 * de não deixar um teste de janela temporal rodar contra o relógio real).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `NextAuth(...)`/`Credentials(...)` de verdade não importam sob Vitest+node
// aqui: `next-auth` importa `next/server` internamente (só resolve dentro do
// runtime do Next.js/webpack, não em Node puro) — "Cannot find module
// .../next/server". Isto é ortogonal à lógica que este teste cobre
// (`authorizeCredentials`, exportada separadamente e testada direto, nunca
// através do objeto que `NextAuth(...)` devolve) — mockar os dois só evita
// que o MÓDULO `auth.ts` quebre ao ser importado.
vi.mock('next-auth', () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock('next-auth/providers/credentials', () => ({
  default: (config: unknown) => config,
}));

const users = new Map<string, { id: string; email: string; name: string; role: string; passwordHash: string }>();

vi.mock('@inno/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => users.get(where.email) ?? null),
    },
  },
}));

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Senha real usada nos testes de sucesso: hash bcrypt de "senha-correta-123"
// gerado uma vez offline (bcryptjs, 4 rounds só para o teste ser rápido).
const REAL_PASSWORD = 'senha-correta-123';
const REAL_PASSWORD_HASH = '$2a$04$K3JQ8v0m2q4b3p5cQqf0kOQxPz2h0eYQwZ0Rl6m8f9s0m0zq1x2y3';

vi.mock('bcryptjs', () => ({
  default: {
    // Fake determinístico: só compara contra a senha "real" que os testes
    // conhecem — não precisamos do bcrypt de verdade para testar a lógica de
    // rate limit/roteamento (a Fase 1 já tinha cobertura disso implicitamente
    // via uso manual; aqui o foco é o limite de tentativas, não o hashing).
    compare: vi.fn(async (password: string, hash: string) => password === REAL_PASSWORD && hash === REAL_PASSWORD_HASH),
  },
}));

function request(ip: string): Request {
  return new Request('https://innoprospect.local/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('authorizeCredentials — rate limit de login', () => {
  beforeEach(() => {
    // `checkRateLimit` (lib/rate-limit.ts) guarda os contadores num Map no
    // ESCOPO DO MÓDULO — sem isto, o Map sobreviveria entre os `it()` deste
    // arquivo (mesmo processo de teste) e um teste vazaria contagem para o
    // próximo. `resetModules` força o próximo `import('./auth')` a
    // reconstruir `rate-limit.ts` do zero (Map novo).
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T10:00:00Z'));
    users.clear();
    users.set('vendedor@innoprospect.local', {
      id: 'user_1',
      email: 'vendedor@innoprospect.local',
      name: 'Vendedor',
      role: 'seller',
      passwordHash: REAL_PASSWORD_HASH,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('permite login com credenciais corretas dentro do limite', async () => {
    const { authorizeCredentials } = await import('./auth');

    const result = await authorizeCredentials(
      { email: 'vendedor@innoprospect.local', password: REAL_PASSWORD },
      request('203.0.113.10'),
    );

    expect(result).toEqual({ id: 'user_1', email: 'vendedor@innoprospect.local', name: 'Vendedor', role: 'seller' });
  });

  it('bloqueia depois de 5 tentativas para o MESMO e-mail (independente do IP mudar)', async () => {
    const { authorizeCredentials } = await import('./auth');

    for (let i = 0; i < 5; i += 1) {
      const outcome = await authorizeCredentials(
        { email: 'vendedor@innoprospect.local', password: 'senha-errada' },
        request(`203.0.113.${i}`), // IP diferente a cada tentativa — só o e-mail deve limitar
      );
      expect(outcome).toBeNull();
    }

    // A 6ª tentativa (ainda dentro da janela) é bloqueada pelo LIMITE, mesmo
    // com a senha CORRETA — é isso que prova que é rate limit, não só "senha
    // errada continua falhando".
    const blocked = await authorizeCredentials(
      { email: 'vendedor@innoprospect.local', password: REAL_PASSWORD },
      request('203.0.113.99'),
    );
    expect(blocked).toBeNull();
  });

  it('bloqueia depois de 20 tentativas do MESMO IP (independente do e-mail mudar)', async () => {
    const { authorizeCredentials } = await import('./auth');

    for (let i = 0; i < 20; i += 1) {
      const outcome = await authorizeCredentials(
        { email: `tentativa-${i}@innoprospect.local`, password: 'senha-errada' },
        request('203.0.113.50'),
      );
      expect(outcome).toBeNull();
    }

    // 21ª tentativa do mesmo IP, com um e-mail (e senha) válidos e NUNCA
    // usados antes — bloqueada pelo eixo de IP, não pelo de e-mail.
    const blocked = await authorizeCredentials(
      { email: 'vendedor@innoprospect.local', password: REAL_PASSWORD },
      request('203.0.113.50'),
    );
    expect(blocked).toBeNull();
  });

  it('libera de novo depois que a janela de 15 minutos passa', async () => {
    const { authorizeCredentials } = await import('./auth');

    for (let i = 0; i < 5; i += 1) {
      await authorizeCredentials(
        { email: 'vendedor@innoprospect.local', password: 'senha-errada' },
        request('203.0.113.10'),
      );
    }
    const stillBlocked = await authorizeCredentials(
      { email: 'vendedor@innoprospect.local', password: REAL_PASSWORD },
      request('203.0.113.10'),
    );
    expect(stillBlocked).toBeNull();

    // Avança 15 minutos e 1 segundo — janela fixa deve ter resetado o contador.
    vi.setSystemTime(new Date('2026-09-22T10:15:01Z'));

    const allowedAgain = await authorizeCredentials(
      { email: 'vendedor@innoprospect.local', password: REAL_PASSWORD },
      request('203.0.113.10'),
    );
    expect(allowedAgain).toEqual({ id: 'user_1', email: 'vendedor@innoprospect.local', name: 'Vendedor', role: 'seller' });
  });

  it('e-mail/senha ausentes retornam null sem consumir o rate limit', async () => {
    const { authorizeCredentials } = await import('./auth');

    const result = await authorizeCredentials({ email: '', password: '' }, request('203.0.113.1'));
    expect(result).toBeNull();
  });

  // Achado do Atlas na revisão desta rodada: o produto é vendido para
  // equipes, então IP compartilhado (escritório atrás do mesmo NAT/proxy) é
  // o caso COMUM, não a exceção. Login bem-sucedido NUNCA pode gastar cota
  // (nem de e-mail, nem de IP) — só falha gasta.
  it('logins BEM-SUCEDIDOS repetidos do mesmo IP nunca se bloqueiam (cenário do escritório)', async () => {
    const { authorizeCredentials } = await import('./auth');
    const officeIp = '203.0.113.200';

    // 25 pessoas diferentes, todas com a senha certa, todas atrás do mesmo
    // IP — mais do que o limite de 20/IP, que só conta FALHA.
    for (let i = 0; i < 25; i += 1) {
      users.set(`pessoa-${i}@innoprospect.local`, {
        id: `user_pessoa_${i}`,
        email: `pessoa-${i}@innoprospect.local`,
        name: `Pessoa ${i}`,
        role: 'seller',
        passwordHash: REAL_PASSWORD_HASH,
      });
      const result = await authorizeCredentials(
        { email: `pessoa-${i}@innoprospect.local`, password: REAL_PASSWORD },
        request(officeIp),
      );
      expect(result).toEqual({
        id: `user_pessoa_${i}`,
        email: `pessoa-${i}@innoprospect.local`,
        name: `Pessoa ${i}`,
        role: 'seller',
      });
    }
  });

  it('login bem-sucedido NÃO reseta o contador de IP (só o do e-mail que logou)', async () => {
    const { authorizeCredentials, LOGIN_RATE_LIMIT_MAX_PER_IP } = await import('./auth');
    const { logger } = await import('./logger');
    const officeIp = '203.0.113.201';

    // (limite - 1) falhas de e-mails nunca usados, todas do mesmo IP.
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_PER_IP - 1; i += 1) {
      const outcome = await authorizeCredentials(
        { email: `desconhecido-${i}@innoprospect.local`, password: 'senha-errada' },
        request(officeIp),
      );
      expect(outcome).toBeNull();
    }

    // 1 login BEM-SUCEDIDO do mesmo IP no meio do caminho.
    const success = await authorizeCredentials(
      { email: 'vendedor@innoprospect.local', password: REAL_PASSWORD },
      request(officeIp),
    );
    expect(success).not.toBeNull();

    // Mais 1 falha (e-mail novo) do mesmo IP: se o sucesso tivesse resetado
    // a cota de IP, isto ainda estaria longe do limite (bloquearia só por
    // senha errada). Em vez disso, o contador de IP não foi tocado pelo
    // sucesso — está em (limite - 1) — e esta falha o leva exatamente ao
    // limite, então AINDA passa (é a última permitida).
    const lastAllowed = await authorizeCredentials(
      { email: 'desconhecido-mais-um@innoprospect.local', password: 'senha-errada' },
      request(officeIp),
    );
    expect(lastAllowed).toBeNull();
    expect(logger.warn).toHaveBeenLastCalledWith('auth.login.falhou', expect.objectContaining({ motivo: 'usuario_nao_encontrado' }));

    // A tentativa seguinte do mesmo IP é bloqueada PELO LIMITE — prova que o
    // login bem-sucedido no meio do caminho não resetou o contador de IP
    // (senão precisaríamos de mais `LOGIN_RATE_LIMIT_MAX_PER_IP` falhas
    // depois do sucesso para chegar aqui, não só 1).
    const blockedByIp = await authorizeCredentials(
      { email: 'desconhecido-mais-dois@innoprospect.local', password: 'senha-errada' },
      request(officeIp),
    );
    expect(blockedByIp).toBeNull();
    expect(logger.warn).toHaveBeenLastCalledWith(
      'auth.login.falhou',
      expect.objectContaining({ motivo: 'limite_de_tentativas', eixoEstourado: 'ip' }),
    );
  });

  it('login bem-sucedido reseta o contador de FALHAS daquele e-mail', async () => {
    const { authorizeCredentials, LOGIN_RATE_LIMIT_MAX_PER_EMAIL } = await import('./auth');
    const { logger } = await import('./logger');

    // (limite - 1) falhas do mesmo e-mail, cada uma de um IP diferente (o
    // eixo de IP não deve interferir neste teste).
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_PER_EMAIL - 1; i += 1) {
      await authorizeCredentials(
        { email: 'vendedor@innoprospect.local', password: 'senha-errada' },
        request(`198.51.100.${i}`),
      );
    }

    // Login correto do mesmo e-mail — deveria zerar a cota dele.
    const success = await authorizeCredentials(
      { email: 'vendedor@innoprospect.local', password: REAL_PASSWORD },
      request('198.51.100.50'),
    );
    expect(success).not.toBeNull();

    // Mais (limite - 1) falhas do MESMO e-mail: se a cota não tivesse sido
    // zerada pelo sucesso, isto já teria estourado (ex.: 4 + 4 = 8 > 5). Como
    // foi zerada, a última ainda é rejeitada por SENHA ERRADA, não por limite.
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_PER_EMAIL - 1; i += 1) {
      await authorizeCredentials(
        { email: 'vendedor@innoprospect.local', password: 'senha-errada' },
        request(`198.51.100.${100 + i}`),
      );
    }
    expect(logger.warn).toHaveBeenLastCalledWith('auth.login.falhou', expect.objectContaining({ motivo: 'senha_incorreta' }));
  });
});
