import { cn } from '@/lib/utils';

type SparklineProps = {
  data: number[];
  className?: string;
  strokeClassName?: string;
};

/**
 * Sparkline em SVG puro (sem lib de gráfico — ver DESIGN-SYSTEM.md §9.4 pra
 * justificativa). Estático de propósito (sem stroke-dasharray animado): a
 * entrada escalonada do card já dá o efeito de "aparecer", e uma animação de
 * desenho por cima teria que reverter pro estado final quando
 * `prefers-reduced-motion` está ligado — mais uma condição pra acertar sem
 * ganho visual real num gráfico deste tamanho.
 */
export function Sparkline({ data, className, strokeClassName = 'text-primary' }: SparklineProps) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * w;
    const y = h - ((value - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn('h-7 w-full', className)}
      role="img"
      aria-label={`Tendência: de ${data[0]} para ${data[data.length - 1]}`}
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('stroke-current', strokeClassName)}
      />
    </svg>
  );
}
