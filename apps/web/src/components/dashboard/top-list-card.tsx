import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type TopListItem = { label: string; count: number };

export function TopListCard({
  title,
  items,
  emptyMessage,
  className,
}: {
  title: string;
  items: TopListItem[];
  emptyMessage: string;
  className?: string;
}) {
  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="!font-sans text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <li key={item.label} className="flex items-center gap-2.5">
                <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{item.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }} />
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">{item.count}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
