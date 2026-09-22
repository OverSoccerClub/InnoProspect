---
name: convention-login-rate-limit
description: Rate limit de tentativas de login (lib/auth.ts) — conta só FALHA, sucesso reseta e-mail mas não IP; padrão peek/increment/reset em lib/rate-limit.ts
metadata:
  type: project
---

Entregue na Onda 2 (2026-09-22) — pendência do Órion desde a Fase 1 ("login público não limita
tentativas"). Duas iterações: a primeira versão contava TODA tentativa (inclusive sucesso), o Atlas
pegou isso na revisão antes de eu fechar a tarefa — registro a causa raiz aqui porque é o tipo de erro
fácil de repetir num rate limit de login futuro (2FA, reset de senha, etc.).

**Causa raiz do primeiro design errado:** rate limit existe pra barrar ADIVINHAÇÃO de senha, então só
FALHA deveria custar cota. Reusar `checkRateLimit` (que sempre incrementa) tanto pra decidir quanto pra
contar mistura as duas coisas — o efeito é que login CORRETO também gasta cota. Num produto vendido pra
equipes (IP compartilhado atrás do mesmo NAT/proxy corporativo é o caso COMUM, não a exceção), isso
trava todo o escritório quando a 21ª pessoa loga certo de manhã.

**Padrão correto (3 primitivas em `lib/rate-limit.ts`, `checkRateLimit` original INTOCADO — outro Vega
já importa a assinatura dele):**
- `peekRateLimit(key, max)` — só LÊ, nunca cria/incrementa bucket. Usado ANTES de tentar a credencial:
  se `!peek.allowed` em e-mail OU IP, recusa (`null`, log `motivo: 'limite_de_tentativas'`) sem nem
  consultar o Prisma.
- `checkRateLimit(key, windowMs, max)` (já existia) — chamado SÓ nos dois ramos de FALHA de
  `authorizeCredentials` (usuário não encontrado / senha incorreta), para os DOIS eixos (e-mail e IP)
  incondicionalmente — mesmo raciocínio de antes: um atacante trocando de e-mail a cada tentativa não
  pode "resetar" o custo do eixo de IP.
- `resetRateLimit(key)` — chamado SÓ no sucesso, e SÓ na chave de e-mail (`login:email:${email}`).
  IP NUNCA reseta — um atacante que acerta uma conta não pode usar isso pra resetar a varredura de
  outras contas a partir do mesmo IP.

Fluxo em `authorizeCredentials` (`apps/web/src/lib/auth.ts`): parse email/senha → `peekRateLimit` nos
dois eixos (recusa se estourado) → busca `User` → falha (`!user` ou senha errada) → `checkRateLimit`
nos dois eixos → sucesso → `resetRateLimit` só do e-mail → retorna o user.

**Limites:** 5 FALHAS/e-mail e 20 FALHAS/IP por 15 min (`LOGIN_RATE_LIMIT_*` exportadas de `auth.ts`,
documentadas também em `.env.example` mesmo não sendo lidas de env — são constantes no código). Mesma
limitação de "em memória, por processo" já documentada em `lib/rate-limit.ts` (1 réplica hoje no
EasyPanel).

**`authorizeCredentials` foi extraída do `Credentials({...})` como função exportada** justamente pra
ser testável sem montar o `NextAuth(...)` inteiro. Ver [[bug-nextauth-vitest-server-import]] pro motivo
de não dar pra importar `next-auth`/`Credentials` de verdade num teste Vitest+node.

Ver também [[bug-nextauth-vitest-server-import]] e [[project-innoprospect]].
