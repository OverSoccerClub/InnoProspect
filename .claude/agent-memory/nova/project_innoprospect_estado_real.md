---
name: innoprospect-estado-real
description: O que está realmente ligado vs. escrito no InnoProspect (revisão 2026-08-03) — peças completas mas sem chamadores, e correções ao ARQUITETURA.md
metadata:
  type: project
---

Revisão profunda feita em 2026-08-03, documentada em `REVISAO-ARQUITETURA.md` na raiz. Aqui ficam
só os fatos que o código não conta sozinho e que economizam uma releitura completa.

**A distinção que importa neste projeto: "escrito" ≠ "ligado".** Verificar chamadores antes de
assumir que uma peça funciona. Peças completas, testadas e **sem nenhum chamador** em 2026-08-03:
- `evaluateSanity` / assertions A1–A4 (`packages/scraper/src/sanity/assertions.ts`) — a rede contra
  "sucesso silencioso" da §5.7 é código morto. Nenhum `ScraperHealthEvent` é gravado por ninguém.
- `EvolutionClient.sendText` — **nada no sistema envia mensagem**. Nunca enviou.
- `WARMUP_TABLE`, `effectiveDailyLimit`, `regressWarmupDay`, `deriveInstanceHealth`
  (`packages/core/src/whatsapp/`).

**Why:** o plano faseado separou "escrever a regra pura" de "ligar a regra", e só a primeira metade
foi feita. Ver [[nova-licoes-plano-faseado]].

**Correções ao ARQUITETURA.md que ainda não apliquei no documento:**
- §0: produção é **EasyPanel**, não Docker Compose. `infra/docker-compose.yml` descreve topologia
  que nunca subiu — tratar como dev-only.
- §1.2: o diagrama mostra 3 workers; só o de scraping existe.
- §4: falta o contrato de **envio manual de mensagem** (`POST /leads/:id/messages`) — foi a
  omissão que matou a entrega 3.7.
- §5.2: a flag `saturated` não existe no schema; `reachedEnd` é calculado e descartado. A dívida D4
  seguirá sem dados até isso ser persistido.
- §5.5 (seletores em 1 arquivo): **respeitado e reforçado** — a única invariante dura que sobreviveu
  intacta à implementação.

**Furo de premissa a validar antes de qualquer coisa:** o scraper extrai telefone do **card da
lista** do Maps, mas o card frequentemente não traz telefone (fica no painel de detalhe). Rebaixei
`scrape-detail` para v2 e ao mesmo tempo escrevi um aceite de Fase 1 que exige telefone — são
incompatíveis. Medir a taxa real de celular por lead é o primeiro número a obter; ele decide se
`scrape-detail` vira bloqueante. Não confirmado (o scraper nunca abriu o Maps).

**Melhorias da implementação que devem virar convenção do projeto:**
- `apps/web/src/lib/services/*` — camada de serviço não prevista no §2; rotas ficaram com ~10 linhas.
  Regra: nenhuma query Prisma em `route.ts`.
- `buildMachineUpdate()` **lança exceção** se campo fora da allowlist entrar no upsert — converteu
  uma regra de disciplina em falha de runtime.

Relacionado: [[innoprospect-arquitetura-v1]], [[innoprospect-armadilhas]], [[innoprospect-escopo]].
