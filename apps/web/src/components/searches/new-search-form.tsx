'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { CitySelector } from '@/components/searches/city-selector';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useUfs } from '@/hooks/useUfs';
import { createSearchJob } from '@/lib/api/searches';
import { ApiRequestError } from '@/lib/fetcher';
import type { City } from '@/types/location';

const NICHE_MIN = 3;
const NICHE_MAX = 120;

export function NewSearchForm() {
  const router = useRouter();
  const { ufs, isLoading: isLoadingUfs, error: ufsError } = useUfs();

  const [niche, setNiche] = useState('');
  const [uf, setUf] = useState('');
  const [cities, setCities] = useState<City[]>([]);
  const [name, setName] = useState('');
  const [maxResultsPerCity, setMaxResultsPerCity] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    const trimmedNiche = niche.trim();
    if (trimmedNiche.length < NICHE_MIN || trimmedNiche.length > NICHE_MAX) {
      errors.niche = `O nicho precisa ter entre ${NICHE_MIN} e ${NICHE_MAX} caracteres.`;
    }
    if (!uf) {
      errors.uf = 'Escolha uma UF.';
    }
    if (maxResultsPerCity && (Number(maxResultsPerCity) < 1 || Number(maxResultsPerCity) > 300)) {
      errors.maxResultsPerCity = 'Use um valor entre 1 e 300.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const job = await createSearchJob({
        niche: niche.trim(),
        uf,
        cityIbgeCodes: cities.length > 0 ? cities.map((c) => c.ibgeCode) : undefined,
        maxResultsPerCity: maxResultsPerCity ? Number(maxResultsPerCity) : undefined,
        name: name.trim() || undefined,
      });
      router.push(`/buscas/${job.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'CONFLICT') {
          setFormError('Já existe uma busca em andamento para esse nicho e UF. Aguarde ela terminar ou cancele antes de criar outra.');
        } else if (err.code === 'VALIDATION_ERROR' && err.details) {
          const errors: Record<string, string> = {};
          for (const d of err.details) errors[d.path] = d.message;
          setFieldErrors((prev) => ({ ...prev, ...errors }));
          setFormError(err.message);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('Não foi possível criar a busca agora. Tente novamente.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="niche">Nicho *</Label>
        <Input
          id="niche"
          placeholder="Ex.: clínica odontológica"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          aria-invalid={Boolean(fieldErrors.niche)}
          aria-describedby={fieldErrors.niche ? 'niche-error' : undefined}
        />
        {fieldErrors.niche && (
          <p id="niche-error" className="text-sm text-destructive">
            {fieldErrors.niche}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="uf">UF *</Label>
        {isLoadingUfs ? (
          <Skeleton className="h-9 w-full" />
        ) : ufsError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os estados. Recarregue a página.</p>
        ) : (
          <Select
            id="uf"
            value={uf}
            onChange={(e) => {
              setUf(e.target.value);
              setCities([]);
            }}
            aria-invalid={Boolean(fieldErrors.uf)}
            aria-describedby={fieldErrors.uf ? 'uf-error' : undefined}
          >
            <option value="">Selecione…</option>
            {ufs.map((item) => (
              <option key={item.id} value={item.sigla}>
                {item.nome} ({item.sigla})
              </option>
            ))}
          </Select>
        )}
        {fieldErrors.uf && (
          <p id="uf-error" className="text-sm text-destructive">
            {fieldErrors.uf}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Municípios (opcional)</Label>
        <CitySelector uf={uf} selected={cities} onChange={setCities} />
      </div>

      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Opções avançadas</summary>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="name">Nome da busca</Label>
            <Input
              id="name"
              placeholder={niche && uf ? `${niche} — ${uf}` : 'Rótulo amigável'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="maxResultsPerCity">Máx. de resultados por cidade</Label>
            <Input
              id="maxResultsPerCity"
              type="number"
              min={1}
              max={300}
              placeholder="120"
              value={maxResultsPerCity}
              onChange={(e) => setMaxResultsPerCity(e.target.value)}
              aria-invalid={Boolean(fieldErrors.maxResultsPerCity)}
            />
            {fieldErrors.maxResultsPerCity && (
              <p className="text-sm text-destructive">{fieldErrors.maxResultsPerCity}</p>
            )}
          </div>
        </div>
      </details>

      <Button type="submit" disabled={isSubmitting} className="w-fit">
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
        {isSubmitting ? 'Criando busca…' : 'Iniciar busca'}
      </Button>
    </form>
  );
}
