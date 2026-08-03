---
name: bug-bullmq-client-not-ioredis
description: Queue#client do bullmq 5.8x não é o Commander do ioredis — não tem .ping(), .set() usa options object
metadata:
  type: project
---

**Sintoma:** `(await queue.client).set(key, value, 'EX', 60)` e `(await queue.client).ping()` falham no
typecheck (`tsc`) com `Expected 2-3 arguments, but got 4` e "method does not exist", mesmo sendo API
clássica válida do `ioredis`.

**Causa raiz:** a partir do bullmq 5.8x (confirmado na versão instalada, `5.81.3`), `Queue#client` NÃO
devolve o cliente `ioredis` bruto — devolve `IRedisClient`, uma abstração própria do bullmq
(`node_modules/bullmq/dist/esm/interfaces/redis-client.d.ts`) desenhada para suportar múltiplos backends
(ioredis, node-redis, Bun) por trás da mesma interface. Ela só expõe um SUBCONJUNTO de comandos, com
assinatura própria:
- `set(key, value, options?: { PX?, EX? })` — objeto de opções, não varargs `'EX', seconds`.
- **Sem `.ping()`.** Para provar conectividade, usar `.info()` (presente na interface) — qualquer
  resposta bem-sucedida já prova o round-trip.
- `del(...keys)`, `get(key)` continuam iguais ao ioredis clássico.

**Correção:** usar a assinatura de `IRedisClient`, não a do `ioredis` Commander completo. Ver
`apps/worker/src/lib/queue-state.ts#recordHeartbeat` (`.set(key, value, { EX: seconds })`) e
`apps/web/src/lib/queue-state.ts#pingRedis` (`.info()` em vez de `.ping()`).

**Como evitar:** antes de assumir qualquer método de `Queue#client`/`Worker#client` no bullmq, checar
`node_modules/.pnpm/bullmq@<versão>/node_modules/bullmq/dist/esm/interfaces/redis-client.d.ts` — a
lista de métodos ali É o contrato real, não a documentação do `ioredis`. Isto vale mesmo `apps/worker`
declarando `ioredis` como dependência direta (`package.json`) — `Queue#client` continua devolvendo o
tipo `IRedisClient` do bullmq, não o tipo `Redis` do pacote `ioredis` importado à parte.

Ver também [[convention-worker-redis-state]] (por que usar `Queue#client` em vez de instanciar um
`ioredis` próprio).
