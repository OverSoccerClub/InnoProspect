import { cn } from '@/lib/utils';

type ProportionRingProps = {
  /** 0-100 */
  percent: number;
  className?: string;
  trackClassName?: string;
  valueClassName?: string;
};

/**
 * Anel de proporção em SVG puro (mesma justificativa de não usar lib de
 * gráfico do `Sparkline`/`LeadsAreaChart`, DESIGN-SYSTEM.md §9.4) — usado
 * onde uma métrica é uma PORCENTAGEM de um todo (ex.: % de leads com
 * celular), caso em que uma tendência ao longo do tempo (sparkline) não é o
 * visual certo: o que importa aqui é "quanto do todo", não "como variou
 * dia a dia".
 */
export function ProportionRing({ percent, className, trackClassName = 'text-muted', valueClassName = 'text-success' }: ProportionRingProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const size = 28;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0', className)}
      role="img"
      aria-label={`${clamped.toFixed(0)}% do total`}
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className={cn('stroke-current opacity-25', trackClassName)} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={cn('stroke-current', valueClassName)}
      />
    </svg>
  );
}
