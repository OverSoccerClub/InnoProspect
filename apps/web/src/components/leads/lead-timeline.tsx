import { CheckCircle2, MessageSquare, PlusCircle, ShieldOff, Tag } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LeadActivity, LeadActivityType } from '@/types/lead';

const ICON: Record<LeadActivityType, typeof CheckCircle2> = {
  created: PlusCircle,
  status_changed: CheckCircle2,
  note_added: Tag,
  message_sent: MessageSquare,
  message_received: MessageSquare,
  opted_out: ShieldOff,
};

const LABEL: Record<LeadActivityType, string> = {
  created: 'Lead criado',
  status_changed: 'Status alterado',
  note_added: 'Nota adicionada',
  message_sent: 'Mensagem enviada',
  message_received: 'Mensagem recebida',
  opted_out: 'Descadastrado (opt-out)',
};

function describePayload(activity: LeadActivity): string | null {
  if (activity.type === 'status_changed') {
    const from = activity.payload.from as string | undefined;
    const to = activity.payload.to as string | undefined;
    if (from && to) return `de "${from}" para "${to}"`;
  }
  return null;
}

export function LeadTimeline({ activities }: { activities: LeadActivity[] }) {
  if (activities.length === 0) {
    return <EmptyState title="Sem atividades ainda" description="As ações sobre este lead vão aparecer aqui." />;
  }

  const sorted = [...activities].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <ol className="flex flex-col">
      {sorted.map((activity, index) => {
        const Icon = ICON[activity.type];
        const detail = describePayload(activity);
        const isLast = index === sorted.length - 1;
        return (
          <li key={activity.id} className={cn('relative flex gap-3', !isLast && 'pb-5')}>
            {!isLast && (
              <span aria-hidden="true" className="absolute left-[13px] top-7 bottom-0 w-px bg-border" />
            )}
            <div className="z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-4 ring-card">
              <Icon className="size-3.5" aria-hidden="true" />
            </div>
            <div className="pb-0.5">
              <p className="text-sm font-medium">
                {LABEL[activity.type]}
                {detail && <span className="font-normal text-muted-foreground"> — {detail}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(activity.createdAt)} · {actorLabel(activity.actor)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function actorLabel(actor: LeadActivity['actor']): string {
  if (actor === 'user') return 'você';
  if (actor === 'lead') return 'o lead';
  return 'sistema';
}
