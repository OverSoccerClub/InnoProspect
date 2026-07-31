'use client';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useUfs } from '@/hooks/useUfs';
import type { SearchJobStatus } from '@/types/search';

export type SearchJobsFilterState = {
  status: SearchJobStatus | '';
  uf: string;
  q: string;
};

const STATUS_OPTIONS: Array<{ value: SearchJobStatus | ''; label: string }> = [
  { value: '', label: 'Todos os status' },
  { value: 'queued', label: 'Na fila' },
  { value: 'running', label: 'Em andamento' },
  { value: 'paused', label: 'Pausada' },
  { value: 'completed', label: 'Concluída' },
  { value: 'failed', label: 'Falhou' },
  { value: 'cancelled', label: 'Cancelada' },
];

export function SearchJobsFilters({
  value,
  onChange,
}: {
  value: SearchJobsFilterState;
  onChange: (value: SearchJobsFilterState) => void;
}) {
  const { ufs } = useUfs();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input
        aria-label="Buscar por nicho ou nome"
        placeholder="Buscar por nicho…"
        value={value.q}
        onChange={(e) => onChange({ ...value, q: e.target.value })}
        className="sm:max-w-xs"
      />
      <Select
        aria-label="Filtrar por status"
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as SearchJobStatus | '' })}
        className="sm:max-w-[180px]"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filtrar por UF"
        value={value.uf}
        onChange={(e) => onChange({ ...value, uf: e.target.value })}
        className="sm:max-w-[160px]"
      >
        <option value="">Todas as UFs</option>
        {ufs.map((uf) => (
          <option key={uf.id} value={uf.sigla}>
            {uf.sigla}
          </option>
        ))}
      </Select>
    </div>
  );
}
