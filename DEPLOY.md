# DEPLOY — InnoProspect no EasyPanel

> Autor: Vulcano (DevOps). Escrito para quem vai clicar na interface do
> EasyPanel, não só para quem já conhece Docker de cor. Referência de
> variáveis: `ARQUITETURA.md §10` e `.env.example` (revisado contra o código
> real nesta mesma entrega).
>
> ⚠️ **Nada aqui foi validado com um `docker build`/`docker compose up` de
> verdade** — não há Docker na máquina onde isto foi escrito. Os Dockerfiles
> e este guia foram revisados com cuidado linha a linha contra a estrutura
> real do repositório, mas o **primeiro build no EasyPanel é o primeiro teste
> real**. Trate o primeiro deploy como um ensaio: acompanhe os logs de build
> e de boot, não assuma que vai funcionar de primeira.

---

## 0. Antes de começar

- [ ] Repositório no GitHub criado e com o código já commitado (Atlas cuida do `git`).
- [ ] EasyPanel instalado e acessível na VPS.
- [ ] Um domínio (ou subdomínio) apontando para o IP da VPS, se for expor o `web` publicamente com HTTPS.
- [ ] Gerar agora, num terminal qualquer, os dois segredos que você vai colar depois:
  ```bash
  # NEXTAUTH_SECRET — segredo de sessão do Auth.js
  openssl rand -base64 32

  # EVOLUTION_API_KEY — chave da Evolution API (usada em dois lugares, tem que ser IGUAL nos dois)
  openssl rand -hex 32
  ```
  Guarde os dois valores num cofre de senhas — vai colar cada um em mais de um lugar abaixo.

---

## 1. Ordem de criação dos serviços

Siga esta ordem — cada serviço depende do anterior estar de pé:

1. **Postgres** (banco `innoprospect`)
2. **Redis**
3. **Evolution API** (depende de 1 e 2)
4. **web** (depende de 1 e 2; Evolution só é necessário quando a Fase 3 — WhatsApp — entrar em uso, mas configure o serviço já para não ter que voltar aqui)
5. **worker** (depende de 1 e 2; mesma observação sobre Evolution)

---

## 2. Postgres

No EasyPanel: **+ Add Service → Postgres** (template pronto).

- Nome do serviço: `innoprospect-postgres` (ou o que preferir — anote o **nome interno**, você vai usar como hostname na `DATABASE_URL`).
- Defina uma senha forte (gerador do próprio EasyPanel serve).
- Banco: `innoprospect`.
- **Não exponha a porta publicamente** — só o `web` e o `worker` precisam acessar, via rede interna do EasyPanel (os serviços de um mesmo projeto se enxergam pelo nome do serviço como hostname).

Se for usar a Evolution API com Postgres também (recomendado — ver §4), crie um **segundo banco** `evolution` dentro desse mesmo serviço Postgres (mais simples que subir um segundo container Postgres): no EasyPanel, entre no serviço Postgres → aba de terminal/console → `psql -U <user> -c "CREATE DATABASE evolution;"`. Se o EasyPanel não expuser um console fácil, crie um **segundo serviço Postgres dedicado** para a Evolution API — mais caro em RAM, mas mais simples de operar sem `psql` manual.

---

## 3. Redis

**+ Add Service → Redis** (template pronto).

- Nome do serviço: `innoprospect-redis`.
- Sem senha é aceitável só se a rede interna do EasyPanel já isola os serviços do projeto de outros projetos na mesma VPS — confirme isso na documentação do EasyPanel antes de decidir. Na dúvida, defina uma senha.
- **Não exponha a porta publicamente.**

---

## 4. Evolution API

**+ Add Service → App** (a partir de uma imagem Docker, não de um repositório Git).

- Imagem: `atendai/evolution-api:<versão pinada>` — **confira a versão estável atual em https://hub.docker.com/r/atendai/evolution-api antes de preencher** (eu não tenho como validar isso nesta sessão sem acesso à internet; `infra/docker-compose.yml` traz `v2.2.3` como ponto de partida, não como valor confirmado).
- **Nunca use a tag `latest`** — risco documentado em `ARQUITETURA.md §9.1` (R4): uma atualização quebrando compatibilidade derruba todo o disparo de WhatsApp sem aviso.
- **Não exponha a porta publicamente** — só `web` e `worker` falam com ela, pelo nome interno do serviço (ex.: `http://innoprospect-evolution:8080`).
- Variáveis de ambiente (nomes da v2.x — confirme contra a documentação oficial da versão que você pinou, https://doc.evolution-api.com, essas chaves mudam entre versões):
  | Variável | Valor |
  |---|---|
  | `SERVER_URL` | URL interna deste serviço, ex. `http://innoprospect-evolution:8080` |
  | `AUTHENTICATION_API_KEY` | o valor de `EVOLUTION_API_KEY` gerado no passo 0 |
  | `DATABASE_ENABLED` | `true` |
  | `DATABASE_PROVIDER` | `postgresql` |
  | `DATABASE_CONNECTION_URI` | `postgresql://<user>:<senha>@<nome-do-serviço-postgres>:5432/evolution` |
  | `CACHE_REDIS_ENABLED` | `true` |
  | `CACHE_REDIS_URI` | `redis://<nome-do-serviço-redis>:6379/1` (banco Redis `1`, separado do `0` que o BullMQ usa) |
  | `WEBHOOK_GLOBAL_ENABLED` | `false` (webhook é configurado por instância, via API, não global) |
- Volume persistente para `/evolution/instances` (sessões do WhatsApp — perder isso derruba todas as conexões e exige reconectar via QR de novo).

---

## 5. web (apps/web)

**+ Add Service → App → From GitHub repository.**

- Repositório: o que o Atlas está criando agora.
- **Build method: Dockerfile.**
- **Build context/path: a RAIZ do repositório** (não `apps/web/`) — isso é crítico, o `apps/web/Dockerfile` copia `pnpm-workspace.yaml`, `packages/db`, `packages/core`, `packages/contracts` de fora de `apps/web/`. Se o EasyPanel pedir "Build Path" e "Dockerfile Path" como campos separados, deixe o primeiro na raiz (`.` ou vazio) e o segundo como `apps/web/Dockerfile`.
- Porta interna do container: `3000` (variável `PORT`, já default no Dockerfile).
- Domínio: configure o seu (ex. `app.seudominio.com.br`), com HTTPS automático do EasyPanel.
- **Health check**: caminho `/api/v1/health`, porta `3000`. Essa rota é pública (não exige sessão) e faz `SELECT 1` no Postgres — só fica `200` se o banco estiver realmente acessível, não só se o processo Node subiu. Configure o EasyPanel para considerar o deploy saudável só depois de N checks `200` consecutivos, e para **manter a versão anterior no ar** (rollback automático) se o novo container não ficar saudável dentro do timeout — é assim que o `docker-entrypoint.sh` fail-fast (ver comentário no próprio arquivo) protege o deploy: se `prisma migrate deploy` falhar, o container nem chega a responder o health check.

### Variáveis de ambiente do `web`

| Variável | Valor | Observação |
|---|---|---|
| `DATABASE_URL` | `postgresql://<user>:<senha>@<serviço-postgres>:5432/innoprospect` | |
| `REDIS_URL` | `redis://<serviço-redis>:6379` | banco `0` (default), separado do `1` da Evolution |
| `NEXTAUTH_SECRET` | o valor gerado no passo 0 | **runtime**, não build — pode trocar sem rebuild |
| `NEXTAUTH_URL` | `https://<seu-domínio>` | tem que bater com o domínio configurado |
| `APP_TIMEZONE` | `America/Sao_Paulo` | |
| `PORT` | `3000` | |
| `RUN_MIGRATIONS` | `true` | só mude para `false` se tiver certeza que outra réplica já migrou este release |
| `ADMIN_EMAIL` / `ADMIN_NAME` / `ADMIN_PASSWORD` | seus valores | usados só quando você rodar o seed manualmente (§7) |
| `EVOLUTION_API_URL` | `http://<serviço-evolution>:8080` | Fase 3, prepare já |
| `EVOLUTION_API_KEY` | o mesmo valor usado em `AUTHENTICATION_API_KEY` da Evolution | tem que ser IGUAL nos dois lados |
| `EVOLUTION_WEBHOOK_BASE_URL` | `https://<seu-domínio>/api/webhooks/evolution` | |
| `LOG_LEVEL` | `info` | |

⚠️ **`NEXT_PUBLIC_USE_MOCKS` e `NEXT_PUBLIC_API_BASE_URL` NÃO vão nesta tabela** — são embutidas no bundle JavaScript do navegador **durante o `docker build`**, não lidas em runtime. O `apps/web/Dockerfile` já builda com `NEXT_PUBLIC_USE_MOCKS=false` por padrão (produção real, sem mock) — não precisa (e não adianta) definir isso como env do serviço no EasyPanel depois do build pronto.

---

## 6. worker (apps/worker)

**+ Add Service → App → From GitHub repository** (mesmo repositório).

- **Build method: Dockerfile. Build context/path: a RAIZ do repositório. Dockerfile Path: `apps/worker/Dockerfile`.**
- **Sem porta exposta, sem domínio** — é um processo de fila, não um servidor HTTP.
- **Sem health check HTTP** — configure o EasyPanel para reiniciar automaticamente (`restart: always`) se o processo cair; a saúde de verdade dele (scraper quebrado, instância banida) é medida por `ScraperHealthEvent` dentro da aplicação (Fase 2/5.6, ainda não implementado).

### Variáveis de ambiente do `worker`

Mesmas de `DATABASE_URL`, `REDIS_URL`, `LOG_LEVEL`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` da tabela acima, **mais**:

| Variável | Valor |
|---|---|
| `SCRAPE_CONCURRENCY` | `2` |
| `SCRAPE_RATE_PER_MIN` | `6` |
| `SCRAPE_DELAY_MIN_MS` / `SCRAPE_DELAY_MAX_MS` | `8000` / `25000` |
| `SCRAPE_HEADLESS` | `true` |
| `SCRAPE_CONTEXT_TTL` | `15` |
| `SCRAPE_INCIDENT_DIR` | `/data/incidents` (monte um volume persistente aqui se quiser preservar evidência de incidente entre deploys) |
| `PROXY_PROVIDER` | `noop` |

`worker` **não** roda `prisma migrate deploy` (só o `web` faz isso, uma vez) — mas gera seu próprio Prisma Client no build (mesmo schema).

---

## 7. Primeiro boot — passo a passo

1. Suba **Postgres** e **Redis**, confirme que os healthchecks deles ficam verdes.
2. Suba a **Evolution API**, confirme que responde (log sem erro de conexão com Postgres/Redis).
3. Faça o **build e deploy do `web`**. Acompanhe o log de build — é aqui que qualquer problema de `pnpm install`/`prisma generate`/`next build` no monorepo vai aparecer primeiro. Acompanhe o log de **boot** logo em seguida — é aqui que `prisma migrate deploy` roda pela primeira vez contra o banco vivo (a migração nunca foi aplicada de verdade até hoje, conforme `PROGRESSO.md`). Se falhar, o container não sobe — leia o erro, é sempre mais claro que adivinhar.
4. Confirme `GET https://<seu-domínio>/api/v1/health` → `200 {"status":"ok","database":"ok",...}`.
5. Rode o seed **uma vez**, manualmente (não faz parte do boot automático — só a migração é automática, de propósito, para não recriar o admin a cada deploy): abra um shell no container `web` pelo EasyPanel (working dir `/app`) e rode:
   ```sh
   cd packages/db && node ../../node_modules/.bin/tsx prisma/seed.ts
   ```
   (roda `seed.ts` diretamente via `tsx`, em vez de `prisma db seed` — evita a ambiguidade de qual `package.json` o CLI do Prisma vai procurar o campo `prisma.seed` num monorepo com o working dir em `/app`, não em `packages/db`. `node_modules/.bin/tsx` existe na raiz porque o `apps/web/Dockerfile` instala com `--shamefully-hoist` — se o binário não estiver lá, rode `find / -name tsx -type f 2>/dev/null` dentro do container para localizar.)
6. Faça login em `/login` com o `ADMIN_EMAIL`/`ADMIN_PASSWORD` do seed.
7. Suba o **worker**. Acompanhe o log — ele deve conectar no Redis e ficar ouvindo a fila `scrape:search` sem erro.
8. Teste o critério de aceite da Fase 1 (`ARQUITETURA.md §8`): buscar "clínica odontológica" em Campinas-SP deve devolver ≥ 30 leads em < 3 minutos, sem duplicatas.

---

## 8. O que NÃO está resolvido ainda (declarado explicitamente, não escondido)

- **Rotação de segredos.** `NEXTAUTH_SECRET` e `EVOLUTION_API_KEY` não têm processo de rotação definido. Trocar hoje invalida todas as sessões ativas (aceitável) e quebra a conexão da Evolution API até você atualizar o valor nos dois lados (web/worker E Evolution) ao mesmo tempo.
- **Backup do Postgres.** `ARQUITETURA.md §8` (item 5.5, minha própria entrega da Fase 5) pede "backup diário do Postgres com **restore testado**" — isso ainda **não existe**. `infra/backup/pg-dump.sh` mencionado na estrutura de pastas (§2) não foi criado nesta entrega. Sem isso, uma perda de volume do Postgres no EasyPanel é perda de dado real e irrecuperável. Prioridade alta antes de colocar dado de cliente de verdade em produção.
- **`requeue-orphans` no boot do worker** (mencionado em `ARQUITETURA.md §9.1` R10) — se o Redis cair e perder a fila, nada reenfileira automaticamente as `SearchTask`/`CampaignTarget` presas em `pending`/`running`. Território do Vega, não meu.
- **Monitoramento pós-deploy real** (métricas de erro/latência, alertas). Hoje só existe o health check de boot — não há dashboard nem alerta contínuo. `ALERT_WEBHOOK_URL` está documentada no `.env.example` mas **não é lida pelo código ainda** (Fase 5.6).
- **Versão da imagem da Evolution API não confirmada** — eu não tenho acesso à internet nesta sessão para checar a tag estável mais recente. Confirme antes do primeiro deploy real (§4).
- **Nenhum dos Dockerfiles/compose foi validado com `docker build`/`docker compose up` de verdade** — sem Docker nesta máquina de desenvolvimento. O primeiro build no EasyPanel é o primeiro teste real (ver aviso no topo deste documento).
