---
name: bug-nextauth-vitest-server-import
description: Importar lib/auth.ts (que chama NextAuth(...)) direto num teste Vitest quebra — next-auth importa next/server internamente
metadata:
  type: project
---

**Sintoma:** `await import('./auth')` num arquivo de teste Vitest (`environment: 'node'`) falha com
`Cannot find module '.../node_modules/next/server' imported from .../next-auth/lib/env.js`.

**Causa raiz:** `next-auth` v5 beta importa `next/server` internamente (usado pra ler headers/cookies
no ambiente do Next.js). Essa resolução de módulo só funciha dentro do bundler do Next.js (webpack/
turbopack) — em Node puro via Vitest, o `next/server` real não é resolvível daquele jeito. Isto é
ortogonal a QUALQUER lógica de negócio dentro de `lib/auth.ts` — quebra só de IMPORTAR o módulo, mesmo
que o teste nem chame `auth`/`handlers`.

**Correção:** dois passos, os dois necessários:
1. Extrair a lógica que precisa ser testada (`authorize`) pra uma função exportada separadamente
   (`authorizeCredentials`), com a MESMA assinatura que o Auth.js exige (`credentials`, `request:
   Request`) — e passar essa função de referência pro `Credentials({ authorize: authorizeCredentials
   })`, em vez de uma arrow function inline. Isso permite importar e chamar a função direto no teste.
2. No arquivo de teste, `vi.mock('next-auth', ...)` e `vi.mock('next-auth/providers/credentials', ...)`
   com stubs triviais (`NextAuth` mockado devolve `{ handlers: {}, auth: vi.fn(), ... }`; `Credentials`
   mockado só devolve o `config` recebido) — isso evita que o MÓDULO `auth.ts` puxe o `next-auth` de
   verdade ao ser importado, sem precisar testar `NextAuth(...)`/`Credentials(...)` em si (eles não têm
   lógica nossa dentro).

Ver `apps/web/src/lib/auth.test.ts` pro padrão pronto (os dois `vi.mock` no topo do arquivo, antes de
qualquer `import`).

**Como evitar de novo:** qualquer arquivo `apps/web/src/lib/*.ts` que chame `NextAuth(...)` (hoje só
`lib/auth.ts`) precisa deste padrão se for testado — extrair a lógica testável pra uma função nomeada
exportada, nunca uma arrow function inline dentro do objeto de config, e mockar `next-auth`/
`next-auth/providers/*` no teste em vez de tentar importar de verdade.

Ver também [[convention-login-rate-limit]] e [[bug-nextauth-edge-prisma-split]] (outro gotcha do
Auth.js v5 nesta base, mas de build, não de teste).
