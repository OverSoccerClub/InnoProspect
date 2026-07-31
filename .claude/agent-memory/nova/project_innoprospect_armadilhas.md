---
name: innoprospect-armadilhas
description: Invariantes inegociáveis do InnoProspect (opt-out, seletores, warmup, dedupe) — violar isso custa número banido ou risco LGPD
metadata:
  type: project
---

Regras que parecem detalhe de implementação mas são decisões de arquitetura. Qualquer agente que
propuser "simplificar" um destes pontos está aumentando risco real, não reduzindo complexidade.

1. **Opt-out é consultado por telefone (E.164), dentro do worker, imediatamente antes de CADA envio.**
   Sem cache, sem snapshot na montagem da campanha.
   **Why:** um opt-out desrespeitado é simultaneamente risco LGPD, risco de denúncia (= ban do número)
   e dano de reputação. Uma query indexada por mensagem a 30 msgs/hora custa nada.
   **How to apply:** se alguém sugerir cachear a blacklist "por performance", recusar.

2. **Nenhum seletor CSS/XPath do Google Maps fora de `packages/scraper/src/extraction/selectors.ts`.**
   **Why:** o Google muda layout sem aviso (risco de prob. alta, trimestral). O conserto tem que ser
   "editar 1 arquivo + rodar fixtures", não caçar seletor em 6 arquivos.
   **How to apply:** Órion reprova PR que vazar seletor. Extração é testada com HTML congelado, sem rede.

3. **Warmup de instância WhatsApp é limite DURO no worker, não sugestão na UI.** `dailyLimitOverride`
   só pode reduzir, nunca aumentar. Spintax com poucas variações **bloqueia** o start da campanha (409),
   não gera aviso.
   **Why:** o modo de falha mais provável é o usuário se sabotar disparando volume alto de número frio.
   O produto tem que impedir, não avisar.

4. **Re-scraping nunca sobrescreve dado humano** (status de funil, notes, tags, ownerId). Upsert só
   atualiza dado de máquina (rating, reviewCount, lastSeenAt).
   **Why:** perder trabalho manual do operador numa rebusca destrói a confiança no CRM.

5. **Sucesso silencioso é o modo de falha mais perigoso do scraper** — roda, não dá exceção, grava zero.
   Por isso existem 4 assertions de sanidade + canário diário que PAUSAM a fila automaticamente.
   O zero-streak só conta municípios com população > 20.000 (senão o alarme vira ruído e é ignorado).

6. **Campanha usa snapshot do template e `CampaignTarget` snapshot do lead**; estado `halted` é distinto
   de `paused` e exige `acknowledgeHalt` no resume.
   **Why:** o operador precisa VER que houve incidente (número caiu/banido), não só clicar em continuar.

Relacionado: [[innoprospect-arquitetura-v1]], [[innoprospect-escopo]].
