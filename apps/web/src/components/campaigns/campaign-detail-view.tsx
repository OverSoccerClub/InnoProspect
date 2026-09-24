'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CircleAlert } from 'lucide-react';

import { CampaignActions } from '@/components/campaigns/campaign-actions';
import { CampaignAudienceSummaryCard } from '@/components/campaigns/campaign-audience-summary';
import { CampaignProgressBar } from '@/components/campaigns/campaign-progress-bar';
import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import { CampaignTargetsTable } from '@/components/campaigns/campaign-targets-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/common/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCampaign } from '@/hooks/useCampaign';
import { readAndClearCampaignCreationSummary } from '@/lib/campaign-creation-cache';
import { formatDateTime } from '@/lib/format';
import { ApiRequestError } from '@/lib/fetcher';
import { cn } from '@/lib/utils';
import type { CreateCampaignResponse } from '@/types/campaign';

export function CampaignDetailView({ id }: { id: string }) {
  const { data: campaign, error, isLoading, isPolling, refetch } = useCampaign(id);
  const [creationSummary, setCreationSummary] = useState<CreateCampaignResponse | null>(null);
  const [refreshBump, setRefreshBump] = useState(0);

  useEffect(() => {
    setCreationSummary(readAndClearCampaignCreationSummary(id));
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !campaign) {
    const notFound = error instanceof ApiRequestError && error.code === 'NOT_FOUND';
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorState title={notFound ? 'Campanha não encontrada' : 'Não foi possível carregar a campanha'} message={error.message} onRetry={refetch} />
      </div>
    );
  }

  if (!campaign) return null;

  const canDispatch = campaign.status === 'running';
  const isEditable = campaign.status === 'draft' || campaign.status === 'scheduled';

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {campaign.templateName} · {campaign.instanceCount} instância(s) · criada em {formatDateTime(campaign.createdAt)}
          </p>
        </div>
        <CampaignActions
          campaign={campaign}
          onChanged={() => {
            refetch();
            setRefreshBump((n) => n + 1);
          }}
        />
      </div>

      {error && campaign && (
        <Alert variant="warning">
          <AlertDescription>
            Não foi possível atualizar o progresso agora ({error.message}). Mostrando os últimos dados conhecidos — tentando de novo automaticamente.
          </AlertDescription>
        </Alert>
      )}

      {campaign.status === 'halted' && campaign.haltReason && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Parada automática de segurança</AlertTitle>
          <AlertDescription>{campaign.haltReason} Use &quot;Revisar e retomar&quot; depois de investigar.</AlertDescription>
        </Alert>
      )}

      {!isEditable && (
        <Alert variant="warning" className="py-3">
          <AlertDescription>
            {campaign.status === 'running'
              ? 'Campanha em execução — nome, template, instâncias e público não podem ser editados agora. Pause primeiro se precisar mudar algo.'
              : 'Esta campanha não pode ser editada neste estado.'}
          </AlertDescription>
        </Alert>
      )}

      {campaign.status === 'running' && campaign.stats.pending > 0 && (
        <Alert>
          <AlertDescription>
            Não existe disparo automático nesta versão: os {campaign.stats.pending} alvo(s) na fila só saem quando você clicar em &quot;Enviar
            agora&quot; em cada um, na lista abaixo.
          </AlertDescription>
        </Alert>
      )}

      {creationSummary && (
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Resumo da criação</p>
          <CampaignAudienceSummaryCard summary={creationSummary.audience} isPreview={false} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progresso</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <CampaignProgressBar stats={campaign.stats} className="flex-1" />
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              {campaign.stats.delivered}/{campaign.stats.total} entregues
              {campaign.stats.failed > 0 && <span className="text-destructive"> · {campaign.stats.failed} falha(s)</span>}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Na fila" value={campaign.stats.pending} />
            <Stat label="Enviadas" value={campaign.stats.sent} />
            <Stat label="Respondidas" value={campaign.stats.responded} tone={campaign.stats.responded > 0 ? 'success' : undefined} />
            <Stat label="Falharam" value={campaign.stats.failed} tone={campaign.stats.failed > 0 ? 'destructive' : undefined} />
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground sm:grid-cols-4">
            <p>
              Entrega: <span className="font-medium tabular-nums text-foreground">{Math.round(campaign.rates.deliveryRate * 100)}%</span>
            </p>
            <p>
              Resposta: <span className="font-medium tabular-nums text-foreground">{Math.round(campaign.rates.responseRate * 100)}%</span>
            </p>
            <p>Status: {isPolling ? 'atualizando…' : 'parado'}</p>
            {campaign.nextSendAt && <p>Próximo envio: {formatDateTime(campaign.nextSendAt)}</p>}
          </div>
        </CardContent>
      </Card>

      {campaign.perInstance.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por instância</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {campaign.perInstance.map((instance) => (
              <div key={instance.instanceId} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{instance.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {instance.sent} enviada(s) · {instance.failed} falha(s) · {instance.quotaRemaining} de cota restante hoje
                  </p>
                </div>
                <Badge variant={instance.status === 'connected' ? 'success' : 'secondary'} className="shrink-0">
                  {instance.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-base font-semibold">Alvos ({campaign.stats.total})</h2>
        <CampaignTargetsTable
          campaignId={campaign.id}
          canDispatch={canDispatch}
          refreshToken={refreshBump}
          onTargetSent={() => {
            refetch();
            setRefreshBump((n) => n + 1);
          }}
        />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/campanhas"
      className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Voltar para campanhas
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'destructive' }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-semibold tabular-nums', tone === 'destructive' && 'text-destructive', tone === 'success' && 'text-success')}>
        {value}
      </p>
    </div>
  );
}
