'use client';

import Link from 'next/link';
import { Loader2, MessageSquareText, Plus } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { PageHeader } from '@/components/common/page-header';
import { TEMPLATE_TABLE_COLUMNS, TemplateTable } from '@/components/templates/template-table';
import { Button } from '@/components/ui/button';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTemplates } from '@/hooks/useTemplates';

export default function TemplatesPage() {
  const { response, isLoading, isLoadingMore, error, loadMore, refetch } = useTemplates();
  const templates = response?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Templates"
        description="Mensagens reutilizáveis com variáveis e variação de texto (spintax) contra bloqueio."
        action={
          <Button asChild size="sm">
            <Link href="/templates/novo">
              <Plus />
              Novo template
            </Link>
          </Button>
        }
      />

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="hidden lg:table-cell">Variáveis</TableHead>
              <TableHead>Variação</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Usos</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            <LoadingRows
              rows={4}
              columns={TEMPLATE_TABLE_COLUMNS}
              columnClassNames={['', 'hidden lg:table-cell', '', '', 'hidden md:table-cell', '']}
            />
          </tbody>
        </Table>
      )}

      {!error && !isLoading && templates.length === 0 && (
        <EmptyState
          icon={<MessageSquareText className="size-8" aria-hidden="true" />}
          title="Nenhum template ainda"
          description="Crie sua primeira mensagem com variáveis e variação de texto para começar a disparar campanhas."
          action={
            <Button asChild size="sm">
              <Link href="/templates/novo">
                <Plus />
                Criar template
              </Link>
            </Button>
          }
        />
      )}

      {!error && !isLoading && templates.length > 0 && (
        <div className="flex flex-col gap-4">
          <TemplateTable templates={templates} onDeleted={refetch} />
          {response?.page.nextCursor && (
            <Button variant="outline" onClick={loadMore} disabled={isLoadingMore} className="w-fit self-center">
              {isLoadingMore && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isLoadingMore ? 'Carregando…' : 'Carregar mais templates'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
