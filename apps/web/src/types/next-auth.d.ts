// Augmentação de tipos do Auth.js — carimba `id`/`role` (UserRole do Prisma:
// 'admin' | 'operator') no `session.user` e no JWT. Ver lib/auth.ts.
import type { DefaultSession } from 'next-auth';
import type { UserRole } from '@inno/db';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession['user'];
  }

  interface User {
    role: UserRole;
  }
}

// `next-auth/jwt` só faz `export * from "@auth/core/jwt"` — augmentar
// `next-auth/jwt` diretamente não funde de verdade com o tipo usado pelos
// callbacks (testado: sem isso, `token.uid`/`token.role` tipam como
// `unknown` via o `Record<string, unknown>` que `JWT` estende). Augmentar o
// módulo de origem funciona.
declare module '@auth/core/jwt' {
  interface JWT {
    uid: string;
    role: UserRole;
  }
}
