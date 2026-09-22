import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';

import { cn } from '@/lib/utils';

type PermissionDeniedStateProps = {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

/**
 * Estado "sem permissão" — mesma família visual de `EmptyState`/`ErrorState`
 * (nunca uma tela em branco ou um 403 cru), reservado para telas/seções que
 * dependem de `session.user.role` (`'admin' | 'operator'`, `types/next-auth.d.ts`).
 * Nenhuma tela usa isto ainda nesta rodada — é fundação para quando a
 * primeira feature admin-only (ex.: gestão de usuários, PROGRESSO.md) tiver
 * uma checagem de papel de verdade no servidor. **Nunca** é a barreira de
 * segurança em si (isso é decisão de rota/API do Vega) — só a UI de fallback
 * quando a checagem do lado do servidor já recusou.
 */
export function PermissionDeniedState({
  title = 'Você não tem acesso a esta área',
  description = 'Fale com um administrador da conta se acha que deveria ver isto.',
  action,
  className,
}: PermissionDeniedStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-display text-sm font-semibold text-foreground">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
