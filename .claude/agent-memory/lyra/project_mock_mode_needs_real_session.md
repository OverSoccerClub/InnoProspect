---
name: project-mock-mode-needs-real-session
description: Em NEXT_PUBLIC_USE_MOCKS=true, o fluxo de login "de verdade" (clicar Entrar na UI) nunca chega ao dashboard nesta build — middleware.ts sempre exige sessão Auth.js real, e login() em modo mock só seta o cookie inno_mock_session
metadata:
  type: project
---

**Descoberto ao testar a Onda 1 (2026-09-22):** tentei confirmar visualmente
o fallback "sem sessão" do `UserMenu` novo navegando pra `/painel` só com o
cookie `inno_mock_session` (sem `authjs.session-token`) — o servidor
devolveu **redirect pro `/login`**, não a página. Não é bug do meu código:
`middleware.ts` roda em TODA rota fora de `/login`/`/descadastro`/`/api/*`
públicas e exige `req.auth?.user` (sessão Auth.js real decodificada do JWT),
**independente** de `NEXT_PUBLIC_USE_MOCKS`. `lib/auth-client.ts#login()` em
modo mock só seta o cookie `inno_mock_session` (gate client-side do
`AuthGuard`) — nunca cria uma sessão Auth.js de verdade. Resultado prático:
**mesmo um usuário clicando "Entrar" na UI em modo mock, preenchendo
qualquer e-mail/senha válidos, é jogado de volta pro `/login` pelo
middleware** depois do `router.push('/painel')` — o fluxo de demo "sem
Postgres" só funciona de verdade se alguém também injetar um cookie de
sessão Auth.js real por fora (é exatamente o que
[[convention-test-session-cookie]] descreve, e o que o Atlas já preparava
com `mint-session.mjs` antes de eu pedir).

**Por quê isso importa:** não é uma regressão desta rodada (não toquei em
`middleware.ts` nem no core de `login()`) — é uma lacuna arquitetural
pré-existente entre o modo mock (pensado pra rodar sem backend) e o
middleware (que sempre fala com Auth.js). Não afeta produção (lá a sessão é
sempre real). Afeta só quem tenta validar o fluxo de login ponta-a-ponta
localmente sem Postgres.

**Como aplicar:** para testar visualmente qualquer tela atrás do login
nesta máquina, sempre gerar o cookie de sessão real via
[[convention-test-session-cookie]] — nunca assumir que só o cookie mock
basta pra "entrar" na aplicação, mesmo que o próprio `AuthGuard` sugira que
sim. Se algum dia isso for reportado como "bug: login não funciona em modo
mock", a causa raiz é esta, não algo na tela de login.
