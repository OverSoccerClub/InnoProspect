'use client';

import { useState } from 'react';
import { Loader2, Tag, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { bulkUpdateLeads } from '@/lib/api/leads';
import { ApiRequestError } from '@/lib/fetcher';
import { LEAD_STATUS_LABEL, type LeadStatus } from '@/types/lead';

const ALL_STATUSES = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[];

/**
 * Ação em massa sobre a seleção atual (checkboxes marcados em `LeadTable`).
 * Só existe enquanto `selectedIds.size > 0` — some sozinha depois de aplicar
 * ou ao limpar a seleção, então nunca fica "flutuando" sem função. Dá
 * interface ao `POST /api/v1/leads/bulk` (backend já pronto — ver
 * `lib/services/leads.ts` — sem tela até esta rodada).
 */
export function LeadBulkToolbar({
  selectedIds,
  onCleared,
  onApplied,
}: {
  selectedIds: string[];
  onCleared: () => void;
  onApplied: (summary: { updated: number; skipped: number }) => void;
}) {
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [tag, setTag] = useState('');
  const [isSubmitting, setIsSubmitting] = useState<'status' | 'add_tags' | 'remove_tags' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function applyStatus() {
    if (!status) return;
    setError(null);
    setIsSubmitting('status');
    try {
      const result = await bulkUpdateLeads({ action: 'set_status', leadIds: selectedIds, value: { status } });
      onApplied({ updated: result.summary.updated, skipped: result.summary.skipped });
      setStatus('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Não foi possível atualizar os leads selecionados.');
    } finally {
      setIsSubmitting(null);
    }
  }

  async function applyTag(action: 'add_tags' | 'remove_tags') {
    const trimmed = tag.trim();
    if (!trimmed) return;
    setError(null);
    setIsSubmitting(action);
    try {
      const result = await bulkUpdateLeads({ action, leadIds: selectedIds, value: { tags: [trimmed] } });
      onApplied({ updated: result.summary.updated, skipped: result.summary.skipped });
      setTag('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Não foi possível atualizar os leads selecionados.');
    } finally {
      setIsSubmitting(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {selectedIds.length} {selectedIds.length === 1 ? 'lead selecionado' : 'leads selecionados'}
        </span>

        <div className="flex items-center gap-1.5">
          <Select
            aria-label="Definir status em massa"
            value={status}
            onChange={(e) => setStatus(e.target.value as LeadStatus)}
            className="h-8 w-40 text-xs"
          >
            <option value="">Definir status…</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" disabled={!status || isSubmitting !== null} onClick={applyStatus}>
            {isSubmitting === 'status' && <Loader2 className="animate-spin" aria-hidden="true" />}
            Aplicar
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <Input
            aria-label="Tag para adicionar ou remover"
            placeholder="tag…"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="h-8 w-32 text-xs"
          />
          <Button size="sm" variant="outline" disabled={!tag.trim() || isSubmitting !== null} onClick={() => applyTag('add_tags')}>
            {isSubmitting === 'add_tags' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Tag />}
            Adicionar
          </Button>
          <Button size="sm" variant="ghost" disabled={!tag.trim() || isSubmitting !== null} onClick={() => applyTag('remove_tags')}>
            {isSubmitting === 'remove_tags' && <Loader2 className="animate-spin" aria-hidden="true" />}
            Remover
          </Button>
        </div>

        <Button size="sm" variant="ghost" className="ml-auto" onClick={onCleared}>
          <X />
          Limpar seleção
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
