'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type TabWithCountItem = {
  key: string;
  label: string;
  /** `undefined` = sem pílula de contagem (aba sem número que faça sentido mostrar). */
  count?: number;
  content: ReactNode;
};

/**
 * Abas com contador dentro do rótulo (`General 12 · Arrival 12`, pedido do
 * dono em 2026-09-24, referência Altezza) — feitas à mão (padrão ARIA de
 * tabs: roving tabindex + setas/Home/End), não Radix: diferente do
 * `DropdownMenu` (que precisa de portal/foco preso/Popper), um painel de
 * abas simples não paga o custo de uma dependência nova — mesma régua de
 * "Radix só onde compensa" já em uso no projeto.
 *
 * Cor da pílula de contagem: SEMPRE um dos dois pares já verificados em
 * DESIGN-SYSTEM.md §7 (`primary`/`primary-foreground` no fill sólido da aba
 * ativa, `secondary`/`secondary-foreground` na inativa) — nunca texto
 * colorido sobre fundo tintado (a armadilha de
 * `feedback-dual-role-color-tokens`).
 */
export function TabsWithCount({
  items,
  defaultKey,
  className,
}: {
  items: TabWithCountItem[];
  defaultKey?: string;
  className?: string;
}) {
  const [active, setActive] = useState(defaultKey ?? items[0]?.key);
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function focusTab(index: number) {
    const item = items[(index + items.length) % items.length];
    if (!item) return;
    setActive(item.key);
    tabRefs.current[item.key]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTab(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTab(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(items.length - 1);
    }
  }

  const activeItem = items.find((item) => item.key === active) ?? items[0];

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Seções"
        className="flex items-center gap-1 overflow-x-auto border-b border-border"
      >
        {items.map((item, index) => {
          const selected = item.key === activeItem?.key;
          return (
            <button
              key={item.key}
              ref={(el) => {
                tabRefs.current[item.key] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.key)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span
                  className={cn(
                    'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                    selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                  )}
                >
                  {item.count}
                </span>
              )}
              {selected && (
                <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.key}
          role="tabpanel"
          id={`${baseId}-panel-${item.key}`}
          aria-labelledby={`${baseId}-tab-${item.key}`}
          hidden={item.key !== activeItem?.key}
          className="pt-4"
        >
          {item.key === activeItem?.key && item.content}
        </div>
      ))}
    </div>
  );
}
