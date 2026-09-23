import { AuthGuard } from '@/components/auth/auth-guard';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { auth } from '@/lib/auth';

/**
 * Server Component (async) — única leitura de sessão da árvore do shell,
 * pelo mesmo motivo de `app/(dashboard)/painel/page.tsx`: `Topbar`/`UserMenu`
 * são Client Components e não podem chamar `auth()` sozinhos. Em modo mock
 * (`NEXT_PUBLIC_USE_MOCKS=true`) sem sessão Auth.js real, `session` vem
 * `null` — `UserMenu` já trata esse caso com um fallback neutro, nunca quebra.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        {/*
          `min-w-0` é a correção real do bug sistêmico de tabela (Onda 2A):
          um item flex sem `min-width` explícito usa `min-width: auto` por
          padrão, que é o min-content da subárvore inteira — inclusive uma
          <table> com células `whitespace-nowrap` bem lá embaixo. Isso força
          esta coluna (e com ela a página inteira, via `<body>`) a crescer
          além da viewport, mesmo com `overflow-x-hidden` no `<main>` (esse
          overflow só contém o PRÓPRIO conteúdo do main depois que a caixa já
          foi dimensionada — não impede a propagação do min-content para
          cima). Sem isto, a "cortina de rolagem" interna de `components/ui/
          table.tsx` nunca chega a atuar: a página inteira estoura primeiro.
          Medido com Playwright antes/depois (ver handoff) — sem `min-w-0`,
          `/leads` a 1280px tinha `document.documentElement.scrollWidth`
          192px maior que `innerWidth`; com `min-w-0`, os dois batem.
        */}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Topbar user={session?.user} />
          {/*
            Sem `max-w` e sem `mx-auto`: o conteúdo ocupa a largura toda
            disponível ao lado da sidebar. Antes havia `max-w-6xl` (1152px),
            que num monitor de 1849px deixava ~700px de faixa morta à direita
            — pedido do dono em 23/09/2026, olhando o painel numa tela larga.
            Isto é um painel de dados (tabelas de leads, grades de KPI), não
            um texto corrido: aqui largura vira coluna visível, não linha
            longa demais para ler. A landing (`components/marketing/*`) mantém
            o `max-w-6xl` de propósito, pelo motivo oposto — lá é leitura.

            O `min-w-0` do flex acima continua sendo o que impede o estouro
            horizontal; tirar o teto de largura não o reintroduz (medido em
            1440px e 1280px depois da mudança: `scrollWidth` == `clientWidth`).
            O respiro lateral fica por conta do padding do `main`.
          */}
          <main className="w-full flex-1 overflow-x-hidden p-4 md:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
