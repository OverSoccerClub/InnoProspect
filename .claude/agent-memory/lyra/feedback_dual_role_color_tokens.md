---
name: feedback-dual-role-color-tokens
description: Um único token de cor semântica não serve para "preenchimento sólido + texto branco" E "texto colorido sobre fundo quase-preto" ao mesmo tempo — mede os dois papéis separadamente, principalmente para hues vermelhas
metadata:
  type: feedback
---

**Regra:** ao definir uma cor semântica (destructive/success/warning/etc.) que vai
ser usada em dois papéis diferentes — (a) preenchimento sólido de badge/botão
com texto branco em cima, e (b) texto colorido direto sobre um fundo bem mais
escuro (ex.: alerta com `bg-{cor}/10` sobre um `background` dark quase-preto)
— **não assuma que um único valor de L (OKLCH) atende os dois papéis**. Meça
com um conversor OKLCH→sRGB + fórmula de contraste WCAG antes de fixar o
valor, não "no olho".

**Por quê:** descoberto na entrega de identidade visual do InnoProspect
(2026-08-03, ver [[project-innoprospect]]). Vermelho (`--destructive`, hue
≈25) tem baixa contribuição no canal G da fórmula de luminância relativa
(0.2126R + 0.7152G + 0.0722B) — então, ao contrário de verde/âmbar, **não
existe um L único que sirva para os dois papéis nessa hue**: L baixo o
suficiente para funcionar como preenchimento com texto branco (~4.5:1) é
baixo demais para funcionar como texto sobre fundo quase-preto no dark mode
(~3.5:1, abaixo do piso de 4.5:1 para texto — só serve pra ícone/borda, que
tem piso 3:1). Isso também revelou um bug real pré-existente no componente
`Alert` do InnoProspect: a variante `success` usava `text-success-foreground`
(branco) como cor do CORPO DO TEXTO sobre `bg-success/10` (verde quase-
branco) — contraste medido **1.02:1**, texto praticamente invisível.

**Como aplicar:** quando um componente precisar de "texto colorido sobre
fundo tintado", **não** reuse o token pensado para fill+texto-branco.
Alternativas, em ordem de preferência: (1) não colorir o corpo do texto —
usar `text-foreground`/`text-muted-foreground` sempre, e reservar a cor
semântica só para ícone/borda (que têm piso WCAG mais baixo, 3:1 em vez de
4.5:1) — foi a solução aplicada no `Alert` (ver
`apps/web/src/components/ui/alert.tsx` e DESIGN-SYSTEM.md §4/§7 do
InnoProspect); (2) se precisar mesmo de texto colorido, medir um L
específico para esse papel (não reusar o token de fill) e documentar os dois
valores lado a lado. Amarelo/âmbar tem o problema espelhado: é claro demais
para servir de ÍCONE sobre fundo CLARO (2.23:1 medido) — nesse caso a solução
foi usar o token `-foreground` (a versão escura, pensada pro texto sobre o
fill) no light e o token base (brilhante) no dark, via `dark:` explícito na
classe Tailwind.
