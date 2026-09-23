---
name: innoprospect-estado-real
description: O que está realmente ligado vs. escrito no InnoProspect — atualizado em 2026-09-23, quando o sistema entrou em produção de verdade (~260 leads coletados) e a premissa "nunca rodou" morreu
metadata:
  type: project
---

**Atualizado em 2026-09-23.** A revisão anterior (2026-08-03) descrevia um sistema que nunca tinha
tocado infra real. Isso acabou: entre 22 e 23/09 o sistema subiu no EasyPanel, coletou ~260 leads
reais do Google Maps e o painel/listagem/ficha/templates/instâncias/opt-out estão em uso.

**A distinção que continua valendo: "escrito" ≠ "ligado".** Mas ela mudou de lugar — desta vez o
wiring foi feito. As peças que em 08/2026 eram código morto (`evaluateSanity`, `effectiveDailyLimit`,
`EvolutionClient.sendText`) hoje têm chamador em produção. O novo modo de falha do projeto é outro:
**o artefato de produção não é o artefato de dev.**

**O que VERIFIQUEI no código em 2026-09-23:**
- **Fase 4 não existe como rota nem como job.** Não há `app/api/v1/campaigns/**`; `apps/worker` só
  tem `scrape-search.job` + `requeue-orphans`. `/campanhas` é uma tela de roadmap (14 linhas).
- **Mas está mais perto do que parece:** `packages/contracts/src/campaign.contract.ts` (244 linhas)
  está completo, e `apps/web/src/lib/services/campaign-targets.ts` (transição de status + incremento
  de contador + `haltCampaignsSoleInstanceDisconnected`) **já é chamado em produção** pelo webhook,
  pelo envio unitário e pelo disconnect manual. A entrega 4.D é menor do que o §8 sugere.
- **Nada da cadência do §6.8 existe:** zero ocorrências de `nextSendAllowedAt`,
  `sendsSinceMicroPause`, `consecutiveUncertain`, `SEND_PACE_LOCKED`, `LEAD_CONTACT_COOLDOWN`,
  `ignorePaceLock`, `drawJitter`. 4.A e 4.B estão inteiramente por fazer. Consequência **hoje**: o
  envio unitário não tem freio de ritmo — dá para clicar 20 vezes em um minuto.
- **`RawCapture`: zero referências em todo o código.** Tabela com 3 índices que ninguém escreve nem
  lê, e o `retention.job` que existia para limpá-la também tem zero ocorrências.
- **Alertas só no worker e só sobre a fila de scrape** (3 kinds: `sanity_incident_opened`,
  `queue_paused`, `queue_resumed`). `apps/web` não emite alerta nenhum — instância caindo, Evolution
  fora, falha de envio e `halted` são silenciosos. E `ALERT_WEBHOOK_URL` está desligada.
- **Recuperação de senha do admin JÁ EXISTE** como caminho de ops sem terminal:
  `ADMIN_RESET_PASSWORD=true` + `ADMIN_PASSWORD` + `RUN_SEED=true` + redeploy (implementado em
  `packages/db/prisma/seed.ts` e `apps/web/docker-entrypoint.sh`, documentado no `DEPLOY.md §7`).
  Não é bloqueador. ⚠️ O docblock de `packages/db/prisma/admin.ts` ainda ensina
  `node ../../node_modules/.bin/tsx ...`, que o `DEPLOY.md` avisa que NÃO funciona.
- **A medida do §8.3 (taxa de celular) não é pesquisa — é leitura de tela.**
  `GET /api/v1/dashboard/summary` já devolve `withPhone` e `withMobile`, e `leadFilterSchema` aceita
  `searchJobId` + `phoneType` + `offNiche`. Dá para medir por busca isolada. Medir só sobre busca
  posterior ao commit `3da386d` (seletores do card consertados), senão o número está subestimado.

**Documentos que envelheceram (corrigir antes de planejar em cima):**
- `PROGRESSO.md` está desatualizado **para menos**: diz "nada está no GitHub nem em produção",
  "404 em todas as rotas", "nunca coletou um lead real". Tudo falso desde 22-23/09. Pior: lista a
  "Decisão em aberto nº 1 (uso próprio ou venda)" como aberta, sendo que o dono a fechou em 22/09.
- `ARQUITETURA.md §8.3` afirma "o scraper nunca abriu o Maps". Falso desde 22/09.

Relacionado: [[innoprospect-arquitetura-v1]], [[innoprospect-armadilhas]], [[innoprospect-escopo]],
[[innoprospect-fase4-motor]], [[nova-licoes-plano-faseado]], [[innoprospect-uso-proprio]].
