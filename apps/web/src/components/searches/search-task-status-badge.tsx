import { Badge } from '@/components/ui/badge';
import type { SearchTaskStatus } from '@/types/search';

const CONFIG: Record<SearchTaskStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'destructive' | 'warning' | 'outline' }> = {
  pending: { label: 'Pendente', variant: 'outline' },
  running: { label: 'Coletando', variant: 'default' },
  done: { label: 'Concluída', variant: 'success' },
  failed: { label: 'Falhou', variant: 'destructive' },
  skipped: { label: 'Pulada', variant: 'secondary' },
};

export function SearchTaskStatusBadge({ status }: { status: SearchTaskStatus }) {
  const config = CONFIG[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
