'use client';

import { useState } from 'react';
import { Loader2, Plus, Search, Users as UsersIcon } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { USER_TABLE_COLUMNS, UserTable } from '@/components/users/user-table';
import { UserFormDialog } from '@/components/users/user-form-dialog';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useUsers } from '@/hooks/useUsers';
import type { UserItem } from '@/types/user';

/**
 * Client Component da tela `/configuracoes/usuarios`. O gate de acesso real
 * (papel admin) já aconteceu no `page.tsx`, Server Component — aqui só
 * recebe o `currentUserId` da sessão, para as proteções de autoexclusão/
 * autorrebaixamento em `lib/user-access.ts` funcionarem em qualquer modo
 * (mock ou real).
 */
export function UsersPageClient({ currentUserId }: { currentUserId: string }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const { response, isLoading, isLoadingMore, error, listComplete, loadMore, refetch } = useUsers({
    q: debouncedSearch || undefined,
  });
  const [formTarget, setFormTarget] = useState<UserItem | null | undefined>(undefined);

  const users = response?.data ?? [];
  const hasLoadedOnce = response !== null;
  // `listComplete` do hook só garante "sem próxima PÁGINA" — com uma busca
  // ativa, a lista visível é um SUBCONJUNTO filtrado, nunca o total de
  // usuários (podem existir admins ativos fora do filtro). Sem esta guarda,
  // buscar por um único admin faria `canDeactivate`/`canChangeRole`
  // acharem, errado, que ele é o último admin do sistema.
  const guardListComplete = listComplete && !debouncedSearch;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuários"
        description="Quem tem acesso ao sistema e o que cada papel pode fazer. Desativar não exclui — os dados da pessoa continuam intactos."
        action={
          <Button size="sm" onClick={() => setFormTarget(null)}>
            <Plus />
            Adicionar usuário
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou e-mail"
          aria-label="Buscar usuário por nome ou e-mail"
          className="pl-9"
        />
      </div>

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && !hasLoadedOnce && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Criado em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            <LoadingRows rows={5} columns={USER_TABLE_COLUMNS} columnClassNames={['', '', '', 'hidden md:table-cell', '']} />
          </tbody>
        </Table>
      )}

      {!error && hasLoadedOnce && users.length === 0 && (
        <EmptyState
          icon={<UsersIcon className="size-8" aria-hidden="true" />}
          title={debouncedSearch ? 'Nenhum usuário encontrado' : 'Nenhum usuário cadastrado ainda'}
          description={
            debouncedSearch
              ? `Ninguém bateu com "${debouncedSearch}". Confira o nome ou o e-mail.`
              : 'Adicione a primeira conta para alguém entrar no sistema.'
          }
          action={
            !debouncedSearch && (
              <Button size="sm" onClick={() => setFormTarget(null)}>
                <Plus />
                Adicionar usuário
              </Button>
            )
          }
        />
      )}

      {!error && hasLoadedOnce && users.length > 0 && (
        <div className={cnLoading(isLoading)} aria-busy={isLoading}>
          <UserTable
            users={users}
            currentUserId={currentUserId}
            guardContext={{ loadedUsers: users, listComplete: guardListComplete }}
            onEdit={(user) => setFormTarget(user)}
            onChanged={refetch}
          />
          {response?.page.nextCursor && (
            <Button variant="outline" onClick={loadMore} disabled={isLoadingMore} className="mt-4 w-fit self-center">
              {isLoadingMore && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isLoadingMore ? 'Carregando…' : 'Carregar mais'}
            </Button>
          )}
        </div>
      )}

      <UserFormDialog
        open={formTarget !== undefined}
        onOpenChange={(open) => !open && setFormTarget(undefined)}
        user={formTarget}
        currentUserId={currentUserId}
        guardContext={{ loadedUsers: users, listComplete: guardListComplete }}
        onSaved={refetch}
      />
    </div>
  );
}

// Mesmo padrão de "manter a última lista visível, esmaecida, enquanto uma
// nova busca/página carrega" documentado em `convention-numbered-pagination`
// — sem isso, cada tecla na busca apagava a tabela inteira por um instante.
function cnLoading(isLoading: boolean): string {
  return isLoading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity';
}
