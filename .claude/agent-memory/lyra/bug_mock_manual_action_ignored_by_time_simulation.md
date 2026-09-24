---
name: bug-mock-manual-action-ignored-by-time-simulation
description: Mock com progresso simulado por tempo (como mocks/searches.ts) ignora silenciosamente uma mutação manual se o "derive status" não checar essa mutação primeiro
metadata:
  type: feedback
---

Em `mocks/campaigns.ts`, a campanha-demo `live` deriva o status de cada alvo
a partir do tempo decorrido (`simSendOffsetMs`/`simResolveOffsetMs`), igual
ao padrão já usado em `mocks/searches.ts`. Ao implementar o disparo manual
(`mockSendCampaignTarget`), a primeira versão mutava `target.fixedStatus =
'sent'` — e não tinha EFEITO NENHUM na tela, porque `deriveTargetStatus`
só olhava `fixedStatus` no branch `!campaign.live`; no branch `live`, a
simulação por tempo sempre ganhava.

**Causa raiz:** dois "motores" escrevendo no mesmo estado derivado
(simulação por tempo vs. ação manual) sem que um soubesse do outro — quem
lê (`deriveTargetStatus`) só verificava um dos dois.

**Correção:** um campo de override explícito (`manualStatus`) checado
PRIMEIRO, antes de qualquer branch de simulação. Qualquer mock futuro que
combine "progresso simulado pelo relógio" com "ação manual do operador"
precisa desse mesmo padrão — override checado antes da lógica de tempo, não
depois, e não escondido dentro do branch "não-live".

**Como notar isso mais rápido:** testar a ação manual especificamente contra
o cenário `live` (o mais complexo), não só contra os cenários com estado
fixo — é onde a interação entre os dois "motores" quebra primeiro.
