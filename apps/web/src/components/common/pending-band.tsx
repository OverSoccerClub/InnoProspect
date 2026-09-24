'use client';

import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PendingBandItem = {
  key: string;
  /** Rótulo curto do que está pendente (ex.: "Leads sem telefone"). */
  label: string;
  count: number;
  actionLabel?: string;
  onAction?: () => void;
  /** `warning` (padrão) para algo que precisa de atenção; `destructive` para uma falha real. Só colore o ÍCONE (piso WCAG 3:1) — nunca o número, ver DESIGN-SYSTEM.md §1.4. */
  tone?: 'warning' | 'destructive';
};

const TONE_ICON_CLASS: Record<NonNullable<PendingBandItem['tone']>, string> = {
  warning: 'text-warning-foreground dark:text-warning',
  destructive: 'text-destructive',
};

/**
 * Faixa de pendências acionável — pedido do dono (2026-09-24, referência
 * Altezza: "1302 Arrival · 809 Transfer · 204 Missing Passport", cada um com
 * uma ação). **Não é KPI decorativo, é fila de trabalho**: só mostra itens
 * com `count > 0`, e cada item carrega a ação que resolve/investiga aquele
 * grupo (nunca só um número solto). Itens com `count === 0` são filtrados
 * ANTES de chegar aqui — nunca renderizar "0 pendências" como se fosse uma
 * fila real.
 *
 * Quando não há nenhuma pendência, mostra uma confirmação calma (não
 * desaparece em silêncio) — mesmo espírito de "nenhum estado morto" do
 * restante do sistema, numa versão discreta (uma linha, não um card cheio).
 */
export function PendingBand({
  items,
  emptyLabel = 'Nenhuma pendência agora',
  className,
}: {
  items: PendingBandItem[];
  emptyLabel?: string;
  className?: string;
}) {
  const visible = items.filter((item) => item.count > 0);

  if (visible.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-xs',
          className,
        )}
      >
        <span className="relative flex size-2 shrink-0">
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      role="list"
      aria-label="Pendências que precisam de ação"
      className={cn(
        'flex flex-col divide-y divide-border rounded-lg border border-border bg-card shadow-xs sm:flex-row sm:divide-x sm:divide-y-0',
        className,
      )}
    >
      {visible.map((item) => (
        <div
          role="listitem"
          key={item.key}
          // `min-w-0` é obrigatório aqui: item flex-1 sem largura mínima
          // explícita usa `min-width: auto` (min-content de toda a subárvore)
          // e nunca encolhe até o `truncate` do rótulo entrar em ação — mesma
          // causa raiz documentada em `bug-table-overflow-flex-min-width`,
          // aplicada preventivamente aqui.
          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <AlertTriangle
              className={cn('size-4 shrink-0', TONE_ICON_CLASS[item.tone ?? 'warning'])}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold leading-none tabular-nums text-foreground">
                {item.count}
              </p>
              <p className="truncate text-xs text-muted-foreground">{item.label}</p>
            </div>
          </div>
          {item.onAction && (
            <Button variant="outline" size="sm" className="shrink-0" onClick={item.onAction}>
              {item.actionLabel ?? 'Ver'}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
