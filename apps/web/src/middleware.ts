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

  // Landing page pública (marketing, Fase "layout premium"). Checagem EXATA,
  // não um prefixo em PUBLIC_PATH_PREFIXES: a lista acima usa
  // `pathname.startsWith(prefix + '/')`, e '/' como prefixo bateria em
  // QUALQUER rota do sistema — bastaria alguém "simplificar" essa lista pra
  // tornar o painel inteiro público. `pathname === '/'` só libera a raiz.
  if (pathname === '/') {
    return NextResponse.next();
  }

  if (pathname === '/login') {
    if (isAuthed) return NextResponse.redirect(new URL('/painel', req.url));
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

/**
 * ⚠️ Rota de arquivo estático que não estiver NESTA lista é interceptada e,
 * sem sessão, vira 307 para `/login` — inclusive as rotas de metadado do App
 * Router, que o Next serve a partir de `app/` e não de `public/`.
 *
 * Foi o que aconteceu com o ícone do app (2026-09-22): `app/icon.svg` e
 * `app/apple-icon.png` existiam, o Next os servia em `/icon.svg` e
 * `/apple-icon.png`, e o middleware respondia 307 para os dois. O navegador
 * recebia a página de login no lugar da imagem, então a aba ficava sem ícone
 * e o log só mostrava um 404/307 de favicon — sintoma que não aponta para
 * este arquivo. `favicon.ico` já estava isento e por isso ninguém percebeu
 * antes: era o único ícone que o projeto não tinha.
 *
 * Ao acrescentar qualquer arquivo em `app/` que o navegador busca sozinho
 * (manifest, robots.txt, sitemap.xml, opengraph-image), inclua aqui E
 * confirme com `curl -D - http://localhost:3000/<arquivo>` que a resposta é
 * 200, não 307. São todos assets públicos de marca — nenhum dado de usuário
 * passa por eles.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png).*)'],
};
