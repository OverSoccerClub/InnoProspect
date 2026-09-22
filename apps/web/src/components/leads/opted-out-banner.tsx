import { ShieldOff } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDateTime } from '@/lib/format';

export function OptedOutBanner({ optedOutAt }: { optedOutAt: string | null }) {
  return (
    <Alert variant="destructive">
      <ShieldOff />
      <AlertTitle>Este número pediu para não receber mais mensagens</AlertTitle>
      <AlertDescription>
        <p>
          {optedOutAt ? `Descadastrado em ${formatDateTime(optedOutAt)}. ` : ''}
          O envio de mensagens para este lead está bloqueado — esse bloqueio é definitivo e vale para
          campanhas e para o envio manual abaixo. Isso protege o número de telefone da sua empresa contra
          denúncias e bloqueio no WhatsApp.
        </p>
      </AlertDescription>
    </Alert>
  );
}
