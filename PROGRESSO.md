# PROGRESSO — InnoProspect

Sistema de prospecção B2B: filtra empresas por **setor/nicho + UF**, coleta os
contatos, e dispara **mensagens de WhatsApp** para os leads.

- **Repositório:** github.com/OverSoccerClub/InnoProspect
- **Produção:** EasyPanel (projeto `inno-prospect`)
- **Arquitetura:** `ARQUITETURA.md` **v1.1** · **Deploy:** `DEPLOY.md`
- **Revisões:** `REVISAO-ARQUITETURA.md` (Nova) · `REVISAO-QA.md` (Íris)
- **Última atualização:** 2026-08-03

---

## Estado atual

O `frontend` está no ar, o login funciona e o banco está migrado. As Fases 1, 2
(parcial) e 3 estão escritas e testadas. A **Fase 4 (campanhas e disparo) não
existe**.

⚠️ **Continua valendo:** o **worker nunca subiu em produção** e **nenhum lead
real foi coletado**. O scraper jamais abriu o Google Maps.

### Métricas

| | |
|---|---|
| Testes | **219** (core 81, messaging 48, web 48, scraper 35, contracts 7) |
| Rotas de API | 23 |
| `pnpm test` na raiz | ✅ existe e roda tudo |

---

## Revisão profunda (2026-08-03) — o diagnóstico

Três auditorias independentes convergiram no mesmo ponto: **o problema não era
o que faltava escrever, era o que estava escrito e não estava ligado.**

| Achado | Estado |
|---|---|
| Assertions de sanidade do scraper eram **código morto** (zero chamadores) | ✅ ligadas |
| Pausa da fila era `setTimeout` **em memória** — sumia no restart | ✅ persistida no Redis |
| `/health` respondia **"ok" com o worker morto** | ✅ reporta cada dependência |
| Rotas públicas **sem rate limit**, corpo parseado antes da auth | ✅ corrigido |
| UI tratava `RATE_LIMITED` que o backend **nunca emitia** | ✅ backend emite |
| `USE_MOCKS` era **fail-open** (default = dado falso) | ✅ invertido |
| `isOptedOut` chumbado em `false`, filtro no-op | ✅ consulta real |
| `apps/web` com **zero testes** | ✅ 48 testes |
| **Sem backup** do Postgres | ✅ documentado + scripts |
| Imagem da Evolution API **órfã desde 2025** | ✅ `evoapicloud/evolution-api:v2.3.7` |
| Nada no sistema chama `sendText` | ⏳ contrato §4.9 escrito, **falta implementar** |

### Commits da rodada

`addc7d4` opt-out real na listagem · `17d81c1` ARQUITETURA v1.1 + contrato do
envio unitário · `a1d3a2e` infra de teste · `fc46446` sanidade, pausa,
heartbeat, rate limit · `f9014fd` backup, headers, Evolution despinada

---

## Próximos passos, em ordem

### 1. Subir o worker (ação do dono — BLOQUEIA tudo)
`inno-prospect-backend`: `apps/worker/Dockerfile`, contexto `/`, **sem porta,
sem domínio, sem health check HTTP**. Sem ele toda busca fica em `queued`.

### 2. Ativar o backup (ação do dono)
`infra/backup/README.md`. O EasyPanel tem recurso **nativo** de backup de
Postgres com destino S3-compatível — usar como primário. **Testar o restore**
num serviço descartável; backup sem restore testado não é backup.

### 3. Rodar a busca de Campinas — o dado que decide uma feature
"clínica odontológica" em Campinas-SP. Precisa reportar **dois números**: % de
leads com telefone e % dos telefones que são móveis. Cortes em `ARQUITETURA.md
§8.3` (≥50% / 25–50% / <25%) decidem se `scrape-detail` é melhoria ou requisito
— o card da lista do Maps frequentemente não traz telefone.

### 4. Implementar o §4.9 — envio unitário
`POST /api/v1/leads/:id/messages`. **A primeira mensagem que o sistema envia.**
O guard de opt-out nasce aqui, com carimbo de 5s que faz o código quebrar se
alguém cachear a blacklist. A Fase 4 herda um portão já exercitado.

### 5. Fase 4 — campanhas e disparo com anti-ban
`dispatch-tick`, `warmup-roll`, janela, jitter, rotação, kill switch.

### 6. Fase 5 — retenção LGPD, eliminação do titular, monitoramento

---

## Decisões em aberto (dependem do dono)

1. **Horário de envio:** piso 08:00–20:00, sem domingo (§4.9.6), ancorado no
   parâmetro de telemarketing porque é o que sustenta a base legal de legítimo
   interesse. Se o nicho tiver praxe diferente, o número é do dono — **mas só
   para estreitar**.
2. **HTTPS no painel do EasyPanel** — acessado por IP sobre HTTP.
3. **Quantos números de WhatsApp?** Define se a rotação entre instâncias é
   essencial na Fase 4.
4. **Texto de descadastro na 1ª mensagem:** "responda SAIR" ou link público?

---

## Invariantes — não reabrir sem motivo forte

- **Fonte:** scraping próprio. **Canal:** Evolution API. **Stack:** Next 15 + TS
  + Prisma + Postgres.
- **Opt-out é por telefone**, checado antes de cada envio. O guard **lança
  exceção** se a checagem tiver mais de 5s — impossível cachear por acidente.
- **Só pode existir UM call site de `sendText`** em produção. Mais de um =
  segundo caminho sem portão. Auditoria: `grep -rn "sendText(" apps/ packages/`.
- **Seletores do Maps em UM arquivo.** **Evolution API só em `packages/messaging`.**
- **Re-scraping nunca sobrescreve dado humano** (`buildMachineUpdate` lança).
- **Contadores incrementados, nunca `COUNT(*)`** — telas fazem polling.
- **Eliminação LGPD apaga `CampaignTarget`** (guarda snapshot do telefone); os
  contadores agregados preservam o histórico anônimo.
- **`halted` ≠ `paused`.** **Pausa por mudança de layout é indefinida** — só sai
  com decisão humana.
- **`apps/web` nunca importa `@inno/scraper`.**
- **Modo degradado tem que ser difícil de ativar**, nunca o padrão.

## Armadilhas já pagas (não repetir)

- Bugs que **só aparecem em `next build`**: componente como prop de
  Server→Client; middleware Edge + Prisma; imports `.js` sem `transpilePackages`.
- **`COPY` de pacote do workspace esquecido no Dockerfile não quebra o
  `pnpm install`** — falha só no bundle. Há guarda nos dois Dockerfiles agora.
- `COPY` de pasta inexistente aborta o build — `apps/web/public/.gitkeep`.
- pnpm em Docker exige `--shamefully-hoist`.
- **`node node_modules/.bin/tsx` NÃO funciona** (shell script). Use
  `node node_modules/tsx/dist/cli.mjs`.
- E-mail do admin precisa ser gravado em minúsculas.
- `next build` falha no Windows no passo `standalone` (EPERM de symlink) — é o
  SO, não o código.
- **`Queue#client` do BullMQ não é o cliente do ioredis** — abstração própria.
