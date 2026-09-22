---
name: feedback-dono-quer-premium-de-verdade
description: O dono do InnoProspect reprova painel/tela com poucos números soltos e sem gráfico como "fraco e frio" — "premium" pra ele é riqueza de dado real, hierarquia visual forte e nenhum estado vazio "morto"
metadata:
  type: feedback
---

**O que aconteceu (rodada "layout premium", 2026-09-22):** entreguei uma 1ª
versão do painel com só 2 KPIs soltos (números + link, sem gráfico, sem
cor variada) e o dono reprovou com todas as letras: "muito feia e fria,
coisa realmente fraca" — pediu redesenho completo, não ajuste. A 2ª versão
(hero com saudação dinâmica + avatar, 4 indicadores com sparkline/delta,
gráfico de área de 30 dias, funil de status, listas recentes, top UFs/
categorias, card de saúde do sistema) foi aprovada.

**Por quê:** "premium" pra este dono não é estética minimalista/vazia — é
**densidade de informação com hierarquia clara**: números que se comparam
(delta vs. período anterior), tendência visível (gráfico/sparkline, não só
o valor atual), cor com intenção (cada bloco de indicador com sua cor,
nunca tudo cinza), e nenhuma seção "morta" (nem estado vazio: ver
DESIGN-SYSTEM.md §9.4, "estado de primeiro acesso é o padrão em produção,
não caso extremo" — um painel bonito com mock e triste com zero real é
reprovado igual).

**Como aplicar em telas futuras deste projeto:** antes de considerar uma
tela "pronta", perguntar (1) tem pelo menos um gráfico/visual de tendência
quando fizer sentido, não só número solto? (2) a cor tem intenção (varia
por categoria/status) ou é tudo neutro? (3) o estado vazio foi desenhado de
propósito, ou só herdou o layout do estado cheio com números zerados? Se a
resposta for "não" pra qualquer uma, a tela provavelmente ainda não está no
nível que este dono aceita como "profissional". Ver DESIGN-SYSTEM.md §9.4
para o catálogo de padrões (indicator card com sparkline, gráfico em SVG
próprio, `useCountUp`, entrada escalonada) reaproveitáveis na próxima tela
rica em dado.
