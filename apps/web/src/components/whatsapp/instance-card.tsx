'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, Plug, Trash2, Unplug } from 'lucide-react';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { InstanceHealthBadge } from '@/components/whatsapp/instance-health-badge';
import { InstanceStatusBadge } from '@/components/whatsapp/instance-status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { deleteInstance, disconnectInstance } from '@/lib/api/whatsapp';
import { ApiRequestError } from '@/lib/fetcher';
import { formatDateTime, formatPhone } from '@/lib/format';
import type { InstanceListItem } from '@/types/whatsapp';

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
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">{instance.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{formatPhone(instance.phoneNumber)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <InstanceStatusBadge status={instance.status} />
          <InstanceHealthBadge health={instance.health} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Aquecimento</p>
            <p className="font-medium">
              Dia {instance.warmup.day} {instance.warmup.isWarm && '· aquecida'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Teto diário</p>
            <p className="font-medium">{instance.warmup.dailyLimit} msgs/dia</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Campanhas ativas</p>
            <p className="font-medium">{instance.activeCampaigns}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Conectado desde</p>
            <p className="font-medium">{formatDateTime(instance.lastConnectionAt)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Uso de hoje</span>
            <span>
              {instance.today.sent} de {usageTotal} ({instance.today.failed} falha(s))
            </span>
          </div>
          <Progress value={usagePercent} label={`${instance.today.sent} mensagens enviadas hoje`} />
        </div>

        <div className="flex flex-wrap gap-2">
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
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
          >
            <Trash2 />
            Excluir
          </Button>
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
