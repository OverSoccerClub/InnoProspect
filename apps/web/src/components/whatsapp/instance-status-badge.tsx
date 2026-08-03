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

export function InstanceStatusBadge({ status }: { status: InstanceConnectionStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
