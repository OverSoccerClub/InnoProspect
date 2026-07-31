import { SearchTaskStatusBadge } from '@/components/searches/search-task-status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SearchTaskItem } from '@/types/search';

export function SearchTaskList({ tasks }: { tasks: SearchTaskItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Município</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Leads encontrados</TableHead>
          <TableHead>Tentativa</TableHead>
          <TableHead>Erro</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="font-medium">{task.cityName}</TableCell>
            <TableCell>
              <SearchTaskStatusBadge status={task.status} />
            </TableCell>
            <TableCell className="text-right">{task.status === 'pending' ? '—' : task.resultCount}</TableCell>
            <TableCell>{task.attempt}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{task.errorCode ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
