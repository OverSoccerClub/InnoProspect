'use client';

import { useState } from 'react';
import { Plus, Server as ServerIcon } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EvolutionServerFormDialog } from '@/components/evolution-servers/evolution-server-form-dialog';
import { EvolutionServerTable, EVOLUTION_SERVER_TABLE_COLUMNS } from '@/components/evolution-servers/evolution-server-table';
import { useEvolutionServers } from '@/hooks/useEvolutionServers';
import type { EvolutionServerItem } from '@/types/evolution-server';

/**
 * Client Component da tela `/configuracoes/servidores-evolution`. O gate de
 * acesso real (papel admin) já aconteceu no `page.tsx`, Server Component —
 * mesmo padrão de `UsersPageClient`.
 */
export function EvolutionServersPageClient() {
  const { servers, isLoading, error, refetch } = useEvolutionServers();
  const [formTarget, setFormTarget] = useState<EvolutionServerItem | null | undefined>(undefined);
  const [highlightTestServerId, setHighlightTestServerId] = useState<string | null>(null);

  const hasLoadedOnce = servers !== null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Servidores Evolution"
        description="Toda instância de WhatsApp nasce em um destes servidores. Teste a conexão antes de confiar um número a ele."
        action={
          <Button size="sm" onClick={() => setFormTarget(null)}>
            <Plus />
            Cadastrar servidor
          </Button>
        }
      />

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && !hasLoadedOnce && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Servidor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Instâncias</TableHead>
              <TableHead>Conexão</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            <LoadingRows
              rows={3}
              columns={EVOLUTION_SERVER_TABLE_COLUMNS}
              columnClassNames={['', '', 'hidden md:table-cell', '', '']}
            />
          </tbody>
        </Table>
      )}

      {!error && hasLoadedOnce && servers.length === 0 && (
        <EmptyState
          icon={<ServerIcon className="size-8" aria-hidden="true" />}
          title="Nenhum servidor Evolution cadastrado"
          description="Cadastre o primeiro servidor para poder criar instâncias de WhatsApp — toda instância nova precisa nascer em um servidor."
          action={
            <Button size="sm" onClick={() => setFormTarget(null)}>
              <Plus />
              Cadastrar servidor
            </Button>
          }
        />
      )}

      {!error && hasLoadedOnce && servers.length > 0 && (
        <EvolutionServerTable
          servers={servers}
          highlightTestServerId={highlightTestServerId}
          onEdit={(server) => setFormTarget(server)}
          onChanged={refetch}
        />
      )}

      <EvolutionServerFormDialog
        open={formTarget !== undefined}
        onOpenChange={(open) => !open && setFormTarget(undefined)}
        server={formTarget}
        onSaved={(serverId) => {
          refetch();
          setHighlightTestServerId(serverId);
        }}
      />
    </div>
  );
}
