'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { deleteOptOut } from '@/lib/api/optouts';
import { ApiRequestError } from '@/lib/fetcher';
import { formatDateTime, formatPhone } from '@/lib/format';
import type { OptOutItem, OptOutSource } from '@/types/optout';

export const OPTOUT_TABLE_COLUMNS = 5;

const SOURCE_LABEL: Record<OptOutSource, string> = {
  reply: 'Respondeu "SAIR"',
  manual: 'Manual',
  public_link: 'Link de descadastro',
  request: 'Solicitação',
};

export function OptOutTable({ optouts, onDeleted }: { optouts: OptOutItem[]; onDeleted: () => void }) {
  const [pendingDelete, setPendingDelete] = useState<OptOutItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteOptOut(pendingDelete.id);
      setPendingDelete(null);
      onDeleted();
    } catch (err) {
      // DELETE exige role=admin no backend (§4.7) — o 403 chega com mensagem pronta pra exibir.
      setDeleteError(err instanceof ApiRequestError ? err.message : 'Não foi possível remover o opt-out.');
    }
  }

  return (
    <>
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
        <TableBody>
          {optouts.map((optout) => (
            <TableRow key={optout.id}>
              <TableCell className="font-medium">{formatPhone(optout.phoneE164)}</TableCell>
              <TableCell>{optout.leadName ?? '—'}</TableCell>
              <TableCell>
                <Badge variant="outline">{SOURCE_LABEL[optout.source]}</Badge>
                {optout.reason && <p className="mt-0.5 text-xs text-muted-foreground">{optout.reason}</p>}
              </TableCell>
              <TableCell>{formatDateTime(optout.createdAt)}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover opt-out de ${formatPhone(optout.phoneE164)}`}
                  onClick={() => {
                    setDeleteError(null);
                    setPendingDelete(optout);
                  }}
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Remover opt-out de ${pendingDelete ? formatPhone(pendingDelete.phoneE164) : ''}?`}
        description="Esse número volta a poder receber mensagens. Só administradores podem fazer isso, e a ação fica registrada na auditoria do lead."
        confirmLabel="Remover"
        errorMessage={deleteError}
        onConfirm={handleDelete}
      />
    </>
  );
}
