/**
 * lib/auth.config.ts — parte "Edge-safe" da config do Auth.js v5, sem
 * `Credentials`/`bcryptjs`/`@inno/db` (Prisma Client usa `node:fs`,
 * `node:child_process` etc., que não existem no Edge Runtime).
 *
 * `middleware.ts` roda em Edge Runtime por padrão no Next.js — se ele
 * importasse `lib/auth.ts` (a config completa) o build do webpack falha
 * tentando empacotar o runtime do Prisma para o Edge (`node:` scheme não
 * suportado lá). Padrão oficial do Auth.js v5 para este caso ("split
 * config"): https://authjs.dev/guides/edge-compatibility — um `NextAuthConfig`
 * comum com os `callbacks`/`pages`, e cada lado (`middleware.ts` vs.
 * `lib/auth.ts`) monta seu próprio `NextAuth(...)`, o full acrescentando o
 * provider de verdade.
 */
import type { NextAuthConfig } from 'next-auth';
import type { UserRole } from '@inno/db';

export const authConfig: NextAuthConfig = {
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  // Vazio de propósito aqui — o middleware só precisa LER a sessão (decodificar
  // o JWT do cookie), nunca autenticar. `lib/auth.ts` (Node runtime) adiciona
  // o `Credentials` de verdade por cima desta config.
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
  },
};
