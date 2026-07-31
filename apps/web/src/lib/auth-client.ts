import { USE_MOCKS } from '@/lib/config';
import { ApiRequestError } from '@/lib/fetcher';
import { mockDelay } from '@/mocks/utils';

export type LoginInput = { email: string; password: string };
export type LoginResult = { ok: true } | { ok: false; message: string };

const MOCK_SESSION_COOKIE = 'inno_mock_session';

/**
 * Cliente de login. Hoje fala só com o mock local — a Fase 1 não inclui o
 * fluxo real de Auth.js (ARQUITETURA.md §1.4, `lib/auth.ts`), que é do Vega
 * (hash de senha, Prisma Adapter, cookie httpOnly). Quando isso existir,
 * troque o corpo por `signIn('credentials', input)` do next-auth/react.
 */
export async function login({ email, password }: LoginInput): Promise<LoginResult> {
  if (USE_MOCKS) {
    await mockDelay(500);
    if (!email.includes('@')) {
      return { ok: false, message: 'Informe um e-mail válido.' };
    }
    if (password.length < 4) {
      return { ok: false, message: 'E-mail ou senha incorretos.' };
    }
    if (typeof document !== 'undefined') {
      document.cookie = `${MOCK_SESSION_COOKIE}=1; path=/; max-age=86400`;
    }
    return { ok: true };
  }

  try {
    // TODO(Vega): apontar para o endpoint real de credenciais do Auth.js
    // quando `apps/web/src/app/api/auth/[...nextauth]/route.ts` existir.
    await fetch('/api/auth/callback/credentials', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiRequestError) return { ok: false, message: err.message };
    return { ok: false, message: 'Não foi possível entrar. Tente novamente.' };
  }
}

export function hasMockSession(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c.startsWith(`${MOCK_SESSION_COOKIE}=`));
}

export function mockLogout(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${MOCK_SESSION_COOKIE}=; path=/; max-age=0`;
}
