---
name: innoprospect-arquitetura-v1
description: Decisões de arquitetura do InnoProspect v1 e o porquê de cada uma — consultar antes de propor mudança estrutural
metadata:
  type: project
---

Arquitetura fechada em 2026-07-30, documentada em `ARQUITETURA.md` na raiz do projeto (esse arquivo
é a fonte detalhada; aqui ficam só as decisões e os motivos, que o código não conta).

**Decisões e porquês:**
- **Monólito modular em 2 processos** (apps/web Next.js + apps/worker Node), monorepo pnpm+Turborepo.
  Why: MVP com time pequeno; microserviços seriam erro de dimensionamento. O worker já está isolado
  o suficiente pra virar serviço separado sem reescrita, se um dia precisar.
- **BullMQ + Redis** para fila, escolhido sobre pg-boss. Why: o núcleo de valor do produto é cadência
  controlada (rate limit, delay, backoff); reimplementar isso à mão sobre Postgres seria escrever a
  mão a parte mais crítica. Redis é volátil por design — **Postgres é a fonte da verdade** e a fila
  é reconstruível a partir dos status `pending`.
- **Auth.js v5 + Credentials**. Why: poucos usuários internos; pagar por usuário não se justifica.
- **`packages/contracts` (Zod) é fonte única da API**, consumida por web e worker. Why: web e worker
  divergirem de tipo é a origem nº 1 de bug em monorepo.
- **Playwright como motor de scraping**, com interface `SearchEngine` preparada pro motor `pb`
  (endpoint interno protobuf) depois. Why: confiabilidade > velocidade nesta fase.
- **Fanout por município IBGE**: Maps devolve ~120 resultados por consulta, então 1 busca do usuário
  vira N SearchTask (uma por município), priorizadas por população. Municípios vêm do seed, nunca de
  chamada ao IBGE em runtime.

**How to apply:** antes de propor mudança estrutural, verificar se ela não colide com um desses
porquês. Se colidir, o argumento tem que atacar o motivo, não só a decisão.

Relacionado: [[innoprospect-escopo]], [[innoprospect-armadilhas]].
