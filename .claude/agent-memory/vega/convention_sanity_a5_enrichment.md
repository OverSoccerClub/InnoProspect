---
name: convention-sanity-a5-enrichment
description: Assertion A5 (checkEnrichmentFillRate) — pega leads "só com o nome" que A1-A4 nunca cobriam; e a remoção do model RawCapture do schema
metadata:
  type: project
---

Entregue na Onda 3 (2026-09-23). Causa raiz do achado do dono: ~260 leads chegaram coletados só com o
nome (endereço/telefone/categoria/site TODOS vazios ao mesmo tempo) e NENHUMA das A1-A4 disparou —
elas medem quantidade (A1 zero-streak), ausência de UM campo isolado (A2 nome, A3 telefone) ou FORMATO
(A4 rating fora de faixa / falha de normalização), nunca "quão preenchido, no total, um lead ficou".

**A5 — `checkEnrichmentFillRate`** (`packages/scraper/src/sanity/assertions.ts`), ligada em
`apps/worker/src/observability/sanity.ts`: mede a fração de leads, na mesma janela de 50 já usada por
A2-A4, onde `address` E `phone` (raw OU E.164) E `category` E `website` estão TODOS vazios ao mesmo
tempo ("nameOnlyRate"). Dispara acima de 30% (`maxNameOnlyRate`), com piso de amostra >= 20 (mesmo
`minSampleSize` de A3). **Deliberadamente NÃO inclui `rating`/`reviewCount`/coordenadas** — um negócio
novo sem avaliação é normal no Maps, incluir esses campos geraria alarme falso. Endereço e categoria
são quase universais em qualquer card do Maps (mesma amostra real que justificou o piso de 20% da A3:
7/7 negócios de "material de construção" tinham os dois) — por isso mesmo um nicho legítimo sem
telefone/site publicado ainda fica com `nameOnlyRate` perto de 0% por esta métrica (só conta como
vazio quando os 4 falham JUNTOS). **PAUSA a fila** (`pauseQueue: true`, `severity: 'critical'`,
diferente de A3/A4) — todos os 4 campos vazios ao mesmo tempo não tem explicação de nicho plausível, é
sinal de seletor quebrado em massa, mesma categoria de falha estrutural que A1/A2.

**Vocabulário fechado estendido:** `ScraperHealthEventType` (enum Prisma) ganhou `fill_rate_enrichment`
— migração `20260923100000_add_enrichment_fill_rate_type` (só `ALTER TYPE ... ADD VALUE`, 100%
aditiva). `EVENT_TYPES` em `sanity.ts` e o `switch` de `windowDescriptionFor` precisam bater 1:1 com o
enum — se adicionar A6 no futuro, mexer nos DOIS lados (schema + `sanity.ts`) e checar
`recordHealthEventIfNew`/o alerta genérico `sanity_incident_opened` continuam cobrindo qualquer `type`
novo sem precisar de código extra em `evaluateAndRecordSanity` (o loop já é genérico sobre
`EVENT_TYPES`).

**Testes:** `packages/scraper/src/sanity/assertions.test.ts` — reproduz o cenário real (janela 100%
"só com o nome"), o caso de nicho legítimo (endereço+categoria preenchidos, sem tel/site — NÃO
dispara), os limites exatos do piso de 30%, e a garantia de que 1 campo isolado preenchido (ex.: só
telefone) já basta para NÃO contar como "só com o nome".

---

**Remoção de `RawCapture` (mesma rodada, decisão do dono já tomada):** model + tabela `raw_captures`
removidos do schema (`packages/db/prisma/schema.prisma`) e migração
`20260923120000_drop_raw_capture` (DESTRUTIVA — `DROP TABLE`, sem backup automático). Verificado ANTES
de apagar: `grep -rln "rawCapture|RawCapture|raw_captures" apps/ packages/` (excluindo
`packages/db/src/generated/**` e `prisma/migrations/**`) devolve só o próprio `schema.prisma` — zero
escritor, zero leitor de produção. O `retention.job` que o comentário original do model previa
("EFÊMERO por desenho, apaga após 7 dias") NUNCA foi implementado (`find . -iname "*retention*"` não
acha nada) — a tabela não tinha nem quem escrevesse nem o job de limpeza que o próprio design previa.
**Não verificado:** se há linhas em produção HOJE (não há acesso ao Postgres de produção desta
máquina) — reportado no handoff para o dono decidir se quer um `SELECT count(*) FROM raw_captures;`
antes de aplicar a migração. `ARQUITETURA.md §7.5`/`§2.6` ainda citam `RawCapture` como item da Fase 5
(retention job planejado) — não editei `ARQUITETURA.md` (território da Nova), fica pendente pra ela/
Alexandria atualizar.

**Ambas as migrações foram geradas OFFLINE** (sem Postgres na máquina, mesma limitação de ambiente já
registrada na memória do Atlas — `innoprospect-bloqueio-docker`) via `prisma migrate diff
--from-schema-datamodel <snapshot do schema ANTES, obtido com \`git show HEAD:...\`>
--to-schema-datamodel prisma/schema.prisma --script` — mesmo padrão já usado nas migrações anteriores
do Cronos (`20260922100000_dashboard_summary_indexes`, `20260923090000_lead_off_niche`). NÃO aplicadas
contra um banco vivo — primeira aplicação real é o `prisma migrate deploy` do boot em produção.

**Gotcha de ambiente Windows:** `prisma generate` falha ao renomear
`query_engine-windows.dll.node` (`EPERM`) se houver um `next dev` (ou qualquer processo Node) com o
client Prisma já carregado em memória — a rename trava porque o arquivo está em uso. O `.d.ts`/JS do
client REGENERA corretamente mesmo assim (só o binário nativo falha); `pnpm typecheck` por pacote
individual (`pnpm --filter <pkg> typecheck`) funciona normalmente. `pnpm typecheck` NA RAIZ (via turbo)
falha porque o pipeline trata `@inno/db#generate` como dependência obrigatória e o exit code 1 do
`prisma generate` propaga, mesmo com os tipos já corretos. Não é bug do meu código — é lock de arquivo
do processo de preview rodando em paralelo. Se acontecer de novo: rodar typecheck por pacote
individualmente prova que os tipos estão certos, sem precisar encerrar o preview.

Ver também [[project-innoprospect]] e [[bug-maps-card-selectors-drift-2026-09]] (o piso de telefone da
A3, mesma amostra real usada para justificar o piso de A5).
