import Link from 'next/link';

import { CampaignProgressBar } from '@/components/campaigns/campaign-progress-bar';
import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import type { CampaignSummary } from '@/types/campaign';

export function CampaignTable({ campaigns }: { campaigns: CampaignSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Campanha</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="min-w-[160px]">Progresso</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Resposta</TableHead>
          <TableHead>Criada em</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {campaigns.map((campaign) => (
          <TableRow key={campaign.id}>
            <TableCell className="max-w-[260px]">
              <Link
                href={`/campanhas/${campaign.id}`}
                title={campaign.name}
                className="block truncate font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {campaign.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {campaign.templateName} · {campaign.instanceCount} instância(s)
              </p>
            </TableCell>
            <TableCell>
              <CampaignStatusBadge status={campaign.status} />
              {campaign.status === 'halted' && campaign.haltReason && (
                <p className="mt-0.5 max-w-[200px] truncate text-xs text-destructive" title={campaign.haltReason}>
                  {campaign.haltReason}
                </p>
              )}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <CampaignProgressBar stats={campaign.stats} className="w-24" />
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {campaign.stats.delivered}/{campaign.stats.total}
                  {campaign.stats.failed > 0 && <span className="text-destructive"> ({campaign.stats.failed} falha)</span>}
                </span>
              </div>
            </TableCell>
            <TableCell className="hidden text-right tabular-nums lg:table-cell">
              {campaign.stats.sent > 0 ? `${Math.round(campaign.rates.responseRate * 100)}%` : '—'}
            </TableCell>
            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDateTime(campaign.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
