---
name: infra-backup-evolution-headers-2026-08
description: Entrega de 2026-08-03 (pré-dado-real) — backup/restore do Postgres, headers de segurança, build-arg de segredos, versão Evolution API confirmada, decisão sobre docker-compose.yml
metadata:
  type: project
---

Entrega puxada pelas 3 revisões (Nova/Órion/Íris) de 2026-08-03, feita porque o dono confirmou que
vai entrar **dado real de cliente**. Arquivos:

- `infra/backup/README.md`, `infra/backup/pg-dump.sh`, `infra/backup/pg-restore.sh` (novos) —
  backup+restore do Postgres. **Decisão principal**: recomendei o recurso NATIVO "Database Backups"
  do EasyPanel (descoberto consultando `easypanel.io/docs` com rede disponível nesta sessão — antes eu
  não sabia que existia) como mecanismo PRIMÁRIO, não os scripts. O nativo tem: agendamento (cron),
  retenção, destino S3-compatível (R2/B2/Spaces/Wasabi/S3), e tela de restore própria — documentado
  oficialmente para PostgreSQL/MySQL/MariaDB/MongoDB (Redis fica de fora, "backup por persistência
  própria"). ⚠️ Pode depender de licença EasyPanel ("scheduled database backups" é mencionado como
  gated) — não confirmei se a licença do dono inclui isso, fica para ele verificar no painel.
  Scripts (`pg-dump.sh`/`pg-restore.sh`) são o fallback: dump/restore avulso, plano B se a licença não
  cobrir o nativo, ou para testar o caminho "cru" do `pg_dump`/`pg_restore` fora da UI.
- `infra/backup/README.md §2` é o procedimento de TESTE DE RESTORE — regra de ouro: nunca testar em
  cima do banco de produção, sempre um serviço/banco descartável à parte, com checagem de contagens
  (`users`/`leads`/`search_jobs`/`opt_outs`/`campaigns` — nomes de tabela reais, `@@map` snake_case do
  `packages/db/prisma/schema.prisma`) e confirmação do e-mail do admin.
- `apps/web/next.config.ts` — `headers()` com CSP + `X-Frame-Options` + `Referrer-Policy` +
  `X-Content-Type-Options` + `Permissions-Policy` + `Strict-Transport-Security`. `'unsafe-inline'` em
  `script-src`/`style-src` documentado no próprio arquivo com o motivo (Next injeta script de hidratação
  sem nonce; Radix UI usa `style=` inline) — CSP com nonce exigiria mexer em `apps/web/src/middleware.ts`,
  fora do meu escopo nesta tarefa (Vega/Lyra). **Validado com `pnpm --filter web run build` de verdade**:
  passou por type-check + geração de todas as páginas sem erro; falhou só depois, no `EPERM` de symlink
  do Windows já conhecido (ver [[feedback_pnpm_docker_monorepo_gotchas]]) — não relacionado ao CSP.
  **Não valida runtime/browser** — primeiro deploy real precisa checar o Console por
  "Refused to ... violates Content Security Policy".
- `infra/docker-compose.yml` + `DEPLOY.md` — versão da Evolution API CONFIRMADA (tinha rede nesta
  sessão, ao contrário da entrega anterior): o projeto trocou de organização/imagem —
  era `atendai/evolution-api` (órfã desde meados de 2025, nunca passou de v2.2.3), agora é
  `evoapicloud/evolution-api` (org `evolution-foundation`, marca "Evolution Foundation"). Tag estável
  atual: `v2.3.7` (2025-12-05); `2.4.0-rc1/rc2` existem mas são RC, não usar. Confirmado via Docker Hub
  API + GitHub API (`git tag` real é `2.3.7` sem "v", a release do GitHub mostra "v2.3.7" — pegadinha
  se for buscar `raw.githubusercontent.com/.../v2.3.7/...`, 404; o caminho certo é `.../2.3.7/...`).
  `.env.example` oficial da 2.3.7 conferido: `DATABASE_ENABLED` sumiu do exemplo (existia na v2.2.x)
  — deixei a variável no compose/DEPLOY.md por precaução, mas sinalizado para conferir no log de boot.
- `infra/docker-compose.yml` — **decisão: manter, não remover** (Nova tinha perguntado). Motivo:
  utilidade real (único jeito de validar os Dockerfiles reais localmente numa máquina com Docker) +
  `ARQUITETURA.md §2` (arquivo da Nova, fora do meu escopo) referencia o caminho — remover/renomear
  quebraria essa referência sem eu poder corrigi-la. Reforcei o aviso "isto não é produção" com banner
  grande no topo do arquivo + `name:` do compose trocado para `innoprospect-local-validation` (evita
  confundir em `docker compose ls`) + cross-reference no topo do `DEPLOY.md`.
- `DEPLOY.md` — nova subseção "Build-time vs runtime" (dentro de §5): auditei os Dockerfiles reais e
  confirmei que **só `DATABASE_URL`** (com placeholder seguro, nunca a senha real — `prisma generate`
  não conecta de verdade) e as duas `NEXT_PUBLIC_*` (não-segredas) são build-args. Todo o resto
  (`NEXTAUTH_SECRET`, `EVOLUTION_API_KEY`, `ADMIN_PASSWORD`, senha do Postgres/Redis) é lido só em
  runtime (`process.env`) — nunca deveria ir no campo "Build" do EasyPanel. `apps/worker/Dockerfile`
  não declara NENHUM `ARG` de segredo. Ou seja: o vazamento em log de build só acontece se alguém
  colar segredo no campo errado da UI do EasyPanel — documentado explicitamente para não acontecer.

## O que NÃO pude validar (sem Docker/Postgres nesta máquina)
- Nenhum dump/restore real rodou — scripts revisados linha a linha, não executados.
- `docker compose config` não rodou de verdade (só validei sintaxe YAML via `python -c "yaml.safe_load"`,
  que confirma estrutura mas não semântica do Compose).
- Recurso nativo "Database Backups" do EasyPanel — documentação lida (`easypanel.io/docs/backups/database`),
  não operado. Licença do dono não confirmada.

Ver [[infra_deploy_easypanel]] para a entrega anterior (Fase 5.5) e [[feedback_pnpm_docker_monorepo_gotchas]]
para o limite conhecido do Windows no `next build`/standalone.
