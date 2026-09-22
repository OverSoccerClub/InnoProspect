# apps/worker/Dockerfile
#
# Base com Chromium/Playwright pronto — o worker roda scraping headless
# (packages/scraper) além dos jobs de disparo e manutenção.
#
# Build context DEVE ser a RAIZ do monorepo:
#   docker build -f apps/worker/Dockerfile -t innoprospect-worker .
#
# HISTÓRICO: apps/worker depende de @inno/db, @inno/core e @inno/scraper
# (fila scrape:search real, Fase 1.4 do Vega). @inno/core também depende de
# @inno/contracts (workspace:^) — por isso ela entra abaixo mesmo sem o
# worker importar dela diretamente. O worker NÃO é bundlado pelo tsup com os
# pacotes internos dentro (tsup só empacota apps/worker/src/index.ts; deps
# workspace:* ficam `external` por padrão) — o `dist/index.js` importa esses
# pacotes em runtime via `node_modules` (symlink do pnpm pro código-fonte em
# `packages/*/src`), então o CÓDIGO-FONTE deles precisa estar presente na
# imagem final, não só o `dist` do worker. @inno/db também precisa do
# Prisma Client GERADO (binário de engine para Linux) — feito no stage
# `build`, dentro do container (nunca copiado do host).
#
# REVISÃO (Vulcano, item 5.5 — auditoria pedida pelo Órion):
# - CORREÇÃO DE BUG REAL (não só otimização): a versão anterior deste
#   Dockerfile copiava só `/app/node_modules` (raiz) pra imagem final. Por
#   padrão o pnpm NÃO consolida tudo ali — cada pacote do workspace
#   (apps/worker, packages/core...) tem seu PRÓPRIO node_modules com as
#   dependências QUE ELE declara (bullmq/ioredis/pino são dependencies de
#   apps/worker, não da raiz). Sem hoisting, o node_modules da raiz sozinho
#   NÃO tem `bullmq` — o `dist/index.js` (bundle tsup, com essas deps
#   `external`) quebraria em runtime com "Cannot find module 'bullmq'".
#   Corrigido com `--shamefully-hoist` no `pnpm install` (achata tudo num
#   node_modules só na raiz — ver comentário no comando abaixo).
# - Adicionado stage `prod-deps`: reinstala as dependências filtrando com
#   `--prod`, sem as devDependencies de build (typescript, tsup, tsx, vitest,
#   pino-pretty, tipos @types/*) que só o stage `build` precisa. O stage
#   `deps` original (com devDependencies) segue existindo só para compilar —
#   o node_modules que vai pra imagem FINAL agora é o enxuto. Maior redução
#   de tamanho vem daqui, não do código-fonte (que é pequeno perto do
#   node_modules e da imagem base do Playwright).
# - Usuário não-root (`pwuser`): Chromium se recusa a rodar como root sem a
#   flag `--no-sandbox` (que o código NÃO passa hoje —
#   packages/scraper/src/engine/browser.ts faz `chromium.launch({ headless
#   })` puro). Rodar como não-root em vez de adicionar `--no-sandbox` mantém
#   o isolamento do processo do Chromium — mais seguro. Precisa dar posse do
#   diretório de browsers (`PLAYWRIGHT_BROWSERS_PATH`, `/ms-playwright` nas
#   imagens oficiais da Microsoft) ao novo usuário.
# - Remoção best-effort de Firefox/WebKit pré-instalados na imagem base — só
#   o Chromium é usado hoje (ver browser.ts). Não falha o build se os
#   caminhos não existirem/mudarem entre versões da imagem base.
#
# ⚠️ NÃO validado com `docker build` nesta máquina (sem Docker instalado).
# Em especial, o caminho exato de `PLAYWRIGHT_BROWSERS_PATH` e a existência
# do usuário `pwuser` PRECISAM ser conferidos no primeiro build real (rodar
# `echo $PLAYWRIGHT_BROWSERS_PATH` dentro de um container da imagem base
# `mcr.microsoft.com/playwright:v1.49.1-jammy` antes de confiar cegamente).

ARG PLAYWRIGHT_VERSION=v1.49.1

# ---------- Stage 1: base ----------
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}-jammy AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# ---------- Stage 2: deps (install COMPLETO — precisa das devDependencies pra buildar) ----------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/scraper/package.json packages/scraper/package.json
RUN pnpm install --frozen-lockfile --filter worker... --shamefully-hoist

# ---------- Stage 3: build (gera Prisma Client + compila o worker via tsup) ----------
FROM deps AS build
COPY apps/worker apps/worker
COPY packages/db packages/db
COPY packages/core packages/core
COPY packages/contracts packages/contracts
COPY packages/scraper packages/scraper

# Mesma guarda do apps/web/Dockerfile. Um pacote do workspace importado pelo
# worker e esquecido nos COPY acima NÃO quebra o `pnpm install` — a falha
# aparece só no bundle, com uma mensagem que não aponta para este arquivo.
# `@inno/messaging` entra aqui quando o worker de disparo (Fase 4) chegar.
RUN node -e "\
const pkg=require('./apps/worker/package.json');\
const fs=require('fs');\
const faltando=Object.keys(pkg.dependencies||{})\
  .filter(d=>d.startsWith('@inno/'))\
  .map(d=>d.replace('@inno/',''))\
  .filter(n=>!fs.existsSync('packages/'+n+'/package.json'));\
if(faltando.length){\
  console.error('\n[Dockerfile] apps/worker depende de @inno/'+faltando.join(', @inno/')+', mas esse(s) pacote(s) NAO foram copiados para a imagem.');\
  console.error('[Dockerfile] Conserto: adicione COPY packages/<nome>/package.json nos stages deps e prod-deps E COPY packages/<nome> no stage build.\n');\
  process.exit(1);\
}\
console.log('[Dockerfile] Todos os pacotes @inno/* de apps/worker estao presentes.');"

RUN pnpm --filter @inno/db run generate
RUN pnpm --filter worker run build

# ---------- Stage 4: prod-deps (install SÓ produção — vai pra imagem final) ----------
FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
# --shamefully-hoist: achata tudo (incl. as dependencies de apps/worker —
# bullmq/ioredis/pino — que por padrão ficariam SÓ em apps/worker/node_modules,
# não na raiz) num único node_modules na raiz. Ver nota no cabeçalho do
# arquivo ("CORREÇÃO DE BUG REAL") — sem isso o `dist/index.js` quebra em
# runtime.
COPY packages/scraper/package.json packages/scraper/package.json
RUN pnpm install --frozen-lockfile --filter worker... --prod --shamefully-hoist

# ---------- Stage 5: runner (imagem final) ----------
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}-jammy AS runner
WORKDIR /app
ENV NODE_ENV=production

# ⚠️ A imagem oficial do Playwright JÁ TRAZ o usuário e o grupo `pwuser`.
# A versão anterior criava os dois direto, e o build real no EasyPanel
# (2026-09-22) morreu aqui com `groupadd: group 'pwuser' already exists`,
# código 9 — era o ponto que o Órion tinha marcado como "assumido, não
# validado" desde agosto, e que só um build de verdade provaria.
#
# Criar apenas quando faltar mantém a imagem funcionando se a base um dia
# deixar de trazer o usuário, sem quebrar enquanto ela traz. `chown` continua
# fora do `if`: precisa rodar sempre, porque `/app` é criado por este
# Dockerfile e pertence ao root.
RUN if ! getent group pwuser >/dev/null 2>&1; then groupadd --system pwuser; fi \
  && if ! id -u pwuser >/dev/null 2>&1; then \
       useradd --system --gid pwuser --create-home --home-dir /home/pwuser pwuser; \
     fi \
  && mkdir -p /home/pwuser \
  && chown -R pwuser:pwuser /app /home/pwuser "${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"

COPY --from=build --chown=pwuser:pwuser /app/apps/worker/dist ./dist
COPY --from=build --chown=pwuser:pwuser /app/apps/worker/package.json ./package.json
COPY --from=build --chown=pwuser:pwuser /app/packages/db ./packages/db
COPY --from=build --chown=pwuser:pwuser /app/packages/core ./packages/core
COPY --from=build --chown=pwuser:pwuser /app/packages/contracts ./packages/contracts
COPY --from=build --chown=pwuser:pwuser /app/packages/scraper ./packages/scraper
COPY --from=prod-deps --chown=pwuser:pwuser /app/node_modules ./node_modules

# Best-effort: só o Chromium é usado (packages/scraper/src/engine/browser.ts).
# Não falha o build se o caminho não existir — ver aviso no cabeçalho.
RUN rm -rf "${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"/firefox-* \
           "${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"/webkit-* \
           "${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"/ffmpeg-* 2>/dev/null || true

USER pwuser

CMD ["node", "dist/index.js"]
