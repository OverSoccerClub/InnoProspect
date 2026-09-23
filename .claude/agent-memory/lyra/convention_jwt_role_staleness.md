---
name: convention-jwt-role-staleness
description: Auth.js com strategy jwt não atualiza claims (role/isActive) de uma sessão já emitida — vale para qualquer campo que afete autorização, não só isActive
metadata:
  type: project
---

`lib/auth.config.ts#callbacks.jwt` só carimba `token.uid`/`token.role` quando
`user` está presente — e isso só acontece no login inicial (Auth.js só passa
`user` nesse momento). Em toda requisição seguinte, o callback recebe
`token` sem `user` e devolve o token JÁ EMITIDO sem reconsultar o banco.
`session: { strategy: 'jwt' }` (`auth.config.ts`) não tem storage
server-side pra revogar/atualizar um token no meio do caminho.

Vega já tinha documentado isso pra `isActive` (`lib/auth.ts#authorizeCredentials`,
comentário "LIMITAÇÃO CONHECIDA"): desativar alguém não derruba a sessão já
aberta, só impede um NOVO login. Confirmei lendo o mesmo callback que **o
idêntico vale para `role`**: rebaixar um admin para operador não retira o
acesso de admin de uma sessão já aberta — o JWT continua com `role: 'admin'`
até expirar ou a pessoa entrar de novo. Usei isso pra escrever o aviso na
tela de edição de usuário (`components/users/user-form-dialog.tsx`), mesma
frase/tom do comentário do Vega.

**Por quê:** é o tipo de comportamento que parece um bug ("rebaixei/desativei
e a pessoa continua entrando") mas é esperado dado `strategy: 'jwt'` sem
storage — documentar evita reabrir a investigação toda vez que um usuário
malicioso ou o dono perceber isso na prática.

**Como aplicar:** qualquer feature nova que dependa de UM CAMPO de
`session.user` pra autorizar algo (ex.: um futuro `permissions[]`,
`teamId`, feature flag por usuário) tem a MESMA armadilha — avisar na UI
onde a mudança é feita, nunca prometer efeito imediato numa sessão já
aberta. Ver também [[project-innoprospect]] (entrega de gestão de usuários,
2026-09-23).
