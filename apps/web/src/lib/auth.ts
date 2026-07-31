/**
 * lib/auth.ts — Auth.js v5 (NextAuth) com Credentials + bcrypt contra
 * `User` (ARQUITETURA §1.4, decisão A3). Config completa (Node runtime) —
 * é a que o `[...nextauth]/route.ts` e as rotas `/api/v1/*` usam. `callbacks`
 * de sessão/JWT vivem em `auth.config.ts` (compartilhados com o
 * `middleware.ts` Edge-safe) para não duplicar; aqui só entra o que exige
 * Node (`Credentials`, `bcryptjs`, `@inno/db`/Prisma).
 *
 * Hardening adicional (rate limit de login por IP, `argon2` em vez de
 * `bcrypt`, cookie policy fina) é explicitamente escopo do Órion na Fase 5
 * (ARQUITETURA §1.4: "Órion valida o hardening... na Fase 5") — aqui só a
 * mitigação de timing attack mais barata (comparar contra um hash dummy
 * quando o e-mail não existe, para não revelar por tempo de resposta se a
 * conta existe).
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@inno/db';
import { authConfig } from './auth.config';

// Hash bcrypt de uma senha aleatória fixa — nunca corresponde a senha real,
// só existe para gastar o mesmo tempo de CPU que um bcrypt.compare de
// verdade quando o e-mail informado não existe.
const DUMMY_PASSWORD_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeOxRD1kU4v1sJQFsBUn5EYidoRDdgFV4a';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'E-mail', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
});
