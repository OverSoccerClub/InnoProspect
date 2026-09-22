---
name: bug-dev-csp-blocks-hydration
description: A CSP de produção do InnoProspect (sem 'unsafe-eval') quebra a hidratação client-side inteira quando testada com `next dev` num navegador real — todo componente 'use client' fica preso no estado pré-mount
metadata:
  type: feedback
---

**Achado (2026-09-22, rodada "layout premium"):** ao testar a landing/painel
com Playwright num navegador de verdade pela primeira vez (skill
`medir-antes-de-afirmar`), o `ThemeToggle` nunca saía do estado pré-mount
(ícone com `opacity-0`, `aria-label="Alternar tema"` preso no fallback) mesmo
1s+ depois do `networkidle`. Causa raiz: `next.config.ts` define
`script-src 'self' 'unsafe-inline'` (sem `'unsafe-eval'`) pra TODAS as rotas,
inclusive em dev. O devtool padrão do webpack em `next dev` (sem
`--turbopack`, ver `apps/web/package.json`) empacota cada módulo com
`eval()` — a CSP bloqueia esse `eval()`, um `pageerror` real aparece no
console ("Evaluating a string as JavaScript violates... 'unsafe-eval'"), e a
hidratação de QUALQUER Client Component nunca completa. Server Components
continuam renderizando normal (é só HTML), então a página parece "quase
certa" até alguém clicar em algo interativo.

**Por quê isso não é bug do meu código nem da CSP em si:** em produção
(`next build`), o devtool não usa `eval()`, então esse problema não deveria
existir lá — é uma fricção específica de testar `next dev` com essa CSP
ativa, não uma falha da CSP de produção. Não tentei consertar (`next.config.ts`
é território fora do meu escopo) — só reportei como achado no handoff.

**Como aplicar:** ao testar QUALQUER interação client-side deste projeto
via Playwright contra `next dev` (clique, toggle, dialog, formulário),
passar `bypassCSP: true` no `browser.newContext(...)` — só no harness de
teste, nunca em código do app. Sem isso, todo teste de interatividade contra
`next dev` vai "falhar" silenciosamente (elemento nunca aparece/responde) e
o instinto errado é achar que o componente tem bug, quando na verdade é o
ambiente de teste que está bloqueado. Ver [[project-innoprospect]] para o
contexto completo da rodada.
