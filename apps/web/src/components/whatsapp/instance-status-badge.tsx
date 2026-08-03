import { Ban, Loader2, QrCode, Unplug, Wifi } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { InstanceConnectionStatus } from '@/types/whatsapp';

const LABEL: Record<InstanceConnectionStatus, string> = {
  disconnected: 'Desconectado',
  connecting: 'Conectando…',
  qr_pending: 'Aguardando QR',
  connected: 'Conectado',
  banned: 'Banido',
};

const VARIANT: Record<InstanceConnectionStatus, 'default' | 'secondary' | 'success' | 'destructive' | 'warning'> = {
  disconnected: 'secondary',
  connecting: 'warning',
  qr_pending: 'warning',
  connected: 'success',
  banned: 'destructive',
};

const ICON: Record<InstanceConnectionStatus, typeof Wifi> = {
  disconnected: Unplug,
  connecting: Loader2,
  qr_pending: QrCode,
  connected: Wifi,
  banned: Ban,
};

export function InstanceStatusBadge({ status }: { status: InstanceConnectionStatus }) {
  const Icon = ICON[status];
  return (
    <Badge variant={VARIANT[status]}>
      <Icon aria-hidden="true" className={status === 'connecting' ? 'animate-spin' : undefined} />
      {LABEL[status]}
    </Badge>
  );
}
