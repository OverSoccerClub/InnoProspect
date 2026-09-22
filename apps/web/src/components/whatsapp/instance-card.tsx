'use client';

import { useState } from 'react';
import { AlertTriangle, Flame, Gauge, Loader2, Megaphone, MoreVertical, Plug, Trash2, Unplug } from 'lucide-react';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { InstanceHealthBadge } from '@/components/whatsapp/instance-health-badge';
import { InstanceStatusBadge } from '@/components/whatsapp/instance-status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { deleteInstance, disconnectInstance } from '@/lib/api/whatsapp';
import { ApiRequestError } from '@/lib/fetcher';
import { formatDateTime, formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { InstanceListItem } from '@/types/whatsapp';

/**
 * Cor da borda esquerda reflete a saúde — mesma linguagem visual do `Alert`
 * (DESIGN-SYSTEM.md §4): quem varre a grade de instâncias enxerga o risco
 * pela borda antes de ler qualquer badge.
 */
const HEALTH_ACCENT: Record<InstanceListItem['health'], string> = {
  ok: 'border-l-success/70',
  warming: 'border-l-warning',
  degraded: 'border-l-warning',
  blocked: 'border-l-destructive',
};

type InstanceCardProps = {
  instance: InstanceListItem;
  onConnect: (instanceId: string, instanceName: string) => void;
  onChanged: () => void;
};

export function InstanceCard({ instance, onConnect, onChanged }: InstanceCardProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const usageTotal = instance.today.sent + instance.today.remaining;
  const usagePercent = usageTotal > 0 ? Math.round((instance.today.sent / usageTotal) * 100) : 0;

  const canConnect = instance.status === 'disconnected' || instance.status === 'qr_pending' || instance.status === 'banned';
  const canDisconnect = instance.status === 'connected' || instance.status === 'connecting';

  async function handleDisconnect() {
    setActionError(null);
    setIsDisconnecting(true);
    try {
      const result = await disconnectInstance(instance.id);
      if (result.pausedCampaigns.length > 0) {
        setActionError(
          `Instância desconectada. ${result.pausedCampaigns.length} campanha(s) pausada(s) por depender só dela.`,
        );
      }
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : 'Não foi possível desconectar agora.');
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteInstance(instance.id);
      setConfirmDelete(false);
      onChanged();
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : 'Não foi possível excluir a instância.');
    }
  }

  return (
    <Card className={cn('flex h-full flex-col border-l-4', HEALTH_ACCENT[instance.health])}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{instance.name}</CardTitle>
          <p className="text-sm text-muted-foreground tabular-nums">{formatPhone(instance.phoneNumber)}</p>
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          <div className="flex flex-col items-end gap-1.5">
            <InstanceStatusBadge status={instance.status} />
            {/* `ok` é redundante com o status "Conectado" + a borda verde do card — só entra na
                grade quando pede atenção de verdade (regra que evita 2 selos verdes empilhados). */}
            {instance.health !== 'ok' && <InstanceHealthBadge health={instance.health} />}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="shrink-0" aria-label={`Mais ações para ${instance.name}`}>
                <MoreVertical aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setDeleteError(null);
                  setConfirmDelete(true);
                }}
              >
                <Trash2 aria-hidden="true" />
                Excluir instância
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {actionError && (
          <Alert variant="warning">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}

        {instance.lastError && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{instance.lastError}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Flame className="size-3.5" aria-hidden="true" />
              Aquecimento
            </span>
            <p className="font-medium tabular-nums">
              Dia {instance.warmup.day}
              {instance.warmup.isWarm && <span className="text-success"> · aquecida</span>}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Gauge className="size-3.5" aria-hidden="true" />
              Teto diário
            </span>
            <p className="font-medium tabular-nums">{instance.warmup.dailyLimit} msgs</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Megaphone className="size-3.5" aria-hidden="true" />
              Campanhas
            </span>
            <p className="font-medium tabular-nums">{instance.activeCampaigns} ativa(s)</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Uso de hoje</span>
            <span className="tabular-nums">
              <span className="font-medium text-foreground">{instance.today.sent}</span> de {usageTotal}
              {instance.today.failed > 0 && <span className="text-destructive"> · {instance.today.failed} falha(s)</span>}
            </span>
          </div>
          <Progress value={usagePercent} label={`${instance.today.sent} mensagens enviadas hoje`} />
        </div>

        <p className="text-xs text-muted-foreground">
          Conectado desde <span className="tabular-nums">{formatDateTime(instance.lastConnectionAt)}</span>
        </p>

        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {canConnect && (
            <Button size="sm" onClick={() => onConnect(instance.id, instance.name)}>
              <Plug />
              {instance.status === 'qr_pending' ? 'Continuar conexão' : 'Conectar'}
            </Button>
          )}
          {canDisconnect && (
            <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={isDisconnecting}>
              {isDisconnecting ? <Loader2 className="animate-spin" /> : <Unplug />}
              Desconectar
            </Button>
          )}
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Excluir "${instance.name}"?`}
        description="Esta ação não pode ser desfeita. Se houver uma campanha em andamento usando só esta instância, a exclusão será bloqueada."
        confirmLabel="Excluir"
        errorMessage={deleteError}
        onConfirm={handleDelete}
      />
    </Card>
  );
}
