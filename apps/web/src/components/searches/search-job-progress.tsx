'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CircleAlert, Loader2, RotateCcw, XCircle } from 'lucide-react';

import { SearchJobStatusBadge } from '@/components/searches/search-job-status-badge';
import { SearchTaskList } from '@/components/searches/search-task-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/common/error-state';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearchJob } from '@/hooks/useSearchJob';
import { cancelSearchJob, retryFailedTasks } from '@/lib/api/searches';
import { ApiRequestError } from '@/lib/fetcher';
import { formatDateTime } from '@/lib/format';

export function SearchJobProgress({ id }: { id: string }) {
  const { data: job, error, isLoading, isPolling, refetch } = useSearchJob(id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  async function handleCancel() {
    setActionError(null);
    setIsCancelling(true);
    try {
      await cancelSearchJob(id);
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : 'Não foi possível cancelar a busca.');
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleRetryFailed() {
    setActionError(null);
    setIsRetrying(true);
    try {
      await retryFailedTasks(id);
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : 'Não foi possível reenfileirar as tarefas falhas.');
    } finally {
      setIsRetrying(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !job) {
    const notFound = error instanceof ApiRequestError && error.code === 'NOT_FOUND';
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorState
          title={notFound ? 'Busca não encontrada' : 'Não foi possível carregar a busca'}
          message={error.message}
          onRetry={refetch}
        />
      </div>
    );
  }

  if (!job) return null;

  const failedTasks = job.tasks.filter((t) => t.status === 'failed');
  const canCancel = job.status === 'queued' || job.status === 'running';
  const canRetryFailed = failedTasks.length > 0 && (job.status === 'failed' || job.status === 'completed');

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{job.name}</h1>
            <SearchJobStatusBadge status={job.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {job.niche} · {job.uf} · criada em {formatDateTime(job.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          {canRetryFailed && (
            <Button variant="outline" size="sm" onClick={handleRetryFailed} disabled={isRetrying}>
              {isRetrying ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              Repetir municípios com falha
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive" size="sm" onClick={handleCancel} disabled={isCancelling}>
              {isCancelling ? <Loader2 className="animate-spin" /> : <XCircle />}
              Cancelar busca
            </Button>
          )}
        </div>
      </div>

      {actionError && <ErrorState message={actionError} />}

      {job.status === 'failed' && job.error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>A busca falhou</AlertTitle>
          <AlertDescription>{job.error}</AlertDescription>
        </Alert>
      )}
      {job.status === 'cancelled' && (
        <Alert variant="warning">
          <CircleAlert />
          <AlertTitle>Busca cancelada</AlertTitle>
          <AlertDescription>
            {job.progress.done} de {job.progress.total} municípios chegaram a ser processados antes do cancelamento.
          </AlertDescription>
        </Alert>
      )}
      {error && job && (
        <Alert variant="warning">
          <AlertDescription>
            Não foi possível atualizar o progresso agora ({error.message}). Mostrando os últimos dados
            conhecidos — tentando de novo automaticamente.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progresso</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Progress
              value={job.progress.percent}
              label={`${job.progress.done} de ${job.progress.total} municípios concluídos`}
              className="flex-1"
            />
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              {job.progress.done}/{job.progress.total} municípios
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Leads encontrados" value={job.leadsFound} />
            <Stat label="Leads novos" value={job.leadsNew} />
            <Stat label="Municípios com falha" value={job.progress.failed} />
            <Stat label="Status" value={isPolling ? 'atualizando…' : 'parado'} isText />
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-base font-semibold">Municípios ({job.tasks.length})</h2>
        <SearchTaskList tasks={job.tasks} />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/buscas"
      className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Voltar para buscas
    </Link>
  );
}

function Stat({ label, value, isText }: { label: string; value: number | string; isText?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={isText ? 'text-sm font-medium' : 'text-lg font-semibold'}>{value}</p>
    </div>
  );
}
