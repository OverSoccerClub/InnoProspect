'use client';

import { useState } from 'react';
import { Loader2, MoreHorizontal, Pencil, RotateCcw, ShieldOff } from 'lucide-react';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RoleBadge } from '@/components/users/role-meta';
import { deactivateUser, reactivateUser } from '@/lib/api/users';
import { ApiRequestError } from '@/lib/fetcher';
import { formatDateTime } from '@/lib/format';
import { canDeactivate, type AdminGuardContext } from '@/lib/user-access';
import type { UserItem } from '@/types/user';

export const USER_TABLE_COLUMNS = 5;

type UserTableProps = {
  users: UserItem[];
  currentUserId: string;
  guardContext: Omit<AdminGuardContext, 'currentUserId'>;
  onEdit: (user: UserItem) => void;
  onChanged: () => void;
};

export function UserTable({ users, currentUserId, guardContext, onEdit, onChanged }: UserTableProps) {
  const [pendingDeactivate, setPendingDeactivate] = useState<UserItem | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function handleDeactivate() {
    if (!pendingDeactivate) return;
    setDeactivateError(null);
    try {
      await deactivateUser(pendingDeactivate.id, currentUserId);
      setPendingDeactivate(null);
      onChanged();
    } catch (err) {
      setDeactivateError(err instanceof ApiRequestError ? err.message : 'Não foi possível desativar este usuário.');
    }
  }

  async function handleReactivate(user: UserItem) {
    setReactivateError(null);
    setReactivatingId(user.id);
    try {
      await reactivateUser(user.id, currentUserId);
      onChanged();
    } catch (err) {
      setReactivateError(err instanceof ApiRequestError ? err.message : `Não foi possível reativar ${user.name}.`);
    } finally {
      setReactivatingId(null);
    }
  }

  return (
    <>
      {reactivateError && <p className="text-sm text-destructive">{reactivateError}</p>}
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
        <TableBody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            const deactivateGuard = canDeactivate(user, { ...guardContext, currentUserId });
            const isReactivating = reactivatingId === user.id;

            return (
              <TableRow key={user.id}>
                <TableCell>
                  <p className="font-medium text-foreground">
                    {user.name} {isSelf && <span className="text-xs text-muted-foreground">(você)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </TableCell>
                <TableCell>
                  <RoleBadge role={user.role} />
                </TableCell>
                <TableCell>
                  {user.isActive ? (
                    <Badge variant="success">Ativo</Badge>
                  ) : (
                    <Badge variant="outline" title="Desativado — não consegue mais entrar, mas os dados dele continuam intactos.">
                      Inativo
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                  {formatDateTime(user.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Ações para ${user.name}`}>
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(user)}>
                        <Pencil aria-hidden="true" />
                        Editar
                      </DropdownMenuItem>
                      {user.isActive ? (
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={deactivateGuard.disabled}
                          title={deactivateGuard.disabled ? deactivateGuard.reason : undefined}
                          onSelect={() => {
                            setDeactivateError(null);
                            setPendingDeactivate(user);
                          }}
                        >
                          <ShieldOff aria-hidden="true" />
                          Desativar
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled={isReactivating} onSelect={() => handleReactivate(user)}>
                          {isReactivating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                          Reativar
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={pendingDeactivate !== null}
        onOpenChange={(open) => !open && setPendingDeactivate(null)}
        title={`Desativar ${pendingDeactivate?.name}?`}
        description={
          <>
            <p>
              A conta para de conseguir entrar, mas os dados que {pendingDeactivate?.name} criou (buscas, templates,
              campanhas) continuam intactos — desativar não é excluir, e dá para reativar depois.
            </p>
            <p className="mt-2">
              Se {pendingDeactivate?.name} já estiver com uma sessão aberta, o acesso continua valendo até ela expirar
              ou a pessoa entrar de novo.
            </p>
          </>
        }
        confirmLabel="Desativar"
        errorMessage={deactivateError}
        onConfirm={handleDeactivate}
      />
    </>
  );
}
