import { AlertOctagon, Flame, ShieldCheck, TrendingDown } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { InstanceHealth } from '@/types/whatsapp';

const LABEL: Record<InstanceHealth, string> = {
  ok: 'Saudável',
  warming: 'Aquecendo',
  degraded: 'Degradada',
  blocked: 'Bloqueada',
};

/**
 * `degraded` !== `blocked` — corrigido aqui (DESIGN-SYSTEM.md §5.2): a versão
 * anterior mapeava os dois pra `destructive`, ficando visualmente idênticos.
 * `degraded` ainda está operando (precisa de atenção, não é crítico
 * sozinho); `blocked` parou de fato (ação imediata). `warming` e `degraded`
 * dividem a cor `warning` de propósito (mesmo grupo "precisa de atenção") —
 * o ícone e o texto são o que os diferencia, nunca só a cor.
 */
const VARIANT: Record<InstanceHealth, 'success' | 'warning' | 'destructive'> = {
  ok: 'success',
  warming: 'warning',
  degraded: 'warning',
  blocked: 'destructive',
};

const ICON: Record<InstanceHealth, typeof ShieldCheck> = {
  ok: ShieldCheck,
  warming: Flame,
  degraded: TrendingDown,
  blocked: AlertOctagon,
};

export function InstanceHealthBadge({ health }: { health: InstanceHealth }) {
  const Icon = ICON[health];
  return (
    <Badge variant={VARIANT[health]}>
      <Icon aria-hidden="true" />
      {LABEL[health]}
    </Badge>
  );
}
