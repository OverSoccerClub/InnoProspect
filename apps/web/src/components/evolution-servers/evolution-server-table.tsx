'use client';

import { useState } from 'react';
import { Loader2, MoreHorizontal, Pencil, RotateCcw, ShieldOff } from 'lucide-react';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TestConnectionControl } from '@/components/evolution-servers/test-connection-control';
import { deactivateEvolutionServer, reactivateEvolutionServer } from '@/lib/api/evolution-servers';
import { ApiRequestError } from '@/lib/fetcher';
import type { EvolutionServerItem } from '@/types/evolution-server';

export const EVOLUTION_SERVER_TABLE_COLUMNS = 5;

type EvolutionServerTableProps = {
  servers: EvolutionServerItem[];
  /** Id do servidor que acabou de ser cadastrado/editado — realça o botão "Testar conexão" daquela linha. */
  highlightTestServerId: string | null;
  onEdit: (server: EvolutionServerItem) => void;
  onChanged: () => void;
};

export function EvolutionServerTable({ servers, highlightTestServerId, onEdit, onChanged }: EvolutionServerTableProps) {
  const [pendingDeactivate, setPendingDeactivate] = useState<EvolutionServerItem | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function handleDeactivate() {
    if (!pendingDeactivate) return;
    setDeactivateError(null);
    try {
      await deactivateEvolutionServer(pendingDeactivate.id);
      setPendingDeactivate(null);
      onChanged();
    } catch (err) {
      // A mensagem do servidor (mock ou real) já traz QUANTAS instâncias
      // bloqueiam e o que fazer a seguir (409 SERVER_IN_USE) — exibir como
      // veio, nunca reescrever.
      setDeactivateError(err instanceof ApiRequestError ? err.message : 'Não foi possível desativar este servidor.');
    }
  }

  async function handleReactivate(server: EvolutionServerItem) {
    setReactivateError(null);
    setReactivatingId(server.id);
    try {
      await reactivateEvolutionServer(server.id);
      onChanged();
    } catch (err) {
      setReactivateError(err instanceof ApiRequestError ? err.message : `Não foi possível reativar ${server.name}.`);
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
            <TableHead>Servidor</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Instâncias</TableHead>
            <TableHead>Conexão</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {servers.map((server) => {
            const isReactivating = reactivatingId === server.id;
            return (
              <TableRow key={server.id}>
                <TableCell>
                  <p className="font-medium text-foreground">{server.name}</p>
                  <p className="max-w-[240px] truncate text-xs text-muted-foreground" title={server.baseUrl}>
                    {server.baseUrl}
                  </p>
                </TableCell>
                <TableCell>
                  {server.isActive ? <Badge variant="success">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {server.instancesCount} {server.instancesCount === 1 ? 'instância' : 'instâncias'}
                </TableCell>
                <TableCell>
                  <TestConnectionControl
                    serverId={server.id}
                    serverName={server.name}
                    highlighted={highlightTestServerId === server.id}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Ações para ${server.name}`}>
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(server)}>
                        <Pencil aria-hidden="true" />
                        Editar
                      </DropdownMenuItem>
                      {server.isActive ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            setDeactivateError(null);
                            setPendingDeactivate(server);
                          }}
                        >
                          <ShieldOff aria-hidden="true" />
                          Desativar
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled={isReactivating} onSelect={() => handleReactivate(server)}>
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
          <p>
            Servidores desativados continuam cadastrados (histórico preservado) e podem ser reativados depois — não é
            uma exclusão. Se houver instância de WhatsApp ativa apontando para ele, a desativação é bloqueada até
            você mover ou desativar essas instâncias primeiro.
          </p>
        }
        confirmLabel="Desativar"
        errorMessage={deactivateError}
        onConfirm={handleDeactivate}
      />
    </>
  );
}
