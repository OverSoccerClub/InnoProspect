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

6. **Todo contrato que eu escrevo envelhece contra o código — e quem envelhece é o documento.**
   **Why:** na revisão de 2026-09-22 achei quatro divergências entre `ARQUITETURA.md` e o que foi
   implementado, e **as quatro eram melhorias do implementador**: `companyName` no guard (G10 não é
   verificável sem saber que nome procurar), `MAX_DECISION_TO_SEND_MS`, `EvaluateSendGuardOptions`, e o
   achatamento de `meta` em `details[]`. Eu tinha escrito "`meta` útil em `details[]`", que descreve
   duas estruturas incompatíveis, e citado campos (`resetsAt`, `optedOutAt`) que nunca existiram.
   **How to apply:** ao revisar, a pergunta não é "o código seguiu o documento?" — é "por que
   divergiu?". Se a divergência tem um motivo melhor que o meu, o documento é que se corrige, e a
   correção precisa dizer **qual era o erro**, senão alguém reverte a melhoria achando que está
   consertando.

7. **Rede de sanidade definida só sobre VOLUME não pega falha de COMPLETUDE.**
   **Why:** em 22/09/2026 o scraper coletou ~260 leads reais "com sucesso" — e quase todos só com o
   nome, porque os seletores do card do Maps tinham mudado (commit `3da386d`). As assertions A1-A4
   do §5.7 existem exatamente contra "sucesso silencioso", e não dispararam: elas medem *quantos*
   leads vieram, nunca *quão preenchidos*. O dono descobriu olhando a tela.
   **How to apply:** ao desenhar detecção de "isso quebrou sem dar erro", listar os campos que o
   produto precisa (aqui: telefone móvel) e assertar a **taxa de preenchimento** deles, não só a
   contagem de linhas. Vale para qualquer extração/importação/integração.

8. **CI sobre o código-fonte não é portão do artefato de produção.**
   **Why:** cinco incidentes seguidos em 22-23/09 no InnoProspect (nome de fila com `:` derrubando o
   BullMQ no boot, Chromium ausente na imagem do worker, `.ts` solto num bundle ESM, `require` em
   CommonJS dentro do bundle, script de backfill que não era entrada do tsup e por isso não existia
   em produção) tinham **typecheck, lint, testes e `next build` verdes**. Nenhum dos quatro portões
   olha para a imagem que sobe.
   **How to apply:** todo processo empacotado precisa de uma **entrada de auto-teste no próprio
   artefato** (`node dist/index.js --selftest`: conecta no banco e no Redis, registra as filas, abre
   o navegador headless, sai 0) rodada no CI contra serviços reais e usada como healthcheck do
   container. Sem isso, o primeiro teste da imagem é sempre a produção.

Relacionado: [[innoprospect-arquitetura-v1]], [[innoprospect-armadilhas]],
[[innoprospect-envio-unitario-guard]], [[innoprospect-fase4-motor]],
[[innoprospect-estado-real]].
