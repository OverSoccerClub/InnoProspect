---
name: feedback-vitest-mock-hoisting
description: vi.mock(path, factory) quebra com "Cannot access '...' before initialization" quando `factory` referencia um binding importado de OUTRO arquivo — como evitar.
metadata:
  type: feedback
---

Regra: `vi.mock(path, factory)` é hoisted pelo Vitest para o topo do
arquivo, ANTES dos `import`s estáticos serem resolvidos. Se `factory`
referencia diretamente um símbolo importado de outro módulo (ex.:
`import { fakePrismaClient } from './fake-db'; vi.mock('@inno/db', () =>
({ prisma: fakePrismaClient }));`), o runtime lança `ReferenceError:
Cannot access '__vi_import_N__' before initialization` — mesmo parecendo
um padrão razoável, e mesmo funcionando "às vezes" dependendo da ordem dos
imports no arquivo.

**Como corrigir (2 padrões, ambos testados e funcionando neste projeto):**

1. **Import dinâmico DENTRO da própria factory** (preferido quando o valor
   vem de outro arquivo):
   ```ts
   vi.mock('@inno/db', async () => {
     const { fakePrismaClient } = await import('@/test/fake-db');
     return { prisma: fakePrismaClient };
   });
   ```
   Funciona porque a resolução só acontece quando a factory É CHAMADA
   (depois de tudo inicializado) — o ESM cacheia o módulo, então é a MESMA
   instância que o resto do arquivo de teste usa via import estático normal.

2. **`vi.hoisted()`** quando o valor nasce no MESMO arquivo (ex.: um
   `prismaMock` construído com `vi.fn()` ali mesmo):
   ```ts
   const prismaMock = vi.hoisted(() => ({ lead: { findMany: vi.fn() } }));
   vi.mock('@inno/db', () => ({ prisma: prismaMock }));
   ```
   Isso funciona direto (sem `import()` dinâmico) porque `vi.hoisted`
   também é hoisted, na mesma ordem relativa ao `vi.mock` que o referencia.

**Por quê isto importa:** descobri isso na prática construindo
`apps/web/src/test/fake-db.ts`, `api-handler-mock.ts` e `logger-mock.ts`
como helpers compartilhados entre `campaign-targets.test.ts`,
`webhook.test.ts`, `optouts.test.ts` — a primeira tentativa (import
estático direto + `vi.mock(path, importedFactoryFn)`) quebrou nos 3
arquivos que usavam `vi.mock`, e só passou de cara no arquivo que não
usava `vi.mock` nenhum (`campaign-targets.test.ts`, que passa o fake como
parâmetro em vez de mockar módulo). Ver `[[project-innoprospect-testing]]`
para onde esse padrão está em uso.

**Como aplicar:** sempre que compartilhar um mock/factory entre múltiplos
arquivos `*.test.ts` (helper de mock reutilizável), usar o padrão 1
(import dinâmico dentro da factory) — é o que generaliza para qualquer
projeto vitest, não só este.
