# PROGRESSO — InnoProspect

Sistema de prospecção B2B: filtra empresas por **setor/nicho + UF**, coleta os
contatos, e dispara **mensagens de WhatsApp** para os leads.

- **Repositório:** github.com/OverSoccerClub/InnoProspect
- **Produção:** EasyPanel (projeto `inno-prospect`)
- **Arquitetura:** `ARQUITETURA.md` (Nova) · **Deploy:** `DEPLOY.md` (Vulcano)
- **Última atualização:** 2026-08-03

---

## Estado atual

O `frontend` está **no ar** e o login funciona. As Fases 1, 2 (parcial) e 3
estão escritas, commitadas e validadas por build. **O worker ainda não subiu**,
e por isso **nenhum lead real foi coletado até hoje**.

### Concluído e commitado

| Fase | Entrega | Commit |
|---|---|---|
| 1 | Monorepo, Docker, configs, deploy EasyPanel | `83f02a9` |
| 1 | Schema Prisma (7 models) + seed IBGE (27 UFs, 5.571 municípios) | `83f02a9` |
| 1 | `packages/scraper` — Playwright, seletores isolados, sanity, fixtures | `83f02a9` |
| 1 | `packages/contracts` (Zod) e `packages/core` (regras puras) | `83f02a9` |
| 1 | `apps/worker` — fila BullMQ, 1 job por município, retry por tipo de erro | `83f02a9` |
| 1 | API `/api/v1` (locations, searches, leads, health) + Auth.js + middleware | `83f02a9` |
| 1 | Telas: login, shell, buscas, progresso ao vivo, leads | `83f02a9` |
| — | Correções da auditoria do Órion (CVE do Next, login/logout) | `d139967` |
| — | `apps/web/public` (build da imagem) | `e2c14bf` |
| — | Normalização de e-mail do admin + ferramenta `admin.ts` | `3949305` |
| — | `RUN_SEED` no boot + comando correto do tsx | `93463c8` |
| — | Diagnóstico de login no log do servidor | `5c0cb89` |
| 3 | `packages/messaging` — cliente Evolution + parser de webhook | `95702ed` |
| 2/3/4 | Schema com 10 tabelas novas (migração aditiva) | `ff3d794` |
| 3 | Opt-out, templates com spintax, instâncias WhatsApp, webhook + telas | `bb6e934` |

**Validação atual:** typecheck 8/8, lint 6/6, **164 testes** (core 81,
messaging 48, scraper 35, contracts), build com 21/21 páginas.

---

## Próximos passos, em ordem

### 1. Subir o worker (ação do dono — BLOQUEIA tudo que segue)
Serviço `inno-prospect-backend` no EasyPanel: `apps/worker/Dockerfile`,
contexto de build `/`, **sem porta, sem domínio, sem health check HTTP**.
Variáveis em `DEPLOY.md §6`. Sem ele, toda busca criada fica em `queued` para
sempre — não há ninguém consumindo a fila.

### 2. Aplicar a migração das Fases 2/3/4
Roda sozinha no próximo deploy do `frontend` (o entrypoint faz
`migrate deploy`). **É a primeira migração deste projeto a rodar em banco com
dado dentro.** Se falhar, o container não sobe — é fail-fast proposital, e o
EasyPanel mantém a versão anterior no ar.

### 3. Validar o critério de aceite da Fase 1 — nunca feito
Buscar **"clínica odontológica" em Campinas-SP** e obter ≥ 30 leads com nome e
telefone em < 3 minutos, sem duplicatas.

⚠️ **Este é o teste mais importante do projeto.** É a primeira vez que o
scraper abre o Google Maps de verdade. A falha mais provável é seletor errado
— e, por desenho, isso é fix em **um arquivo só**
(`packages/scraper/src/extraction/selectors.ts`).

### 4. Fase 4 — campanhas e disparo com anti-ban
Único bloco grande que falta para o sistema fazer o que promete. Inclui:
seleção de público, `dispatch-tick.job` com `FOR UPDATE SKIP LOCKED`, janela de
envio, jitter, rotação entre instâncias, aquecimento e kill switch.

**Pré-requisito já resolvido:** o opt-out existe (Fase 3).

### 5. Fase 5 — segurança e operação
Rate limit de login, headers de segurança (CSP), retenção LGPD, backup do
Postgres com restore testado, `requeue-orphans`, monitoramento.

---

## Decisões em aberto (dependem do dono)

1. **Rate limit de login no proxy do EasyPanel.** Não existe (adiado para a
   Fase 5, quando a premissa era "poucos usuários internos"). O domínio agora é
   público. Recomendação: ligar um rate limit por IP — é configuração, não código.
2. **HTTPS no painel do EasyPanel.** Está sendo acessado por IP sobre HTTP.
3. **Quantos números de WhatsApp** serão usados? Define se a rotação entre
   instâncias é essencial já na Fase 4.
4. **Texto padrão de descadastro** na 1ª mensagem: "responda SAIR" ou link
   público? O sistema suporta os dois.
5. **Backup do Postgres não existe.** Prioridade alta antes de dado de cliente real.
6. **Versão da imagem da Evolution API** não confirmada (`v2.2.3` é chute).

---

## Invariantes — não reabrir sem motivo forte

- **Fonte de leads:** scraping próprio. **Canal:** Evolution API.
  **Stack:** Next.js 15 + TS + Prisma + Postgres. Decisões do dono.
- **Opt-out é por telefone**, checado **antes de cada envio**, inclusive dentro
  de campanha em andamento. Nenhum disparo é habilitado sem ele.
- **Seletores do Google Maps vivem em UM arquivo só.**
- **Toda a Evolution API vive em `packages/messaging`.**
- **Re-scraping nunca sobrescreve dado humano** — `buildMachineUpdate()` lança
  exceção se um campo fora da allowlist tentar entrar no upsert.
- **Contadores são incrementados, nunca `COUNT(*)`** — telas fazem polling.
- **Eliminação LGPD apaga `CampaignTarget` junto** (ele guarda snapshot do
  telefone); os contadores agregados da `Campaign` preservam o histórico anônimo.
- **`halted` ≠ `paused`** — parada automática não é pausa humana.
- **`apps/web` nunca importa `@inno/scraper`** (arrastaria Playwright).

## Armadilhas já pagas (não repetir)

- Bugs que **só aparecem em `next build`**, nunca em `dev`/`typecheck`:
  componente como prop de Server→Client Component; middleware Edge + Prisma;
  imports `.js` de pacotes internos sem `transpilePackages` + `extensionAlias`.
- `COPY` de pasta inexistente aborta o build Docker — `apps/web/public` precisa
  do `.gitkeep`.
- pnpm em Docker exige `--shamefully-hoist`, senão falta dependência em runtime.
- **`node node_modules/.bin/tsx` NÃO funciona** (é shell script). Use
  `node node_modules/tsx/dist/cli.mjs`.
- O e-mail do admin precisa ser gravado em minúsculas — o `authorize`
  normaliza antes de buscar.
- `next build` falha no Windows no passo do `standalone` (EPERM de symlink).
  É limitação do SO; no container Linux funciona.
