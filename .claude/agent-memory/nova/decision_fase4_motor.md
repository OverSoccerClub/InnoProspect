---
name: innoprospect-fase4-motor
description: Porquês das decisões da Fase 4 (campanhas + dispatch-tick) fechadas na v1.2 do ARQUITETURA.md — cadência do número, lease, incerto, alvos no POST
metadata:
  type: project
---

Fase 4 desenhada em 2026-09-22 (`ARQUITETURA.md` v1.2: §4.5, §4.9.10, §4.10, §6.8, §6.9, §8 Fase 4).
O "o quê" está no documento e é longo. Aqui ficam só os **porquês**, que o código não conta.

**1. Cadência é propriedade do NÚMERO, não do chamador** (fecha o achado médio do Órion).
Eu tinha desenhado ritmo como atributo de *quem chama* — manual é humano logo é lento, campanha é robô
logo precisa de freio. Do lado do WhatsApp isso não existe: ele observa a **taxa de emissão de um
número**. Dois caminhos disciplinados em separado somam, e a soma não tem dono. Daí um gate único,
`WhatsAppInstance.nextSendAllowedAt`, em **Postgres e não Redis** — gate volátil produz rajada logo
depois do restart, o pior momento possível.
Assimetria: contato **frio** respeita o gate (é o abuso descrito); **resposta em conversa aberta**
passa (é o tráfego menos parecido com bot que existe) mas **empurra** o gate. A regra de quando o
override vale mora **dentro** do guard puro (`ignorePaceLock` é anulado se `isColdFirstContact`) —
se ficasse no serviço, viravam duas implementações em duas semanas.

**2. Lease em vez de status `sending`.** Acrescentar valor ao enum `CampaignTargetStatus` propaga para
contratos, UI e filtros por uma necessidade interna do worker. O lease (`scheduledFor = now + 120s` na
mesma transação do `SELECT ... FOR UPDATE SKIP LOCKED`) devolve alvo órfão sozinho, dispensa job de
resgate e transforma `attempt` no contador natural de tentativas.
⚠️ **A garantia dura contra envio duplicado não é o lease — é `Message.campaignTargetId @unique`.** O
lease é performance; o índice único é correção. É ele que fecha o risco R7.
⚠️ Armadilha achada ao escrever a query: em Postgres `ORDER BY col ASC` é **NULLS LAST**, e é assim que
o índice `(campaignId, status, scheduledFor)` está construído. `NULLS FIRST` faria o planner abandonar
o índice a cada 15s. Solução: `scheduledFor` nunca fica `NULL` a partir do `start`.

**3. Resultado incerto: alvo vira `failed` terminal, nunca retentado, cota não volta.** Reagendar é a
única opção capaz de mandar a mesma abordagem duas vezes para a mesma pessoa, e o dano de duplicar
(denúncia → ban) é maior que o de não enviar. A instância **não** é punida (timeout de rede não é a
instância falhando) — mas isso abre um buraco: uma Evolution agonizante devolveria incerto para
sempre, queimando cota às cegas. Fechado com `consecutiveUncertain`: ≥3 tira a instância da rotação,
≥5 dá `halt`. **Parar é o movimento conservador justamente porque não sabemos o que aconteceu.**

**4. Alvos materializados no `POST`, não no `start`.** Mais caro, e escolhido porque o operador precisa
ver **quais** leads entraram, não só quantos — "800 viraram 430" sem lista é um número que ele não tem
como auditar. O `POST /campaigns/preview` (não escreve nada) existe para a tela recalcular a cada
debounce sem gerar drafts-lixo, e leva `blockers[]`: tudo o que faria o `start` devolver 409 depois.

**5. Campanha `running` não é editável.** Editar cadência no meio do disparo cria janela em que o tick
leu as settings antigas e grava com elas; resolver direito custa versionamento de settings. Pausar
primeiro custa um clique e elimina a classe inteira de bug. Restrição deliberada, não limitação.

**6. `MISSING_OPTOUT_NOTICE` é erro do `start`, não do envio.** O snapshot é o mesmo para todos os
alvos: falhar alvo a alvo transformaria um erro de configuração em 430 falhas. Validar na parte
**fixa** do texto (grupos de spintax removidos) é O(1) e é a regra certa de qualquer jeito — aviso de
descadastro que aparece em 1 de 12 variações não é aviso.

**7. Critério que decidiu quais jobs entram na Fase 4:** entra o que é necessário para o sistema
**parar**; fica para depois o que é necessário para **otimizar**. Corte secundário: regra que precisa
de mais histórico do que o aceite da fase produz (50 alvos) não é testável agora — e regra não
testável entregue é exatamente como nasceram as quatro funções sem chamador deste projeto.
`warmup-roll` é obrigatório (sem ele `warmupDay` nunca avança e a tabela do §6.2 é decoração);
`health-check` entra só na fatia que para; heurísticas de shadow-ban e `retention` ficam para depois.

Relacionado: [[innoprospect-envio-unitario-guard]], [[innoprospect-armadilhas]],
[[nova-licoes-plano-faseado]], [[innoprospect-uso-proprio]].
