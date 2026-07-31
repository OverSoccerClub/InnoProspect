import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

/** Banner de erro padrão com ação de tentar de novo — usar em toda falha de chamada de API. */
export function ErrorState({ title = 'Não deu certo', message, onRetry }: ErrorStateProps) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>{message}</span>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} className="w-fit">
            Tentar novamente
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
