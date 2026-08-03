# Backup e restore do Postgres — InnoProspect

> Autor: Vulcano (DevOps). Escrito em 2026-08-03, quando o dono confirmou que
> **vai entrar dado real de cliente**. Antes disso este diretório não
> existia — ver `DEPLOY.md §8` (histórico) e a revisão de arquitetura da
> Nova (`REVISAO-ARQUITETURA.md`, item P1/Onda 4.0): *"backup sem restore
> testado não é backup, é esperança."*
>
> ⚠️ **Nada aqui foi executado de verdade nesta sessão** — não há Postgres
> nem Docker disponível na máquina onde isto foi escrito. Os comandos foram
> revisados linha a linha contra a documentação oficial do Postgres 16 e do
> EasyPanel (consultada com acesso à rede em 2026-08-03), mas o **primeiro
> dump real e o primeiro restore real são o primeiro teste de verdade**. A
> seção 2 existe justamente para forçar esse teste antes de confiar cegamente.

---

## 0. Duas camadas — e por que as duas

| | Backup nativo do EasyPanel (§1) | Scripts deste diretório (§3) |
|---|---|---|
| O que é | Recurso "Database Backups" do serviço Postgres no EasyPanel: agenda, roda `pg_dump`, envia para um provedor externo e mantém retenção — tudo pela UI | `pg-dump.sh` / `pg-restore.sh`, POSIX sh, chamam `pg_dump`/`pg_restore` diretamente |
| Quando usar | **Path primário** — é gerenciado, testado pelo próprio EasyPanel, tem tela de restore própria | Dump avulso antes de uma migração arriscada; teste de restore fora da UI; plano B se o EasyPanel ficar fora do ar ou a conta não tiver a licença que inclui backup agendado |
| Depende de | Uma licença EasyPanel que inclua "scheduled database backups" (confirme no seu painel — não veio confirmado nesta sessão) | Nada além de `pg_dump`/`pg_restore`/`psql` (mesma versão major do Postgres, 16) em algum lugar com rede até o Postgres |

**Recomendação:** ative o nativo (§1) como mecanismo principal. Mantenha os
scripts (§3) como o "eu sei fazer isso na mão se precisar" — e use-os pelo
menos uma vez para o teste de restore inicial (§2), porque a tela de restore
do EasyPanel também merece ser testada, não só configurada.

---

## 1. Ativar o backup nativo do EasyPanel

1. **Configurar o destino** (uma vez por servidor): `Settings → Server →
   Storage Providers → Add Provider`. Escolha **S3-compatible** — funciona
   com Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Wasabi ou AWS S3.
   Motivo de ser S3 e não "Local": ver aviso grande na §4. Dê um nome
   descritivo (ex. `offsite-r2`) e teste a conexão.
2. No serviço **Postgres** do InnoProspect → aba **Backups** → **Create
   Database Backup**:
   - Nome do banco: `innoprospect` (e, se você seguiu `DEPLOY.md §2` e criou
     um banco `evolution` separado no mesmo serviço, crie uma **segunda**
     configuração de backup só para ele — configurações de backup do
     EasyPanel são por banco, não por serviço).
   - Agende (ex. diário, `0 2 * * *` — o padrão do EasyPanel já é esse).
     O horário do cron segue o fuso do **servidor**, não `America/Sao_Paulo`
     necessariamente — confira o fuso do servidor antes de escolher o
     horário, para não coincidir com a janela de uso real do sistema.
   - Retenção: defina um número (ex. `14`) — o EasyPanel apaga os mais
     antigos automaticamente, contando **todos** os arquivos naquele
     caminho de destino, não só os deste backup. Por isso o próximo ponto:
   - Caminho de destino: use um caminho **exclusivo** desta configuração,
     ex. `innoprospect/postgres` — nunca reaproveite o mesmo caminho para
     dois backups diferentes (a retenção de um apagaria arquivo do outro).
   - Ative a configuração.
3. Rode um **Manual Run** assim que criar a configuração. Confira o log de
   ação (Backups Log) e confirme que o arquivo apareceu de fato no provedor
   configurado (não só que a ação "terminou sem erro" — o próprio EasyPanel
   avisa que isso não é a mesma coisa).
4. **Faça o teste de restore da §2 agora**, não depois. Uma configuração de
   backup nunca testada é, na prática, desconhecida.

Formato gerado pelo EasyPanel para Postgres: `.sql.gz` via `pg_dump` (não é
o mesmo formato `--format=custom` que `pg-dump.sh` gera — ambos válidos,
mas não intercambiáveis entre a tela de restore do EasyPanel e o
`pg-restore.sh` deste diretório; use o restore da mesma origem do dump).

---

## 2. Teste de restore — o procedimento que faz isto ser um backup de verdade

**Regra de ouro: nunca teste restore em cima do banco de produção.** Os dois
roteiros abaixo (EasyPanel nativo e scripts manuais) criam um banco/serviço
**descartável** à parte.

### 2.a Testando o restore nativo do EasyPanel

1. Crie um **segundo serviço Postgres** no EasyPanel, só para este teste —
   ex. `innoprospect-restore-check`. Pode ser o menor plano disponível;
   você vai apagar este serviço no fim do teste.
2. Abra o serviço Postgres **de produção** → aba **Backups** → **Restore**.
   ⚠️ Leia com atenção: a documentação do EasyPanel diz que o restore roda
   **"contra o serviço que você tem aberto"** — ou seja, se você abrir isto
   dentro do Postgres de produção, o alvo é a produção. Para testar sem
   risco, o caminho seguro é abrir esta tela a partir do serviço **novo**
   (`innoprospect-restore-check`), não do de produção, e apontar para o
   backup mais recente do provedor configurado na §1.
   Se a sua versão do EasyPanel não permitir restaurar um backup de OUTRO
   serviço a partir de um serviço novo, use o roteiro **2.b** (scripts
   manuais) — ele não tem essa limitação, porque você escolhe o host/porta
   de destino explicitamente.
3. Informe o caminho exato do arquivo de backup e o nome do banco de
   destino (`innoprospect`, dentro do serviço de teste).
4. Acompanhe o log da ação até o fim.
5. **Verifique de verdade** (é aqui que a maioria dos "backups testados"
   falha por preguiça — não pule):
   - Abra o **Shell** do serviço `innoprospect-restore-check` e rode:
     ```sql
     select 'users' as tabela, count(*) from users
     union all select 'leads', count(*) from leads
     union all select 'search_jobs', count(*) from search_jobs
     union all select 'opt_outs', count(*) from opt_outs
     union all select 'campaigns', count(*) from campaigns
     order by 1;
     ```
   - Compare essas contagens com as do banco de **produção** (mesma query,
     lá). Devem ser iguais ou muito próximas (diferença só se o backup
     restaurado for mais antigo que "agora").
   - Confirme que o admin existe: `select email, role from users where role
     = 'admin';` — o e-mail tem que ser o que você espera.
   - Se possível, aponte temporariamente uma cópia local do `apps/web`
     (`DATABASE_URL` apontando para este banco de teste) e faça login de
     verdade — é a única forma de provar que o hash de senha e o schema
     batem com o que o Auth.js espera.
6. **Apague o serviço `innoprospect-restore-check`** depois de confirmar —
   ele não deve ficar rodando (custo de recurso e mais um alvo para
   proteger).
7. Repita este teste periodicamente (sugestão: a cada mudança de schema
   relevante — nova migração — e no mínimo uma vez por trimestre), não só
   na primeira vez.

### 2.b Testando com os scripts manuais (`pg-dump.sh` / `pg-restore.sh`)

Use isto se preferir não depender da UI de restore do EasyPanel para o
teste, ou se quiser confirmar o caminho "cru" (`pg_dump`/`pg_restore`) que
está por trás dela.

```sh
# 1. Dump manual da produção (rode de uma máquina/console com rede até o
#    Postgres do EasyPanel — ver §3 sobre onde rodar isto).
PGHOST=<host-do-postgres> PGPORT=5432 PGUSER=<user> PGPASSWORD=<senha> \
  PGDATABASE=innoprospect BACKUP_DIR=./backups \
  sh infra/backup/pg-dump.sh

# 2. Restore num banco DESCARTÁVEL (nunca 'innoprospect' de produção).
#    Pode ser dentro do MESMO serviço Postgres (um banco extra) ou, melhor,
#    num serviço Postgres novo e temporário (evita competir por recursos
#    com produção e evita erro de digitação acertar o banco errado no MESMO
#    host).
PGHOST=<host-do-postgres-de-teste> PGPORT=5432 PGUSER=<user> PGPASSWORD=<senha> \
  sh infra/backup/pg-restore.sh ./backups/innoprospect_20260803_020000.dump innoprospect_restore_check
```

O `pg-restore.sh` já roda uma checagem de contagens automática no final —
mesmo assim, faça a verificação humana do passo 5 acima (comparar com
produção, achar o admin, testar login) antes de considerar o backup
confiável.

---

## 3. Onde rodar os scripts manuais

Os scripts precisam de rede até o Postgres e dos binários `pg_dump`/
`pg_restore`/`psql` (versão 16, para bater com o servidor). Três opções,
em ordem de preferência:

1. **Shell do próprio serviço Postgres no EasyPanel** (o painel expõe um
   console/terminal por serviço) — já tem os binários certos instalados
   (é a mesma imagem do servidor) e já está na rede interna, sem precisar
   expor a porta 5432 publicamente. Copie os scripts para dentro via esse
   console, ou cole o conteúdo diretamente.
2. **Um serviço avulso temporário** no EasyPanel, criado a partir da imagem
   `postgres:16-alpine` (mesma versão do servidor), só para rodar os
   scripts com rede interna — mais trabalho que a opção 1, mas não
   compartilha o console do banco de produção.
3. **Sua própria máquina**, com `postgresql-client` 16 instalado — só
   funciona se a porta do Postgres estiver temporariamente exposta/acessível
   (ex. túnel SSH para a VPS). **Nunca deixe a porta 5432 exposta
   publicamente por mais tempo que o necessário** (`DEPLOY.md §2` já
   recomenda mantê-la fechada — reabrir para rodar um dump manual e fechar
   de novo depois é aceitável; deixar aberta não é).

---

## 4. Onde guardar o dump, por quanto tempo, e o aviso que importa mais

⚠️ **Um dump salvo no mesmo volume/disco do Postgres NÃO é um backup contra
perda de volume.** Se o volume do EasyPanel for perdido, corrompido, ou o
disco da VPS falhar, o dump que está `pg_dump`ado para uma pasta no mesmo
servidor/volume some **junto** com o banco original. Isso não é uma
hipótese remota — é exatamente o cenário que este trabalho existe para
cobrir (perda de volume = perda de dado real e irrecuperável, como o
próprio `DEPLOY.md §8` já registrava antes desta entrega).

Por isso:
- O destino do backup **precisa** estar fora do servidor/volume do
  Postgres. É por isso que a §1 usa um provedor S3-compatível (R2/B2/
  Spaces/Wasabi/S3) como destino do backup nativo do EasyPanel, e por isso
  `pg-dump.sh` tem upload opcional para S3 (`BACKUP_S3_*`) — o arquivo
  local que o script gera é conveniência para o teste imediato
  (`pg_restore --list`), não a cópia de segurança em si.
- **Retenção sugerida:** 14 dumps diários (2 semanas) como ponto de
  partida — ajuste conforme o volume de alterações reais do sistema depois
  que o dado de cliente começar a entrar. Regras de ciclo de vida mais
  sofisticadas (ex. manter 1 por semana além de 30 dias) ficam a cargo das
  regras do próprio provedor de armazenamento (S3 lifecycle rules), não do
  campo de retenção simples do EasyPanel.
- **Antes de qualquer migração de schema ou mudança arriscada em produção**
  (nova versão do Prisma schema, mudança de credenciais, etc.): rode um
  backup manual extra (Manual Run no EasyPanel, ou `pg-dump.sh` na mão) —
  não confie só no agendado da madrugada.

---

## 5. Monitoramento do próprio backup (o que ainda falta)

Hoje, se o job agendado do EasyPanel parar de rodar silenciosamente (cron
mal configurado, provedor de storage com token expirado, etc.), **ninguém é
avisado automaticamente** — é preciso abrir o Backups Log manualmente.
`pg-dump.sh` já dispara um POST em `ALERT_WEBHOOK_URL` se ele mesmo falhar
(quando usado), mas isso não cobre o caminho nativo do EasyPanel. Pendência
registrada para quando `apps/worker/src/observability/alerts.ts` existir
(Onda 4 da revisão da Nova) — nesse momento vale avaliar um heartbeat/canário
que confirme "existe um backup dos últimos N dias no destino", não só que o
job "rodou sem erro".

---

## 6. Checklist da primeira ativação

- [ ] Provedor S3-compatível configurado em `Settings → Storage Providers`.
- [ ] Configuração de backup criada no serviço Postgres, com caminho de
      destino exclusivo e retenção definida.
- [ ] Manual Run executado e arquivo confirmado no provedor (não só "log
      sem erro").
- [ ] Teste de restore completo (§2) executado **uma vez**, com verificação
      humana das contagens e do e-mail do admin — não só o script.
- [ ] Serviço/banco descartável do teste de restore **apagado** depois.
- [ ] Você (dono) sabe onde ver o Backups Log e sabe reconhecer um "restore
      concluído" real de um "iniciado mas não confirmado" (a doc do
      EasyPanel é explícita: iniciar a ação não é prova de que terminou).
