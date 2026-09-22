import { CheckCheck, CircleHelp, Clock, Eye, Send, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { MessageStatus } from '@/types/lead';

/**
 * `messageStatusSchema`: queued/sent/delivered/read/failed — mesma lógica de
 * "cor + ícone + texto, nunca só cor" do resto do app (DESIGN-SYSTEM.md §5).
 * Progressão neutro → marca → sucesso, igual ao `CampaignTargetStatusBadge`
 * (§5.3): `read` é o "melhor" estado observável, por isso ganha `success`.
 */
const LABEL: Record<MessageStatus, string> = {
  queued: 'Na fila',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Falhou',
};

const VARIANT: Record<MessageStatus, 'secondary' | 'default' | 'success' | 'destructive'> = {
  queued: 'secondary',
  sent: 'default',
  delivered: 'default',
  read: 'success',
  failed: 'destructive',
};

const ICON: Record<MessageStatus, typeof Send> = {
  queued: Clock,
  sent: Send,
  delivered: CheckCheck,
  read: Eye,
  failed: X,
};

/**
 * `failed` com `EVOLUTION_SEND_UNCERTAIN` NÃO é falha: o WhatsApp não
 * respondeu a tempo e a mensagem pode ter sido entregue. O backend não
 * retenta esse envio de propósito (retry duplicaria a mensagem no WhatsApp do
 * lead). Se a tela mostrasse "Falhou", convidaria o operador a reenviar e
 * produziria exatamente a duplicata que o sistema evitou. Por isso tem
 * rótulo, cor e dica próprios.
 */
const UNCERTAIN_ERROR_CODE = 'EVOLUTION_SEND_UNCERTAIN';

export function MessageStatusBadge({ status, errorCode }: { status: MessageStatus; errorCode?: string | null }) {
  if (status === 'failed' && errorCode === UNCERTAIN_ERROR_CODE) {
    return (
      <Badge variant="warning" title="Pode ter sido entregue. Confira se o lead recebeu antes de reenviar.">
        <CircleHelp aria-hidden="true" />
        Não confirmada
      </Badge>
    );
  }

  const Icon = ICON[status];
  return (
    <Badge variant={VARIANT[status]}>
      <Icon aria-hidden="true" />
      {LABEL[status]}
    </Badge>
  );
}
