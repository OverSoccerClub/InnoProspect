'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/hooks/useNow';
import { getHealth } from '@/lib/api/health';
import { formatRelative } from '@/lib/format';
import { listInstances } from '@/lib/api/whatsapp';
import { getStatusFreshnessLevel } from '@/lib/whatsapp-freshness';
import type { HealthReport } from '@/types/health';
import type { InstanceListItem } from '@/types/whatsapp';

type RowStatus = 'ok' | 'warn' | 'error';

type Row = { label: string; status: RowStatus; detail: string; detailTitle?: string };

const ROW_ICON: Record<RowStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: MinusCircle,
  error: XCircle,
};

const ROW_ICON_CLASS: Record<RowStatus, string> = {
  ok: 'text-success',
  warn: 'text-warning-foreground dark:text-warning',
  error: 'text-destructive',
};

/**
 * Mesma lógica usada no fetch real e na versão fixa do primeiro acesso — um
 * lugar só de verdade. `now` vem de `useNow` (ver componente abaixo): não é
 * usado pra buscar dado novo, só pra recalcular o frescor sem congelar
 * "confirmado há X" no valor do render que buscou os dados.
 */
function buildHealthRows(health: HealthReport, instances: InstanceListItem[], now: number): Row[] {
  const connected = instances.filter((i) => i.status === 'connected');
  // Quantas das CONECTADAS estão com confirmação hesitante (`stale`/`unknown`
  // — ver `lib/whatsapp-freshness.ts`) — é exatamente a combinação do
  // incidente do dono (2026-09-24): "conectado" que ninguém confirma há um
  // tempo. Aqui no dashboard isso rebaixa a linha pra `warn` (nunca `error`
  // — é "não sei", não "quebrou"), porque é onde o dono olha de relance e
  // acredita.
  const staleConnected = connected.filter((i) => getStatusFreshnessLevel(i.statusCheckedAt, now) !== 'fresh').length;
  return [
    {
      label: 'Banco de dados',
      status: health.checks.database.status === 'ok' ? 'ok' : 'error',
      detail: health.checks.database.status === 'ok' ? `${health.checks.database.latencyMs ?? '—'}ms` : (health.checks.database.error ?? 'Indisponível'),
    },
    {
      label: 'Redis',
      status: health.checks.redis.status === 'ok' ? 'ok' : 'error',
      detail: health.checks.redis.status === 'ok' ? `${health.checks.redis.latencyMs ?? '—'}ms` : (health.checks.redis.error ?? 'Indisponível'),
    },
    {
      label: 'Worker',
      status: health.checks.worker.status === 'ok' ? 'ok' : 'error',
      detail: health.checks.worker.status === 'ok' ? `último sinal ${formatRelative(health.checks.worker.lastHeartbeatAt)}` : 'sem sinal',
    },
    {
      label: 'Fila de coleta',
      status: health.checks.queue.status === 'running' ? 'ok' : health.checks.queue.status === 'paused' ? 'error' : 'warn',
      detail: health.checks.queue.status === 'running' ? 'operando' : health.checks.queue.status === 'paused' ? 'pausada' : 'indeterminado',
    },
    {
      label: 'WhatsApp',
      status:
        connected.length === 0 ? (instances.length === 0 ? 'warn' : 'error') : staleConnected > 0 ? 'warn' : 'ok',
      detail:
        instances.length === 0
          ? 'nenhuma instância'
          : staleConnected > 0
            // Curto de propósito (o card é um resumo, não a fonte da
            // verdade) — o "há quanto tempo" de cada instância já vive em
            // `/whatsapp` (`StatusFreshness` em cada card). Aqui só precisa
            // dizer QUE existe algo pra reconferir.
            ? `${connected.length} de ${instances.length} conectada${instances.length === 1 ? '' : 's'} · ${staleConnected} não confirmada${staleConnected === 1 ? '' : 's'}`
            : `${connected.length} de ${instances.length} conectada${instances.length === 1 ? '' : 's'}`,
      detailTitle:
        staleConnected > 0
          ? 'Ainda não reconfirmamos a conexão de uma ou mais instâncias com a Evolution API — veja o detalhe em /whatsapp.'
          : undefined,
    },
  ];
}

type SystemHealthCardProps = {
  className?: string;
  /**
   * Dados fixos, pulando o fetch interno — usado só por
   * `FirstAccessChecklist`, que já resolveu um cenário coerente de conta
   * nova (sistema saudável, zero instâncias de WhatsApp) via
   * `useFirstAccessSystemContext`.
   */
  overrideData?: { health: HealthReport; instances: InstanceListItem[] };
};

/**
 * Card de saúde do sistema — banco, Redis, worker (heartbeat), fila e
 * WhatsApp num olhar só. É o que dá "cara de sistema profissional" (pedido
 * do dono) e resolve o problema real de ninguém perceber quando algo parou
 * sem abrir `/health` manualmente (mesmo motivo do `QueueHealthBanner`,
 * DESIGN-SYSTEM.md §9.3 — este card é o complemento operacional dele).
 */
export function SystemHealthCard({ className, overrideData }: SystemHealthCardProps) {
  const [source, setSource] = useState<{ health: HealthReport; instances: InstanceListItem[] } | null>(overrideData ?? null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(!overrideData);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (overrideData) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([getHealth(), listInstances()])
      .then(([health, instances]) => {
        if (!cancelled) setSource({ health, instances });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar a saúde do sistema.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey, overrideData]);

  // Não busca dado novo — só recalcula o frescor (`buildHealthRows`) pra não
  // congelar "sem confirmar há X" no valor do render que buscou os dados
  // (mesmo motivo de `StatusFreshness`/`useNow`).
  const now = useNow();
  const rows = useMemo(() => (source ? buildHealthRows(source.health, source.instances, now) : null), [source, now]);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="!font-sans text-sm font-medium text-muted-foreground">Saúde do sistema</CardTitle>
      </CardHeader>
      <CardContent>
        {error && <ErrorState message={error.message} onRetry={() => setReloadKey((k) => k + 1)} />}

        {!error && isLoading && (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}

        {!error && !isLoading && rows && (
          <ul className="flex flex-col gap-2.5">
            {rows.map((row) => {
              const Icon = ROW_ICON[row.status];
              return (
                <li key={row.label} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-foreground">
                    <Icon className={`size-4 shrink-0 ${ROW_ICON_CLASS[row.status]}`} aria-hidden="true" />
                    {row.label}
                  </span>
                  <span className="text-right text-xs text-muted-foreground" title={row.detailTitle}>
                    {row.detail}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
