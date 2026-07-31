import { signIn, signOut } from 'next-auth/react';

import { USE_MOCKS } from '@/lib/config';
import { mockDelay } from '@/mocks/utils';

export type LoginInput = { email: string; password: string };
export type LoginResult = { ok: true } | { ok: false; message: string };

const MOCK_SESSION_COOKIE = 'inno_mock_session';

/**
 * Cliente de login.
 *
 * Em produção usa `signIn('credentials')` do next-auth/react — e NÃO um POST
 * cru para `/api/auth/callback/credentials`. O Auth.js v5 exige um csrfToken
 * nesse POST; sem ele o login falha SEMPRE. O `signIn` busca o token e monta
 * a requisição sozinho. (Achado do Órion na auditoria pré-deploy: a versão
 * anterior deste arquivo fazia o fetch cru e, pior, devolvia `{ ok: true }`
 * sem nunca olhar o status da resposta — reportava sucesso em senha errada.)
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
    // `redirect: false` para tratarmos o erro na própria tela, em vez de o
    // Auth.js navegar para /api/auth/error e perder o formulário preenchido.
    const result = await signIn('credentials', { email, password, redirect: false });

    // Credencial inválida NÃO lança — volta em `result.error`. Tratar o
    // retorno é o que impede o bug antigo de dar "entrou" com senha errada.
    if (!result || result.error) {
      return { ok: false, message: 'E-mail ou senha incorretos.' };
    }
    return { ok: true };
  } catch {
    // Só cai aqui em falha de rede ou indisponibilidade do servidor de auth.
    return { ok: false, message: 'Não foi possível entrar. Tente novamente.' };
  }
}

export function hasMockSession(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c.startsWith(`${MOCK_SESSION_COOKIE}=`));
}

/**
 * Encerra a sessão. Em produção precisa ser o `signOut` do Auth.js: limpar o
 * cookie de mock não derruba a sessão real, e o usuário continuaria logado
 * depois de clicar em "Sair" (o middleware o mandaria de volta ao dashboard).
 */
export async function logout(): Promise<void> {
  if (USE_MOCKS) {
    if (typeof document === 'undefined') return;
    document.cookie = `${MOCK_SESSION_COOKIE}=; path=/; max-age=0`;
    return;
  }
  await signOut({ redirect: false });
}
