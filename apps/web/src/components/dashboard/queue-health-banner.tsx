'use client';

import { useState } from 'react';
import { AlertOctagon, CheckCircle2, RefreshCcw, ShieldQuestion } from 'lucide-react';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useQueueStatus } from '@/hooks/useQueueStatus';
import { resumeQueue } from '@/lib/api/scraper';
import { ApiRequestError } from '@/lib/fetcher';
import { formatRelative } from '@/lib/format';
import type { ScraperQueueStatusResponse } from '@/types/scraper-queue';

type QueueHealthBannerProps = {
  /**
   * Estado fixo, pulando o fetch/polling interno — usado só por
   * `FirstAccessChecklist`, que já resolveu um cenário coerente de conta
   * nova (fila rodando) via `useFirstAccessSystemContext` e não pode deixar
   * este componente buscar o estado global do mock (que começa pausado com
   * incidente, ver `mocks/dashboard.ts`).
   */
  status?: ScraperQueueStatusResponse;
};

/**
 * Banner de saúde da fila `scrape-search` — hoje o único jeito de descobrir
 * que a coleta parou é abrir `/health` manualmente (lacuna real, não
 * cosmética). Consome `GET /api/v1/scraper/queue` (poll a cada 20s) e expõe
 * `POST /api/v1/scraper/queue/resume` atrás de uma confirmação explícita: a
 * pausa é uma decisão de segurança automática do worker (taxa de erro/zero
 * resultado alta), e só um humano que investigou pode dizer que é seguro
 * seguir — texto do botão de confirmação deixa isso claro de propósito.
 */
export function QueueHealthBanner({ status: statusOverride }: QueueHealthBannerProps = {}) {
  const polling = useQueueStatus(!statusOverride);
  const status = statusOverride ?? polling.data;
  const isLoading = statusOverride ? false : polling.isLoading;
  const error = statusOverride ? null : polling.error;
  const refetch = polling.refetch;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  async function handleResume() {
    setResumeError(null);
    try {
      await resumeQueue();
      setConfirmOpen(false);
      refetch();
    } catch (err) {
      setResumeError(
        err instanceof ApiRequestError ? err.message : 'Não foi possível retomar a fila agora. Tente novamente.',
      );
    }
  }

  if (isLoading) {
    return <Skeleton className="h-16 w-full rounded-lg" />;
  }

  if (error || !status) {
    return (
      <Alert variant="warning">
        <ShieldQuestion aria-hidden="true" />
        <AlertTitle>Não foi possível checar a saúde da fila de coleta</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{error?.message ?? 'Tente novamente em instantes.'}</span>
          <Button size="sm" variant="outline" className="w-fit" onClick={refetch}>
            Tentar novamente
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (status.status === 'running') {
    return (
      <Alert variant="success" className="py-3">
        <CheckCircle2 aria-hidden="true" />
        <AlertTitle className="mb-0">Fila de coleta operando normalmente</AlertTitle>
      </Alert>
    );
  }

  if (status.status === 'unknown') {
    return (
      <Alert variant="warning">
        <ShieldQuestion aria-hidden="true" />
        <AlertTitle>Não foi possível determinar o estado da fila</AlertTitle>
        <AlertDescription>
          O Redis que sustenta a fila de coleta não respondeu. Isso não confirma que ela parou, só que não dá
          para saber daqui. Se persistir, avise quem cuida da infraestrutura.
        </AlertDescription>
      </Alert>
    );
  }

  // status.status === 'paused'
  const isCritical = status.severity === 'critical';
  const incidentCount = status.openIncidents.length;

  return (
    <>
      <Alert variant={isCritical ? 'destructive' : 'warning'}>
        <AlertOctagon aria-hidden="true" />
        <AlertTitle>Fila de coleta pausada automaticamente</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{status.reason ?? 'Um incidente de segurança pausou a coleta. Revise antes de retomar.'}</span>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {status.pausedAt && <span>Pausada {formatRelative(status.pausedAt)}</span>}
            {incidentCount > 0 && (
              <Badge variant={isCritical ? 'destructive' : 'warning'}>
                {incidentCount} {incidentCount === 1 ? 'incidente aberto' : 'incidentes abertos'}
              </Badge>
            )}
          </div>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => setConfirmOpen(true)}>
            <RefreshCcw aria-hidden="true" />
            Revisar e retomar
          </Button>
        </AlertDescription>
      </Alert>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setResumeError(null);
        }}
        title="Retomar a fila de coleta"
        description="A pausa foi uma medida de segurança automática, não um bug de tela. Retomar sem entender a causa (ex.: taxa alta de resultados vazios, possível bloqueio do Google Maps) tende a reproduzir o mesmo incidente minutos depois. Confirme só se você já investigou e sabe por que é seguro seguir."
        confirmLabel="Já investiguei, retomar a fila"
        confirmVariant="default"
        errorMessage={resumeError}
        onConfirm={handleResume}
      />
    </>
  );
}
