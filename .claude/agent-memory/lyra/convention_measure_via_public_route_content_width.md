---
name: convention-measure-via-public-route-content-width
description: Como medir a geometria de um componente novo do dashboard sem precisar de cookie de sessão — injetar markup com as classes reais na rota pública /login, mas calculando a largura de conteúdo REAL (viewport menos sidebar/padding), não o viewport bruto
metadata:
  type: feedback
---

**Regra:** pra medir overflow de um componente que vai morar dentro do shell
autenticado (`app/(dashboard)/layout.tsx`), sem gerar cookie de sessão
([[convention-test-session-cookie]] funciona mas exige acertar o
`NEXTAUTH_SECRET` exato do `next dev` compartilhado, que eu não controlo):
navegar até `/login` (pública, sem `AuthGuard`) e injetar via
`page.evaluate` um `<div>` com as classes Tailwind EXATAS do componente —
a folha global carrega em qualquer rota, então o CSS medido é o CSS real da
build. Zero necessidade de auth pra validar geometria pura.

**Pegadinha que corrigi antes de reportar:** medir isso no VIEWPORT bruto
(768px/1280px) SUPERESTIMA a largura disponível — o shell tira sidebar
(`w-64`=256px, `hidden md:flex`, ou seja só aparece a partir de 768px, que é
justamente onde este teste mede) + padding do `<main>`
(`p-4 md:p-6 lg:p-8`) + padding do `Card` que envolve o filtro (`p-6`=24px
cada lado). A largura de conteúdo REAL que um componente dentro de
`/leads` vê é `viewport − 256 − padding do main − 48` — bem menor que o
viewport inteiro:
- 768px de viewport → **416px** de conteúdo real (256 sidebar + 48 padding
  main `md:p-6` + 48 padding card).
- 1280px de viewport → **912px** de conteúdo real (256 sidebar + 64 padding
  main `lg:p-8` + 48 padding card).

Testar no viewport bruto teria escondido um overflow real: no caso da barra
de filtros de `/leads` (13 filtros), a diferença decidiu se a linha principal
ficava em `flex-row` (viewport bruto de 768px, > breakpoint `sm`=640px) ou em
`flex-col` (416px real, < 640px) — os dois passam sem overflow, mas são
LAYOUTS diferentes; reportar o errado como "testado" seria uma afirmação
falsa sobre o que o operador realmente vê.

**Como aplicar:** ao medir qualquer componente novo do dashboard sem sessão à
mão, usar `chromium.launch({ executablePath: <chrome/edge do sistema> })`
via `playwright-core` (sem precisar baixar Chromium — usa o navegador já
instalado na máquina), abrir `/login`, e setar o viewport para a largura de
CONTEÚDO calculada acima (não o viewport nominal do requisito) antes de ler
`scrollWidth`/`clientWidth`/`getComputedStyle`. Se o padding do shell mudar
(`app/(dashboard)/layout.tsx`), recalcular os dois números.
