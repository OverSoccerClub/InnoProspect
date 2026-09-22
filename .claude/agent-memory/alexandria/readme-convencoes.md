---
name: readme-innoprospect-convencoes
description: Convenções de documentação do InnoProspect — estado honesto, verificação contra código, avisos críticos
metadata:
  type: feedback
---

## Regras para documentação no InnoProspect

**Quando documentar o projeto:**
- Estado deve refletir PROGRESSO.md (leia sempre no início)
- Stack e estrutura vêm de ARQUITETURA.md v1.1
- Comandos devem ser verificados contra package.json (pnpm install, pnpm test, pnpm dev, pnpm db:migrate, pnpm db:seed — NÃO há `npm run db:seed` direto)
- Variáveis de env vêm de .env.example (já tem comentários bons)

**Avisos críticos que SEMPRE aparecem em docs públicas:**
1. Descadastro é obrigatório — não há exceção, flag ou role admin que derrote
2. OPTOUT_TOKEN_SECRET é obrigatória antes de QUALQUER envio real (fail-closed, sem ela recusa tudo)
3. APP_COMPANY_NAME é obrigatória nos templates (resolvida como `{{minha_empresa}}`)
4. Janela de envio é dura (08–20, seg-sex, Brasil/SP, domingos nunca) — só pode estreitar, nunca alargar
5. Um único ponto de chamada ao WhatsApp (`apps/web/src/lib/services/messages.ts`) — segundo caminho sem portão é bug

**Estado honesto para públicos:**
- Código pronto, testado em unidade (340+ testes)
- Nunca rodou contra Google Maps de verdade
- Nunca testado contra Evolution API de verdade
- Campanhas (disparo em massa) não foram implementadas
- LGPD e gestão de usuários não foram implementadas
- Produção está 404 (diagnóstico pendente)

**Armadilhas já pagas (menção em README ou runbooks):**
- `next dev` trava Prisma binário no Windows se `pnpm typecheck` ou `pnpm build` rodarem em paralelo
- `NEXT_PUBLIC_USE_MOCKS=true` é build-time, não runtime (já compilado no bundle)
- `node node_modules/.bin/tsx` não funciona (é shell script)
- `next build` falha em Windows no passo `standalone` (EPERM de symlink — é do SO)
- DateTime do Prisma é TIMESTAMP sem fuso, salvo em UTC (SQL cru por dia de SP exige AT TIME ZONE duplo)

**Estrutura de docs esperada:**
- README — porta de entrada, como rodar, state-of-the-art honesto
- PROGRESSO.md — roadmap, decisões abertas, próximos passos
- ARQUITETURA.md — design, contratos de API, modelos, fluxos (fechada para implementação nas seções CONTRATO)
- DEPLOY.md — produção, EasyPanel, health checks, vars obrigatórias
- DESIGN-SYSTEM.md — UI, paleta, tokens
- REVISAO-ARQUITETURA.md — discrepâncias encontradas
- REVISAO-QA.md — cobertura, gaps
- docs/ — runbooks de operação

**Why:** Estado honesto previne surpresas e wasted debugging. Uma semana de "por que isso não funciona?" + "ah, nunca rodou de verdade contra o serviço real". Avisos críticos evitam envios bloqueados por falta de variável, ou descadastro ignorado.

**How to apply:** Toda vez que atualizar doc pública (README, runbook), cheque:
1. Cada comando contra package.json
2. Cada var contra .env.example
3. Cada afirmação de recurso contra PROGRESSO.md (se "implementado", confirme que está lá)
4. Avisos críticos listados acima se for doc dirigida ao operador/dono
