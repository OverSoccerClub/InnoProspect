import { AlertTriangle, CheckCircle2, MessageSquare, PlusCircle, ShieldOff, Tag } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isOptOutActivity, LEAD_STATUS_LABEL, type LeadActivity, type LeadActivityType } from '@/types/lead';

const ICON: Record<LeadActivityType, typeof CheckCircle2> = {
  created: PlusCircle,
  status_changed: CheckCircle2,
  note_added: Tag,
  tags_added: Tag,
  tags_removed: Tag,
  message_sent: MessageSquare,
  message_failed: AlertTriangle,
  message_received: MessageSquare,
  opted_out: ShieldOff,
};

const LABEL: Record<LeadActivityType, string> = {
  created: 'Lead criado',
  status_changed: 'Status alterado',
  note_added: 'Nota adicionada',
  tags_added: 'Marcadores adicionados',
  tags_removed: 'Marcadores removidos',
  message_sent: 'Mensagem enviada',
  message_failed: 'Falha no envio',
  message_received: 'Mensagem recebida',
  opted_out: 'Descadastrado (opt-out)',
};

/**
 * O backend registra o tipo da atividade como texto livre, então a tela pode
 * receber um tipo que ainda não conhece — foi o que quase aconteceu quando as
 * ações em massa criaram `tags_added`/`tags_removed`: `ICON[tipo]` sairia
 * `undefined` e o React derrubaria a ficha inteira com "tipo de elemento
 * inválido". Um histórico com um item genérico é muito melhor do que uma
 * página que não abre.
 */
function iconePara(type: string): typeof CheckCircle2 {
  if (isOptOutActivity(type)) return ICON.opted_out;
  return ICON[type as LeadActivityType] ?? CheckCircle2;
}

function rotuloPara(type: string): string {
  if (isOptOutActivity(type)) return LABEL.opted_out;
  return LABEL[type as LeadActivityType] ?? type.replace(/_/g, ' ');
}

/**
 * O payload guarda o valor interno do enum (`new`, `responded`...). Mostrá-lo
 * cru deixava a linha do tempo dizendo `de "new" para "responded"` na tela.
 * Traduz pelo mesmo mapa que o `LeadStatusBadge` usa; um valor desconhecido
 * (payload antigo ou estado novo ainda sem rótulo) aparece como veio em vez de
 * sumir.
 */
function statusLabel(value: string): string {
  return (LEAD_STATUS_LABEL as Record<string, string>)[value] ?? value;
}

function describePayload(activity: LeadActivity): string | null {
  if (activity.type === 'status_changed' && activity.payload) {
    const from = activity.payload.from as string | undefined;
    const to = activity.payload.to as string | undefined;
    if (from && to) return `de ${statusLabel(from)} para ${statusLabel(to)}`;
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
        const Icon = iconePara(activity.type);
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
                {rotuloPara(activity.type)}
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
