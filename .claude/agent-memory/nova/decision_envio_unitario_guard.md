---
name: innoprospect-envio-unitario-guard
description: Decisões do contrato §4.9 (POST /leads/:id/messages) — por que o guard de envio nasce no envio unitário e não na campanha, e os 5 porquês que sustentam isso
metadata:
  type: project
---

Contrato escrito em 2026-08-03 (`ARQUITETURA.md` §4.9, doc promovido a v1.1). Fecha a omissão que
matou a entrega 3.7. Aqui ficam só os **porquês** — o "o quê" está no §4.9 e é longo.

**Decisão-mãe: o portão de envio nasce no envio unitário, não na Fase 4.**
**Why:** se o guard nascesse no `dispatch-tick.job`, a primeira execução dele seria também a primeira
vez que 500 pessoas receberiam mensagem. Com volume 1 e um humano olhando, um bug custa uma mensagem;
no disparo, custa o número. A Fase 4 tem que **herdar** um portão exercitado em produção.
**How to apply:** se alguém propuser "deixa o guard pra quando tiver campanha", recusar — é a mesma
classe de erro que produziu quatro funções puras sem chamador neste projeto.

**Cinco decisões de detalhe e o motivo de cada uma:**

1. **Rota síncrona no `apps/web`, não na fila.** O operador precisa do *motivo* da recusa na mesma
   tela. Passar pela fila transforma "este número pediu para sair" em silêncio. O worker continua
   sendo o único caminho para **volume**.
2. **Carimbo `optOut.checkedAt` no guard, que LANÇA se tiver > 5s.** Converte "não cachear a
   blacklist" de regra de disciplina em falha de runtime. Mesmo truque do `buildMachineUpdate()`,
   que funcionou melhor que a regra escrita que eu tinha especificado.
3. **Write-ahead do `Message`** (grava `queued` + debita cota ANTES de chamar a Evolution).
   Os modos de falha não são simétricos: "enviei e não registrei" produz mensagem invisível, cota
   furada e reenvio duplicado; "registrei e não enviei" produz uma linha `failed` visível. **A cota
   erra sempre para menos, nunca para mais.**
4. **Horário no manual = piso duro (08–20, sem domingo, sem override) + janela comercial com
   confirmação explícita.** A janela do §6.3 protege contra duas coisas que eu tratava como uma:
   *parecer robô* (some com volume 1 + humano no clique) e *irritar o destinatário* (não some — quem
   recebe abordagem fria às 22h denuncia igual, e não sabe se foi humano ou cron). Como só uma some,
   a resposta não é "libera" nem "bloqueia".
5. **Envio manual não é modo de teste:** consome a mesma cota, os mesmos contadores, os mesmos
   bloqueios. Se fosse exceção, viraria o caminho oficial para furar o warmup.

**Buraco de contrato descoberto no caminho — `error.reason` (§4.0, CONTRATO alterado):** o documento
citava sub-códigos (`ALREADY_OPTED_OUT`, `INSUFFICIENT_TEXT_VARIATION`…) como se fossem `error.code`,
mas `code` é enum fechado de 8 valores ligado ao HTTP. Não havia onde eles morarem, e a UI só tinha a
`message` em pt-BR — ou seja, não tinha como decidir nada. `reason` é aditivo e é o **único** campo em
que a Lyra pode ramificar lógica.

Relacionado: [[innoprospect-armadilhas]], [[nova-licoes-plano-faseado]], [[innoprospect-estado-real]].
