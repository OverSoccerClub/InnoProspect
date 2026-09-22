---
name: convention-test-session-cookie
description: Como gerar um cookie de sessão Auth.js v5 localmente para testar telas logadas do InnoProspect sem tocar em código de autenticação e sem precisar do Postgres rodando
metadata:
  type: feedback
---

**Regra:** pra tirar screenshot/testar uma tela atrás do `middleware.ts`
sem um fluxo de login real disponível (Postgres não roda nesta máquina, ver
[[project-innoprospect]]), gerar o JWT de sessão direto com
`next-auth/jwt`'s `encode()`, nunca editando `lib/auth*.ts` ou
`middleware.ts`. Passos que funcionaram (2026-09-22):

1. Subir `next dev` com um `NEXTAUTH_SECRET`/`AUTH_SECRET` EFÊMERO passado
   como variável de ambiente do processo (nunca escrito em `.env.local`).
2. Um script `.mjs` chama `encode({ token: { uid, role, name, email, sub },
   secret, salt: 'authjs.session-token' })` — `salt` tem que ser o nome do
   cookie (é usado na derivação HKDF da chave, ver
   `node_modules/@auth/core/jwt.js`). O script SÓ roda se estiver dentro de
   `apps/web/` (resolução de módulo ESM usa a localização do arquivo, não o
   cwd) — copiar pra lá temporariamente, rodar, apagar depois (nunca commitar).
3. No Playwright, `context.addCookies([{ name: 'authjs.session-token',
   value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite:
   'Lax' }])` antes de navegar — isso passa o `middleware.ts` (que só
   decodifica o JWT, sem tocar no Postgres, `session: { strategy: 'jwt' }`
   em `auth.config.ts`).
4. **Pegadinha adicional se `NEXT_PUBLIC_USE_MOCKS=true`:**
   `components/auth/auth-guard.tsx` é um gate client-side SEPARADO do
   middleware — só olha o cookie `inno_mock_session` (não o cookie real de
   sessão) quando mocks estão ligados. Sem esse segundo cookie, o AuthGuard
   redireciona pro `/login` mesmo com sessão real válida, e como o
   middleware por sua vez redireciona `/login` autenticado de volta pro
   painel, dá a impressão de tela travada num spinner infinito (é na
   verdade um loop client↔middleware). Setar os DOIS cookies resolve.

**Por quê:** é o único jeito de verificar visualmente uma tela logada real
(não mock) nesta máquina sem Postgres/Redis — e a instrução do dono é
explícita: gerar cookie via script de teste é permitido, editar código de
autenticação para facilitar teste não é. Ver também
[[bug-dev-csp-blocks-hydration]] (mesma sessão de testes) — combinar
`bypassCSP: true` com esse cookie é o que permite testar interação real
(abrir `ConfirmDialog`, clicar em confirmar) em telas atrás de login.
