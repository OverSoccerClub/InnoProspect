# InnoProspect

**Sistema de prospecção B2B que busca empresas no Google Maps por nicho e estado, organiza como leads em um CRM leve e aborda por WhatsApp com descadastro obrigatório e proteções anti-bloqueio.**

---

## Como funciona

1. **Definir um alvo** — você escolhe um nicho ("clínica odontológica") e uma UF (São Paulo).
2. **Coleta automática** — o sistema varre o Google Maps município por município, extrai contatos e deduplica.
3. **Organização em leads** — cada empresa vira um registro no CRM com status, notas, histórico de contato.
4. **Abordagem por WhatsApp** — você monta templates com variáveis, cria campanhas e dispara, com cadência controlada, horário comercial obrigatório e descadastro público.

---

## Estado atual — leia com atenção

O código foi desenvolvido, testado em unidade (340 testes rodando) e **nunca rodou contra dados reais**. Especificamente:

| Funcionalidade | Estado |
|---|---|
| Landing pública, painel, identidade visual | ✅ Pronto |
| Coleta de leads (busca, scraper, fila) | ✅ Código pronto, testado · ❌ nunca rodou contra Google Maps de verdade |
| Ficha e histórico do lead | ✅ Pronto |
| WhatsApp (instância, templates, descadastro público) | ✅ Pronto |
| **Envio individual de mensagem** | ✅ Pronto · ❌ nunca testado contra Evolution API real |
| **Campanhas e disparo em massa** | ❌ **Não foi implementado** |
| Gestão de usuários, recuperação de senha, configurações | ❌ **Não foi implementado** |
| LGPD (retenção de dados, exclusão a pedido) | ❌ **Não foi implementado** |

**Produção:** O código está em GitHub mas bloqueado para push. A produção no EasyPanel devolve 404 — serviço parado, domínio trocado ou deploy incompleto.

---

## Stack

- **Frontend/API:** Next.js 15 (App Router), TypeScript, React Server Components, Tailwind CSS
- **Backend:** Node.js (processo separado), Playwright (scraping), Bull/BullMQ (filas)
- **Banco:** PostgreSQL (Prisma ORM)
- **Fila/Cache:** Redis
- **WhatsApp:** Evolution API (Baileys)
- **Testes:** Vitest, Playwright

### Estrutura de pastas

```
InnoProspect/
├── apps/
│   ├── web/              # Next.js: UI + API (routes + webhooks)
│   └── worker/           # Node: scraper, dispatcher, health checks
├── packages/
│   ├── db/               # Prisma schema, migrations, seed
│   ├── contracts/        # Zod schemas e tipos de API (fonte única)
│   ├── core/             # Lógica de domínio sem I/O (leads, templates, opt-outs)
│   ├── scraper/          # Extrator do Google Maps (Playwright)
│   └── messaging/        # Cliente da Evolution API
├── infra/                # Docker Compose, scripts de backup
└── docs/                 # Runbooks, LGPD
```

---

## Como rodar localmente

### Pré-requisitos

- **Node.js** 20.9.0+ (veja `package.json` / `engines`)
- **pnpm** 9.12.0+ (gerenciador de workspaces)
- **Docker** e **Docker Compose** (para Postgres, Redis)

### Passos

**1. Clonar e instalar**
```bash
git clone https://github.com/OverSoccerClub/InnoProspect.git
cd InnoProspect
pnpm install
```

**2. Levantar infraestrutura**
```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

Isso sobe PostgreSQL e Redis em containers isolados, expondo nas portas 5432 e 6379 do host.

**3. Configurar ambiente**
```bash
cp .env.example .env.local
```

Preencha no mínimo:
- `DATABASE_URL` — já vem com `localhost:5432` (padrão do docker-compose.dev.yml)
- `REDIS_URL` — já vem com `localhost:6379`
- `NEXTAUTH_SECRET` — gere com `openssl rand -base64 32`
- `APP_TIMEZONE=America/Sao_Paulo` (já preenchido)

Variáveis opcionais para este momento:
- `NEXT_PUBLIC_USE_MOCKS=true` — ativa modo de dados de exemplo sem banco (apenas UI)
- `APP_COMPANY_NAME` — nome da sua empresa nos templates
- `OPTOUT_TOKEN_SECRET` — **obrigatória antes do primeiro envio real**; gere igual ao `NEXTAUTH_SECRET`

Veja `.env.example` para todas as variáveis documentadas.

**4. Executar migrations e seed**
```bash
pnpm db:migrate
pnpm db:seed
```

Cria tabelas, índices e popula UFs/municípios do IBGE + usuário admin.

**5. Rodar o servidor de desenvolvimento**
```bash
pnpm dev
```

- Frontend + API: http://localhost:3000
- Login: email/senha do seed (veja `ADMIN_EMAIL`, padrão `admin@innoprospect.local`)

> ⚠️ **Nota importante:** `pnpm dev` trava o binário do Prisma no Windows. Se precisar rodar `pnpm typecheck` ou `pnpm build` enquanto o servidor está ativo, **desligue o servidor primeiro**.

### Rodar os testes

```bash
pnpm test
```

Roda 340+ testes de unidade e integração (core, web, scraper, worker, messaging):
- `packages/core` — lógica de domínio
- `apps/web` — API e componentes
- `packages/scraper` — extração do Google Maps
- `packages/messaging` — integração Evolution
- `apps/worker` — processadores de fila

---

## Documentação

Comece por esta ordem:

1. **[PROGRESSO.md](./PROGRESSO.md)** — Estado atual, roadmap, decisões abertas, armadilhas conhecidas. **Leia primeiro.**

2. **[ARQUITETURA.md](./ARQUITETURA.md)** — Design do sistema, contratos de API, modelos de domínio, fluxos de negócio. Referência técnica completa.

3. **[DEPLOY.md](./DEPLOY.md)** — Como implantar no EasyPanel. Variáveis obrigatórias, Health checks, problemas conhecidos de produção.

4. **[DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)** — Paleta, componentes, tokens CSS.

5. **[REVISAO-ARQUITETURA.md](./REVISAO-ARQUITETURA.md)** — O que foi encontrado de discrepâncias entre o documento e o código.

6. **[REVISAO-QA.md](./REVISAO-QA.md)** — Cobertura de testes, gaps encontrados.

7. **`docs/`** — Runbooks para quebras de scraper, números banidos, LGPD.

---

## Avisos importantes

### 1. Descadastro é obrigatório

Toda campanha respeita uma **blacklist de descadastro** (tabela `OptOut`), checada imediatamente antes de cada envio. Não há exceção, flag ou role `admin` que derrote isso. Leads descadastrados continuam bloqueados se reaparecerem em buscas futuras — a chave é o telefone, não o lead.

### 2. OPTOUT_TOKEN_SECRET é obrigatória antes do primeiro envio

A rota pública de descadastro (`GET /descadastro/:token`) valida o token com HMAC. **Sem esta variável, aceita qualquer token.** Gere no EasyPanel **antes** da primeira campanha.

```bash
openssl rand -base64 32
```

### 3. Modo de mocks é apenas para desenvolvimento

`NEXT_PUBLIC_USE_MOCKS=true` ativa dados de exemplo. **Nunca vai para produção.** O padrão em Dockerfile é `false`. Verifique em `.env.example` se sobrescrever para testes locais.

### 4. Janela de envio é dura (não configurável em runtime)

- **Piso duro (sempre respeitado):** 08:00–20:00, segunda a sexta, Brasil/São Paulo.
- **Domingos e feriados nacionais:** Nunca (calculado, não é tabela fixa).
- **Sábado:** Sempre permitido no envio manual; não entra em campanhas por padrão.

Há flag para apenas **estreitar** a janela (`DISPATCH_WINDOW_START`, `DISPATCH_WINDOW_END`), nunca alargar.

### 5. Um único ponto de chamada ao WhatsApp

Toda mensagem passa por `apps/web/src/lib/services/messages.ts#sendText` ou pela rota `/api/v1/leads/:id/messages` (envio individual). Um segundo caminho sem portão é um bug. Audite aqui qualquer mudança de fluxo de mensagem.

---

## Primeiros passos após rodar

1. **Validar ambiente:** `GET http://localhost:3000/api/v1/health` — mostra status de Postgres e Redis.

2. **Fazer login:** Credenciais do seed (variáveis `ADMIN_*` em `.env.local`).

3. **Explorar o painel:** Navegar pelas seções de Buscas, Leads, Templates, WhatsApp.

4. **Testar envio individual:** Criar um lead de teste, tentar enviar uma mensagem (vai falhar se Evolution API não estiver configurada — é esperado).

5. **Ler o PROGRESSO:** Entender o que vem a seguir (conexão real ao Google Maps, Evolution, campanhas).

---

## Troubleshooting

### Servidor não sobe
- `error: getaddrinfo ENOTFOUND postgres` → Docker Compose não está rodando. Rode `docker compose -f infra/docker-compose.dev.yml up -d`.
- `Database error: connection refused` → Postgres levantou mas não está pronto. Espere 10s e tente novamente.

### `pnpm typecheck` falha enquanto `pnpm dev` está rodando
Conhecida travada no Windows (Prisma binário travado). Desligue o servidor (`Ctrl+C` no terminal de dev) e tente novamente.

### Login não funciona
O seed gera apenas um usuário admin. Altere `ADMIN_EMAIL` e `ADMIN_PASSWORD` em `.env.local`, rode `pnpm db:seed` novamente.

### Testes falham
Verifique que o Docker Compose está ativo. Alguns testes precisam de Postgres de verdade (não mocado).

---

## Contribuir

Veja [ARQUITETURA.md §2](./ARQUITETURA.md#2-estrutura-de-pastas-contrato--vulcano-e-vega-seguem-isto) para regras de dependência entre pacotes. Resumo:

- `apps/*` importam de `packages/*` — nunca vice-versa.
- `packages/core` é lógica pura (sem Prisma, sem Next) — testável em unidade.
- Seletores do Google Maps: só em `packages/scraper/src/extraction/selectors.ts`.
- Contatos de Evolution API: só em `packages/messaging/`.

---

## Licença

Propriedade privada. Sem licença de distribuição pública.

---

## Suporte

- Bugs em produção: Veja [PROGRESSO.md §1](./PROGRESSO.md#1-destravar-ações-do-dono-sem-código) para checklist de diagnóstico.
- Dúvidas sobre arquitetura: [ARQUITETURA.md](./ARQUITETURA.md).
- Runbooks de operação: `docs/`.
