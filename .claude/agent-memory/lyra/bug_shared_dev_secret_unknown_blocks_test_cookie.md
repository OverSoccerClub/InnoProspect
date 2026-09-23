---
name: bug-shared-dev-secret-unknown-blocks-test-cookie
description: Mintar cookie de sessão de teste (convention-test-session-cookie) falha silenciosamente (redireciona pro /login) quando o NEXTAUTH_SECRET do next dev compartilhado mudou desde a última vez que foi anotado
metadata:
  type: feedback
---

**O que aconteceu (2026-09-23):** segui [[convention-test-session-cookie]] pra
testar `/configuracoes/usuarios` atrás de login sem Postgres — mintei um JWT
com `secret: 'innoprospect-shared-dev-secret'` (o valor efêmero anotado numa
rodada anterior, 2026-09-22). O `next dev` compartilhado (porta 3000) estava
de pé, mas com um `NEXTAUTH_SECRET` DIFERENTE (provavelmente reiniciado por
outra sessão/pessoa desde então) — o cookie decodifica com assinatura
inválida, o middleware trata como "sem sessão" e manda pro `/login`. O
sintoma (`page.title()` volta "Entrar — InnoProspect") é indistinguível de
"esqueci de setar o cookie" — só percebi comparando com o resultado esperado.

**Por quê isso importa:** não existe hoje um jeito de LER o `NEXTAUTH_SECRET`
de um processo `next dev` já rodando sem ter sido eu quem o iniciou (não é um
`.env.local` — é passado como env var efêmera do processo que o lançou,
por decisão deliberada de nunca escrever segredo de auth em arquivo). Sem
esse valor, mintar cookie de teste é impossível, e a única alternativa segura
é NÃO subir um `next dev` próprio (proibido, ver
[[bug-shared-next-dev-cache-conflict]]).

**Como aplicar:** antes de gastar tempo mintando cookie de teste, confirmar
com quem subiu o `next dev` compartilhado (Atlas/dono) qual é o
`NEXTAUTH_SECRET` da sessão atual, ou pedir pra ele anotar esse valor em
algum lugar efêmero (nunca `.env.local`, nunca commitado) acessível à equipe
enquanto aquele processo estiver de pé. Se não for possível obter o valor,
reportar como bloqueio explícito no handoff em vez de simular sucesso —
não forjar "testei e passou" sem confirmação visual real.
