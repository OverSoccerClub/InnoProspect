import type { LucideIcon } from 'lucide-react';

type ComingSoonProps = {
  icon: LucideIcon;
  title: string;
  phase: string;
  description: string;
};

/** Placeholder honesto para seções que ainda não existem — nunca um link quebrado. */
export function ComingSoon({ icon: Icon, title, phase, description }: ComingSoonProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-6" />
        </div>
        <p className="font-display text-sm font-semibold text-foreground">{phase}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
