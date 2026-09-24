import { CircleAlert, Users } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { AUDIENCE_EXCLUSION_LABEL, AUDIENCE_EXCLUSION_ORDER } from '@/lib/campaign-audience';
import { cn } from '@/lib/utils';
import type { CampaignAudienceSummary } from '@/types/campaign';

type CampaignAudienceSummaryCardProps = {
  summary: CampaignAudienceSummary;
  /** `true` = ainda é uma prévia, antes de criar a campanha de verdade. */
  isPreview: boolean;
  className?: string;
};

/**
 * O CORAÇÃO da entrega (pedido explícito do dono): "800 encontrados → 430
 * elegíveis", com CADA motivo de exclusão listado e quantificado — nunca só
 * o número final. O operador precisa conseguir olhar isto e dizer "esse
 * motivo está errado", e cada motivo já vem com a explicação de por que
 * existe (ARQUITETURA §4.5.4).
 */
export function CampaignAudienceSummaryCard({ summary, isPreview, className }: CampaignAudienceSummaryCardProps) {
  const { totalMatched, eligible, excluded } = summary;
  const excludedTotal = totalMatched - eligible;
  const activeReasons = AUDIENCE_EXCLUSION_ORDER.filter((key) => excluded[key] > 0);

  return (
    <Card variant="flat" className={cn('border-dashed bg-muted/30', className)}>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Users className="size-5" aria-hidden="true" />
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-foreground">{totalMatched}</span>
            <span className="text-sm text-muted-foreground">encontrado(s)</span>
            <span className="text-muted-foreground" aria-hidden="true">
              →
            </span>
            <span className="text-2xl font-semibold tabular-nums text-success">{eligible}</span>
            <span className="text-sm text-muted-foreground">elegível(is) para receber a campanha</span>
          </div>
        </div>

        {excludedTotal > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {excludedTotal} de fora — por que, um por um:
            </p>
            <ul className="flex flex-col gap-1.5">
              {activeReasons.map((key) => (
                <li key={key} className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{AUDIENCE_EXCLUSION_LABEL[key].label}</p>
                    <p className="text-xs text-muted-foreground">{AUDIENCE_EXCLUSION_LABEL[key].hint}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap tabular-nums font-semibold text-foreground">{excluded[key]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {eligible === 0 && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>
              Nenhum lead elegível sobrou. Ajuste o público — não é possível criar (ou iniciar) uma campanha sem ninguém para receber.
            </AlertDescription>
          </Alert>
        )}

        {isPreview && (
          <p className="text-xs text-muted-foreground">
            Prévia — os números podem mudar levemente se algo no cadastro dos leads for alterado até você confirmar a criação.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
