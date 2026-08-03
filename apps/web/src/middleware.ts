/**
 * middleware.ts — proteção REAL de sessão (Auth.js v5), ARQUITETURA §1.4.
 * Substitui o `AuthGuard` client-side da Lyra (que só olha um cookie mock e
 * não bloqueia nada quando `USE_MOCKS=false`) como a barreira de verdade:
 *
 *   - Páginas do dashboard (tudo fora de `/login`, `/descadastro/*` e
 *     `/api/*`): sem sessão → redirect para `/login`.
 *   - `/api/v1/*` (exceto `/api/v1/health`, usado por healthcheck de infra
 *     sem cookie): sem sessão → `401` no envelope de erro padrão (§4.0),
 *     mesmo formato que `lib/api-handler.ts` devolve nas rotas — o
 *     `fetcher.ts` da Lyra já sabe interpretar isso via `ApiRequestError`.
 *   - `/api/auth/*` (o próprio NextAuth) e `/api/webhooks/*` (Evolution API,
 *     Fase 3 — autenticado por outro mecanismo, `apikey` + `instanceKey`,
 *     não por cookie de sessão) ficam de fora da checagem.
 *   - `/api/v1/public/*` (Fase 3, ARQUITETURA §4.7: `POST
 *     /api/v1/public/optout`) também fica de fora — é o endpoint que a
 *     página pública `/descadastro/:token` consome, sem sessão por desenho
 *     (link enviado por WhatsApp para quem nem tem conta no sistema).
 *     Autenticado por token HMAC no corpo, não por cookie — ver
 *     `lib/services/optouts.ts#publicOptOut`.
 *
 * ⚠️ Importa `auth.config.ts` (Edge-safe), NÃO `lib/auth.ts` — o Middleware
 * roda em Edge Runtime por padrão, e `lib/auth.ts` carrega `bcryptjs` +
 * Prisma Client (`@inno/db`), que dependem de APIs Node (`node:fs`,
 * `node:child_process`) inexistentes no Edge. Ver o comentário completo em
 * `lib/auth.config.ts`.
 */
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth.config';

const { auth } = NextAuth(authConfig);

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/descadastro',
  '/api/auth',
  '/api/webhooks',
  '/api/v1/health',
  '/api/v1/public',
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = Boolean(req.auth?.user);
  const isPublic = PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (pathname === '/login') {
    if (isAuthed) return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  }

  if (isPublic) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    if (isAuthed) return NextResponse.next();
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sessão inválida ou expirada. Faça login novamente.',
          requestId: crypto.randomUUID(),
        },
      },
      { status: 401 },
    );
  }

  // Página do dashboard fora de /login sem sessão → manda pro login.
  if (!isAuthed) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
