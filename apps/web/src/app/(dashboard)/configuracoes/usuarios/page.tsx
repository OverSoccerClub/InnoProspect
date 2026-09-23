import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PermissionDeniedState } from '@/components/common/permission-denied-state';
import { UsersPageClient } from '@/components/users/users-page-client';
import { auth } from '@/lib/auth';

/**
 * Server Component (async) — primeiro uso REAL de `session.user.role` como
 * gate de UI (`PermissionDeniedState` existia desde a rodada de "layout
 * premium" sem nenhuma tela usar ainda). Isto é cortesia, não o gate de
 * verdade: `GET/POST/PATCH/DELETE /api/v1/users*` já recusam com `403`
 * independente desta checagem — ver `lib/api-handler.ts#requireRole` e
 * `lib/services/users.ts`. Se alguém chegar aqui por outro caminho (link
 * direto, sessão cujo papel mudou), `UsersPageClient`/`useUsers` ainda
 * tratam o `403` da API normalmente via `ErrorState` (nunca confiam só
 * nesta tela para negar acesso).
 */
export default async function UsuariosPage() {
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

      {isAdmin && session ? (
        <UsersPageClient currentUserId={session.user.id} />
      ) : (
        <PermissionDeniedState
          title="Gestão de usuários é restrita a administradores"
          description="Operadores usam o sistema no dia a dia (buscas, leads, templates, envio) e não administram contas. Fale com um administrador se precisar de acesso a esta área."
        />
      )}
    </div>
  );
}
