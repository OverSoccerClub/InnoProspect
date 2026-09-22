import { ShieldOff } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { MessageStatusBadge } from '@/components/leads/message-status-badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LeadActivity, LeadMessageItem } from '@/types/lead';

const OPT_OUT_KEYWORDS = /\b(sair|parar|cancelar|descadastrar|stop|unsubscribe)\b/i;

/**
 * `LeadMessageItem` (`GET /leads/:id`, contrato real) não tem `errorCode` —
 * só a resposta de `POST /messages` tem. Uma mensagem recém-enviada nesta
 * sessão (via `MessageComposer.onSent`) carrega o campo extra; uma que já
 * veio do GET, não. Tipo local só para a UI tolerar os dois formatos sem
 * inventar contrato novo.
 */
type ConversationMessage = LeadMessageItem & { errorCode?: string | null };

/**
 * Detecta se uma mensagem de entrada é um pedido de descadastro. Fonte
 * primária: `LeadActivity` `opted_out` correlacionado por `payload.messageId`
 * (o que o backend real deveria gravar). Fallback: heurística de palavra-chave
 * no corpo — cobre o caso de hoje, em que o backend ainda não grava essa
 * correlação. ⚠️ Assunção a confirmar com o Vega (ver handoff).
 */
function buildOptOutMessageIds(activities: LeadActivity[]): Set<string> {
  const ids = new Set<string>();
  for (const activity of activities) {
    if (activity.type !== 'opted_out') continue;
    const messageId = activity.payload?.messageId;
    if (typeof messageId === 'string') ids.add(messageId);
  }
  return ids;
}

export function LeadConversation({ messages, activities }: { messages: ConversationMessage[]; activities: LeadActivity[] }) {
  if (messages.length === 0) {
    return (
      <EmptyState
        title="Nenhuma mensagem ainda"
        description="Envie a primeira mensagem pelo compositor abaixo — ela aparece aqui na hora."
      />
    );
  }

  const optOutMessageIds = buildOptOutMessageIds(activities);
  const sorted = [...messages].sort((a, b) => {
    const aTime = a.sentAt ?? '9999';
    const bTime = b.sentAt ?? '9999';
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  });

  return (
    <ol className="flex flex-col gap-3" aria-label="Conversa com o lead">
      {sorted.map((message) => {
        const isOutbound = message.direction === 'outbound';
        const isOptOutRequest = !isOutbound && (optOutMessageIds.has(message.id) || OPT_OUT_KEYWORDS.test(message.body));
        return (
          <li key={message.id} className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-lg p-3 text-sm sm:max-w-md',
                isOutbound && 'bg-primary/10',
                !isOutbound && !isOptOutRequest && 'bg-muted',
                isOptOutRequest && 'border-2 border-destructive bg-destructive/[0.06]',
              )}
            >
              {isOptOutRequest && (
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-destructive">
                  <ShieldOff className="size-3.5" aria-hidden="true" />
                  Pedido de descadastro
                </p>
              )}
              <p className="whitespace-pre-wrap leading-relaxed">{message.body}</p>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatDateTime(message.sentAt) || (message.status === 'queued' ? 'Enviando…' : '—')}</span>
                {isOutbound && <MessageStatusBadge status={message.status} errorCode={message.errorCode} />}
              </div>
              {message.status === 'failed' && (
                <p className="mt-1 text-xs text-destructive">
                  Não foi entregue{message.errorCode ? ` (${message.errorCode})` : ''}. Você pode tentar reenviar.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
