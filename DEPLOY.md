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
>
> ⚠️ **`infra/docker-compose.yml` NÃO é a produção.** A produção é este
> documento — cada serviço criado avulso na UI do EasyPanel. Aquele arquivo
> é só para validar localmente, numa máquina com Docker, que os mesmos
> Dockerfiles sobem juntos; nunca rodou nem roda em produção. Se você
> chegou aqui depurando um incidente, o estado real está no painel do
> EasyPanel, não naquele arquivo.

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

- Imagem: **`evoapicloud/evolution-api:v2.3.7`** — confirmada com acesso à
  rede em 2026-08-03 (última tag estável, publicada 2025-12-05; existe
  `2.4.0-rc1`/`rc2`, mais recentes mas release-candidate, **não use**).
  ⚠️ **O projeto mudou de nome/organização e de imagem Docker.** Era
  `EvolutionAPI/evolution-api` → imagem `atendai/evolution-api`; agora é
  `evolution-foundation/evolution-api` (marca "Evolution Foundation") →
  imagem **`evoapicloud/evolution-api`**. A imagem antiga (`atendai/...`)
  ficou órfã (nenhum push desde meados de 2025) e nunca teve nada além da
  v2.2.3 — que era exatamente o "chute" que estava aqui antes. Se você
  pinar uma versão mais nova no futuro, confirme de novo em
  https://github.com/evolution-foundation/evolution-api/releases (tags
  `latest`/prerelease não servem) e em
  https://hub.docker.com/r/evoapicloud/evolution-api/tags.
- **Nunca use a tag `latest`** — risco documentado em `ARQUITETURA.md §9.1` (R4): uma atualização quebrando compatibilidade derruba todo o disparo de WhatsApp sem aviso.
- **Não exponha a porta publicamente** — só `web` e `worker` falam com ela, pelo nome interno do serviço (ex.: `http://innoprospect-evolution:8080`).
- Variáveis de ambiente — conferidas em 2026-08-03 contra o `.env.example`
  REAL da tag `2.3.7` (`https://github.com/evolution-foundation/evolution-api/blob/2.3.7/.env.example`
  — repare que a tag git não tem o "v" que aparece no nome da release):
  | Variável | Valor |
  |---|---|
  | `SERVER_URL` | URL interna deste serviço, ex. `http://innoprospect-evolution:8080` |
  | `AUTHENTICATION_API_KEY` | o valor de `EVOLUTION_API_KEY` gerado no passo 0 |
  | `DATABASE_ENABLED` | `true` — ⚠️ essa chave **não aparece mais** no `.env.example` da 2.3.7 (existia na v2.2.x, que foi a base deste guia antes). Deixe por precaução — env var desconhecida costuma ser ignorada — mas **acompanhe o log de boot** da Evolution API no primeiro deploy: se houver aviso de variável não reconhecida, remova esta linha. |
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

### ⚠️ Build-time vs runtime — onde cada variável vai no EasyPanel

O EasyPanel normalmente separa, na tela do serviço `web`, um campo para
**"Build" (vira `--build-arg`)** e outro para **"Environment" (env do
container em runtime)**. Essa distinção não é cosmética: **tudo que entra
como build-arg fica gravado permanentemente na imagem** — qualquer pessoa
com acesso ao registry/`docker history` da imagem consegue ler de volta, e
o valor aparece **em texto puro no log de build**. Runtime env não tem
nenhum desses dois problemas (não é impresso no log de build, não fica
gravado na imagem).

Contra o `apps/web/Dockerfile` real:

| Variável | Build-arg? | Por quê |
|---|---|---|
| `DATABASE_URL` | Sim, mas **não precisa do valor real** | O `prisma generate` (stage `generate`) só precisa de uma URL com formato válido pra resolver o schema — **nunca conecta de verdade**. O Dockerfile já tem um placeholder (`postgresql://user:pass@localhost:5432/placeholder`) como default do `ARG`. **Não sobrescreva isso com a senha real do Postgres de produção** — não há motivo, e isso seria exatamente o vazamento que este aviso existe para evitar. Deixe o EasyPanel construir sem preencher este build-arg. |
| `NEXT_PUBLIC_USE_MOCKS` | Sim (mas não é segredo) | Vira parte do bundle JS do navegador — tem que existir em build-time por definição. Default do Dockerfile já é `false` (produção real); só mexa se quiser uma imagem de demonstração com mocks. |
| `NEXT_PUBLIC_API_BASE_URL` | Sim (mas não é segredo) | Mesmo motivo acima. Deixe vazio (mesma origem) no caso normal. |
| **Todas as outras** (`NEXTAUTH_SECRET`, `EVOLUTION_API_KEY`, `ADMIN_PASSWORD`, senha do Postgres embutida numa `DATABASE_URL` de verdade, senha do Redis, etc.) | **NÃO** | São lidas em runtime pelo processo Node (`process.env.*`), nunca pelo `next build`. Coloque SÓ no campo "Environment"/runtime do EasyPanel. Colocar aqui não muda nada funcionalmente hoje (o build já usa o placeholder) — o único efeito de colocar por engano seria vazar o segredo no log de build e gravá-lo na imagem, sem nenhum ganho. |

**Regra prática para quem for preencher a tela do EasyPanel:** se o campo se
chama "Build"/"Build Arguments"/"Build Variables", só preencha
`NEXT_PUBLIC_USE_MOCKS`/`NEXT_PUBLIC_API_BASE_URL` se precisar mudar o
default — e nunca cole um segredo ali. Tudo que tem "senha", "secret",
"key" ou "password" no nome vai no campo de runtime, sempre.

O mesmo vale para `apps/worker` — o `apps/worker/Dockerfile` não declara
**nenhum** `ARG` de segredo (confirmado lendo o arquivo nesta entrega); toda
variável do worker é runtime.

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
| `OPTOUT_TOKEN_SECRET` | gerar com `openssl rand -base64 32` | ⚠️ **obrigatória antes de enviar qualquer mensagem.** Assina o link de descadastro que vai em cada mensagem. Sem ela, a página pública `/descadastro/:token` recusa **todos** os links (fail-closed): a pessoa clica para sair da lista e recebe erro, o que quebra o mecanismo de LGPD. Trocar o valor invalida os links já enviados. |
| `APP_COMPANY_NAME` | nome da sua empresa | Preenche `{{minha_empresa}}` nos templates. A primeira mensagem precisa identificar quem está falando (ARQUITETURA §7.4) |

⚠️ **`NEXT_PUBLIC_USE_MOCKS` e `NEXT_PUBLIC_API_BASE_URL` NÃO vão nesta tabela** — são embutidas no bundle JavaScript do navegador **durante o `docker build`**, não lidas em runtime. O `apps/web/Dockerfile` já builda com `NEXT_PUBLIC_USE_MOCKS=false` por padrão (produção real, sem mock) — não precisa (e não adianta) definir isso como env do serviço no EasyPanel depois do build pronto. Ver a subseção "Build-time vs runtime" acima para a tabela completa de quem é build-arg e quem é runtime — **todas as variáveis da tabela acima são runtime**, nenhuma delas deve ir no campo de "Build" do EasyPanel.

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
| `ALERT_WEBHOOK_URL` | opcional: URL de webhook de entrada do Slack ou do Google Chat |

**Alertas (`ALERT_WEBHOOK_URL`, no serviço `worker`, não no `web`).** O worker envia um aviso quando abre um incidente de sanidade do scraper, quando a fila pausa por erro de coleta e quando uma pausa temporizada é retomada. Só na mudança de estado, nunca a cada ciclo. Para Slack: crie um *Incoming Webhook* no canal e cole a URL. Para Google Chat: *Webhooks de entrada* no espaço. Sem a variável, o worker funciona normalmente e registra no log de boot que os alertas estão desligados. Retomadas manuais pelo painel não geram aviso, porque quem clicou já sabe.

`worker` **não** roda `prisma migrate deploy` (só o `web` faz isso, uma vez) — mas gera seu próprio Prisma Client no build (mesmo schema).

---

## 7. Primeiro boot — passo a passo

1. Suba **Postgres** e **Redis**, confirme que os healthchecks deles ficam verdes.
2. Suba a **Evolution API**, confirme que responde (log sem erro de conexão com Postgres/Redis).
3. Faça o **build e deploy do `web`**. Acompanhe o log de build — é aqui que qualquer problema de `pnpm install`/`prisma generate`/`next build` no monorepo vai aparecer primeiro. Acompanhe o log de **boot** logo em seguida — é aqui que `prisma migrate deploy` roda pela primeira vez contra o banco vivo (a migração nunca foi aplicada de verdade até hoje, conforme `PROGRESSO.md`). Se falhar, o container não sobe — leia o erro, é sempre mais claro que adivinhar.
4. Confirme `GET https://<seu-domínio>/api/v1/health` → `200 {"status":"ok","database":"ok",...}`.
5. Rode o seed **uma vez**, manualmente (não faz parte do boot automático — só a migração é automática, de propósito, para não recriar o admin a cada deploy): abra um shell no container `web` pelo EasyPanel (working dir `/app`) e rode:
   **Opção A (recomendada — não exige terminal no container):** defina
   `RUN_SEED=true` nas envs do serviço `web` e faça o redeploy. O seed roda no
   boot e o resultado aparece no **log de deploy**, incluindo a linha
   `→ e-mail do admin (normalizado): ...`, que é o jeito mais rápido de
   descobrir por que um login falha. **Remova a variável depois** — o seed é
   idempotente, mas deixar ligado só custa tempo de boot.

   **Opção B (terminal no container, working dir `/app`):**
   ```sh
   node node_modules/tsx/dist/cli.mjs packages/db/prisma/seed.ts
   ```
   ⚠️ Use este caminho, **não** `node node_modules/.bin/tsx`: o `.bin/tsx` é um
   shell script wrapper e o `node` não consegue executá-lo — falha de um jeito
   confuso ou simplesmente não faz nada.

   Ferramenta de manutenção do admin (mesmo working dir):
   ```sh
   node node_modules/tsx/dist/cli.mjs packages/db/prisma/admin.ts list
   node node_modules/tsx/dist/cli.mjs packages/db/prisma/admin.ts set-password email@dominio.com SenhaForte
   ```

   **Perdeu a senha do admin e não tem terminal?** Defina `ADMIN_PASSWORD` com
   a senha nova, `ADMIN_RESET_PASSWORD=true` e `RUN_SEED=true`, e faça o
   redeploy. Depois **remova `ADMIN_RESET_PASSWORD`**.
   (roda `seed.ts` diretamente via `tsx`, em vez de `prisma db seed` — evita a ambiguidade de qual `package.json` o CLI do Prisma vai procurar o campo `prisma.seed` num monorepo com o working dir em `/app`, não em `packages/db`. `node_modules/.bin/tsx` existe na raiz porque o `apps/web/Dockerfile` instala com `--shamefully-hoist` — se o binário não estiver lá, rode `find / -name tsx -type f 2>/dev/null` dentro do container para localizar.)
6. Faça login em `/login` com o `ADMIN_EMAIL`/`ADMIN_PASSWORD` do seed.
7. Suba o **worker**. Acompanhe o log — ele deve conectar no Redis e ficar ouvindo a fila `scrape-search` sem erro.
8. Teste o critério de aceite da Fase 1 (`ARQUITETURA.md §8`): buscar "clínica odontológica" em Campinas-SP deve devolver ≥ 30 leads em < 3 minutos, sem duplicatas.

---

## 7.5. Backup do Postgres — obrigatório antes de dado de cliente real

Passo a passo completo, com o teste de restore, em `infra/backup/README.md`.
Resumo: ative o recurso nativo "Database Backups" do serviço Postgres no
EasyPanel (agendamento + retenção + destino S3-compatível externo), e
**teste o restore de verdade** antes de considerar isto resolvido — um
backup nunca restaurado é uma suposição, não uma proteção. `infra/backup/`
também tem `pg-dump.sh`/`pg-restore.sh` como caminho manual (avulso ou se a
sua licença do EasyPanel não incluir backup agendado nativo).

⚠️ Nenhum comando de backup/restore foi executado nesta sessão — sem
Postgres nem Docker disponíveis. O que precisa ser verificado no primeiro
uso está listado no topo de cada script e no checklist final do README.

---

## 8. O que NÃO está resolvido ainda (declarado explicitamente, não escondido)

- **Rotação de segredos.** `NEXTAUTH_SECRET` e `EVOLUTION_API_KEY` não têm processo de rotação definido. Trocar hoje invalida todas as sessões ativas (aceitável) e quebra a conexão da Evolution API até você atualizar o valor nos dois lados (web/worker E Evolution) ao mesmo tempo. Território do Órion (revisão de 2026-08-03, P10) — cito e sigo.
- **`requeue-orphans` no boot do worker** (mencionado em `ARQUITETURA.md §9.1` R10) — se o Redis cair e perder a fila, nada reenfileira automaticamente as `SearchTask`/`CampaignTarget` presas em `pending`/`running`. Território do Vega, não meu.
- **Monitoramento pós-deploy real** (métricas de erro/latência, alertas). Hoje só existe o health check de boot — não há dashboard nem alerta contínuo. Desde 2026-09-22 o worker envia alertas de fila e scraper por `ALERT_WEBHOOK_URL` (ver §6), e `infra/backup/pg-dump.sh` dispara nela quando o backup falha. Ainda não há alerta para o `web` fora do ar nem métricas de erro e latência.
- **Monitoramento do próprio backup** (§7.5) — se o job agendado do EasyPanel parar de rodar silenciosamente, hoje ninguém é avisado automaticamente; é preciso abrir o Backups Log na mão. Ver `infra/backup/README.md §5`.
- **Nenhum dos Dockerfiles/compose foi validado com `docker build`/`docker compose up` de verdade** — sem Docker nesta máquina de desenvolvimento. O primeiro build no EasyPanel é o primeiro teste real (ver aviso no topo deste documento).
- **Headers de segurança (`next.config.ts`) validados só até onde esta máquina permite.** `pnpm --filter web run build` passou pela geração de todas as páginas com o novo `headers()` sem erro de compilação — mas o build falha depois disso por um limite conhecido do Windows sem modo desenvolvedor (`EPERM` ao criar symlink do `.next/standalone`, o mesmo problema já registrado na entrega anterior, não relacionado ao CSP). Isso prova que o CSP não quebra o *build*; **não prova que nada quebra no navegador** — no primeiro deploy real, abra o Console do navegador em cada tela (login, dashboard, `/descadastro/:token`, modal de QR do WhatsApp) e procure por erros `Refused to ... because it violates the following Content Security Policy directive`. Se aparecer, é a CSP bloqueando algo legítimo que esta revisão não previu — ajuste a diretiva específica em `next.config.ts` e documente o porquê ali, não remova a CSP inteira.

### Resolvido nesta entrega (2026-08-03)
- **Backup do Postgres com restore testável** — `infra/backup/` criado (ver §7.5). "Testável" ≠ "testado": o teste de restore em si ainda precisa ser executado pelo menos uma vez por alguém com acesso ao EasyPanel — não é algo que eu (Vulcano) tenha como fazer sem Postgres/Docker nesta máquina.
- **Headers de segurança** — `apps/web/next.config.ts` ganhou `headers()` com CSP, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy` e `Strict-Transport-Security`. Trade-offs documentados no próprio arquivo.
- **Segredos em build-arg** — auditado: só `DATABASE_URL` (com placeholder seguro, não a senha real) e as duas `NEXT_PUBLIC_*` (não-segredas) são build-args nos Dockerfiles reais. Documentado explicitamente em §5 qual variável vai em qual campo do EasyPanel.
- **Versão da Evolution API confirmada** — `evoapicloud/evolution-api:v2.3.7` (o projeto trocou de organização/imagem; ver §4).
- **`infra/docker-compose.yml`** — mantido (decisão abaixo), com banner "isto não é produção" reforçado no topo do arquivo e aqui no `DEPLOY.md`.

---

### Decisão: `infra/docker-compose.yml` — manter, marcado como dev-only (não remover)

A Nova perguntou (revisão de arquitetura, 2026-08-03) se este arquivo deveria ser marcado como dev-only ou removido, porque ele "descreve uma topologia que nunca subiu" e documentação divergente é pior que ausente. Decisão: **manter, com o aviso reforçado**, não remover. Motivos:
1. **Utilidade real que nada mais cobre**: é o único jeito de validar, numa máquina com Docker, que os `Dockerfile`s reais do `apps/web`/`apps/worker` sobem e conversam entre si (web ↔ postgres ↔ redis ↔ Evolution) — algo que nunca foi testado nem nesta máquina de desenvolvimento nem em produção ainda. Removê-lo não resolve a causa raiz (documentação vs. realidade); só apaga uma ferramenta que vai fazer falta no dia em que alguém tiver Docker à mão e precisar reproduzir um bug de build localmente antes de gastar um deploy real testando.
2. **Remover não é opção segura sem quebrar referência que não posso editar**: `ARQUITETURA.md §2` (arquivo da Nova, fora do meu escopo nesta tarefa) cita este caminho na estrutura de pastas. Renomear ou apagar o arquivo deixaria essa referência inconsistente sem que eu pudesse corrigi-la eu mesmo.
3. O problema real não era a existência do arquivo, era o aviso ser fraco. Corrigido: banner grande no topo do arquivo (impossível de não ver ao abrir), nome do projeto compose trocado de `innoprospect` para `innoprospect-local-validation` (evita confundir em `docker compose ls`/nomes de container com algo de produção), e referência cruzada no topo deste `DEPLOY.md`.

---

## 9. CI (GitHub Actions) — o que roda antes de chegar até aqui

Workflow em `.github/workflows/ci.yml`, dispara em todo `push` e `pull
request` para `main`. Node 22 + pnpm 9.12.0 — as mesmas versões que
`apps/web/Dockerfile` e `apps/worker/Dockerfile` usam em produção.

**O que ele VALIDA:**
- `pnpm install --frozen-lockfile` — o lockfile está íntegro e reprodutível
  (falha se alguém commitou um `package.json` sem atualizar o
  `pnpm-lock.yaml`).
- `pnpm typecheck` (`tsc --noEmit` em cada workspace) e `pnpm lint`
  (ESLint).
- `pnpm test` — os testes automatizados (Vitest) do monorepo. Rodam com um
  `DATABASE_URL` placeholder (mesmo valor default do `ARG DATABASE_URL` dos
  Dockerfiles) só para o `prisma generate` resolver o schema — os testes em
  si usam banco falso em memória (`apps/web/src/test/fake-db.ts` e
  equivalentes), nenhuma conexão real é aberta.
- Se isto passa aqui (Ubuntu limpo) e falha no build do EasyPanel, o
  problema é ambiental (SO, versão de imagem base, algo específico do
  Docker) — não é o código Node em si, que já foi validado num ambiente
  limpo antes de chegar lá.

**O que ele NÃO valida (declarado, não escondido):**
- **Que `prisma migrate deploy` aplica de verdade.** O `DATABASE_URL` é um
  placeholder só de formato — nunca conecta em nenhum Postgres. A migração
  real só é testada no primeiro boot do `web` em produção (§7), contra o
  banco de verdade.
- **Qualquer coisa que dependa de rede/serviço externo** — Evolution API
  respondendo, worker conectando num Redis real, etc.
- **Que os `Dockerfile`s buildam.** O CI não roda `docker build`. Nem roda
  `next build` — de propósito: exigiria segredos de produção (ou
  placeholders que não provam nada sobre o build real do EasyPanel) só
  para gerar um artefato que este workflow não usa para nada. O primeiro
  build real continua sendo o do EasyPanel (ver aviso no topo deste
  documento) — trate-o como ensaio, não como formalidade.
- **Segurança do código** (auditoria OWASP — território do Órion,
  `/revisar`) e **auditoria de dependências de terceiros** (`pnpm audit` —
  feita manualmente por enquanto; não está automatizada neste workflow. Ver
  achados na memória do Vulcano e no handoff da entrega que criou este CI).

**Como interpretar uma falha:** o job tem um só, com passos sequenciais
(instalar → gerar Prisma Client → typecheck → lint → test). O nome do passo
que ficou vermelho no log do GitHub já diz qual dos quatro quebrou — não
precisa adivinhar. Falha em `typecheck`/`lint` costuma ser um erro real de
tipo ou uma regra de lint violada (não ambiental); falha em `pnpm install
--frozen-lockfile` quase sempre significa que alguém editou um
`package.json` sem rodar `pnpm install` de novo antes de commitar (o
lockfile ficou desatualizado).

**O que isto NÃO impede:** o workflow roda em `push` e `pull request`, mas
por si só não bloqueia ninguém de dar push direto na `main` com o CI
vermelho — ele avisa depois do fato. Para bloquear de verdade, é preciso
ativar "Require status checks to pass before merging" na proteção da branch
`main`, nas configurações do repositório no GitHub — isso é uma
configuração do repositório, não deste arquivo de workflow, e não foi
ativada nesta entrega.
