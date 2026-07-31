'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { listCities } from '@/lib/api/locations';
import type { City } from '@/types/location';

type CitySelectorProps = {
  uf: string;
  selected: City[];
  onChange: (cities: City[]) => void;
};

/**
 * Seleção de cidades dentro da UF escolhida. Opcional: vazio = todos os
 * municípios da UF (ARQUITETURA.md §4.2, `cityIbgeCodes`). Usa checkboxes
 * nativos com busca por nome em vez de um combobox — melhor pra listas
 * longas (até ~600 municípios em SP) e mais simples de navegar por teclado.
 */
export function CitySelector({ uf, selected, onChange }: CitySelectorProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [cities, setCities] = useState<City[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uf) {
      setCities([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    listCities(uf, debouncedQuery || undefined)
      .then((data) => {
        if (!cancelled) setCities(data);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar os municípios. Tente novamente.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uf, debouncedQuery]);

  const selectedCodes = new Set(selected.map((c) => c.ibgeCode));

  function toggleCity(city: City, checked: boolean) {
    if (checked) {
      onChange([...selected, city]);
    } else {
      onChange(selected.filter((c) => c.ibgeCode !== city.ibgeCode));
    }
  }

  if (!uf) {
    return <p className="text-sm text-muted-foreground">Escolha uma UF para listar os municípios.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="city-search">Buscar município (opcional)</Label>
        <Input
          id="city-search"
          placeholder="Ex.: Campinas"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Deixe sem selecionar nenhum município para buscar em todos os municípios de{' '}
          {uf}.
        </p>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{selected.length} selecionado(s):</span>
          {selected.map((city) => (
            <Badge key={city.ibgeCode} variant="secondary" className="gap-1 pr-1">
              {city.nome}
              <button
                type="button"
                onClick={() => toggleCity(city, false)}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remover ${city.nome}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])} className="h-6 px-2 text-xs">
            Limpar
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="max-h-56 overflow-y-auto rounded-md border border-border p-2">
        {isLoading && (
          <div className="flex flex-col gap-2 p-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-2/3" />
            ))}
          </div>
        )}
        {!isLoading && !error && cities.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">Nenhum município encontrado para essa busca.</p>
        )}
        {!isLoading &&
          cities.map((city) => {
            const checkboxId = `city-${city.ibgeCode}`;
            return (
              <div key={city.ibgeCode} className="flex items-center gap-2 rounded px-1 py-1.5 hover:bg-accent">
                <Checkbox
                  id={checkboxId}
                  checked={selectedCodes.has(city.ibgeCode)}
                  onChange={(e) => toggleCity(city, e.target.checked)}
                />
                <Label htmlFor={checkboxId} className="flex-1 cursor-pointer font-normal">
                  {city.nome}
                </Label>
              </div>
            );
          })}
      </div>
    </div>
  );
}
