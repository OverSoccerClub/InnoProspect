/**
 * lib/auth.ts — Auth.js v5 (NextAuth) com Credentials + bcrypt contra
 * `User` (ARQUITETURA §1.4, decisão A3). Config completa (Node runtime) —
 * é a que o `[...nextauth]/route.ts` e as rotas `/api/v1/*` usam. `callbacks`
 * de sessão/JWT vivem em `auth.config.ts` (compartilhados com o
 * `middleware.ts` Edge-safe) para não duplicar; aqui só entra o que exige
 * Node (`Credentials`, `bcryptjs`, `@inno/db`/Prisma).
 *
 * Hardening: mitigação de timing attack (comparar contra um hash dummy
 * quando o e-mail não existe, para não revelar por tempo de resposta se a
 * conta existe) + rate limit de tentativas de login por e-mail e por IP
 * (pendência do Órion desde a Fase 1 — login público sem limite nenhum).
 * `argon2` em vez de `bcrypt` e cookie policy fina continuam fora do escopo
 * desta rodada.
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@inno/db';
import { authConfig } from './auth.config';
import { logger } from './logger';
import { checkRateLimit, clientIpFromRequest, peekRateLimit, resetRateLimit } from './rate-limit';

// Hash bcrypt de uma senha aleatória fixa — nunca corresponde a senha real,
// só existe para gastar o mesmo tempo de CPU que um bcrypt.compare de
// verdade quando o e-mail informado não existe.
const DUMMY_PASSWORD_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeOxRD1kU4v1sJQFsBUn5EYidoRDdgFV4a';

// Limites de tentativa de login — dois eixos independentes, os dois via
// `lib/rate-limit.ts` (janela fixa, EM MEMÓRIA/por processo; ver a limitação
// documentada no topo daquele arquivo — 1 réplica hoje no EasyPanel, trocar
// por Redis se isso mudar):
//  - por E-MAIL: 5 tentativas / 15 min. É a conta que um ataque de
//    brute-force/credential-stuffing tenta diretamente — 5 cobre alguém
//    errando a senha de verdade (2-3 vezes é comum) sem abrir margem
//    relevante para varredura de dicionário contra UMA conta.
//  - por IP: 20 tentativas / 15 min. Mais folgado de propósito: um IP pode
//    ser um escritório inteiro atrás do mesmo NAT/proxy corporativo — não
//    queremos travar todo mundo por causa de uma pessoa errando a senha.
//    Ainda assim barra um script varrendo várias contas do mesmo IP.
//
// A cota só é gasta em FALHA (`checkRateLimit`, incrementa). Um login
// BEM-SUCEDIDO nunca incrementa (só `peekRateLimit`, que só lê) — sem isto,
// 20 pessoas de um mesmo escritório logando corretamente de manhã travariam
// a si mesmas por 15 minutos assim que a 21ª pessoa entrasse (achado do
// Atlas na revisão desta rodada: o produto é vendido para equipes, IPs
// compartilhados são o caso comum, não a exceção). Login bem-sucedido zera
// o contador daquele E-MAIL (`resetRateLimit`) — mas NUNCA o do IP: um
// atacante que acerta uma conta não pode usar isso para resetar a varredura
// de outras contas a partir do mesmo IP.
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX_PER_EMAIL = 5;
export const LOGIN_RATE_LIMIT_MAX_PER_IP = 20;

/**
 * Extraída do `Credentials({...})` para ser testável isoladamente (mesma
 * assinatura que o Auth.js v5 exige em `authorize`: `credentials` +
 * `request: Request`) sem precisar montar o `NextAuth(...)` inteiro em
 * teste. Ver `lib/auth.test.ts`.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<'email' | 'password', unknown>>,
  request: Request,
) {
  const email = typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : '';
  const password = typeof credentials?.password === 'string' ? credentials.password : '';
  if (!email || !password) return null;

  const ip = clientIpFromRequest(request);
  const emailKey = `login:email:${email}`;
  const ipKey = `login:ip:${ip}`;

  // Só CONSULTA (não gasta cota) — decide se a tentativa pode nem chegar a
  // olhar o banco. Se qualquer um dos dois eixos já estourou (de FALHAS
  // anteriores), recusa aqui, sem incrementar de novo.
  const emailPeek = peekRateLimit(emailKey, LOGIN_RATE_LIMIT_MAX_PER_EMAIL);
  const ipPeek = peekRateLimit(ipKey, LOGIN_RATE_LIMIT_MAX_PER_IP);

  if (!emailPeek.allowed || !ipPeek.allowed) {
    // Resposta ao navegador continua o `CredentialsSignin` genérico (`null`
    // abaixo) — igual a qualquer outro motivo de falha. NUNCA revelamos ao
    // cliente que o bloqueio é por limite de tentativas: isso é informação
    // útil de mais para quem está atacando (confirma que está perto de
    // acertar/que o e-mail existe/quanto falta esperar). Só no log do
    // servidor, mesmo padrão de `auth.login.falhou` que já existia.
    logger.warn('auth.login.falhou', {
      motivo: 'limite_de_tentativas',
      emailTentado: email,
      ip,
      eixoEstourado: !emailPeek.allowed ? 'email' : 'ip',
      dica: 'Rate limit de login (5 FALHAS/e-mail ou 20 FALHAS/IP por 15min) atingido — ver LOGIN_RATE_LIMIT_* em lib/auth.ts.',
    });
    return null;
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Diagnóstico NO LOG DO SERVIDOR apenas. A resposta ao navegador
  // continua sendo o `CredentialsSignin` genérico do Auth.js — quem está
  // do lado de fora não consegue descobrir quais contas existem.
  //
  // Por que isto existe: sem separar os dois casos, um login que falha é
  // indistinguível de "não rodei o seed", "errei o e-mail" e "errei a
  // senha". Isso custou várias rodadas de deploy às cegas. Nunca logamos
  // a senha nem o hash — só o e-mail tentado, que é o que permite ver na
  // hora um descasamento de maiúscula/minúscula ou de domínio.
  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    // Gasta cota nos DOIS eixos — mesmo que este e-mail específico esteja
    // longe do próprio limite, o eixo por IP precisa continuar contando
    // (é ele que pega um script varrendo e-mails diferentes do mesmo IP).
    checkRateLimit(emailKey, LOGIN_RATE_LIMIT_WINDOW_MS, LOGIN_RATE_LIMIT_MAX_PER_EMAIL);
    checkRateLimit(ipKey, LOGIN_RATE_LIMIT_WINDOW_MS, LOGIN_RATE_LIMIT_MAX_PER_IP);
    logger.warn('auth.login.falhou', {
      motivo: 'usuario_nao_encontrado',
      emailTentado: email,
      dica: 'Nenhum User com este e-mail. Rode o seed (RUN_SEED=true) ou confira o ADMIN_EMAIL.',
    });
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    checkRateLimit(emailKey, LOGIN_RATE_LIMIT_WINDOW_MS, LOGIN_RATE_LIMIT_MAX_PER_EMAIL);
    checkRateLimit(ipKey, LOGIN_RATE_LIMIT_WINDOW_MS, LOGIN_RATE_LIMIT_MAX_PER_IP);
    logger.warn('auth.login.falhou', {
      motivo: 'senha_incorreta',
      emailTentado: email,
      userId: user.id,
      dica: 'O usuário existe e a senha não confere. Para redefinir: ADMIN_PASSWORD + ADMIN_RESET_PASSWORD=true + RUN_SEED=true.',
    });
    return null;
  }

  // Sucesso: zera a cota deste E-MAIL (não a do IP, ver comentário acima dos
  // limites) — login correto não deveria continuar "gastando" a mesma cota
  // que suas próprias tentativas erradas anteriores já gastaram.
  resetRateLimit(emailKey);
  logger.info('auth.login.ok', { userId: user.id, role: user.role });
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'E-mail', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      authorize: authorizeCredentials,
    }),
  ],
});
