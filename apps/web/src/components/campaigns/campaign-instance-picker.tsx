'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Unplug } from 'lucide-react';

import { InstanceHealthBadge } from '@/components/whatsapp/instance-health-badge';
import { InstanceStatusBadge } from '@/components/whatsapp/instance-status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorState } from '@/components/common/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { listInstances } from '@/lib/api/whatsapp';
import { cn } from '@/lib/utils';
import type { InstanceListItem } from '@/types/whatsapp';

type CampaignInstancePickerProps = {
  selected: string[];
  onChange: (ids: string[]) => void;
};

/**
 * Checklist de instâncias de WhatsApp — só `status === 'connected'` é
 * selecionável de fato (o `start` da campanha recusa com
 * `INSTANCE_NOT_CONNECTED` se não estiver, ARQUITETURA §4.5.9). As demais
 * aparecem desabilitadas COM o motivo visível (badge de status), em vez de
 * simplesmente não listar — o operador precisa entender por que uma
 * instância que ele esperava usar não está disponível agora.
 */
export function CampaignInstancePicker({ selected, onChange }: CampaignInstancePickerProps) {
  const [instances, setInstances] = useState<InstanceListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listInstances()
      .then((data) => {
        if (!cancelled) setInstances(data);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar as instâncias de WhatsApp.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string, connected: boolean) {
    if (!connected) return;
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!instances) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma instância cadastrada ainda.{' '}
        <Link href="/whatsapp" className="font-medium text-primary hover:underline">
          Conecte uma instância de WhatsApp
        </Link>{' '}
        antes de criar uma campanha.
      </p>
    );
  }

  const noneConnected = instances.every((i) => i.status !== 'connected');

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-col gap-2" role="group" aria-label="Instâncias de WhatsApp">
        {instances.map((instance) => {
          const connected = instance.status === 'connected';
          const isSelected = selected.includes(instance.id);
          return (
            <label
              key={instance.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 transition-colors',
                connected ? 'hover:bg-accent/40' : 'cursor-not-allowed opacity-60',
                isSelected && 'border-primary bg-accent/30',
              )}
            >
              <Checkbox
                checked={isSelected}
                disabled={!connected}
                onChange={() => toggle(instance.id, connected)}
                aria-label={`Usar ${instance.name}`}
              />
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-foreground">{instance.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {instance.phoneNumber ?? 'sem número'} · cota hoje: {instance.today.remaining} restante(s) de {instance.warmup.dailyLimit}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <InstanceStatusBadge status={instance.status} />
                {instance.health !== 'ok' && <InstanceHealthBadge health={instance.health} />}
              </div>
            </label>
          );
        })}
      </fieldset>

      {noneConnected && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <Unplug className="size-3.5" aria-hidden="true" />
          Nenhuma instância está conectada agora — você pode montar a campanha, mas não vai conseguir iniciá-la até conectar uma.
        </p>
      )}
    </div>
  );
}
