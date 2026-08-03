---
name: nova-licoes-plano-faseado
description: Correções ao meu próprio método de planejar, compradas na revisão do InnoProspect (2026-08-03) — aplicar em QUALQUER projeto que eu desenhar
metadata:
  type: feedback
---

Quatro regras de planejamento que violei no InnoProspect v1 e que a revisão de 2026-08-03 expôs.
Aplicam-se a qualquer arquitetura que eu escrever, não só a este projeto.

1. **Fase 0 = walking skeleton com infra real, antes de qualquer domínio.**
   **Why:** o InnoProspect chegou a 13.400 linhas, 12 commits, build verde e 164 testes **sem que
   uma linha jamais tocasse Postgres, Redis, Google Maps ou WhatsApp**. Cada fase empilhou hipótese
   sobre hipótese. Meu plano tratava "escrito + build passando" como equivalente a "entregue".
   **How to apply:** a primeira fase entrega infra de pé + 1 caminho fim-a-fim real (por mais
   ridículo que seja o escopo). Só depois começa o domínio.

2. **Nenhuma entrega no plano de fases sem contrato correspondente na seção de API.**
   **Why:** escrevi a entrega 3.7 (envio manual de WhatsApp) no plano faseado mas não o endpoint na
   §4. Ninguém implementou — o §4 é, na prática, a lista de trabalho. Justamente a entrega que
   existia para validar a integração externa antes de construir em cima dela.
   **How to apply:** ao fechar um plano faseado, varrer item a item perguntando "qual contrato
   corresponde a isto?". Sem contrato, a entrega não existe.

3. **Função pura + teste ≠ funcionalidade. O wiring É a entrega.**
   **Why:** `evaluateSanity` (as 4 assertions anti-"sucesso silencioso"), `WARMUP_TABLE`,
   `regressWarmupDay`, `effectiveDailyLimit` — todas escritas, testadas, exportadas e com **zero
   chamadores**. Em qualquer relatório de progresso parecem prontas. Eu tinha separado "assertions
   A1–A4" da entrega do job como itens independentes; não são.
   **How to apply:** o critério de aceite de uma regra de proteção é o **comportamento observável
   quando ela dispara** (evento gravado, tela mudou, alerta saiu), nunca o teste unitário da função.

4. **Todo modo degradado com default seguro e sinal mais barulhento que o normal.**
   **Why:** `USE_MOCKS` fail-open para dados falsos; health check que responde `ok` sem saber se o
   worker existe; fila que pausa indefinidamente sem sinal nem caminho de retomada. Em todos, o
   default escolhido foi "parece funcionando".
   **How to apply:** ao desenhar qualquer flag/fallback, perguntar "se isto ficar ligado por engano
   em produção, alguém percebe?". Se a resposta for não, inverter o default e adicionar sinal visível.

5. **Todo nome que aparece num contrato precisa de um campo onde morar.**
   **Why:** escrevi `409 SEARCH_ALREADY_RUNNING`, `409 TEMPLATE_IN_USE`, `409 ALREADY_OPTED_OUT` e
   mais meia dúzia ao longo do §4 como se fossem valores de `error.code` — que é um enum fechado de
   8 valores ligado 1:1 ao status HTTP. Esses nomes não tinham onde existir. Passou por 21 rotas
   implementadas sem ninguém notar, porque cada rota isolada "funciona": ela devolve 409 com uma
   mensagem em pt-BR. Só que o cliente ficou sem como **decidir** — "opt-out" (nunca mais tente) e
   "cota estourada" (tente amanhã) chegam idênticos.
   **How to apply:** ao fechar um contrato, varrer os identificadores em `MAIÚSCULA_COM_UNDERSCORE`
   e perguntar "em qual campo do envelope isto viaja?". Se não houver campo, ou eu crio o campo, ou
   o nome é decoração.

Relacionado: [[innoprospect-arquitetura-v1]], [[innoprospect-armadilhas]],
[[innoprospect-envio-unitario-guard]].
