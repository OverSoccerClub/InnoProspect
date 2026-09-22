import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Linhas de esqueleto para tabelas enquanto os dados carregam.
 * `columnClassNames` deixa cada célula do esqueleto repetir a mesma classe de
 * colapso responsivo (`hidden lg:table-cell` etc.) do `TableHead` real
 * correspondente — sem isso, a linha de esqueleto (sempre com todas as
 * colunas) desalinha do cabeçalho (que já esconde a coluna de baixa
 * prioridade) enquanto os dados carregam.
 */
export function LoadingRows({
  rows = 5,
  columns = 4,
  columnClassNames,
}: {
  rows?: number;
  columns?: number;
  columnClassNames?: string[];
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b border-border">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <td key={colIndex} className={cn('px-4 py-3', columnClassNames?.[colIndex])}>
              <Skeleton className="h-4 w-full max-w-[160px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
