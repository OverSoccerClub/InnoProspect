'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, Pause, Play } from 'lucide-react';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { ErrorState } from '@/components/common/error-state';
import { EngineStatusBadge } from '@/components/dispatch/engine-status-badge';
import { WorkerHeartbeat } from '@/components/dispatch/worker-heartbeat';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDispatchQueueStatus } from '@/hooks/useDispatchQueueStatus';
import { useNow } from '@/hooks/useNow';
import { pauseDispatchQueue, resumeDispatchQueue } from '@/lib/api/dispatch';
import { getDispatchHeartbeatLevel } from '@/lib/dispatch-heartbeat';
import { ApiRequestError } from '@/lib/fetcher';
import { formatRelative } from '@/lib/format';

type DispatchEngineCardProps = {
  /**
   * Gate de UI (cortesia) — mesmo padrão de `WhatsappPageClient`/
   * `EvolutionServersPageClient`: quem não é admin ainda VÊ este card (o
   * `GET` é liberado pra qualquer operador autenticado, ARQUITETURA §6.8.9 —
   * "saber se o motor está ligado" não é informação sensível), mas os
   * botões de pausar/retomar somem. O gate de verdade é `requireRole: 'admin'`
   * nas duas rotas `POST` (`lib/services/dispatch.ts`).
   */
  isAdmin: boolean;
};

/**
 * O "botão único do incidente" (ARQUITETURA §6.8.9): pausar o motor de
 * disparo tem que ser um clique, sem cerimônia — por isso NÃO passa por
 * `ConfirmDialog`. Retomar é o oposto (volta a mandar mensagem pra gente
 * real) e por isso SEMPRE passa por confirmação explícita. De propósito só
 * um botão de ação aparece por vez (o da ação que faz sentido no estado
 * atual) — dois botões simétricos lado a lado sugeririam que pausar e
 * retomar pesam igual, e não pesam.
 */
export function DispatchEngineCard({ isAdmin }: DispatchEngineCardProps) {
  const { data: status, error, isLoading, refetch } = useDispatchQueueStatus();
  const now = useNow();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  async function handlePause() {
    setPauseError(null);
    setIsPausing(true);
    try {
      await pauseDispatchQueue();
      refetch();
    } catch (err) {
      setPauseError(
        err instanceof ApiRequestError ? err.message : 'Não foi possível pausar o motor agora. Tente novamente.',
      );
    } finally {
      setIsPausing(false);
    }
  }

  async function handleResume() {
    setResumeError(null);
    try {
      await resumeDispatchQueue();
      setConfirmOpen(false);
      refetch();
    } catch (err) {
      setResumeError(
        err instanceof ApiRequestError ? err.message : 'Não foi possível retomar o motor agora. Tente novamente.',
      );
    }
  }

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }

  if (error || !status) {
    return (
      <ErrorState
        title="Não foi possível checar o motor de disparo"
        message={error?.message ?? 'Tente novamente em instantes.'}
        onRetry={refetch}
      />
    );
  }

  const heartbeatLevel = getDispatchHeartbeatLevel(status.lastTickAt, now);
  // A combinação perigosa: alguém ligou o motor, mas o worker que de fato
  // dispara mensagens não dá sinal. O flag diz "rodando"; na prática nada
  // está saindo — e isso merece um destaque que "worker sem sinal" sozinho
  // (ver `WorkerHeartbeat`) não carrega no mesmo peso.
  const runningWithDeadWorker = status.status === 'running' && heartbeatLevel !== 'alive';

  return (
    <Card variant="elevated">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <EngineStatusBadge status={status.status} />
          <WorkerHeartbeat lastTickAt={status.lastTickAt} now={now} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {runningWithDeadWorker && (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>O motor está marcado como ligado, mas o worker não responde</AlertTitle>
            <AlertDescription>
              Nada está sendo disparado enquanto o worker estiver assim, mesmo com o freio liberado. Se isso
              persistir, é um problema de infraestrutura (worker caído), não da tela.
            </AlertDescription>
          </Alert>
        )}

        {status.status === 'running' && status.enabledBy && (
          <p className="text-sm text-muted-foreground">
            Retomado por <span className="font-medium text-foreground">{status.enabledBy}</span>
            {status.enabledAt && <> · {formatRelative(status.enabledAt)}</>}
          </p>
        )}

        {status.status === 'paused' && (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Sem disparo automático enquanto estiver pausado. Nenhuma mensagem de campanha sai daqui até alguém
              retomar.
            </p>
            {/*
              Autoria da pausa. A ausência dela é um caso NORMAL, não um dado
              faltando: o motor nasce pausado, e aí não houve ninguém a
              registrar. Por isso a linha simplesmente não aparece, em vez de
              exibir "pausado por —" ou "desconhecido", que faria um estado
              esperado parecer defeito.
            */}
            {status.pausedBy && (
              <p>
                Pausado por <span className="font-medium text-foreground">{status.pausedBy}</span>
                {status.pausedAt && <> · {formatRelative(status.pausedAt)}</>}
              </p>
            )}
            {status.pausedReason && <p className="italic">“{status.pausedReason}”</p>}
          </div>
        )}

        {isAdmin ? (
          <div className="flex flex-col gap-2">
            {status.status === 'running' ? (
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={handlePause}
                disabled={isPausing}
              >
                {isPausing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Pause aria-hidden="true" />}
                Pausar agora
              </Button>
            ) : (
              <Button size="sm" className="w-fit" onClick={() => setConfirmOpen(true)}>
                <Play aria-hidden="true" />
                Retomar o motor
              </Button>
            )}
            {pauseError && <p className="text-sm text-destructive">{pauseError}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Só administradores podem pausar ou retomar o motor.</p>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setResumeError(null);
        }}
        title="Retomar o motor de disparo"
        description="Isto volta a mandar mensagens de campanha para pessoas reais, para todo mundo, agora. Confirme só se você já sabe por que ele estava pausado e é seguro seguir."
        confirmLabel="Sim, retomar o motor"
        confirmVariant="default"
        errorMessage={resumeError}
        onConfirm={handleResume}
      />
    </Card>
  );
}
