'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircle, Plus, RefreshCw } from 'lucide-react';

import { CardGridSkeleton } from '@/components/common/card-grid-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CreateInstanceDialog } from '@/components/whatsapp/create-instance-dialog';
import { InstanceCard } from '@/components/whatsapp/instance-card';
import { QrCodeDialog } from '@/components/whatsapp/qr-code-dialog';
import { usePolling } from '@/hooks/usePolling';
import { listInstances, reconcileInstances } from '@/lib/api/whatsapp';
import { ApiRequestError } from '@/lib/fetcher';
import type { InstanceListItem } from '@/types/whatsapp';

type WhatsappPageClientProps = {
  /**
   * `POST /whatsapp/instances/reconcile` exige `requireRole: 'admin'` — o
   * botão "Verificar agora" só aparece pra quem tem o papel, mesma cortesia
   * de `configuracoes/usuarios` e `configuracoes/servidores-evolution`
   * (gate de UI, não o gate de verdade: a API recusaria de qualquer forma
   * se alguém chegasse aqui sem ser admin).
   */
  isAdmin: boolean;
};

export function WhatsappPageClient({ isAdmin }: WhatsappPageClientProps) {
  const { data: polledInstances, error, isLoading, refetch } = usePolling<InstanceListItem[]>(listInstances, {
    intervalMs: 15000,
  });

  // Espelha o resultado do polling, mas pode ser sobrescrito diretamente
  // pela resposta de `POST .../reconcile` (`handleReconcileNow` abaixo) —
  // é isso que deixa o botão "Verificar agora" trocar os dados da tela sem
  // esperar o próximo ciclo de 15s do polling.
  const [instances, setInstances] = useState<InstanceListItem[] | null>(null);
  useEffect(() => {
    if (polledInstances) setInstances(polledInstances);
  }, [polledInstances]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<{ id: string; name: string } | null>(null);

  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const handleConnect = useCallback((instanceId: string, instanceName: string) => {
    setQrTarget({ id: instanceId, name: instanceName });
  }, []);

  /**
   * "Verificar agora". Duas coisas podem dar errado, e elas são DIFERENTES:
   *
   *  1. A chamada falhou (403 por papel, 500 nosso) → `catch`. A tela mantém
   *     o último dado conhecido; nada foi confirmado.
   *  2. A chamada devolveu `200` mas a Evolution não respondeu por parte das
   *     instâncias (`unconfirmed > 0`). Esta rota NÃO devolve 502 nesse caso,
   *     de propósito — a reconciliação nunca quebra a leitura. Sem olhar o
   *     `unconfirmed`, com a Evolution inteira fora do ar o operador clicaria
   *     e receberia um sucesso silencioso: os selos continuariam velhos (isso
   *     está certo, `statusCheckedAt` não avança), mas a AÇÃO teria mentido
   *     por omissão. É o único jeito de expressar sucesso PARCIAL — 3 de 4
   *     confirmadas é um resultado real, e nenhum código HTTP diz isso sem
   *     mentir sobre as outras 3.
   *
   * Nos dois casos os dados frescos que vieram (se vieram) são aplicados: as
   * instâncias que a Evolution CONSEGUIU confirmar estão corretas, e jogá-las
   * fora por causa das outras deixaria a tela mais velha do que precisa.
   */
  async function handleReconcileNow() {
    setReconcileError(null);
    setIsReconciling(true);
    try {
      const { instances: fresh, unconfirmed } = await reconcileInstances();
      setInstances(fresh);
      if (unconfirmed > 0) {
        setReconcileError(
          unconfirmed === 1
            ? 'Uma instância não pôde ser confirmada agora (Evolution API indisponível ou sem resposta). O status dela na tela é a última informação conhecida, não uma confirmação.'
            : `${unconfirmed} instâncias não puderam ser confirmadas agora (Evolution API indisponível ou sem resposta). O status delas na tela é a última informação conhecida, não uma confirmação.`,
        );
      }
    } catch (err) {
      // A tela continua mostrando o último dado conhecido (`instances` não
      // muda) — o que falhou foi a CONFIRMAÇÃO, não a leitura. Nunca deixar
      // parecer que a verificação passou.
      setReconcileError(
        err instanceof ApiRequestError
          ? err.message
          : 'Não foi possível confirmar o status agora. O que está na tela ainda é a última informação conhecida.',
      );
    } finally {
      setIsReconciling(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="WhatsApp"
        description="Conecte números, acompanhe aquecimento e saúde da conexão antes de disparar campanhas."
        action={
          <>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={handleReconcileNow} disabled={isReconciling}>
                {isReconciling ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Verificar agora
              </Button>
            )}
            <Button size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus />
              Nova instância
            </Button>
          </>
        }
      />

      {reconcileError && (
        <Alert variant="warning">
          <AlertDescription>{reconcileError}</AlertDescription>
        </Alert>
      )}

      {error && !instances && <ErrorState message={error.message} onRetry={refetch} />}

      {error && instances && (
        <Alert variant="warning">
          <AlertDescription>
            Não foi possível atualizar as instâncias agora ({error.message}). Mostrando os últimos dados
            conhecidos — tentando de novo automaticamente.
          </AlertDescription>
        </Alert>
      )}

      {!error && isLoading && <CardGridSkeleton count={3} />}

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
