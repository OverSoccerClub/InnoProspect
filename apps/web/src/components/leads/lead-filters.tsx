'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Globe, MessageCircle, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useSearchJobs } from '@/hooks/useSearchJobs';
import { useUfs } from '@/hooks/useUfs';
import {
  countAdvancedLeadFilters,
  describeActiveLeadFilters,
  EMPTY_LEADS_FILTER,
  hasAnyLeadFilter,
  removeLeadFilterChip,
  type LeadsFilterState,
} from '@/lib/lead-filter-state';
import { listCities } from '@/lib/api/locations';
import { cn } from '@/lib/utils';
import { LEAD_STATUS_LABEL, PHONE_TYPE_LABEL, type LeadStatus } from '@/types/lead';
import type { City } from '@/types/location';

export { EMPTY_LEADS_FILTER, type LeadsFilterState } from '@/lib/lead-filter-state';

const ALL_STATUSES = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[];

/**
 * Dois atalhos prontos, pensados para o que o dono vende (site/tráfego/
 * automação via WhatsApp) — não são um 3º sistema de filtro, só um jeito
 * mais rápido de chegar numa combinação que já existe no painel "Mais
 * filtros". Cada botão fica "pressionado" quando o filtro atual já bate com
 * ele, mesmo que o operador tenha chegado lá pelo painel avançado.
 */
const SHORTCUTS: Array<{
  key: string;
  label: string;
  icon: typeof Globe;
  isActive: (value: LeadsFilterState) => boolean;
  apply: (value: LeadsFilterState) => LeadsFilterState;
  clear: (value: LeadsFilterState) => LeadsFilterState;
}> = [
  {
    key: 'no-website',
    label: 'Sem site',
    icon: Globe,
    isActive: (v) => v.hasWebsite === 'false',
    apply: (v) => ({ ...v, hasWebsite: 'false' }),
    clear: (v) => ({ ...v, hasWebsite: '' }),
  },
  {
    key: 'ready-for-whatsapp',
    label: 'Pronto para WhatsApp',
    icon: MessageCircle,
    isActive: (v) => v.hasPhone === 'true' && v.phoneType === 'mobile',
    apply: (v) => ({ ...v, hasPhone: 'true', phoneType: 'mobile' }),
    clear: (v) => ({ ...v, hasPhone: '', phoneType: '' }),
  },
];

function FilterPill({
  isSelected,
  onClick,
  children,
}: {
  isSelected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isSelected
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

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

  const hasActiveFilters = hasAnyLeadFilter(value);
  const advancedCount = countAdvancedLeadFilters(value);
  const activeChips = describeActiveLeadFilters(value, {
    statusLabel: (status) => LEAD_STATUS_LABEL[status],
    cityLabel: cities.find((c) => c.ibgeCode === value.cityIbgeCode)?.nome,
    searchJobLabel: searchJobs.find((job) => job.id === value.searchJobId)?.name,
    phoneTypeLabel: (type) => PHONE_TYPE_LABEL[type],
  });

  return (
    <div className="flex flex-col gap-3">
      {/* `sm:flex-wrap`: mesmo com poucos controles na barra principal, o
          shrink de flex item sem `min-width:0` não é garantia contra
          overflow — quebra em 2 linhas antes de estourar a página. */}
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

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_LEADS_FILTER)}>
            Limpar tudo
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Atalhos:</span>
        {SHORTCUTS.map(({ key, label, icon: Icon, isActive, apply, clear }) => {
          const active = isActive(value);
          return (
            <FilterPill key={key} isSelected={active} onClick={() => onChange(active ? clear(value) : apply(value))}>
              <Icon className="size-3" aria-hidden="true" />
              {label}
            </FilterPill>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por status">
        {ALL_STATUSES.map((status) => (
          <FilterPill key={status} isSelected={value.status.includes(status)} onClick={() => toggleStatus(status)}>
            {LEAD_STATUS_LABEL[status]}
          </FilterPill>
        ))}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
          <span className="text-xs font-medium text-muted-foreground">Filtros ativos:</span>
          {activeChips.map((chip) => (
            <Badge key={chip.key} variant="secondary" className="gap-1 pr-1">
              {chip.label}
              <button
                type="button"
                onClick={() => onChange(removeLeadFilterChip(value, chip.key))}
                aria-label={`Remover filtro: ${chip.label}`}
                className="rounded-full p-0.5 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Painel de filtros avançados — os 7 campos que `leadFilterSchema` já
          aceitava e a tela nunca expunha (pedido do dono, 2026-09-23), mais
          origem/nicho (já existiam, movidos pra cá pra a barra principal não
          crescer pra 11 controles de uma vez). `<details>` nativo: mesmo
          padrão já usado em `new-search-form.tsx` ("Opções avançadas") —
          acessível de fábrica (teclado/Espaço/Enter), sem popover novo que
          precisaria lidar com z-index/overlap. */}
      <details className="group rounded-md border border-border p-3 open:pb-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          Mais filtros
          {advancedCount > 0 && (
            <Badge variant="secondary" aria-label={`${advancedCount} filtro(s) avançado(s) ativo(s)`}>
              {advancedCount}
            </Badge>
          )}
        </summary>

        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-filter-website">Site</Label>
            <Select
              id="lead-filter-website"
              value={value.hasWebsite}
              onChange={(e) => onChange({ ...value, hasWebsite: e.target.value as LeadsFilterState['hasWebsite'] })}
            >
              <option value="">Todos</option>
              <option value="false">Sem site</option>
              <option value="true">Com site</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-filter-phone">Telefone</Label>
            <Select
              id="lead-filter-phone"
              value={value.hasPhone}
              onChange={(e) => {
                const hasPhone = e.target.value as LeadsFilterState['hasPhone'];
                // Filtrar "sem telefone" e ainda exigir um tipo de telefone
                // não faz sentido — limpa o tipo pra não deixar um filtro
                // contraditório escondido.
                onChange({ ...value, hasPhone, phoneType: hasPhone === 'false' ? '' : value.phoneType });
              }}
            >
              <option value="">Todos</option>
              <option value="true">Tem telefone</option>
              <option value="false">Sem telefone</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-filter-phone-type">Tipo de telefone</Label>
            <Select
              id="lead-filter-phone-type"
              value={value.phoneType}
              onChange={(e) => onChange({ ...value, phoneType: e.target.value as LeadsFilterState['phoneType'] })}
              disabled={value.hasPhone === 'false'}
            >
              <option value="">Todos</option>
              <option value="mobile">{PHONE_TYPE_LABEL.mobile}</option>
              <option value="landline">{PHONE_TYPE_LABEL.landline}</option>
              <option value="unknown">{PHONE_TYPE_LABEL.unknown}</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-filter-rating">Avaliação mínima</Label>
            <Select
              id="lead-filter-rating"
              value={value.minRating}
              onChange={(e) => onChange({ ...value, minRating: e.target.value as LeadsFilterState['minRating'] })}
            >
              <option value="">Qualquer avaliação</option>
              <option value="3">3 estrelas ou mais</option>
              <option value="4">4 estrelas ou mais</option>
              <option value="4.5">4,5 estrelas ou mais</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-filter-category">Categoria</Label>
            <Input
              id="lead-filter-category"
              placeholder="Ex.: restaurante, pizzaria"
              value={value.category}
              onChange={(e) => onChange({ ...value, category: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-filter-tags">Tags</Label>
            <Input
              id="lead-filter-tags"
              placeholder="Ex.: prioridade, retorno"
              value={value.tags}
              onChange={(e) => onChange({ ...value, tags: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-filter-search-job">Busca de origem</Label>
            <Select
              id="lead-filter-search-job"
              value={value.searchJobId}
              onChange={(e) => onChange({ ...value, searchJobId: e.target.value })}
              disabled={isLoadingSearchJobs && searchJobs.length === 0}
            >
              <option value="">Todas as buscas</option>
              {searchJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-filter-off-niche">Aderência ao nicho</Label>
            <Select
              id="lead-filter-off-niche"
              aria-describedby="lead-filter-off-niche-hint"
              value={value.offNiche}
              onChange={(e) => onChange({ ...value, offNiche: e.target.value as LeadsFilterState['offNiche'] })}
            >
              <option value="">Todos os leads</option>
              <option value="false">Só aderentes ao nicho</option>
              <option value="true">Só fora do nicho</option>
            </Select>
            <span id="lead-filter-off-niche-hint" className="text-xs text-muted-foreground">
              Compara a categoria do lead com o nicho da busca de origem.
            </span>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="lead-filter-created-from">Criados entre</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="lead-filter-created-from"
                type="date"
                aria-label="Criados a partir de"
                value={value.createdFrom}
                max={value.createdTo || undefined}
                onChange={(e) => onChange({ ...value, createdFrom: e.target.value })}
                className="w-auto"
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="date"
                aria-label="Criados até"
                value={value.createdTo}
                min={value.createdFrom || undefined}
                onChange={(e) => onChange({ ...value, createdTo: e.target.value })}
                className="w-auto"
              />
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
