---
name: innoprospect-2026-09-23-infra-paginacao
description: Auditoria do InnoProspect em 2026-09-23 — Dockerfile/scraper dos últimos 2 dias, paginação numerada de GET /leads, export CSV, bulk actions e dimensionamento do risco LGPD (RawCapture sem retention.job). Achados por severidade.
metadata:
  type: project
---

Auditoria de 2026-09-23, pedida pelo dono para cobrir áreas nunca revisadas: infra/scraper dos
últimos 2 dias, paginação numerada nova de `GET /api/v1/leads`, export CSV, ações em massa e
dimensionamento do risco de retenção LGPD. Ver [[innoprospect-fase3-whatsapp-optout-webhook]] (que
ganhou uma atualização: o gap de rate limit/maxBodyBytes das rotas públicas já foi corrigido) e
[[innoprospect-onda-a-envio-unitario]] para o envio de WhatsApp (não re-auditado aqui, `grep
"sendText("` confirma ainda 1 único call site, sem mudança).

**Nenhum achado crítico.** Nada que bloqueie deploy.

**Paginação/export/bulk bem travados (achado positivo, não risco):**
- `LEAD_PAGE_SIZES = [25,50,100]` (enum fechado, `leadPaginationQuerySchema` em
  `packages/contracts/src/lead.contract.ts`) — `pageSize` não pode ser inflado para dump da base via
  paginação normal.
- `GET /leads/export`: teto duro de 50.000 linhas (`LEAD_EXPORT_MAX_ROWS`), checado com `COUNT` ANTES
  de abrir o stream (`countLeadsForExport`, `apps/web/src/lib/services/leads.ts:481`) — nunca abre uma
  resposta `200` que seria cortada no meio.
- **Injeção de fórmula em CSV (CWE-1236) já mitigada**: `escapeCsvField`
  (`apps/web/src/lib/services/leads.ts:426`) prefixa `'` em qualquer valor que comece com
  `=`, `+`, `-`, `@` — relevante porque nome/endereço/categoria vêm do Google Maps, o operador não
  escolhe o dado. Boa prática, preservar ao tocar o export de novo.
- `POST /leads/bulk`: teto de 10.000 ids (`LEAD_BULK_MAX_IDS`), e ao usar `filter` em vez de
  `leadIds` exige `expectedCount` batendo com a contagem RECONSULTADA no momento da chamada (`409
  EXPECTED_COUNT_MISMATCH` se divergir) — evita "mudei 4.000 leads sem querer" por filtro que mudou de
  contagem entre a tela carregar e o clique.
- Todo filtro (`buildWhere`, `leads.ts:128`) usa objetos `Prisma.LeadWhereInput` — sem SQL cru, sem
  concatenação de string. Sem risco de SQL injection em `q`/`category`/etc.

**Middleware (`apps/web/src/middleware.ts`, matcher liberando `icon.svg`/`apple-icon.png`):
confirmado seguro.** O regex do `matcher` (`/((?!_next/static|_next/image|favicon\.ico|icon\.svg|
apple-icon\.png).*)`) usa `\.` literal (não wildcard) — `/iconXsvg` não casa a exceção e continua
redirecionando para login (bate com o teste manual do dono). A lookahead não é ancorada no fim
(`icon.svg` + qualquer sufixo também escaparia do middleware), mas isso é inofensivo porque não existe
NENHUMA rota real nesses sufixos — o Next devolve 404 antes de qualquer dado sensível ser servido.
Sem achado.

**Scraper/worker dos últimos 2 dias — sem vazamento de dado de lead no log de erro (confirmado, não
suposto):** `ScrapeError` (`packages/scraper/src/errors.ts`) só carrega `code`/`message`/`cause` —
nenhum campo estruturado com dado de negócio. Todo `throw new ScrapeError(...)` em
`navigate.ts`/`browser.ts`/`playwright-engine.ts` acontece ANTES da extração de cards (a lista
`cardHtmls` só é populada depois que o feed é classificado com sucesso) — logo `cause` é sempre erro
técnico do Playwright/Chromium, e a mensagem só contém a query de busca (nicho+cidade, ex.
"restaurantes em São Paulo") e um trecho da PRÓPRIA página de bloqueio do Google, nunca telefone/nome
de lead. `errForLog` em `scrape-search.job.ts:318` (mudança auditada) preserva esse mesmo contrato —
só melhora o log ENCADEANDO `cause`, não adiciona campo novo. Logger do worker (`pino`) só serializa
`name/message/stack` de valor error-like — confirmado lendo `observability/logger.ts` (comentário
próprio no topo já documenta a regra "nunca telefone/endereço bruto").

**`apps/worker/Dockerfile`: dívida de DOCUMENTAÇÃO, não de segurança.** O rodapé do arquivo (linhas
107-112) ainda diz "⚠️ NÃO validado com `docker build` nesta máquina" pedindo para confirmar
`PLAYWRIGHT_BROWSERS_PATH`/usuário `pwuser`/guarda de versão no "primeiro build real" — mas o PRÓPRIO
cabeçalho do arquivo, alguns parágrafos acima, relata um INCIDENTE REAL DE PRODUÇÃO no EasyPanel na
MESMA DATA (2026-09-22, `groupadd: group 'pwuser' already exists`) que só existe porque um build real
já rodou e falhou/foi corrigido. O aviso "não validado" ficou desatualizado no mesmo commit que
descreve a validação real. Não é risco de segurança (o conteúdo do Dockerfile em si — usuário não-root,
sem secret hardcoded, guarda de versão do Playwright — está correto), é sinal para Vulcano confirmar e
limpar a nota antes que alguém leia o aviso e assuma, errado, que nada disso foi testado ainda.

**LGPD — dimensionamento do risco de retenção (pedido explícito do dono, sem dramatizar nem
minimizar):**
- Uso é B2B, dado coletado é de ESTABELECIMENTOS (nome do negócio, telefone comercial, endereço,
  categoria) via Google Maps — não é dado de menor, não é dado sensível (saúde/biometria/opinião), e
  para MEI/autônomo o "nome do negócio" pode coincidir com nome de pessoa física, mas ainda assim é
  contato PROFISSIONAL, exposto publicamente pelo próprio titular no Google Maps para fins de contato
  comercial. Base legal mais plausível (não sou advogado, é leitura de engenheiro): legítimo interesse
  (art. 7º, IX) para prospecção B2B de dado já público, com o opt-out funcional como mitigação do
  direito de oposição.
- **O que falta de verdade**: `RawCapture` (schema, `packages/db/prisma/schema.prisma:616`) documenta
  a própria intenção — "EFÊMERO por desenho: `retention.job` apaga fisicamente após 7 dias" — mas eu
  não achei esse job em lugar nenhum do código (`grep -rln retention apps/ packages/` só bate no
  client Prisma gerado). Toda vez que o worker processa 1 card do Maps, grava 1 linha de `RawCapture`
  com o objeto bruto capturado (`rawData Json`) — isso cresce SEM NENHUMA limpeza desde a Fase 2,
  ainda que o índice `@@index([createdAt])` já exista PRONTO para o job que ainda não foi escrito.
  Isso é o único ponto onde "coletar e nunca apagar" já é uma realidade em produção, não uma hipótese.
- **Tamanho real do risco para este contexto (uso próprio, admin único, sem cliente terceiro)**: BAIXO
  hoje, mas por acidente de escala, não por desenho — com ~260 leads a base de `RawCapture` ainda é
  pequena e o custo de alguém pedir exclusão/reclamar é teórico. O risco sobe com o TEMPO (mais
  meses de scraping = mais dado acumulado sem TTL) e SOBE MUITO se um dia entrar um cliente terceiro
  (dado de leads DE OUTRA EMPRESA guardado sem prazo é outro nível de exposição regulatória). Não é
  "ok ignorar para sempre" — é "ok não ser a prioridade desta sprint", com o job de retenção como
  próximo item de dívida técnica antes de qualquer expansão de uso.
- Direito de eliminação (apagar um lead a pedido do titular) também não existe (`DELETE
  /api/v1/leads/:id` não existe) — mesma leitura: baixo risco prático hoje (uso interno, ninguém pediu
  ainda), mas é o próximo "portão" que falta se o produto crescer.

**`pnpm audit --prod`: mesma categoria de antes (herdadas, build-time), versões atualizaram.**
`sharp@0.34.5` (via `next@15.5.26`) ainda `<0.35.4`/`<0.35.0` conforme o advisory (libvips CVE-2026-*),
`postcss@8.4.31` com 3 advisories de sourcemap/XSS, `nanoid@3.3.16` (transitivo de postcss),
`deepmerge-ts` (transitivo de `@prisma/config`, usado só pela CLI do Prisma em build/generate, nunca
em runtime). Mesma conclusão da auditoria anterior: `next/image` continua não usado em código nenhum
(`grep` confirmou de novo) então `sharp` não roda em runtime; `postcss`/`nanoid` só atuam em build
time, nunca processando CSS/sourcemap controlado por usuário em produção. Classificado Baixo, sem
mudança de veredito — só acompanhar se o Next lançar patch que resolva transitivamente.
