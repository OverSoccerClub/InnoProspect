# apps/web/Dockerfile
#
# Multi-stage para o apps/web (Next.js 15, App Router, output "standalone")
# dentro do monorepo pnpm+Turborepo do InnoProspect. Mesmo padrão que o
# Pontua.me / Painel de Missões (ver C:\Projetos\App\innovarecode-missoes\Dockerfile
# como referência de raciocínio) — adaptado aqui para monorepo, que aquele
# projeto não é.
#
# Build context DEVE ser a RAIZ do monorepo (não apps/web/):
#   docker build -f apps/web/Dockerfile -t innoprospect-web .
#
# Notas importantes (leia antes de mexer):
# - `apps/web` depende de @inno/contracts, @inno/core e @inno/db (workspace:^).
#   @inno/core depende de @inno/contracts. Cada um desses precisa ter o
#   `package.json` copiado ANTES do `pnpm install` (senão o pnpm não resolve o
#   workspace), e o CÓDIGO-FONTE copiado antes do `next build` (Next transpila
#   esses pacotes via `transpilePackages`, não são pré-compilados).
# - O Prisma Client (@inno/db) é gerado DENTRO do container (stage `deps`,
#   Linux) — nunca copiar `packages/db/src/generated/` do host (gitignored,
#   e mesmo que existisse, poderia ter sido gerado num binário/OS diferente).
#   `prisma generate` exige `DATABASE_URL` resolvível no schema (mesmo sem
#   conectar de verdade) — por isso o placeholder abaixo.
# - Alpine usa musl libc: o binário de engine do Prisma precisa de OpenSSL —
#   instalado explicitamente em toda stage que toca Prisma (senão: "unable to
#   open libssl.so").
# - `output: 'standalone'` num monorepo pnpm gera `.next/standalone/apps/web/server.js`
#   (estrutura aninhada espelhando o caminho relativo à raiz do workspace,
#   graças a `outputFileTracingRoot` setado em `next.config.ts`) — por isso os
#   COPY da stage `runner` preservam esse aninhamento e o CMD final aponta
#   para `apps/web/server.js`, não `server.js`.
# - `NEXT_PUBLIC_*` são "embutidas" no bundle JS do CLIENTE em BUILD TIME, não
#   em runtime — mudar a env do container depois não muda o valor já
#   compilado. `NEXT_PUBLIC_USE_MOCKS` default aqui é `false` (produção real,
#   sem mocks) — é o item 3 do PROGRESSO.md ("trocar o mock da Lyra pelo
#   backend real"). Só mude via `--build-arg` se precisar de uma imagem de
#   demonstração com mocks.
# - `prisma migrate deploy` roda no `docker-entrypoint.sh`, não aqui — o CLI
#   precisa do node_modules COMPLETO (não só o subconjunto traçado pelo
#   standalone), por isso a stage `runner` sobrescreve o node_modules do
#   standalone com o node_modules cheio da stage `deps`. Imagem final maior;
#   aceitável — confiabilidade do deploy > tamanho da imagem (mesma decisão
#   documentada no Dockerfile de referência).
#
# ⚠️ NÃO validado com `docker build` nesta máquina (sem Docker instalado).
# Sintaxe e caminhos revisados manualmente contra a estrutura real do repo —
# ver DEPLOY.md para o checklist do primeiro build real no EasyPanel.

ARG NODE_VERSION=22

# ---------- Stage 1: base (Node + pnpm + libs do Prisma) ----------
FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache openssl libc6-compat
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---------- Stage 2: deps (install com cache de camada) ----------
# Copia só os manifestos (package.json + lockfile) primeiro — se nenhuma
# dependência mudou, o Docker reaproveita esta camada mesmo que o código
# tenha mudado, evitando reinstalar tudo a cada build.
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
# ⚠️ ESTA LISTA PRECISA CONTER TODO `@inno/*` QUE apps/web/package.json
# declara como dependência. Um pacote novo importado pelo app e esquecido aqui
# NÃO quebra o `pnpm install` — ele passa, e o build só falha lá na frente com
# "Module not found: Can't resolve '@inno/xxx'", longe da causa. Foi assim que
# `@inno/messaging` derrubou o deploy da Fase 3. O `RUN` de verificação no
# stage `builder` existe para transformar isso num erro explícito.
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/messaging/package.json packages/messaging/package.json
# --shamefully-hoist: por padrão o pnpm cria um node_modules PRÓPRIO dentro
# de cada pacote do workspace (apps/web/node_modules, packages/db/node_modules
# etc.), cada um só com symlinks das SUAS dependências declaradas — só o
# node_modules da RAIZ sozinho (o que a stage `runner` copia lá embaixo) NÃO
# contém tudo isso. `--shamefully-hoist` achata tudo num node_modules único
# na raiz, tornando um `COPY .../node_modules` simples o suficiente para
# rodar o server E o CLI do Prisma depois. Custo: perde um pouco do
# isolamento estrito do pnpm (risco de "acesso a dependência fantasma") —
# aceitável dentro de uma imagem de runtime que não roda mais `pnpm install`.
RUN pnpm install --frozen-lockfile --filter web... --shamefully-hoist

# ---------- Stage 3: generate (Prisma Client, precisa do schema) ----------
FROM deps AS generate
COPY packages/db/prisma packages/db/prisma
# Placeholder: só para o schema (`url = env("DATABASE_URL")`) resolver
# durante `prisma generate`. Nenhuma conexão real é feita aqui.
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/placeholder"
ENV DATABASE_URL=${DATABASE_URL}
RUN pnpm --filter @inno/db run generate

# ---------- Stage 4: builder (compila o Next.js) ----------
FROM generate AS builder
COPY apps/web apps/web
COPY packages/db packages/db
COPY packages/core packages/core
COPY packages/contracts packages/contracts
COPY packages/messaging packages/messaging

# Guarda contra o erro mais provável deste arquivo: apps/web passa a importar um
# pacote novo do workspace e alguém esquece de copiá-lo nos dois lugares acima.
# Sem isto, o sintoma é um "Module not found" do webpack no meio do `next build`
# — mensagem que não diz nada sobre o Dockerfile ser a causa. Aqui a falha vem
# antes, nomeando o pacote e o conserto.
RUN node -e "\
const pkg=require('./apps/web/package.json');\
const fs=require('fs');\
const faltando=Object.keys(pkg.dependencies||{})\
  .filter(d=>d.startsWith('@inno/'))\
  .map(d=>d.replace('@inno/',''))\
  .filter(n=>!fs.existsSync('packages/'+n+'/package.json'));\
if(faltando.length){\
  console.error('\n[Dockerfile] apps/web depende de @inno/'+faltando.join(', @inno/')+', mas esse(s) pacote(s) NAO foram copiados para a imagem.');\
  console.error('[Dockerfile] Conserto: adicione COPY packages/<nome>/package.json no stage deps E COPY packages/<nome> no stage builder.\n');\
  process.exit(1);\
}\
console.log('[Dockerfile] Todos os pacotes @inno/* de apps/web estao presentes.');"

ENV NEXT_TELEMETRY_DISABLED=1
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/placeholder"
ENV DATABASE_URL=${DATABASE_URL}
# Produção real por padrão — ver nota sobre NEXT_PUBLIC_* acima.
ARG NEXT_PUBLIC_USE_MOCKS="false"
ENV NEXT_PUBLIC_USE_MOCKS=${NEXT_PUBLIC_USE_MOCKS}
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

# ⚠️ PRECISA vir antes do build do Next. Desde 2026-09-22 o `@inno/db` tem
# build próprio (`tsc -p tsconfig.build.json`, compila `index.ts`/`client.ts`
# ao lado do fonte) e o `exports.default` do pacote aponta para o `.js`
# compilado — mudança feita para o WORKER, que roda `node dist/index.js` puro
# e não transpila nada.
#
# Sem esta linha, o build real do frontend quebra com
# `Module not found: Can't resolve '@inno/db'` em toda rota que toca o banco:
# o arquivo apontado por `exports` simplesmente não existe ainda. Aconteceu em
# produção no mesmo dia, logo depois de o worker ser corrigido — a correção de
# um app derrubou o build do outro.
RUN pnpm --filter @inno/db run build

RUN pnpm --filter web run build

# ---------- Stage 5: runner (imagem final) ----------
FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# Porta configurável em runtime (`docker run -e PORT=...` / env do EasyPanel),
# sem precisar rebuildar a imagem.
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Build enxuto do Next (server.js + node_modules traçado como usado),
# aninhado em apps/web/ por causa do outputFileTracingRoot (ver cabeçalho).
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
# ⚠️ Depende de `apps/web/public/` EXISTIR no repositório. O Docker aborta o
# build ("not found") se a origem do COPY não existe, e o Git não versiona
# diretório vazio — por isso há um `.gitkeep` lá. Não remova um sem o outro.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Entrypoint (migrate deploy fail-fast + start do server).
COPY --chown=nextjs:nodejs apps/web/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Reforço proposital (não confiar só no tracing automático do Next standalone
# para o CLI do Prisma): node_modules COMPLETO da stage `deps`/`generate` +
# schema/migrations completos — o `prisma migrate deploy` do entrypoint
# precisa disso e não é código que o Next rastreia (só roda via CLI, fora do
# server Next). Vem DEPOIS do `.next/standalone` de propósito, para o
# node_modules completo prevalecer sobre o subconjunto que o standalone já
# trouxe.
COPY --from=generate --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/src ./packages/db/src
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

USER nextjs

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "apps/web/server.js"]
