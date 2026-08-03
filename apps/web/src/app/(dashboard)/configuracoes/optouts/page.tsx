'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Plus, ShieldOff } from 'lucide-react';

import { AddOptOutDialog } from '@/components/optouts/add-optout-dialog';
import { OPTOUT_TABLE_COLUMNS, OptOutTable } from '@/components/optouts/optout-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { Button } from '@/components/ui/button';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptOuts } from '@/hooks/useOptOuts';

export default function OptOutsPage() {
  const { response, isLoading, isLoadingMore, error, loadMore, refetch } = useOptOuts();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const optouts = response?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/configuracoes"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar para configurações
      </Link>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Opt-outs</h1>
          <p className="text-sm text-muted-foreground">
            Números que pediram para não receber mais mensagens. O bloqueio é checado antes de todo envio, mesmo
            durante uma campanha em andamento.
          </p>
        </div>
        <Button size="sm" onClick={() => setIsAddOpen(true)}>
          <Plus />
          Adicionar manualmente
        </Button>
      </div>

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Telefone</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            <LoadingRows rows={4} columns={OPTOUT_TABLE_COLUMNS} />
          </tbody>
        </Table>
      )}

      {!error && !isLoading && optouts.length === 0 && (
        <EmptyState
          icon={<ShieldOff className="size-8" aria-hidden="true" />}
          title="Nenhum opt-out registrado"
          description="Assim que alguém responder SAIR, usar o link de descadastro ou for adicionado manualmente, aparece aqui."
          action={
            <Button size="sm" onClick={() => setIsAddOpen(true)}>
              <Plus />
              Adicionar manualmente
            </Button>
          }
        />
      )}

      {!error && !isLoading && optouts.length > 0 && (
        <div className="flex flex-col gap-4">
          <OptOutTable optouts={optouts} onDeleted={refetch} />
          {response?.page.nextCursor && (
            <Button variant="outline" onClick={loadMore} disabled={isLoadingMore} className="w-fit self-center">
              {isLoadingMore && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isLoadingMore ? 'Carregando…' : 'Carregar mais'}
            </Button>
          )}
        </div>
      )}

      <AddOptOutDialog open={isAddOpen} onOpenChange={setIsAddOpen} onCreated={refetch} />
    </div>
  );
}
