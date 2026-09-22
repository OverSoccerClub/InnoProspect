'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { useCountUp } from '@/hooks/useCountUp';
import { cn } from '@/lib/utils';

type IndicatorCardProps = {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  value: number;
  /** Formata o número já animado — usado pra "%", "min", etc. Padrão: `toLocaleString('pt-BR')`. */
  format?: (value: number) => string;
  /** `null`/`undefined` = sem comparação disponível (esconde o badge, não mostra "0%" enganoso). */
  deltaPercent?: number | null;
  deltaLabel?: string;
  /**
   * Visual da métrica (sparkline, anel de proporção, mini-barras de
   * comparação — ver `components/dashboard/charts/*`). Cada indicador usa o
   * visual que combina com o TIPO do dado, não sparkline em tudo: os 4
   * cards precisam do mesmo peso visual, mas não do mesmo gráfico.
   */
  visual?: ReactNode;
  /** Texto de apoio (ex.: "1 na fila · 2 rodando"). */
  secondaryText?: string;
};

/**
 * Tile de indicador do painel — ícone em caixa colorida, número animado
 * (`useCountUp`, desliga em `prefers-reduced-motion`), variação vs. período
 * anterior (seta colorida + texto NEUTRO — nunca o número da variação em
 * verde/vermelho direto, mesma regra de "cor só no ícone/borda" do Alert e
 * do banner de fila, DESIGN-SYSTEM.md §1.4/§4) e um slot de visual (`visual`).
 */
export function IndicatorCard({
  icon: Icon,
  iconClassName = 'bg-primary/10 text-primary',
  label,
  value,
  format,
  deltaPercent,
  deltaLabel = 'vs. semana passada',
  visual,
  secondaryText,
}: IndicatorCardProps) {
  const animated = useCountUp(value);
  const displayValue = format ? format(animated) : animated.toLocaleString('pt-BR');
  const hasDelta = deltaPercent !== null && deltaPercent !== undefined;
  const isPositive = hasDelta && deltaPercent! >= 0;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <span className={cn('flex size-9 items-center justify-center rounded-lg', iconClassName)}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
          {hasDelta && (
            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              {isPositive ? (
                <ArrowUp className="size-3.5 text-success" aria-hidden="true" />
              ) : (
                <ArrowDown className="size-3.5 text-destructive" aria-hidden="true" />
              )}
              {Math.abs(deltaPercent!).toFixed(0)}%
            </span>
          )}
        </div>
        <div>
          <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{displayValue}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        {visual}
        {secondaryText && <p className="text-xs text-muted-foreground">{secondaryText}</p>}
        {hasDelta && <p className="sr-only">{deltaLabel}</p>}
      </CardContent>
    </Card>
  );
}
