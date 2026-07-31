# PROGRESSO — InnoProspect

Sistema de prospecção B2B: filtra empresas por **setor/nicho + UF**, coleta os
contatos, e dispara **mensagens de WhatsApp** para os leads.

- **Missão no painel:** `PM-VERT` / `cms7jdn8p00c001th6nvzrcfv`
- **Arquitetura:** `ARQUITETURA.md` (Nova) — 11 seções, contratos fechados
- **Última atualização:** 2026-07-31

---

## Estado atual: Fase 1 quase fechada, **nunca executada de verdade**

O código das duas pontas existe e compila. O que **não** aconteceu ainda é
rodar o sistema contra banco vivo — não há Docker nesta máquina, então nem
Postgres nem Redis subiram. **Nenhum lead real foi coletado até agora.**

### Concluído

| # | Entrega | Quem | Situação |
|---|---|---|---|
| 1.1 | Monorepo pnpm+Turborepo, apps/web, apps/worker, docker-compose de dev | Vulcano | ✅ |
| 1.2 | Schema Prisma (7 models) + migração + seed IBGE | Cronos | ✅ |
| 1.3 | `packages/contracts` (Zod da §4) e `packages/core` (regras puras + testes) | Vega | ✅ |
| 1.3 | `packages/scraper`: engine Playwright, seletores isolados, extractor, sanity, fixtures | Vega | ✅ |
| 1.4 | `apps/worker`: fila BullMQ, 1 job = 1 município, retry/backoff por tipo de erro | Vega | ✅ |
| 1.5 | Rotas `/api/v1/*` + `api-handler` (auth, Zod, envelope de erro) | Vega | ✅ |
| — | Auth.js v5 real (credentials + bcrypt) + middleware protegendo dashboard e API | Vega | ✅ |
| 1.6 | Telas: login, shell, nova busca, progresso ao vivo (polling 3s), leads, ficha | Lyra | ⚠️ em **mock** |

### Falta para fechar a Fase 1

1. **Subir Postgres + Redis** — bloqueado: Docker não instalado. Ver "Decisões em aberto".
2. **Rodar `db:migrate` + `db:seed`** contra banco vivo (a migração nunca foi aplicada de fato).
3. **Trocar o mock da Lyra pelo backend real:** `NEXT_PUBLIC_USE_MOCKS=false` e, em
   `lib/auth-client.ts`, trocar o `login()` por
   `signIn('credentials', { email, password, redirect: false })` — **não** usar
   fetch cru para `/api/auth/callback/credentials` (o NextAuth exige csrfToken).
4. **Preencher `.env.local`**: hoje só tem as variáveis do painel de missões.
   Faltam `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.
5. **Íris (item 1.7)** — e2e "criar busca → ver leads". Só faz sentido depois do passo 1.
6. **Critério de aceite ainda não verificado:** buscar "clínica odontológica" em
   Campinas-SP retornar ≥ 30 leads com nome e telefone em < 3 minutos, sem duplicatas.

---

## Decisões em aberto (dependem do dono)

1. **Como subir Postgres + Redis nesta máquina.** Docker não está instalado.
   Opções: (a) instalar Docker Desktop; (b) Postgres + Redis nativos no Windows;
   (c) usar um Postgres gerenciado remoto (Neon/Supabase) e Redis remoto.
   **Nada é validável de verdade até isso ser resolvido** — é o único bloqueio real hoje.
2. **Escala.** As premissas da §0 da arquitetura são suposições da Nova, não
   briefing. Se o alvo for muito maior (centenas de usuários, milhões de leads),
   avisar antes da Fase 2.
3. **Hospedagem.** Assumido VPS Linux com Docker Compose. Se for Vercel, o worker
   precisa de outro lugar de qualquer forma (Chromium + processo longo não rodam lá).
4. **Quantos números de WhatsApp** serão usados? Define se a rotação entre
   instâncias é essencial já na Fase 4.
5. **Texto padrão de descadastro** na 1ª mensagem: "responda SAIR" ou link público?
   O sistema suporta os dois; o default é escolha de quem assina a comunicação.
6. **`turbo.json` sem `generate`** (prisma generate) como dependência de
   build/typecheck de `@inno/db` — hoje precisa rodar manual. Território do Vulcano.

---

## Convenções travadas (não reabrir sem motivo forte)

- **Fonte de leads:** scraping próprio. **Canal:** Evolution API. **Stack:**
  Next.js 15 + TS + Prisma + Postgres. Decisões do dono.
- **Seletores do Google Maps vivem em UM arquivo só**
  (`packages/scraper/src/extraction/selectors.ts`). Mudança de layout = fix de 1 arquivo.
- **Opt-out é por telefone e checado ANTES de cada envio**, inclusive dentro de
  campanha em andamento.
- **Re-scraping nunca sobrescreve dado humano** (`status`, `notes`, `tags`,
  `ownerId`) — ver `MACHINE_UPDATABLE_FIELDS` em `packages/core`.
- **Contadores do SearchJob são incrementados, nunca `COUNT(*)`** — a tela faz
  polling de 3s.
- **`apps/web` nunca importa `@inno/scraper`** (carregaria Playwright no bundle).
- **Bugs que só aparecem em `next build`**, nunca em `dev`/`typecheck`: componente
  passado como prop de Server → Client Component; middleware Edge + Prisma;
  imports `.js` de pacotes internos sem `transpilePackages` + `extensionAlias`.
