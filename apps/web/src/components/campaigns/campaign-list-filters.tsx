'use client';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { CampaignStatus } from '@/types/campaign';

export type CampaignListFilterState = {
  status: CampaignStatus | '';
  q: string;
};

const STATUS_OPTIONS: Array<{ value: CampaignStatus | ''; label: string }> = [
  { value: '', label: 'Todos os status' },
  { value: 'draft', label: 'Rascunho' },
  { value: 'scheduled', label: 'Agendada' },
  { value: 'running', label: 'Em andamento' },
  { value: 'paused', label: 'Pausada' },
  { value: 'halted', label: 'Interrompida automaticamente' },
  { value: 'completed', label: 'Concluída' },
  { value: 'cancelled', label: 'Cancelada' },
];

export function CampaignListFilters({
  value,
  onChange,
}: {
  value: CampaignListFilterState;
  onChange: (value: CampaignListFilterState) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input
        aria-label="Buscar por nome da campanha ou template"
        placeholder="Buscar campanhas…"
        value={value.q}
        onChange={(e) => onChange({ ...value, q: e.target.value })}
        className="sm:max-w-xs"
      />
      <Select
        aria-label="Filtrar por status"
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as CampaignStatus | '' })}
        className="sm:max-w-[220px]"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
