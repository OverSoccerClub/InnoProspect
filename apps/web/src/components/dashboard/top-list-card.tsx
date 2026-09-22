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
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="line-clamp-2 text-xs text-muted-foreground" title={item.label}>
                    {item.label}
                  </span>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">{item.count}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
