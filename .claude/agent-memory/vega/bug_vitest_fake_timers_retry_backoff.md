---
name: bug-vitest-fake-timers-retry-backoff
description: Teste de retry/backoff com sleep() real estourou o timeout padrão de 5s do vitest — usar fake timers
metadata:
  type: project
---

**Sintoma:** teste `EvolutionClient.sendText` cobrindo classificação de `TIMEOUT`/`TRANSIENT_ERROR`
(`packages/messaging/src/client/evolution-client.test.ts`) travou em "Test timed out in 5000ms".

**Causa raiz:** o código de produção (`client/http.ts`, `evolutionRequest`) faz retry automático de
transporte para `TRANSIENT_ERROR`/`TIMEOUT` usando `sleep()` real com backoff com jitter (~1s e ~4s,
ver `MESSAGING_ERROR_POLICY`). Um teste que chama o método do cliente ponta a ponta (sem mockar
`sleep`) soma esses delays reais — 2 tentativas de retry facilmente passam dos 5000ms default do
vitest, e mais perto ainda de estourar quando o próprio erro simulado (timeout) também consome tempo
real. É o mesmo padrão que existe em `packages/scraper/src/errors.ts` (`applyJitter`/`backoffForAttempt`
com jitter real) — lá os testes só exercitam as funções puras isoladas, nunca uma chamada ponta ponta
que de fato dorme.

**Correção:** para qualquer teste que force um erro retryable através da chamada pública (não só a
função pura de backoff), envolver com `vi.useFakeTimers()` antes de chamar o método, dar
`await vi.runAllTimersAsync()` para destravar os `setTimeout` pendentes (tanto o do `sleep()` do retry
quanto o do `AbortController` do timeout), e só então `await` a promise/asserção — sempre com
`vi.useRealTimers()` num `finally`. Ver os testes "faz retry de transporte em 500", "propaga
TRANSIENT_ERROR depois de esgotar" e "classifica timeout (AbortError)" em
`packages/messaging/src/client/evolution-client.test.ts` para o padrão pronto.

**Como evitar de novo:** qualquer pacote futuro que implemente retry-com-backoff (ex.: dispatch worker
consumindo `MessagingError.retryable`) e for testado ponta a ponta (não só a função pura de cálculo de
backoff) precisa deste padrão de fake timers — não confiar que "o delay é só de 1-4s, cabe no timeout
default". Alternativa mais simples quando não precisar testar o retry em si: injetar/mockar `sleep`
diretamente em vez de fake timers globais.

Relacionado: [[convention-messaging-evolution-api]].
