---
name: convention-admin-role-and-user-crud
description: CRUD de usuários (User.isActive) + requireRole em apiRoute — mecanismo único de autorização por papel, quais rotas ficaram admin-only, e a corrida "nunca zero admin"
metadata:
  type: project
---

Entregue numa rodada só (2026-09-23, Onda 4): antes desta rodada não existia
NENHUMA rota de usuário, e `role` (`admin`|`operator`) só era verificado em UM
lugar de todo o código (`optouts.ts#deleteOptOut`, `if` ad-hoc). Duas partes
inseparáveis — CRUD sem enforcement teria dado a um "operador" poder de admin
em tudo (a checagem de papel é o que dá sentido à tela).

**Mecanismo central (`apps/web/src/lib/api-handler.ts`):** `apiRoute({
requireRole: 'admin' })` — roda IMEDIATAMENTE depois da sessão, ANTES de
parsear params/query/body (mesma lógica de "falhar rápido" do `rateLimit`).
Sem sessão → `401` (não `403` — distinção real, testada). Sessão com papel
errado → `403 FORBIDDEN`. Nenhuma rota deve voltar a copiar `if
(session.user.role !== 'admin') forbidden(...)` — é o padrão antigo que eu
removi de `optouts.ts#deleteOptOut` (agora só a rota `optouts/[id]/route.ts`
declara `requireRole: 'admin'`, o serviço não sabe mais de `role`).

**Rotas que passaram a exigir admin nesta rodada:** todo `/api/v1/users/**`
(novo), `/api/v1/whatsapp/instances/**` (GET/POST/DELETE/connect/disconnect/qr
— TODAS, inclusive leitura: gerenciar instância é papel de admin, operador nem
vê a lista), `POST /api/v1/scraper/queue/resume` (retomar fila — "cancelar/
retomar fila" da lista do dono), `DELETE /api/v1/optouts/:id` (migrado do
`if` ad-hoc). `GET /api/v1/scraper/queue` (só leitura/monitoramento) e
`GET/POST /api/v1/optouts` (uso rotineiro) ficaram sem `requireRole` de
propósito — só a ação de ADMINISTRAR é restrita, não o monitoramento.

**Desativar, nunca excluir (`User.isActive`, `packages/db/prisma/
schema.prisma`):** decisão comprovada, não só preferência — `SearchJob.
createdById`/`WhatsAppInstance.createdById`/`MessageTemplate.createdById`/
`Campaign.createdById` são `onDelete: Restrict` (confirmado lendo o schema
antes de decidir, como pedido). Um `DELETE` físico de um `User` que já criou
QUALQUER uma dessas entidades estoura `P2003` na hora — e isso é a MAIORIA dos
usuários reais, não uma exceção. `Lead.ownerId`/`LeadActivity.actorUserId` são
`SetNull`, mas apagar perderia autoria de auditoria (quem fez opt-out, quem
mudou status). `DELETE /api/v1/users/:id` é soft-delete (`isActive: false`),
idempotente (chamar 2x no mesmo usuário já inativo é no-op, `204` as duas
vezes). Migração `20260923141500_add_user_is_active` — 100% aditiva.

**Duas proteções obrigatórias, em `lib/services/users.ts`:**
1. Ninguém pode excluir/rebaixar A SI MESMO (`actor.id === id` bloqueia
   `isActive:false` e `role` saindo de `admin`, em `updateUser` E
   `deactivateUser`).
2. Nunca zero admin ativo — `lockActiveAdminsAndCount` faz `SELECT id FROM
   users WHERE role='admin' AND "isActive"=true FOR UPDATE` DENTRO da mesma
   `$transaction` antes de contar, só quando a mudança PODE reduzir o nº de
   admins (evita o lock extra em toda edição de nome/senha). O `FOR UPDATE`
   existe porque "contar, decidir, then UPDATE" sem lock é write-skew clássico
   (duas transações rebaixando DOIS admins diferentes ao mesmo tempo podem
   cada uma ver 2 antes de qualquer comitar). **NÃO validado contra Postgres
   real** (mesma limitação de sempre nesta máquina) — a lógica sequencial
   está testada (`users.test.ts`), o fechamento da corrida sob concorrência
   real depende do comportamento documentado do `FOR UPDATE` no Postgres.

**Login bloqueia conta desativada, mas com limitação documentada:**
`authorizeCredentials` (`lib/auth.ts`) recusa `!user.isActive` (mesma resposta
genérica, mesmo custo de rate limit de qualquer outra falha — não é jeito
mais barato de varrer contas). **Isto só impede um login NOVO.** Uma sessão
JÁ aberta (JWT já emitido, `session: {strategy:'jwt'}`) continua válida até
expirar — não há storage de sessão server-side pra revogar na hora. Mesma
limitação vale para MUDANÇA DE PAPEL (rebaixar um admin não afeta a sessão já
aberta dele). Documentado no handoff, não meia-solução escondida — resolver
de verdade exigiria trocar a estratégia de sessão ou um storage de
revogação, fora do escopo desta rodada.

**Colisão de timestamp de migração com o Cronos:** o Cronos estava
concorrentemente no MESMO `schema.prisma` nesta rodada (Fase 4.B,
`EvolutionServer`) e criou `20260923140000_evolution_servers` — timestamp
IDÊNTICO ao que eu tinha escolhido primeiro para `add_user_is_active`. Só
percebi porque o hook de edição avisou "arquivo mudou em disco desde a
última leitura". Renomeei a MINHA pasta para `20260923141500_...` antes de
prosseguir. **Como evitar de novo:** ao editar `schema.prisma`/criar migração
numa sessão onde outro agente pode estar no mesmo arquivo, reler o arquivo
(ou `ls migrations/`) IMEDIATAMENTE antes de gerar o timestamp, não confiar
no que foi lido no início da tarefa.

Ver também [[project-innoprospect]], [[convention-api-routes-fase1]],
[[convention-login-rate-limit]].
