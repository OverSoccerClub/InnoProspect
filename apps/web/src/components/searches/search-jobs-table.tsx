import Link from 'next/link';

import { SearchJobStatusBadge } from '@/components/searches/search-job-status-badge';
import { Progress } from '@/components/ui/progress';
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
            <TableCell>
              <Link
                href={`/buscas/${job.id}`}
                className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {job.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {job.niche} · {job.uf}
              </p>
            </TableCell>
            <TableCell>
              <SearchJobStatusBadge status={job.status} />
            </TableCell>
            <TableCell className="min-w-[140px]">
              <div className="flex items-center gap-2">
                <Progress
                  value={job.progress.percent}
                  label={`${job.progress.done} de ${job.progress.total} municípios concluídos`}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">
                  {job.progress.done}/{job.progress.total}
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
