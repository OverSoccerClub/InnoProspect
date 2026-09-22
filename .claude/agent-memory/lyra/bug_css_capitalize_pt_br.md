---
name: bug-css-capitalize-pt-br
description: A classe Tailwind `capitalize` (text-transform CSS) maiusculiza a primeira letra de CADA palavra — errado para frases em português (só a 1ª letra da frase deveria maiusculizar)
metadata:
  type: feedback
---

**Bug real (painel, `components/dashboard/summary-hero.tsx`, 2026-09-22):**
`Intl.DateTimeFormat('pt-BR', { weekday: 'long', ... }).format(new Date())`
devolve `"terça-feira, 22 de setembro"` (minúsculo, correto em pt-BR). Eu
apliquei a classe `capitalize` pra maiusculizar a primeira letra e o
resultado renderizado foi `"Terça-Feira, 22 De Setembro"` — CSS
`text-transform: capitalize` maiusculiza APÓS todo espaço/hífen, não só o
início da string. Só vi o bug numa screenshot real (skill
`medir-antes-de-afirmar`); lendo o JSX parecia óbvio que funcionaria.

**Como aplicar:** nunca usar `capitalize` (Tailwind ou CSS puro) para
maiusculizar só a 1ª letra de uma frase/label em português (ou qualquer
idioma onde só a primeira palavra deveria maiusculizar). Fazer em JS:
`str.charAt(0).toUpperCase() + str.slice(1)`. `capitalize` só serve pra
título-em-cada-palavra de verdade (ex.: nome próprio composto), não para
data por extenso, frase corrida ou label de UI.
