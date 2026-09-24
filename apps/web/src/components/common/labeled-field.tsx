import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type LabeledFieldProps = {
  /** Ícone semântico opcional — sempre neutro (`text-muted-foreground`), nunca carrega cor de status (ver DESIGN-SYSTEM.md §1.4: cor com papel duplo é armadilha de contraste). */
  icon?: LucideIcon;
  label: string;
  children: ReactNode;
  className?: string;
  valueClassName?: string;
};

/**
 * Bloco "ícone + rótulo pequeno + valor" — formaliza o `InfoRow` que
 * `lead-detail.tsx` já tinha à mão (mesma marcação, promovido a primitivo
 * compartilhado nesta rodada de acabamento "premium"/Altezza, pedido do
 * dono em 2026-09-24). Reusar em qualquer card de ficha com campos
 * rotulados — não recriar o padrão localmente numa tela nova.
 */
export function LabeledField({ icon: Icon, label, children, className, valueClassName }: LabeledFieldProps) {
  return (
    <div className={cn('flex items-start gap-2', className)}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className={cn('text-sm text-foreground', valueClassName)}>{children}</div>
      </div>
    </div>
  );
}
