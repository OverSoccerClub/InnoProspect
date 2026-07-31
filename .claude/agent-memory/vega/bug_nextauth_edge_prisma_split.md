---
name: bug-nextauth-edge-prisma-split
description: next build falha com erros node:fs/node:child_process ao usar Auth.js v5 + Prisma no middleware.ts — causa raiz e correção
metadata:
  type: feedback
---

**Sintoma:** `pnpm --filter web run build` falhava com `UnhandledSchemeError: Reading from
"node:child_process"/"node:fs"/"node:crypto"/"node:os" is not handled by plugins`, apontando pro
runtime gerado do Prisma Client (`packages/db/src/generated/client/runtime/library.js`), importado
através de `./src/lib/auth.ts`. Não aparecia no `tsc --noEmit` nem no `next dev` — só no `next build`.

**Causa raiz:** `middleware.ts` roda em **Edge Runtime** por padrão no Next.js (não Node). Eu tinha um
único `lib/auth.ts` com a config completa do Auth.js v5 (Credentials + `bcryptjs` + `@inno/db`/Prisma)
e o `middleware.ts` importava `auth` de lá — o webpack tentou empacotar o runtime do Prisma Client
(que usa `node:fs`, `node:child_process` etc. pra achar/rodar o binário da query engine) pro bundle do
Edge, que não suporta APIs Node nativas.

**Correção:** split de config, padrão oficial do Auth.js v5
(https://authjs.dev/guides/edge-compatibility):
- `lib/auth.config.ts` — `NextAuthConfig` Edge-safe: `secret`, `session`, `pages`, `callbacks.jwt`/
  `callbacks.session` (só copiam campo, sem I/O), `providers: []`. Só `import type` de `@inno/db`
  (erasado em build, não gera import de runtime).
- `lib/auth.ts` — config completa (Node): `{...authConfig, providers: [Credentials(...)]}`, com
  `bcryptjs` + `prisma`. Usada só por `app/api/auth/[...nextauth]/route.ts` e por rotas
  `/api/v1/*` (Route Handlers rodam em Node runtime por padrão, diferente de middleware).
- `middleware.ts` — `const { auth } = NextAuth(authConfig)` (importa `auth.config.ts`, NUNCA
  `auth.ts`).

**Como aplicar:** qualquer app Next.js deste projeto (ou outro) que use Auth.js v5 + Prisma/bcrypt +
`middleware.ts` DEVE manter esse split. Nunca importar `lib/auth.ts` (a config completa) de dentro de
`middleware.ts`. Se o middleware precisar de mais lógica de authz (roles, etc.), colocar em
`auth.config.ts` (callbacks), não migrar Prisma pra lá.

Bug relacionado descoberto no mesmo lugar: augmentar `declare module 'next-auth/jwt'` (em
`types/next-auth.d.ts`) NÃO funde de verdade com o tipo usado pelos callbacks — `next-auth/jwt` só faz
`export * from "@auth/core/jwt"` (re-export), então a fusão de interface precisa mirar o módulo de
ORIGEM: `declare module '@auth/core/jwt' { interface JWT {...} } }`. Mesmo assim, em alguns pontos
(`session.user.id = token.uid`) o campo ainda tipava como `unknown` (a interface `JWT` upstream
estende `Record<string, unknown>`) — resolvido com cast explícito (`token.uid as string`) em vez de
insistir na inferência. Ver `lib/auth.ts`/`lib/auth.config.ts` pros comentários completos.

Relacionado: [[project-innoprospect]], [[convention-api-routes-fase1]].
