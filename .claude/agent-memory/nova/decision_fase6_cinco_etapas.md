---
name: innoprospect-fase6-cinco-etapas
description: Porquês da §8.11.11-8.11.16 (v1.5) — cota como origem do ranking, hipótese vs. evidência, campanha única multi-ângulo, classificar a resposta e os dois vieses de seleção
metadata:
  type: project
---

Desenhada em 2026-09-26 (`ARQUITETURA.md` v1.5, §§8.11.11-8.11.16, invariantes A39-A48).
**Estende** a §8.11 da v1.4 — nada de lá foi revogado. O "o quê" está no documento; aqui os porquês.
Ver [[innoprospect-fase6-prospeccao-autonoma]] para a camada anterior.

**1. O ranking não nasce de "melhorar conversão"; nasce da COTA — e esse enquadramento decide tudo.**
`WARMUP_TABLE` dá 20 msg/dia no dia 1. Com 200 alvos são dez dias úteis. Quando só dá para falar com
20 pessoas hoje, **quem** se escolhe é o jogo inteiro, e a escassez não vai embora comprando servidor
(ela **é** o anti-ban). Regra geral que fica: *capacidade escassa transforma priorização em
arquitetura* — enquanto a cota couber no público, ordenar é enfeite.

**2. "O ranking é a hipótese; a resposta é a evidência" (§8.11.11) é a frase que impede a promessa
falsa.** Tudo que coletamos mede **encaixe**, nada mede **intenção**: uma clínica 4.8 sem site pode
ter *decidido* não ter site. Sem essa frase escrita e repetida na tela, "os melhores leads" vira
crença imune a correção — e o score v2, treinado só no topo, a confirma para sempre.

**3. Achado no código que virou A48 (campanha única, ângulo por alvo).** `dispatch-tick` itera
`campaign.findMany({ where: running, orderBy: startedAt asc })` e a cota vem de
`InstanceDailyStat.sentToday`, ou seja é **do número**. Logo campanhas por ângulo **não rodam em
paralelo: serializam** — a mais antiga come o dia inteiro. O ângulo A sairia nos dias 1-3 com
`warmupDay` 5 e o B nos dias 4-6 com `warmupDay` 8: a comparação entre ângulos vira comparação entre
**semanas**, criando exatamente o confundidor que a §8.11.3 grava `instanceId`/`warmupDay`/`hourOfDay`
para eliminar. Corolário que vale além deste caso: **"separar para organizar" pode destruir a
comparação que justifica a separação.** Daí também a ordem intercalada por ângulo dentro da campanha
(bloco por score puro mediria um ângulo só se a campanha fosse `halted` no dia 2 — e ela é).

**4. `discarded` é IRREVERSÍVEL, e foi isso que fechou a fronteira da etapa 4 (A44).**
`checkStatusTransition` responde "não é possível sair de 'discarded'" para qualquer destino e
**qualquer ator** — nem humano desfaz. E `to === 'discarded'` é liberado *antes* da checagem de ator,
então uma regra automática **pode** descartar. Pode e não vai. Lição: antes de decidir o que a máquina
automatiza, leia o que o estado-alvo permite **desfazer**, não só o que permite fazer.

**5. Classificar a resposta é o uso de IA mais seguro do sistema, e o argumento é estrutural:**
o modelo **lê** em vez de escrever, não há fato a inventar (entrada = texto, saída = categoria de
lista fechada), a saída **nunca chega no celular de ninguém**, e responde a pergunta do dono
("continuar ou não"). Mesmo assim entra **depois** da versão por regra: a LGPD aqui é diferente —
mandar `rating`/`categoria` é dado comercial público, mandar a resposta é **texto escrito por uma
pessoa**. Decisão: 6.1R só regra, contar `needs_human`, e só então decidir (D-IA-10). O atenuante que
descobri: o texto **já** é persistido em `Message.body` (12 meses, §7.5) — o que muda é a
**transmissão**, não o armazenamento.

**6. `sem interesse` JÁ está em `OPT_OUT_TRIGGERS`.** Parte do que o dono chamaria de "não tem
interesse" hoje já é opt-out duro com bloqueio permanente do telefone. Por isso a categoria
`not_interested` só existe para o que a regra não pegou, e a regra é **unidirecional** (A43): o modelo
acrescenta opt-out, nunca revoga — falso positivo custa 1 lead, falso negativo custa denúncia (§6.7).

**7. O conserto do "SAIR" é de ORDEM, não de mecanismo — e o motivo é o CONTADOR.**
`advanceCampaignTargetStatus` já leva qualquer alvo não-terminal direto para `skipped`. O que não
desfaz é `Campaign.respondedCount`, já incrementado ao passar por `responded`: o alvo contaria duas
vezes e o contador ficaria inflado pelos descadastros para sempre. Registrar o opt-out **antes** é o
conserto; "skipar depois" não é.

**8. Dois vieses, não um (A47) — e a distinção é a parte que some se ninguém escrever.**
Exploração de **público** (sorteio uniforme fora do recorte) responde *o score prevê resposta?*;
exploração de **ângulo** (N3) responde *qual mensagem converte?*. Um envio tem no máximo um
`exploreKind`, senão o resultado ruim não é atribuível. E o ponto fino: a pergunta do score se
responde **dentro** da fatia aleatória, o único conjunto em que a seleção não decidiu quem entrou —
por isso `ApproachOutcome.score` vai **cru**, não em bucket como `rating`.

**9. Duas correções ao que eu mesma escrevi na v1.4:**
- A §8.11.4 disse "configuração no mesmo lugar da pausa global". Conferi: a pausa mora no **Redis**, e
  "Redis limpo = pausado" é a propriedade, não efeito colateral — não mover. Mas envelope de autonomia
  e perfil de pesos precisam de Postgres (`AppSetting`), senão um Redis limpo troca o critério de
  ordenação da campanha seguinte **sem aviso**.
- A elegibilidade **não** é um buraco: `classifyAudience` já corta os 6 motivos e devolve as contagens
  (`totalMatched = eligible + Σ excluded`). O erro caro é de **ordem** (A39): ranquear antes de
  filtrar entrega um recorte que a elegibilidade esvazia, e os que faltam não são repostos pelos
  seguintes da fila. Antes de propor peça nova, cheque se a peça existe e está no lugar errado.

Relacionado: [[innoprospect-fase6-prospeccao-autonoma]], [[innoprospect-fase4-motor]],
[[innoprospect-armadilhas]], [[nova-licoes-plano-faseado]].
