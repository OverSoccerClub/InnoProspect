---
name: convention_use_now_self_aging_relative_time
description: Como fazer texto relativo ("há 2 min") envelhecer sozinho na tela sem novo fetch — hook useNow + recalcular no render, nunca precomputar e guardar em state
metadata:
  type: convention
---

`formatRelative` (`lib/format.ts`) já existe e calcula contra `Date.now()` no
momento da CHAMADA — mas se o componente só chama essa função dentro de um
`.then()` de fetch e guarda o resultado PRONTO em `useState`, o texto fica
congelado no valor do render que buscou o dado. Se a pessoa deixar a aba
aberta, "há 2 min" nunca vira "há 40 min" — mente por omissão.

A correção (feita em `hooks/useNow.ts`, Fase de reconciliação de status
WhatsApp, 2026-09-24): um hook `useNow(intervalMs = 30_000)` que só devolve
`Date.now()` e se atualiza via `setInterval` — SEM buscar dado novo. Quem
precisa de texto relativo vivo:

1. Guarda os dados BRUTOS em state (não o texto já formatado).
2. Chama `useNow()` no componente.
3. Recalcula o texto/nível de frescor a cada render via função pura (`useMemo`
   se o cálculo não for trivial), passando `now` como parâmetro explícito —
   nunca lendo `Date.now()` direto dentro da função pura (isso é o que a torna
   testável sem mockar relógio de verdade).

Usado em `components/whatsapp/status-freshness.tsx` (recalcula a cada render)
e em `components/dashboard/system-health-card.tsx` (guarda `{health,
instances}` cru em state, e só o `useMemo(buildHealthRows(...), [source,
now])` depende de `now` — ver [[project_whatsapp_status_reconciliation_ui]]).

**Por que 30s de intervalo**: overhead insignificante (um `setInterval` por
componente montado, nenhuma rede) e granularidade de minutos é o que os
textos relativos mostram de qualquer forma — não precisa de nada mais fino.
