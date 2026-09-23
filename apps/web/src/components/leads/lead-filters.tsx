'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useSearchJobs } from '@/hooks/useSearchJobs';
import { useUfs } from '@/hooks/useUfs';
import { listCities } from '@/lib/api/locations';
import { cn } from '@/lib/utils';
import { LEAD_STATUS_LABEL, type LeadStatus } from '@/types/lead';
import type { City } from '@/types/location';

export type LeadsFilterState = {
  q: string;
  status: LeadStatus[];
  uf: string;
  cityIbgeCode: string;
  /** id de `SearchJobSummary` (vazio = todas as buscas). */
  searchJobId: string;
  /** `''` = todos, `'true'` = só fora do nicho, `'false'` = só aderentes — `<select>` nativo só fala string. */
  offNiche: '' | 'true' | 'false';
};

export const EMPTY_LEADS_FILTER: LeadsFilterState = {
  q: '',
  status: [],
  uf: '',
  cityIbgeCode: '',
  searchJobId: '',
  offNiche: '',
};

const ALL_STATUSES = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[];

export function LeadFilters({
  value,
  onChange,
}: {
  value: LeadsFilterState;
  onChange: (value: LeadsFilterState) => void;
}) {
  const { ufs } = useUfs();
  const [cities, setCities] = useState<City[]>([]);
  // Todas as buscas (não paginado aqui — se um dia passar de ~100 buscas,
  // isto precisa virar um combobox com busca; ver PENDÊNCIAS do handoff).
  const { jobs: searchJobs, isLoading: isLoadingSearchJobs } = useSearchJobs({ limit: 100 });

  useEffect(() => {
    if (!value.uf) {
      setCities([]);
      return;
    }
    let cancelled = false;
    listCities(value.uf).then((data) => {
      if (!cancelled) setCities(data);
    });
    return () => {
      cancelled = true;
    };
  }, [value.uf]);

  function toggleStatus(status: LeadStatus) {
    const isSelected = value.status.includes(status);
    onChange({
      ...value,
      status: isSelected ? value.status.filter((s) => s !== status) : [...value.status, status],
    });
  }

  const hasActiveFilters = Boolean(
    value.q || value.status.length > 0 || value.uf || value.cityIbgeCode || value.searchJobId || value.offNiche,
  );

  return (
    <div className="flex flex-col gap-3">
      {/* `sm:flex-wrap`: com 6 controles (busca + 4 selects + botão), uma única
          linha sem wrap ultrapassaria a largura da tela em telas médias —
          shrink de flex item sem `min-width:0` não é garantia contra overflow
          (mesma causa raiz do bug de tabela já registrado na memória). Quebra
          em 2 linhas antes de estourar, em vez de rolar a página inteira. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          aria-label="Buscar por nome, telefone ou endereço"
          placeholder="Buscar leads…"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          className="sm:max-w-xs"
        />
        <Select
          aria-label="Filtrar por UF"
          value={value.uf}
          onChange={(e) => onChange({ ...value, uf: e.target.value, cityIbgeCode: '' })}
          className="sm:max-w-[160px]"
        >
          <option value="">Todas as UFs</option>
          {ufs.map((uf) => (
            <option key={uf.id} value={uf.sigla}>
              {uf.sigla}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filtrar por cidade"
          value={value.cityIbgeCode}
          onChange={(e) => onChange({ ...value, cityIbgeCode: e.target.value })}
          disabled={!value.uf}
          className="sm:max-w-[200px]"
        >
          <option value="">{value.uf ? 'Todas as cidades' : 'Escolha uma UF primeiro'}</option>
          {cities.map((city) => (
            <option key={city.ibgeCode} value={city.ibgeCode}>
              {city.nome}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filtrar por busca de origem"
          value={value.searchJobId}
          onChange={(e) => onChange({ ...value, searchJobId: e.target.value })}
          disabled={isLoadingSearchJobs && searchJobs.length === 0}
          className="sm:max-w-[220px]"
        >
          <option value="">Todas as buscas</option>
          {searchJobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filtrar por aderência ao nicho buscado"
          value={value.offNiche}
          onChange={(e) => onChange({ ...value, offNiche: e.target.value as LeadsFilterState['offNiche'] })}
          className="sm:max-w-[190px]"
        >
          <option value="">Nicho: todos os leads</option>
          <option value="false">Só aderentes ao nicho</option>
          <option value="true">Só fora do nicho</option>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_LEADS_FILTER)}>
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por status">
        {ALL_STATUSES.map((status) => {
          const isSelected = value.status.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggleStatus(status)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isSelected
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              {LEAD_STATUS_LABEL[status]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
