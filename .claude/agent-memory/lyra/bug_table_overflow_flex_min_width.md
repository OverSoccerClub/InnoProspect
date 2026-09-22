---
name: bug-table-overflow-flex-min-width
description: Tabela larga "corta coluna" mesmo com overflow-auto no wrapper — a causa raiz não estava na tabela, era o item flex do shell sem min-width:0, que deixa o min-content da tabela empurrar a página inteira
metadata:
  type: feedback
---

**O que aconteceu (Onda 2A, 2026-09-22):** `/leads` e `/templates` cortavam
coluna a 1440px e 1280px mesmo com `components/ui/table.tsx` já tendo um
wrapper `overflow-auto` em volta da `<table>`. Lendo o CSS isso parecia
suficiente — só a medição (`document.documentElement.scrollWidth` vs.
`clientWidth` via Playwright, ver skill `medir-antes-de-afirmar`) revelou que
a PÁGINA inteira estava 78-192px mais larga que a viewport, com barra de
rolagem horizontal no `<body>`. O wrapper `overflow-auto` da tabela nunca
chegava a agir porque a página já tinha estourado um nível acima.

**Causa raiz:** em `app/(dashboard)/layout.tsx`, a coluna direita do shell
(`<div className="flex min-h-screen flex-1 flex-col">`, item de um flex ROW
junto com a `Sidebar`) não tinha `min-width` explícito. Item flex sem
`min-width` usa o default `min-width: auto`, que o spec define como o
min-content da subárvore inteira — inclusive uma `<table>` com células
`whitespace-nowrap` bem lá no fundo do DOM. Isso forçava aquele item (e com
ele `<body>`/`<html>`) a crescer além da viewport. **`overflow-x-hidden` no
`<main>` (um descendente, não o próprio item flex) não impede isso** — esse
overflow só contém o conteúdo depois que a caixa do `<main>` já foi
dimensionada; não quebra a propagação do min-content para o ANCESTRAL flex.

**Correção:** uma linha, `min-w-0` na coluna do shell (junto com
`overflow-auto` no wrapper de `components/ui/table.tsx`, que já existia).
Confirmado com medição antes/depois: `PAGE_OVERFLOW` (scrollWidth −
clientWidth do `<html>`) caiu de 192px (1280px, `/leads`) e 78px (1280px,
`/templates`) para exatamente 0px nos dois, em 1440 e 1280.

**Como aplicar em qualquer layout futuro deste projeto:** todo item de um
flex/grid container que vá conter uma tabela, um `<pre>`, ou qualquer
conteúdo com `whitespace-nowrap`/min-content grande precisa de `min-w-0`
(ou `min-width: 0` explícito) no próprio item flex/grid — nunca confiar que
`overflow-hidden`/`overflow-auto` num DESCENDENTE resolve, porque a
propagação do min-content acontece ANTES do overflow do descendente entrar
em jogo. Sintoma característico para reconhecer isso rápido: medir
`document.documentElement.scrollWidth > document.documentElement.clientWidth`
com a página carregada — se for verdade, o culpado quase certo é um item
flex/grid sem `min-width:0` em algum ponto entre o `<body>` e o elemento
largo, não o componente que "parece" estar cortando.

**Complemento (descoberta):** mesmo depois do `overflow-auto` do wrapper
passar a funcionar de verdade, a barra de rolagem do sistema é fina/só-no-
hover em muitos SOs — fácil de não notar que "tem mais coluna pra esse lado".
Adicionei uma sombra de rolagem 100% CSS (`.inno-table-scroll`,
`app/globals.css`, técnica clássica de gradientes com
`background-attachment: local`/`scroll`) como reforço visual — ver
`components/ui/table.tsx`.
