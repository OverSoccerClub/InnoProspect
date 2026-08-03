#!/bin/sh
# infra/backup/pg-dump.sh
#
# Dump manual/portátil do Postgres do InnoProspect — pg_dump em formato
# custom (comprimido, permite restore seletivo com pg_restore), com nome
# datado e limpeza de retenção local.
#
# ESTE SCRIPT É O CAMINHO SECUNDÁRIO. O caminho primário recomendado é o
# recurso NATIVO de "Database Backups" do EasyPanel (agendamento + retenção +
# envio automático para armazenamento externo, com tela de restore própria)
# — ver `infra/backup/README.md` §1. Use este script para:
#   - rodar um dump manual avulso (ex.: antes de uma migração arriscada,
#     além do backup agendado);
#   - ter um caminho de backup que NÃO depende do EasyPanel estar no ar ou
#     da conta ter a licença que inclui backup agendado nativo;
#   - documentar o comando exato (`pg_dump`) que também está por trás do
#     recurso nativo, para quem quiser entender/depurar sem depender de uma
#     UI fechada.
#
# POSIX sh de propósito (não bash) — roda tanto no shell do container
# `postgres:16-alpine` do EasyPanel (busybox ash) quanto em qualquer
# Linux/macOS com `pg_dump` instalado.
#
# ⚠️ NÃO EXECUTADO NESTA SESSÃO — não há Postgres nem Docker disponível
# nesta máquina de desenvolvimento (ver DEPLOY.md e memória de infra do
# Vulcano). O que precisa ser verificado no primeiro uso real, em ordem:
#   1. `pg_dump --version` no ambiente que vai rodar isto é >= a versão do
#      servidor (Postgres 16 no `infra/docker-compose.yml`/EasyPanel) — o
#      pg_dump de uma versão MENOR que o servidor pode falhar ou gerar um
#      dump incompleto silenciosamente em alguns tipos de objeto.
#   2. Que as variáveis PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE abaixo
#      realmente alcançam o Postgres do EasyPanel (rede interna vs.
#      exposição temporária de porta — ver README §3).
#   3. Que o arquivo gerado não está vazio/corrompido: rode
#      `pg_restore --list "$arquivo"` logo após o primeiro dump real e
#      confirme que lista tabelas de verdade (não solução completa — só
#      prova que o arquivo tem estrutura válida, NÃO que os dados batem;
#      isso só o teste de restore completo do README §2 prova).
#
# Uso:
#   PGHOST=... PGPORT=5432 PGUSER=... PGPASSWORD=... PGDATABASE=innoprospect \
#     BACKUP_DIR=/backups RETENTION_DAYS=14 ./pg-dump.sh
#
# Variáveis opcionais (ver README §4 "onde guardar o dump"):
#   BACKUP_S3_BUCKET / BACKUP_S3_ENDPOINT / BACKUP_S3_PREFIX
#     Se definidas E o binário `aws` (AWS CLI) estiver disponível, o dump é
#     enviado também para um bucket S3-compatível (R2/Spaces/B2/Wasabi/S3)
#     depois de gerado localmente. Requer AWS_ACCESS_KEY_ID/
#     AWS_SECRET_ACCESS_KEY já exportadas no ambiente (não neste script —
#     nunca colocar segredo em texto num script versionado).
#   ALERT_WEBHOOK_URL
#     Se definida E `curl` disponível, um POST simples é enviado em caso de
#     FALHA do dump (não em caso de sucesso — não crie ruído). Mesmo padrão
#     de variável documentado em `.env.example` para alertas da aplicação,
#     mas este uso aqui é independente: o script não depende do código da
#     aplicação ler essa env, ele mesmo faz o POST.

set -eu

PGHOST="${PGHOST:?defina PGHOST (hostname do serviço Postgres)}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:?defina PGUSER}"
PGDATABASE="${PGDATABASE:?defina PGDATABASE (ex.: innoprospect)}"
: "${PGPASSWORD:?defina PGPASSWORD}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

export PGPASSWORD

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
FILENAME="${PGDATABASE}_${TIMESTAMP}.dump"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

alert_failure() {
  reason="$1"
  echo "[pg-dump] FALHA: ${reason}" >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ] && command -v curl >/dev/null 2>&1; then
    curl -fsS -X POST "$ALERT_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\"[InnoProspect] backup do Postgres FALHOU em ${PGHOST}/${PGDATABASE}: ${reason}\"}" \
      >/dev/null 2>&1 || echo "[pg-dump] aviso: falha ao notificar ALERT_WEBHOOK_URL (não é a causa raiz)" >&2
  fi
}

trap 'alert_failure "erro inesperado (linha $LINENO)"' ERR

mkdir -p "$BACKUP_DIR"

echo "[pg-dump] Iniciando dump de ${PGDATABASE}@${PGHOST}:${PGPORT} -> ${FILEPATH}"

# -Fc: formato "custom", já comprimido, permite `pg_restore --list` (inspecionar
# sem restaurar) e restore seletivo (--table=..., etc). --no-owner/--no-privileges:
# torna o dump portátil entre ambientes com usuários de banco diferentes (ex.:
# restaurar num Postgres de teste com outro usuário dono).
if ! pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom --no-owner --no-privileges \
    --file="$FILEPATH"; then
  alert_failure "pg_dump retornou erro"
  rm -f "$FILEPATH"
  exit 1
fi

# Dump vazio/corrompido não deve ser tratado como sucesso silencioso — é
# exatamente o tipo de "backup fantasma" que só se descobre na hora errada.
SIZE="$(wc -c < "$FILEPATH" 2>/dev/null || echo 0)"
if [ "$SIZE" -lt 1024 ]; then
  alert_failure "arquivo gerado suspeito de vazio/corrompido (${SIZE} bytes)"
  exit 1
fi

echo "[pg-dump] OK: ${FILEPATH} (${SIZE} bytes)"

# Upload opcional para armazenamento remoto S3-compatível (ver cabeçalho).
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    S3_PATH="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-innoprospect}/${FILENAME}"
    ENDPOINT_ARG=""
    if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
      ENDPOINT_ARG="--endpoint-url=${BACKUP_S3_ENDPOINT}"
    fi
    if aws s3 cp "$FILEPATH" "$S3_PATH" $ENDPOINT_ARG; then
      echo "[pg-dump] enviado para ${S3_PATH}"
    else
      alert_failure "dump local OK mas upload para ${S3_PATH} falhou -- o dump SÓ existe no disco local (mesma máquina/volume do Postgres, ver README §4)"
      exit 1
    fi
  else
    echo "[pg-dump] aviso: BACKUP_S3_BUCKET definido mas o binário 'aws' não está disponível neste ambiente -- dump ficou SÓ local." >&2
  fi
fi

# Retenção local: apaga dumps deste banco mais velhos que RETENTION_DAYS.
# Não mexe em arquivos de outros bancos/prefixos no mesmo diretório.
echo "[pg-dump] Aplicando retenção local: ${RETENTION_DAYS} dias em ${BACKUP_DIR}"
find "$BACKUP_DIR" -maxdepth 1 -name "${PGDATABASE}_*.dump" -type f -mtime "+${RETENTION_DAYS}" -print -delete || true

echo "[pg-dump] Concluído."
