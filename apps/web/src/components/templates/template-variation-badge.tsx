import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { variationRisk } from '@/lib/spintax';

const VARIANT = {
  low: 'destructive',
  medium: 'warning',
  good: 'success',
} as const;

/** Badge de contagem de variações, colorido pelo risco anti-ban (ARQUITETURA.md §6.4). */
export function TemplateVariationBadge({
  count,
  className,
  title,
}: {
  count: number;
  className?: string;
  /** Tooltip acessível (ex.: um exemplo renderizado) — nunca a única forma de ver a informação, só um atalho. */
  title?: string;
}) {
  const risk = variationRisk(count);
  return (
    <Badge variant={VARIANT[risk]} className={className} title={title}>
      {risk !== 'good' && <AlertTriangle aria-hidden="true" />}
      {count} {count === 1 ? 'variação' : 'variações'}
    </Badge>
  );
}
