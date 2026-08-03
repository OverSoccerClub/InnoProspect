#!/bin/sh
# infra/backup/pg-restore.sh
#
# Restore de um dump gerado por `pg-dump.sh` (ou pelo backup nativo do
# EasyPanel — mesmo formato, `pg_dump --format=custom`) para um banco de
# destino. Existe para UMA coisa: tornar o teste de restore (README §2) uma
# operação de um comando, sem depender de decorar a sintaxe do pg_restore
# sob pressão, no meio de um incidente.
#
# ⚠️ ESTE SCRIPT É DESTRUTIVO no banco de DESTINO (`--clean` derruba objetos
# existentes antes de recriar). Por desenho, ele SE RECUSA a rodar sem você
# digitar o nome do banco de destino de novo, propositalmente redundante —
# evita o erro mais caro possível aqui: restaurar em cima do banco de
# produção por engano enquanto o objetivo era só TESTAR o restore.
#
# ⚠️ NÃO EXECUTADO NESTA SESSÃO — sem Postgres/Docker disponível nesta
# máquina. Antes de confiar nisto: rode uma vez contra um banco de teste
# qualquer (mesmo fora do InnoProspect) e confirme que os passos abaixo
# realmente acontecem na ordem esperada.
#
# Uso:
#   PGHOST=... PGPORT=5432 PGUSER=... PGPASSWORD=... \
#     ./pg-restore.sh /caminho/para/innoprospect_20260803_020000.dump nome_do_banco_destino
#
# O terceiro argumento (nome do banco) é pedido DE NOVO interativamente como
# confirmação — a menos que RESTORE_CONFIRM=<mesmo nome> esteja definido no
# ambiente (útil para automação/CI de teste de restore, não para uso manual).

set -eu

DUMP_FILE="${1:?uso: pg-restore.sh <arquivo.dump> <banco_destino>}"
TARGET_DB="${2:?uso: pg-restore.sh <arquivo.dump> <banco_destino>}"

PGHOST="${PGHOST:?defina PGHOST}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:?defina PGUSER}"
: "${PGPASSWORD:?defina PGPASSWORD}"
export PGPASSWORD

if [ ! -f "$DUMP_FILE" ]; then
  echo "[pg-restore] arquivo não encontrado: ${DUMP_FILE}" >&2
  exit 1
fi

echo "=============================================================="
echo " VOCÊ ESTÁ PRESTES A RESTAURAR (destrutivo) em cima de:"
echo "   host/porta : ${PGHOST}:${PGPORT}"
echo "   banco      : ${TARGET_DB}"
echo "   a partir de: ${DUMP_FILE}"
echo ""
echo " Se '${TARGET_DB}' for o banco de PRODUÇÃO, PARE AGORA. O teste de"
echo " restore (README §2) é para rodar contra um banco/serviço SEPARADO,"
echo " descartável, nunca contra produção."
echo "=============================================================="

if [ "${RESTORE_CONFIRM:-}" != "$TARGET_DB" ]; then
  printf 'Digite o nome do banco de destino de novo para confirmar: '
  read -r TYPED
  if [ "$TYPED" != "$TARGET_DB" ]; then
    echo "[pg-restore] confirmação não bateu ('${TYPED}' != '${TARGET_DB}') -- abortando, nada foi tocado." >&2
    exit 1
  fi
fi

echo "[pg-restore] Verificando estrutura do dump antes de tocar no banco (pg_restore --list)..."
if ! pg_restore --list "$DUMP_FILE" >/dev/null; then
  echo "[pg-restore] o arquivo não parece um dump válido em formato custom -- abortando." >&2
  exit 1
fi

echo "[pg-restore] Restaurando em ${TARGET_DB}..."
# --clean --if-exists: derruba objetos existentes antes de recriar (restore
# "em cima de" um banco que já tem schema, sem precisar dropar o banco
# inteiro antes). --no-owner/--no-privileges: evita falhar por causa de
# roles/owners que não existem no ambiente de destino (comum ao restaurar
# num banco de teste com outro usuário).
pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
  --clean --if-exists --no-owner --no-privileges \
  "$DUMP_FILE"

echo "[pg-restore] Restore concluído. Rodando checagem de sanidade (contagens)..."

# Checagem de sanidade automática — não substitui a verificação humana do
# README §2 (comparar contagens com produção, achar o usuário admin,
# testar login), mas já pega o caso mais grosseiro: restore "funcionou" (sem
# erro) só que o banco ficou vazio.
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" -c "
select 'users' as tabela, count(*) from users
union all select 'leads', count(*) from leads
union all select 'search_jobs', count(*) from search_jobs
union all select 'opt_outs', count(*) from opt_outs
union all select 'campaigns', count(*) from campaigns
order by 1;
" || echo "[pg-restore] aviso: checagem de contagens falhou (schema pode ter nome diferente) -- confira manualmente." >&2

echo ""
echo "[pg-restore] Próximo passo MANUAL obrigatório (não automatizado aqui):"
echo "  psql ... -c \"select email, role from users where role = 'admin';\""
echo "  Confirme que o e-mail do admin bate com o que você espera do backup"
echo "  restaurado, e compare as contagens acima com o banco de produção."
echo "  Ver README §2 para o roteiro completo."
