import { Badge } from '@/components/ui/badge';
import type { InstanceHealth } from '@/types/whatsapp';

const LABEL: Record<InstanceHealth, string> = {
  ok: 'Saudável',
  warming: 'Aquecendo',
  degraded: 'Degradada',
  blocked: 'Bloqueada',
};

const VARIANT: Record<InstanceHealth, 'success' | 'warning' | 'destructive'> = {
  ok: 'success',
  warming: 'warning',
  degraded: 'destructive',
  blocked: 'destructive',
};

export function InstanceHealthBadge({ health }: { health: InstanceHealth }) {
  return <Badge variant={VARIANT[health]}>{LABEL[health]}</Badge>;
}
