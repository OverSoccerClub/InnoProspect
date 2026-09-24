---
name: convention-contract-ts-over-arquitetura-prose
description: Quando o ARQUITETURA.md e o campaign.contract.ts (ou outro *.contract.ts) discordam, construir contra o .ts — e reconferir, porque o Vega pode estar publicando em paralelo, no mesmo dia
metadata:
  type: convention
---

Na Fase 4.E encontrei `ARQUITETURA.md §4.5` descrevendo uma "v1.2" do
contrato de campanha (preview, `alreadyTargeted`, `PATCH`, envio manual por
alvo) que `packages/contracts/src/campaign.contract.ts` ainda não tinha.

**Regra:** o arquivo `.ts` publicado é a fonte de verdade para o que
construir — é o que o Vega de fato valida na rota. O `ARQUITETURA.md` é
prosa de design, pode estar adiantado (documentando uma decisão já tomada
mas ainda não codificada) ou atrasado (código evoluiu, ninguém atualizou o
texto). Nunca inventar um campo/endpoint que só existe na prosa.

**Por que reconferir, não só registrar o gap e seguir:** nesta rodada, o
Vega publicou `alreadyTargeted` E o endpoint de envio manual NO MEIO da
minha sessão — rodei `tsc` de novo por outro motivo e o erro de tipo
apareceu sozinho, revelando a mudança. Se eu tivesse só anotado o gap no
início e nunca mais olhado o `.ts`, teria entregado uma tela desalinhada
com o que o backend real passou a exigir (`CampaignAudienceExcluded` com 6
campos, não 5). Rodar `tsc --noEmit` com frequência durante uma sessão longa
com trabalho paralelo funciona como um "sensor" barato de que o contrato
mudou embaixo dos pés — sem precisar perguntar ao Atlas o tempo todo.

**Como aplicar:** ao achar uma divergência ARQUITETURA vs `.ts`, construir
contra o `.ts`, reportar o gap no handoff (não decidir sozinho qual documento
está certo), e reconferir o `.ts` a cada rodada de `tsc`/antes de fechar a
tarefa — não só na primeira leitura.
