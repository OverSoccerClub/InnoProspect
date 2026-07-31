#!/bin/sh
# apps/web/docker-entrypoint.sh
#
# Entrypoint de produção do apps/web (InnoProspect).
#
# Roda `prisma migrate deploy` (aplica só migrações já commitadas em
# packages/db/prisma/migrations — nunca gera migração nova, seguro para
# produção) e, SÓ SE isso der certo, sobe o servidor Next.js.
#
# --- Por que fail-fast (propósito, não acidente) -----------------------
# `set -e` faz o script inteiro morrer no primeiro comando que falhar. Se
# `migrate deploy` falhar (schema divergente, banco fora do ar, migração
# quebrada), o container encerra com código de erro e o `exec node
# apps/web/server.js` da última linha NUNCA roda.
#
# Isso é proposital: é MELHOR o deploy falhar visivelmente (container não
# sobe, health check nunca fica verde, EasyPanel mantém a versão anterior no
# ar) do que subir um app novo apontando para um banco com schema
# desatualizado — que corrompe dado silenciosamente ou derruba toda rota que
# tocar a tabela que mudou. Health check + rollback automático do EasyPanel
# (ver DEPLOY.md) só funcionam se o container efetivamente falhar ao subir
# quando algo está errado — um app que sobe "quebrado por dentro" engana o
# health check.
#
# Para desligar a migração automática (ex.: múltiplas réplicas do mesmo
# release rodando em paralelo, migração já aplicada por outro processo/CI),
# defina RUN_MIGRATIONS=false nas envs do serviço.
#
# --- Por que `--schema` explícito ---------------------------------------
# Este é um monorepo: o schema não fica em `./prisma/schema.prisma` a partir
# da raiz da imagem (WORKDIR /app), mas em `packages/db/prisma/schema.prisma`
# (Dockerfile copia a estrutura preservando o caminho do workspace). Sem
# `--schema` explícito o Prisma CLI procura no lugar errado e falha.

set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Rodando 'prisma migrate deploy'..."
  node node_modules/prisma/build/index.js migrate deploy --schema=packages/db/prisma/schema.prisma
  echo "[entrypoint] Migrações aplicadas com sucesso."
else
  echo "[entrypoint] RUN_MIGRATIONS=false — pulando migrate deploy."
fi

# --- Seed opcional, sob demanda ------------------------------------------
# Por que existe: o seed (UFs + municípios do IBGE + admin) NÃO faz parte do
# boot normal, de propósito — ele não deve rodar a cada deploy. Mas em
# ambientes onde não há terminal fácil no container, não havia como executá-lo
# na primeira subida, e o sistema fica inutilizável: sem admin ninguém loga, e
# sem municípios o scraper não tem onde buscar.
#
# Com RUN_SEED=true o seed roda UMA vez neste boot e o resultado aparece no
# log de deploy. Depois de rodar, REMOVA a variável (ou ponha false) — deixar
# ligada só gasta tempo de boot, já que o seed é idempotente.
#
# Best-effort de propósito: diferente da migração, uma falha aqui NÃO derruba
# o container. Um seed que falhou (ex.: IBGE fora do ar) deixa o app de pé e
# corrigível; derrubar o boot por causa disso seria pior.
#
# `tsx/dist/cli.mjs` é o caminho real do CLI. NÃO use `node .bin/tsx`:
# `.bin/tsx` é um shell script wrapper, e o node não o executa — falha com
# erro de sintaxe confuso ou silêncio.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] RUN_SEED=true — rodando seed (idempotente)..."
  if node node_modules/tsx/dist/cli.mjs packages/db/prisma/seed.ts; then
    echo "[entrypoint] Seed concluído."
  else
    echo "[entrypoint] AVISO: o seed falhou. O app vai subir mesmo assim — veja o erro acima."
  fi
  echo "[entrypoint] Lembre de remover RUN_SEED das envs depois desta subida."
fi

echo "[entrypoint] Iniciando servidor Next.js..."
exec "$@"
