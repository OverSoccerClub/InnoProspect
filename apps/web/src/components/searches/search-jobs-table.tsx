import Link from 'next/link';

import { SearchJobStatusBadge } from '@/components/searches/search-job-status-badge';
import { SearchProgressBar } from '@/components/searches/search-progress-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import type { SearchJobSummary } from '@/types/search';

export function SearchJobsTable({ jobs }: { jobs: SearchJobSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Busca</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Progresso</TableHead>
          <TableHead className="text-right">Leads</TableHead>
          <TableHead>Criada em</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="max-w-[240px]">
              <Link
                href={`/buscas/${job.id}`}
                title={job.name}
                className="block truncate font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {job.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {job.niche} · {job.uf}
              </p>
            </TableCell>
            <TableCell>
              <SearchJobStatusBadge job={job} />
            </TableCell>
            <TableCell className="min-w-[140px]">
              <div className="flex items-center gap-2">
                <SearchProgressBar progress={job.progress} className="w-24" />
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {job.progress.done}/{job.progress.total}
                  {job.progress.failed > 0 && <span className="text-destructive"> ({job.progress.failed} falha)</span>}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-right">
              <span className="font-medium">{job.leadsFound}</span>
              <span className="text-xs text-muted-foreground"> ({job.leadsNew} novos)</span>
            </TableCell>
            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
              {formatDateTime(job.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
