import { CheckCheck, Circle, Eye, Send, SkipForward, TriangleAlert, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { CampaignTargetStatus } from '@inno/contracts';

/** Ainda sem tela — ver `campaign-status-badge.tsx`. Mapa em DESIGN-SYSTEM.md §5.3. */
const LABEL: Record<CampaignTargetStatus, string> = {
  pending: 'Na fila',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  responded: 'Respondeu',
  failed: 'Falhou',
  skipped: 'Pulado',
};

const VARIANT: Record<CampaignTargetStatus, 'secondary' | 'default' | 'success' | 'warning' | 'destructive'> = {
  pending: 'secondary',
  sent: 'default',
  delivered: 'default',
  read: 'success',
  responded: 'warning',
  failed: 'destructive',
  skipped: 'secondary',
};

const ICON: Record<CampaignTargetStatus, typeof Send> = {
  pending: Circle,
  sent: Send,
  delivered: CheckCheck,
  read: Eye,
  responded: TriangleAlert,
  failed: X,
  skipped: SkipForward,
};

export function CampaignTargetStatusBadge({ status }: { status: CampaignTargetStatus }) {
  const Icon = ICON[status];
  return (
    <Badge variant={VARIANT[status]}>
      <Icon aria-hidden="true" />
      {LABEL[status]}
    </Badge>
  );
}
