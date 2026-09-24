'use client';

import { ChevronRight } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { CampaignSettingsInput } from '@/types/campaign';

/** Estado do formulário — todos os campos SEMPRE presentes (o `?` do contrato é resolvido aqui com defaults visíveis, não escondidos no backend). */
export type CampaignSettingsFormState = {
  dailyLimitPerInstance: string; // vazio = deixa o backend decidir pela cota de aquecimento de cada instância.
  startHour: number;
  endHour: number;
  daysOfWeek: number[];
  jitterMin: number;
  jitterMax: number;
  skipRecentlyContactedDays: number;
};

/** Mesmo default de negócio de `lib/send-window.ts` (janela comercial seg–sex, 9h–18h) e do contrato (`jitterSecondsSchema.min >= 30`). */
export const DEFAULT_CAMPAIGN_SETTINGS_FORM: CampaignSettingsFormState = {
  dailyLimitPerInstance: '',
  startHour: 9,
  endHour: 18,
  daysOfWeek: [1, 2, 3, 4, 5],
  jitterMin: 30,
  jitterMax: 90,
  skipRecentlyContactedDays: 30,
};

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function toCampaignSettingsInput(form: CampaignSettingsFormState): CampaignSettingsInput {
  return {
    dailyLimitPerInstance: form.dailyLimitPerInstance ? Number(form.dailyLimitPerInstance) : undefined,
    sendWindow: { startHour: form.startHour, endHour: form.endHour, daysOfWeek: form.daysOfWeek },
    jitterSeconds: { min: form.jitterMin, max: form.jitterMax },
    skipRecentlyContactedDays: form.skipRecentlyContactedDays,
  };
}

/**
 * "Opções avançadas" da campanha — mesmo padrão `<details>` de
 * `new-search-form.tsx` (nativamente acessível, sem popover). Pré-preenchido
 * com defaults sensatos (janela comercial, jitter mínimo de 30s) — o
 * operador só toca aqui se quiser algo diferente.
 */
export function CampaignSettingsFields({
  value,
  onChange,
  errors,
}: {
  value: CampaignSettingsFormState;
  onChange: (value: CampaignSettingsFormState) => void;
  errors?: Record<string, string>;
}) {
  function toggleDay(day: number) {
    onChange({
      ...value,
      daysOfWeek: value.daysOfWeek.includes(day) ? value.daysOfWeek.filter((d) => d !== day) : [...value.daysOfWeek, day].sort(),
    });
  }

  return (
    <details className="group rounded-md border border-border p-3 open:pb-4">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        Cadência e horário de envio
      </summary>

      <div className="mt-3 flex flex-col gap-4 pl-6">
        <div>
          <Label>Dias de envio</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana em que a campanha pode enviar">
            {DAY_LABELS.map((label, day) => {
              const isActive = value.daysOfWeek.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-accent',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {errors?.daysOfWeek && <p className="mt-1 text-xs text-destructive">{errors.daysOfWeek}</p>}
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-start-hour">Início (hora)</Label>
            <Input
              id="campaign-start-hour"
              type="number"
              min={8}
              max={20}
              value={value.startHour}
              onChange={(e) => onChange({ ...value, startHour: Number(e.target.value) })}
              className="w-24"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-end-hour">Fim (hora)</Label>
            <Input
              id="campaign-end-hour"
              type="number"
              min={8}
              max={20}
              value={value.endHour}
              onChange={(e) => onChange({ ...value, endHour: Number(e.target.value) })}
              className="w-24"
            />
          </div>
          {errors?.sendWindow && <p className="w-full text-xs text-destructive">{errors.sendWindow}</p>}
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-jitter-min">Intervalo mínimo entre envios (s)</Label>
            <Input
              id="campaign-jitter-min"
              type="number"
              min={30}
              value={value.jitterMin}
              onChange={(e) => onChange({ ...value, jitterMin: Number(e.target.value) })}
              className="w-32"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-jitter-max">Intervalo máximo (s)</Label>
            <Input
              id="campaign-jitter-max"
              type="number"
              min={30}
              value={value.jitterMax}
              onChange={(e) => onChange({ ...value, jitterMax: Number(e.target.value) })}
              className="w-32"
            />
          </div>
          {errors?.jitterSeconds && <p className="w-full text-xs text-destructive">{errors.jitterSeconds}</p>}
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-daily-limit">Limite diário por instância</Label>
            <Input
              id="campaign-daily-limit"
              type="number"
              min={1}
              placeholder="usar a cota de aquecimento de cada instância"
              value={value.dailyLimitPerInstance}
              onChange={(e) => onChange({ ...value, dailyLimitPerInstance: e.target.value })}
              className="w-64"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-skip-recent">Não reabordar quem foi contatado nos últimos (dias)</Label>
            <Input
              id="campaign-skip-recent"
              type="number"
              min={0}
              value={value.skipRecentlyContactedDays}
              onChange={(e) => onChange({ ...value, skipRecentlyContactedDays: Number(e.target.value) })}
              className="w-24"
            />
          </div>
        </div>
      </div>
    </details>
  );
}
