---
name: innoprospect-onde-o-envio-mora
description: Por que o ato de enviar saiu de apps/web para packages/sending, por que o worker NÃO chama a rota HTTP, e por que o motor nasce pausado (ARQUITETURA v1.3, §6.8.0/§6.8.9/§6.8.10)
metadata:
  type: project
---

Decidido em 2026-09-24, antes de o Vega escrever o `dispatch-tick`. O "o quê" está na
`ARQUITETURA.md` v1.3 (§6.8.0, §6.8.9, §6.8.10, §8 Fase 4.F). Aqui só os porquês.

**1. O corte não foi inventado — já estava escrito em prosa.** O topo de `messages.ts` declara um
invariante ("nenhum `await` entre a leitura de opt-out e `evaluateSendGuard`; entre o guard e
`sendText` só o write-ahead"). Isso é propriedade de um **trecho contíguo**, e foi esse trecho que
virou `packages/sending`. Quando existir dúvida sobre onde cortar algo neste projeto, procure o
invariante que alguém já escreveu em comentário: a fronteira de módulo certa costuma ser a fronteira
do invariante.

**2. O pacote devolve união discriminada, não lança `ApiHttpError`.** Erro de HTTP é resposta a um
pedido de humano. Para o motor, `409 SEND_PACE_LOCKED` não é erro: é "reagende para as 14h37". Fazer
o worker ler status HTTP para decidir o destino de um alvo é control flow por exceção num processo
que nem HTTP fala. Bônus real: `outcome` novo quebra a compilação **dos dois** chamadores.

**3. Worker chamando a rota HTTP do `web` — descartado, e o motivo forte não é a regra de §2.**
É que restart/deploy do `web` no meio de uma campanha devolve erro de rede, e erro de rede no envio é
**incerto** por definição (§6.8.6): alvo morre `failed`, cota não volta, ninguém sabe se saiu.
Estaríamos fabricando o pior caso do sistema em todo deploy. Secundários: exigiria credencial de
serviço com poder de enviar, e o motor seria estrangulado pelo `MANUAL_SEND_RATE_PER_MIN` (10/min),
que foi desenhado para um humano clicando.

**4. Duplicação: a linha divisória que passei a usar.** Pode duplicar **protocolo** (nome de fila,
chave de Redis, transporte de log/alerta) — diverge alto, alguém percebe. Não pode duplicar o que
decide **se** a mensagem sai, **quando** sai ou **o que foi cobrado** por ela — diverge em silêncio.
O caso mais afiado: `advanceNextSendAllowedAt` (o `UPDATE ... WHERE nextSendAllowedAt < $novo`). O
motor é literalmente o segundo escritor concorrente que aquela correção do Órion previu; uma cópia
sem o `WHERE` faz o gate anti-ban **recuar** sem erro e sem log. Segundo caso: `todayDateKey` — fuso
diferente entre os dois apps = duas linhas de `InstanceDailyStat` por dia = teto de warmup dobrado.

**5. Por que a extração é segura apesar de mexer em produção:** `messages.test.ts` (817 linhas, fake
de Prisma, `@inno/core` real) cobre `sendLeadMessage`, cuja assinatura não muda. O critério ficou
escrito como contrato: se o teste precisar de ajuste além de caminho de import, a extração mudou
comportamento e se refaz — não se reajusta o teste.

**6. Fiação de build é PASSO 0, não detalhe de implementação.** Os 5 incidentes de 22–23/09 passaram
por typecheck, lint, testes e build e só apareceram no boot do container. `@inno/sending` tem que
entrar no `noExternal` do tsup (senão `ERR_UNKNOWN_FILE_EXTENSION`) com `@inno/db` seguindo external
(engine nativo do Prisma resolvido por `__dirname`), e em `transpilePackages` do Next. Prova = import
real + `selftest` no container.

**7. Motor nasce pausado, e o interruptor é a pausa global persistida — não uma env.** Aval dado ao
Atlas: o canal de alerta muda a **duração** do incidente, não o **tamanho**; os controles de
prevenção (guard, gate, cota, lease, `@unique`, halts) é que limitam o estrago, e eles existem. Por
isso alerta não bloqueia a construção. Mas: chave ausente no Redis = pausado (inverso do scraper, e
escrito no doc para ninguém "consertar" a assimetria), porque env é invisível na tela e exige
redeploy — e quem precisa desligar às 2h da manhã é o dono, do celular, sem terminal (§0).
Contrapartida que exigi: enquanto o alerta estiver desligado, **os patamares de parada não podem ser
afrouxados**, e a primeira ativação é 1 instância + campanha curta + alguém olhando.

**8. Achado que não estava no radar de ninguém:** `sendWindowDaysOfWeek`, `jitterMin/MaxSeconds` e
`dailyLimitPerInstance` são gravados, devolvidos pela API e exibidos pela Lyra — e **nenhum código os
lê na hora de enviar**. `SendWindowConfig` do `@inno/core` nem tem `daysOfWeek`. Mesma família do
`warmupDay` que nunca avançava: tela prometendo controle que não existe. Virou §6.8.10, com a regra
geral "configuração de campanha só estreita limite de segurança, nunca alarga".

Relacionado: [[innoprospect-fase4-motor]], [[innoprospect-envio-unitario-guard]],
[[nova-licoes-plano-faseado]], [[innoprospect-armadilhas]].
