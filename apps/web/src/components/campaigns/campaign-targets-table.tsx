'use client';

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';

import { CampaignTargetStatusBadge } from '@/components/campaigns/campaign-target-status-badge';
import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCampaignTargets } from '@/hooks/useCampaignTargets';
import { sendCampaignTarget } from '@/lib/api/campaigns';
import { ApiRequestError } from '@/lib/fetcher';
import { formatDateTime, formatPhone } from '@/lib/format';
import type { CampaignTargetStatus } from '@/types/campaign';

const STATUS_OPTIONS: Array<{ value: CampaignTargetStatus | ''; label: string }> = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'Na fila' },
  { value: 'sent', label: 'Enviada' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'read', label: 'Lida' },
  { value: 'responded', label: 'Respondeu' },
  { value: 'failed', label: 'Falhou' },
  { value: 'skipped', label: 'Pulado' },
];

function describeSendError(err: ApiRequestError): string {
  switch (err.reason) {
    case 'QUIET_HOURS':
    case 'OUTSIDE_BUSINESS_WINDOW':
    case 'INSTANCE_NOT_CONNECTED':
    case 'CAMPAIGN_NOT_RUNNING':
    case 'TARGET_NOT_PENDING':
      return err.message;
    default:
      return err.message;
  }
}

type CampaignTargetsTableProps = {
  campaignId: string;
  /** Só mostra o botão "Enviar agora" quando a campanha está de fato em andamento — alvo pendente de um rascunho não pode ser disparado. */
  canDispatch: boolean;
  /** Sobe a cada poll do detalhe da campanha (3s) — dá bump na lista sem o componente saber COMO o pai decide "hora de atualizar". */
  refreshToken: number;
  /** Chamado depois de um envio manual bem-sucedido, para o pai atualizar `campaign.stats` sem esperar o próximo poll de 3s. */
  onTargetSent?: () => void;
};

/**
 * A lista de quem entrou na campanha (requisito 2 do dono: "conferir quem
 * entrou, não só quantos") E, quando `canDispatch`, o botão que EXISTE só
 * porque não há motor automático nesta rodada — "Enviar agora" é o
 * operador apertando o play em um alvo por vez.
 */
export function CampaignTargetsTable({ campaignId, canDispatch, refreshToken, onTargetSent }: CampaignTargetsTableProps) {
  const [status, setStatus] = useState<CampaignTargetStatus | ''>('');
  const { response, isLoading, isLoadingMore, error, loadMore, refetch } = useCampaignTargets(campaignId, status, refreshToken);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});

  const targets = response?.data ?? [];

  async function handleSend(targetId: string) {
    setSendErrors((prev) => ({ ...prev, [targetId]: '' }));
    setSendingId(targetId);
    try {
      await sendCampaignTarget(campaignId, targetId);
      refetch();
      onTargetSent?.();
    } catch (err) {
      setSendErrors((prev) => ({
        ...prev,
        [targetId]: err instanceof ApiRequestError ? describeSendError(err) : 'Não foi possível enviar agora.',
      }));
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Select aria-label="Filtrar por status do alvo" value={status} onChange={(e) => setStatus(e.target.value as CampaignTargetStatus | '')} className="sm:max-w-[220px]">
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && !response && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Quando</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            <LoadingRows rows={5} columns={4} columnClassNames={['', '', 'hidden md:table-cell', '']} />
          </tbody>
        </Table>
      )}

      {!error && response && targets.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {status ? 'Nenhum alvo com este status.' : 'Nenhum alvo nesta campanha.'}
        </p>
      )}

      {!error && targets.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Quando</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((target) => {
                const canSendThis = canDispatch && target.status === 'pending';
                const when = target.sentAt ?? target.scheduledFor;
                return (
                  <TableRow key={target.id}>
                    <TableCell>
                      <p className="font-medium text-foreground">{target.leadName}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">{formatPhone(target.phoneE164)}</p>
                    </TableCell>
                    <TableCell>
                      <CampaignTargetStatusBadge status={target.status} />
                      {target.skipReason && <p className="mt-0.5 text-xs text-muted-foreground">{target.skipReason}</p>}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground md:table-cell">
                      {when ? formatDateTime(when) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {canSendThis && (
                        <div className="flex flex-col items-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleSend(target.id)} disabled={sendingId === target.id}>
                            {sendingId === target.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send />}
                            Enviar agora
                          </Button>
                          {sendErrors[target.id] && <p className="max-w-[220px] text-right text-xs text-destructive">{sendErrors[target.id]}</p>}
                        </div>
                      )}
                      {!canSendThis && target.status === 'pending' && !canDispatch && (
                        <span className="text-xs text-muted-foreground">Inicie a campanha para disparar</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {response?.page.nextCursor && (
            <Button variant="outline" onClick={loadMore} disabled={isLoadingMore} className="w-fit self-center">
              {isLoadingMore && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isLoadingMore ? 'Carregando…' : 'Carregar mais alvos'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
