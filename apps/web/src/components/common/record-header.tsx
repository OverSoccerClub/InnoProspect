import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type RecordHeaderField = {
  key: string;
  label: string;
  value: ReactNode;
};

/**
 * Cabeçalho de registro em colunas rotuladas — padrão pedido pelo dono
 * (2026-09-24, referência Altezza Travel): rótulo pequeno em maiúsculas
 * (`TOUR DATE`, `MANAGER`) com o valor destacado embaixo, várias colunas no
 * mesmo espaço que uma pilha de linhas ocuparia. Deliberadamente "burro" —
 * não decide cor nenhuma por conta própria. `value` é o lugar de compor um
 * badge (`LeadStatusBadge`, etc.) quando o campo for um status; a cor mora
 * SEMPRE no componente de origem, nunca aqui, para não duplicar a lógica de
 * `feedback-dual-role-color-tokens` num primitivo genérico.
 *
 * Zero token de cor novo: label usa `text-muted-foreground` e valor usa
 * `text-foreground` — os dois pares já verificados em DESIGN-SYSTEM.md §7,
 * nenhum contraste novo para recalcular.
 */
export function RecordHeader({ fields, className }: { fields: RecordHeaderField[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:items-start sm:gap-x-0 sm:gap-y-4',
        className,
      )}
    >
      {fields.map((field, index) => (
        <div
          key={field.key}
          className={cn('min-w-0 sm:pr-6', index > 0 && 'sm:border-l sm:border-border sm:pl-6')}
        >
          <dt className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {field.label}
          </dt>
          <dd className="mt-1 truncate font-display text-sm font-semibold text-foreground sm:text-base">
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
