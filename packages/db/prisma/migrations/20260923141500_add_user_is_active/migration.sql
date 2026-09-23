-- InnoProspect — `User.isActive` (CRUD de usuários do sistema, Onda 4). Ver
-- comentário completo em `packages/db/prisma/schema.prisma` no campo
-- `isActive` do model `User`.
--
-- Gerada manualmente (sem Postgres disponível nesta máquina, mesma
-- limitação registrada nas migrações anteriores — `prisma migrate diff`
-- não pôde ser rodado contra um banco vivo). ⚠️ NÃO aplicada contra banco
-- vivo. Roda no boot via `prisma migrate deploy` (entrypoint fail-fast) —
-- conferir o resultado no primeiro boot.
--
-- 100% ADITIVA: uma coluna nova com DEFAULT constante (`true`). Nenhum
-- usuário existente muda de comportamento — todo usuário hoje continua
-- podendo logar exatamente como antes. `DEFAULT` de valor constante é só
-- metadado no Postgres 11+, não reescreve a tabela linha a linha (mesma
-- observação já registrada em `20260923090000_lead_off_niche`); a tabela
-- `users` também é pequena (1-20 linhas hoje), então isto é irrelevante em
-- termos de custo aqui de qualquer forma.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
