import { cn } from '@/lib/utils';

type CompareBarsItem = {
  label: string;
  value: number;
  barClassName?: string;
};

type CompareBarsProps = {
  items: CompareBarsItem[];
  className?: string;
};

/**
 * Duas (ou mais) mini-barras horizontais comparando contagens pequenas lado
 * a lado (ex.: buscas "na fila" vs. "rodando") — o visual certo quando não
 * há série no tempo pra sparkline nem uma proporção de um todo pra
 * `ProportionRing`, só uma comparação direta entre poucos números.
 */
export function CompareBars({ items, className }: CompareBarsProps) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="w-11 shrink-0 text-[10px] text-muted-foreground">{item.label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', item.barClassName ?? 'bg-accent-foreground/70')}
              style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-4 shrink-0 text-right text-[10px] font-medium tabular-nums text-foreground">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
