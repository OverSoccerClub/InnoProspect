'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

type AreaChartProps = {
  data: { date: string; count: number }[];
  className?: string;
};

function formatShortDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * Gráfico de área em SVG puro — sem Recharts/D3. Decisão registrada em
 * DESIGN-SYSTEM.md §9.4: para uma única série de 30 pontos, uma lib de
 * gráfico pesaria no bundle e precisaria de auditoria de CSP (a CSP do
 * projeto não libera `unsafe-eval`, e algumas libs de gráfico geram/avaliam
 * função em runtime) sem ganhar nada que um `<path>` não resolva sozinho.
 * Se o painel ganhar séries múltiplas/zoom/pan no futuro, reconsiderar.
 */
export function LeadsAreaChart({ data, className }: AreaChartProps) {
  const gradientId = useId();
  const w = 600;
  const h = 200;
  const padY = 12;
  const max = Math.max(...data.map((d) => d.count), 1);

  const points = data.map((d, index) => {
    const x = (index / (data.length - 1)) * w;
    const y = padY + (1 - d.count / max) * (h - padY * 2);
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;

  const first = data[0];
  const last = data[data.length - 1];

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-48 w-full overflow-visible" role="img" aria-label={`Leads coletados por dia, últimos ${data.length} dias — de ${first?.count ?? 0} em ${first ? formatShortDate(first.date) : ''} para ${last?.count ?? 0} em ${last ? formatShortDate(last.date) : ''}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" className="text-primary" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-primary" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary" />
        {points.map((p) => (
          <circle key={p.date} cx={p.x} cy={p.y} r="6" fill="transparent" className="cursor-default text-primary hover:fill-current hover:opacity-20">
            <title>
              {formatShortDate(p.date)}: {p.count} {p.count === 1 ? 'lead' : 'leads'}
            </title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{first ? formatShortDate(first.date) : ''}</span>
        <span>{last ? formatShortDate(last.date) : ''}</span>
      </div>
    </div>
  );
}
