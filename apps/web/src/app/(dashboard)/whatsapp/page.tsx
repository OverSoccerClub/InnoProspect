'use client';

import { useCallback, useState } from 'react';
import { MessageCircle, Plus } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { CreateInstanceDialog } from '@/components/whatsapp/create-instance-dialog';
import { InstanceCard } from '@/components/whatsapp/instance-card';
import { QrCodeDialog } from '@/components/whatsapp/qr-code-dialog';
import { usePolling } from '@/hooks/usePolling';
import { listInstances } from '@/lib/api/whatsapp';
import type { InstanceListItem } from '@/types/whatsapp';

export default function WhatsappPage() {
  const { data: instances, error, isLoading, refetch } = usePolling<InstanceListItem[]>(listInstances, {
    intervalMs: 15000,
  });

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<{ id: string; name: string } | null>(null);

  const handleConnect = useCallback((instanceId: string, instanceName: string) => {
    setQrTarget({ id: instanceId, name: instanceName });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Conecte números, acompanhe aquecimento e saúde da conexão antes de disparar campanhas.
          </p>
        </div>
        <Button size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus />
          Nova instância
        </Button>
      </div>

      {error && !instances && <ErrorState message={error.message} onRetry={refetch} />}

      {error && instances && (
        <Alert variant="warning">
          <AlertDescription>
            Não foi possível atualizar as instâncias agora ({error.message}). Mostrando os últimos dados
            conhecidos — tentando de novo automaticamente.
          </AlertDescription>
        </Alert>
      )}

      {!error && isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex flex-col gap-3 p-6">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && instances && instances.length === 0 && (
        <EmptyState
          icon={<MessageCircle className="size-8" aria-hidden="true" />}
          title="Nenhuma instância conectada"
          description="Crie uma instância e conecte um número de WhatsApp para começar a disparar campanhas."
          action={
            <Button size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus />
              Nova instância
            </Button>
          }
        />
      )}

      {instances && instances.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {instances.map((instance) => (
            <InstanceCard key={instance.id} instance={instance} onConnect={handleConnect} onChanged={refetch} />
          ))}
        </div>
      )}

      <CreateInstanceDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreated={(instanceId, instanceName) => {
          refetch();
          setQrTarget({ id: instanceId, name: instanceName });
        }}
      />

      {qrTarget && (
        <QrCodeDialog
          instanceId={qrTarget.id}
          instanceName={qrTarget.name}
          open={qrTarget !== null}
          onOpenChange={(open) => !open && setQrTarget(null)}
          onConnected={refetch}
        />
      )}
    </div>
  );
}
