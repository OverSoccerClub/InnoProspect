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

**Correções ao ARQUITETURA.md — ✅ TODAS APLICADAS em 2026-08-03 (doc virou v1.1).** Não reabrir:
- §0: produção é EasyPanel; `infra/docker-compose.yml` é dev-only. Daí derivei um requisito duro:
  **toda recuperação precisa de caminho pela UI ou env var idempotente** (não há terminal confiável).
- §1.2: nota dizendo que só o Scrape Worker existe e que o seed roda no `apps/web`.
- §4: contrato do envio unitário escrito → **§4.9** (ver [[innoprospect-envio-unitario-guard]]).
- §4.0: `error.reason` adicionado ao envelope — **CONTRATO alterado, Vega mexe em `packages/contracts`**.
- §5.2: `saturated` ausente + dedupe de card por `outerHTML` (infla `resultCount` e trunca resultados).
- §8: plano faseado reescrito (Fase 0, ondas no lugar do paralelismo, gatilho do `scrape-detail`).
- §9.2: dívidas novas D8 (sem reconciliação de status de mensagem) e D9 (sem model de configuração —
  `{{minha_empresa}}` vem de env, trocar exige redeploy).
- §5.5 (seletores em 1 arquivo): respeitado e reforçado — a única invariante dura que sobreviveu
  intacta à implementação.

**Furo de premissa, ainda ABERTO (o primeiro número a obter):** o scraper extrai telefone do **card
da lista** do Maps, mas o card frequentemente não traz telefone (fica no painel de detalhe).
Rebaixei `scrape-detail` para v2 e ao mesmo tempo escrevi um aceite de Fase 1 que exige telefone —
incompatíveis. O critério de decisão agora está fechado em números no §8.3: medida a taxa de leads
com **celular** na busca de Campinas, **≥50% = melhoria (Fase 6) · 25–50% = requisito antes da Fase
4 · <25% = bloqueante imediato**. Medir só depois de corrigir o dedupe de card, senão a base do
percentual está inflada. Pedir dois números à Íris: % com qualquer telefone e % dos telefones que são
móveis — a queda em cada um tem remédio diferente. Não confirmado (o scraper nunca abriu o Maps).

**Melhorias da implementação que devem virar convenção do projeto:**
- `apps/web/src/lib/services/*` — camada de serviço não prevista no §2; rotas ficaram com ~10 linhas.
  Regra: nenhuma query Prisma em `route.ts`.
- `buildMachineUpdate()` **lança exceção** se campo fora da allowlist entrar no upsert — converteu
  uma regra de disciplina em falha de runtime.

Relacionado: [[innoprospect-arquitetura-v1]], [[innoprospect-armadilhas]], [[innoprospect-escopo]].
