'use client';

import { useEffect, useRef } from 'react';
import { MessageCircle, ShieldOff } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { MessageStatusBadge } from '@/components/leads/message-status-badge';
import { formatDateTime, formatDayLabel, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isOptOutActivity, type LeadActivity, type LeadMessageItem } from '@/types/lead';

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
    if (!isOptOutActivity(activity.type)) continue;
    const messageId = activity.payload?.messageId;
    if (typeof messageId === 'string') ids.add(messageId);
  }
  return ids;
}

type DayGroup = { dayKey: string; label: string; messages: ConversationMessage[] };

/** Agrupa por dia calendário (fuso local) — mesmo texto de `sentAt` já vem ordenado. */
function groupByDay(sorted: ConversationMessage[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const message of sorted) {
    const iso = message.sentAt ?? message.readAt ?? message.deliveredAt;
    const dayKey = iso ? iso.slice(0, 10) : 'sem-data';
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.messages.push(message);
    } else {
      groups.push({ dayKey, label: iso ? formatDayLabel(iso) : 'Data desconhecida', messages: [message] });
    }
  }
  return groups;
}

export function LeadConversation({ messages, activities }: { messages: ConversationMessage[]; activities: LeadActivity[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rolagem começa embaixo — é ali que a conversa continua, não no início do
  // histórico. Também reaplica sempre que chega mensagem nova (envio local ou
  // atualização automática da ficha).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <EmptyState
        icon={<MessageCircle className="size-5" aria-hidden="true" />}
        title="Nenhuma mensagem ainda"
        description="Envie a primeira mensagem pelo compositor abaixo. Assim que o lead responder, a resposta aparece aqui automaticamente — esta tela se atualiza sozinha."
        className="border-none bg-transparent py-10"
      />
    );
  }

  const optOutMessageIds = buildOptOutMessageIds(activities);
  const sorted = [...messages].sort((a, b) => {
    const aTime = a.sentAt ?? '9999';
    const bTime = b.sentAt ?? '9999';
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  });
  const hasInbound = sorted.some((m) => m.direction === 'inbound');
  const hasOutbound = sorted.some((m) => m.direction === 'outbound');
  const groups = groupByDay(sorted);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversa com o lead"
      className="flex max-h-[480px] min-h-[280px] flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6"
    >
      {groups.map((group) => (
        <div key={group.dayKey} className="flex flex-col gap-3">
          <div className="sticky top-0 z-10 flex justify-center py-1">
            <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-xs">
              {group.label}
            </span>
          </div>
          {group.messages.map((message) => {
            const isOutbound = message.direction === 'outbound';
            const isOptOutRequest = !isOutbound && (optOutMessageIds.has(message.id) || OPT_OUT_KEYWORDS.test(message.body));
            return (
              <div key={message.id} className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-xs sm:max-w-md',
                    isOutbound && 'rounded-br-sm bg-primary/10',
                    !isOutbound && !isOptOutRequest && 'rounded-bl-sm bg-muted',
                    isOptOutRequest && 'rounded-bl-sm border-2 border-destructive bg-destructive/[0.06]',
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
                    <span title={formatDateTime(message.sentAt)}>
                      {message.sentAt ? formatTime(message.sentAt) : message.status === 'queued' ? 'Enviando…' : '—'}
                    </span>
                    {isOutbound && <MessageStatusBadge status={message.status} errorCode={message.errorCode} />}
                  </div>
                  {message.status === 'failed' && (
                    <p className="mt-1 text-xs text-destructive">
                      Não foi entregue{message.errorCode ? ` (${message.errorCode})` : ''}. Você pode tentar reenviar.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {hasOutbound && !hasInbound && (
        <p className="mt-1 text-center text-xs text-muted-foreground">
          Nenhuma resposta chegou por aqui ainda — pode ser que o lead não tenha respondido, ou que a
          resposta ainda não tenha chegado ao sistema. Esta tela atualiza sozinha, sem precisar recarregar.
        </p>
      )}
    </div>
  );
}
