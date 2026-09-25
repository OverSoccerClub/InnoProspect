---
name: convention-shared-clock-across-siblings
description: Quando dois componentes da mesma tela precisam do mesmo "agora" para decidir estados relacionados (badge de frescor + banner que depende do mesmo limiar), chame useNow() uma vez no pai e passe now como prop — nunca deixe cada filho chamar useNow() por conta própria.
metadata:
  type: convention
---

`useNow()` ([[convention_use_now_self_aging_relative_time]]) dá cada chamador
o seu próprio `setInterval` independente. Se dois componentes-irmãos que
aparecem juntos na mesma tela (ex.: um badge de heartbeat + um alerta que
depende do mesmo heartbeat estar "vivo ou morto") cada um chamar `useNow()`
por conta própria, eles têm dois relógios que re-renderizam em momentos
diferentes — por até um intervalo inteiro (30s no padrão do projeto) o badge
pode dizer uma coisa e o alerta calculado a partir do MESMO dado bruto dizer
outra, porque cada um leu um `now` ligeiramente diferente.

**Como aplicar:** quando isso acontecer (motor de disparo — Fase 4.F.3 — foi
o primeiro caso: `DispatchEngineCard` precisava do mesmo `now` que
`WorkerHeartbeat` para decidir "motor ligado mas worker sem sinal" no mesmo
instante que o badge mostra "sem sinal"), chame `useNow()` **uma vez no
componente pai** e passe `now: number` como prop para os filhos que precisam
dele. Os filhos ficam sem hook próprio — puros a partir de `now` + dado bruto,
o que também os torna mais fáceis de testar isoladamente.

Isto não é uma correção de bug observado em produção (achei revisando antes
de entregar, não depois de reprovação) — registro porque é o tipo de
inconsistência que só aparece com o relógio real rodando por minutos, nunca
num teste unitário isolado nem num único screenshot.
