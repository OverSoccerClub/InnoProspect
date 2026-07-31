---
name: infra-docker-compose-dev
description: infra/docker-compose.dev.yml do InnoProspect — postgres+redis para dev local, credenciais fixas não-secretas
metadata:
  type: reference
---

`C:\Projetos\Web\InnoProspect\infra\docker-compose.dev.yml` sobe só Postgres 16 e Redis 7 (volumes
nomeados `innoprospect_postgres_data`/`innoprospect_redis_data`, healthcheck, portas 5432/6379 expostas
no host). Credenciais são fixas de dev (`innoprospect`/`innoprospect`) — documentadas como não-secretas
no próprio arquivo, nunca reutilizar em produção.

**Não validado com `docker compose config`** nesta sessão — Docker não está instalado na máquina onde
montei o esqueleto (`docker: command not found`). Sintaxe revisada manualmente, mas alguém com Docker
disponível deveria rodar `docker compose -f infra/docker-compose.dev.yml up -d` antes de considerar
100% validado.

`DATABASE_URL`/`REDIS_URL` de dev no `.env.example` apontam para `localhost` (apps rodando via `pnpm
dev` fora de container, conectando no host). Isso muda para hostnames de serviço (`postgres`, `redis`)
quando a stack completa for containerizada em `infra/docker-compose.yml` (Fase 3.3/5.5, ainda não
existe).
