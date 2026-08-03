'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Trash2 } from 'lucide-react';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { TemplateStatusBadge } from '@/components/templates/template-status-badge';
import { TemplateVariationBadge } from '@/components/templates/template-variation-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { deleteTemplate } from '@/lib/api/templates';
import { ApiRequestError } from '@/lib/fetcher';
import type { TemplateItem } from '@/types/template';

export function TemplateTable({ templates, onDeleted }: { templates: TemplateItem[]; onDeleted: () => void }) {
  const [pendingDelete, setPendingDelete] = useState<TemplateItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteTemplate(pendingDelete.id);
      setPendingDelete(null);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : 'Não foi possível excluir o template.');
    }
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Variáveis</TableHead>
            <TableHead>Variação</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Usos</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((template) => (
            <TableRow key={template.id}>
              <TableCell>
                <Link
                  href={`/templates/${template.id}`}
                  className="font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {template.name}
                </Link>
                <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">{template.body}</p>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {template.variablesUsed.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    template.variablesUsed.map((v) => (
                      <Badge key={v} variant="outline">
                        {`{{${v}}}`}
                      </Badge>
                    ))
                  )}
                </div>
              </TableCell>
              <TableCell>
                <TemplateVariationBadge count={template.spintaxVariations} />
              </TableCell>
              <TableCell>
                <TemplateStatusBadge isActive={template.isActive} />
              </TableCell>
              <TableCell>{template.usageCount}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label={`Editar ${template.name}`}>
                    <Link href={`/templates/${template.id}`}>
                      <Pencil />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${template.name}`}
                    onClick={() => {
                      setDeleteError(null);
                      setPendingDelete(template);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Excluir "${pendingDelete?.name ?? ''}"?`}
        description="Esta ação não pode ser desfeita. Se o template estiver em uso por uma campanha ativa, ele será mantido (você pode desativá-lo em vez de excluir)."
        confirmLabel="Excluir"
        errorMessage={deleteError}
        onConfirm={handleDelete}
      />
    </>
  );
}

export const TEMPLATE_TABLE_COLUMNS = 6;
