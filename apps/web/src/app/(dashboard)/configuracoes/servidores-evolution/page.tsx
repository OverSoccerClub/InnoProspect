import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PermissionDeniedState } from '@/components/common/permission-denied-state';
import { EvolutionServersPageClient } from '@/components/evolution-servers/evolution-servers-page-client';
import { auth } from '@/lib/auth';

/**
 * Server Component (async) — mesmo gate de cortesia de
 * `configuracoes/usuarios/page.tsx` (`session.user.role === 'admin'`). O
 * gate de verdade é a API (`GET/POST/PATCH/DELETE /api/v1/evolution-
 * servers*`, `requireRole: 'admin'` — ver `evolution-servers/route.ts`) —
 * se alguém chegar aqui por outro caminho (link direto, sessão cujo papel
 * mudou), `EvolutionServersPageClient`/`useEvolutionServers` ainda tratam o
 * `403` da API normalmente via `ErrorState` (nunca confiam só nesta tela
 * para negar acesso).
 */
export default async function ServidoresEvolutionPage() {
  const session = await auth();
  const isAdmin = session?.user.role === 'admin';

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/configuracoes"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar para configurações
      </Link>

      {isAdmin ? (
        <EvolutionServersPageClient />
      ) : (
        <PermissionDeniedState
          title="Servidores Evolution são restritos a administradores"
          description="Esta é a infraestrutura de disparo compartilhada por todo o sistema — só administradores cadastram, editam e testam servidores."
        />
      )}
    </div>
  );
}
