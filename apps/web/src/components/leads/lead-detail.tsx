'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CircleAlert, Globe, Loader2, MapPin, MessageSquare, Star } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { LabeledField } from '@/components/common/labeled-field';
import { RecordHeader, type RecordHeaderField } from '@/components/common/record-header';
import { LeadConversation } from '@/components/leads/lead-conversation';
import { LeadOrigin } from '@/components/leads/lead-origin';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { LeadTimeline } from '@/components/leads/lead-timeline';
import { MessageComposer } from '@/components/leads/message-composer';
import { OptedOutBanner } from '@/components/leads/opted-out-banner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { getLead, patchLead } from '@/lib/api/leads';
import { ApiRequestError } from '@/lib/fetcher';
import { formatDateTime, formatPhone } from '@/lib/format';
import { isOptOutActivity, LEAD_STATUS_LABEL, type LeadDetail as LeadDetailType, type LeadStatus } from '@/types/lead';
import type { SendLeadMessageResponse } from '@/types/lead-message';

/**
 * `message_sent`/`message_received`/`message_failed` já aparecem, de forma
 * muito mais rica (bolha de chat, não uma linha "Mensagem enviada"), no card
 * Conversa abaixo — deixá-los TAMBÉM na Linha do tempo duplicava o mesmo
 * evento duas vezes na mesma tela (achado desta rodada de acabamento,
 * 2026-09-24). A Linha do tempo agora é só o que NÃO tem representação em
 * outro lugar da ficha: criação, mudança de status, notas, tags, opt-out.
 */
const MESSAGE_ACTIVITY_TYPES = new Set(['message_sent', 'message_received', 'message_failed']);

const ALL_STATUSES = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[];

/**
 * A ficha não tinha NENHUMA forma de saber, sem o operador recarregar a
 * página manualmente, que o lead respondeu — motivo direto do pedido do
 * dono ("não está mostrando a resposta do lead") depois da 1ª conversa real
 * em produção. `GET /leads/:id` é leitura pura (idempotente), então
 * revalidar em segundo plano é seguro; 8s segue o mesmo espírito do
 * `useQueueStatus` (20s, "banner de saúde") mas mais rápido, porque aqui é
 * uma conversa ao vivo — perto do `useSearchJob` (3s), sem ir tão rápido
 * porque não há uma condição de parada natural (a conversa nunca "termina").
 */
const LEAD_LIVE_POLL_MS = 8000;

export function LeadDetail({ id }: { id: string }) {
  const [lead, setLead] = useState<LeadDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [liveUpdateFailed, setLiveUpdateFailed] = useState(false);

  function fetchLead() {
    setIsLoading(true);
    setError(null);
    getLead(id)
      .then(setLead)
      .catch((err: unknown) => setError(err instanceof Error ? err : new Error('Não foi possível carregar o lead.')))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    fetchLead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Revalidação silenciosa em segundo plano — nunca reativa `isLoading` (sem
  // piscar o skeleton) e pula o tick por completo enquanto uma troca de
  // status está em voo, para não sobrescrever o valor otimista com o dado
  // antigo do servidor no meio da corrida. Um envio de mensagem não precisa
  // do mesmo cuidado: `sendLeadMessage` já retornou (o servidor já persistiu)
  // antes de `handleMessageSent` tocar o estado local.
  const isSavingStatusRef = useRef(isSavingStatus);
  isSavingStatusRef.current = isSavingStatus;
  const hasLoadedRef = useRef(false);
  hasLoadedRef.current = Boolean(lead) && !error;

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!hasLoadedRef.current || isSavingStatusRef.current) return;
      getLead(id)
        .then((fresh) => {
          setLead(fresh);
          setLiveUpdateFailed(false);
        })
        .catch(() => setLiveUpdateFailed(true));
    }, LEAD_LIVE_POLL_MS);
    return () => clearInterval(intervalId);
  }, [id]);

  function handleMessageSent(response: SendLeadMessageResponse) {
    setLead((current) => {
      if (!current) return current;
      const isColdStatus = current.status === 'new' || current.status === 'validated';
      const now = new Date().toISOString();
      return {
        ...current,
        messages: [...current.messages, response.message],
        lastContactedAt: response.message.sentAt ?? current.lastContactedAt,
        status: isColdStatus ? 'contacted' : current.status,
        activities: [
          ...current.activities,
          ...(isColdStatus
            ? [
                {
                  id: `local_status_${Date.now()}`,
                  leadId: current.id,
                  type: 'status_changed' as const,
                  payload: { from: current.status, to: 'contacted' },
                  actor: 'system' as const,
                  createdAt: now,
                },
              ]
            : []),
          {
            id: `local_msg_${Date.now()}`,
            leadId: current.id,
            type: 'message_sent' as const,
            payload: { messageId: response.message.id, instanceId: response.instance.id },
            actor: 'user' as const,
            createdAt: now,
          },
        ],
      };
    });
  }

  async function handleStatusChange(nextStatus: LeadStatus) {
    if (!lead || nextStatus === lead.status) return;
    setStatusError(null);
    setIsSavingStatus(true);
    const previous = lead.status;
    setLead({ ...lead, status: nextStatus });
    try {
      const updated = await patchLead(id, { status: nextStatus });
      setLead((current) => (current ? { ...current, ...updated } : current));
    } catch (err) {
      setLead((current) => (current ? { ...current, status: previous } : current));
      setStatusError(err instanceof ApiRequestError ? err.message : 'Não foi possível atualizar o status.');
    } finally {
      setIsSavingStatus(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !lead) {
    const notFound = error instanceof ApiRequestError && error.code === 'NOT_FOUND';
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorState
          title={notFound ? 'Lead não encontrado' : 'Não foi possível carregar o lead'}
          message={error?.message ?? 'Tente novamente.'}
          onRetry={fetchLead}
        />
      </div>
    );
  }

  const timelineActivities = lead.activities.filter((activity) => !MESSAGE_ACTIVITY_TYPES.has(activity.type));

  // Cabeçalho de registro em colunas (pedido do dono, referência Altezza,
  // 2026-09-24) — o que antes eram 4 linhas espalhadas (badge ao lado do
  // nome, InfoRow "Telefone"/"Avaliação" dentro do card Contato, "Última
  // vez visto" solto no rodapé do mesmo card) virou uma tira rotulada única,
  // legível num único olhar. `RecordHeader` não decide cor nenhuma — cada
  // valor chega pronto (`LeadStatusBadge`, `LeadOrigin`) da lógica de cor que
  // já existia.
  const recordFields: RecordHeaderField[] = [
    { key: 'status', label: 'Status', value: <LeadStatusBadge status={lead.status} /> },
    {
      key: 'phone',
      label: 'Telefone',
      value: (
        <span className="tabular-nums">
          {formatPhone(lead.phoneE164)}
          {lead.phoneType === 'landline' && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">(fixo)</span>
          )}
        </span>
      ),
    },
    {
      key: 'rating',
      label: 'Avaliação',
      value:
        lead.rating !== null ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star className="size-3.5 fill-warning text-warning" aria-hidden="true" />
            {lead.rating.toFixed(1)}
            <span className="text-xs font-normal text-muted-foreground">({lead.reviewCount ?? 0})</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'origin',
      label: 'Origem',
      value: lead.searchNiche ? <LeadOrigin searchNiche={lead.searchNiche} offNiche={lead.offNiche} /> : '—',
    },
    {
      key: 'last-activity',
      label: 'Última atividade',
      value: formatDateTime(lead.lastContactedAt ?? lead.lastSeenAt),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
          >
            {lead.name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0]?.toUpperCase() ?? '')
              .join('')}
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{lead.name}</h1>
            <p className="text-sm text-muted-foreground">
              {lead.category ?? 'Sem categoria'} {lead.city && `· ${lead.city} — ${lead.uf}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSavingStatus && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
          <div className="flex flex-col gap-1">
            <Label htmlFor="lead-status" className="sr-only">
              Alterar status do lead
            </Label>
            <Select
              id="lead-status"
              value={lead.status}
              disabled={isSavingStatus}
              onChange={(e) => handleStatusChange(e.target.value as LeadStatus)}
              className="w-44"
            >
              {ALL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {LEAD_STATUS_LABEL[status]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <Card variant="flat">
        <CardContent className="pt-4">
          <RecordHeader fields={recordFields} />
        </CardContent>
      </Card>

      {statusError && <ErrorState message={statusError} />}

      {lead.isOptedOut && (
        <OptedOutBanner optedOutAt={lead.activities.find((a) => isOptOutActivity(a.type))?.createdAt ?? null} />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* `elevated`: identidade/contato do lead — referência primária da
            ficha. Redesenho de 2026-09-23 (pedido do dono, 1ª conversa real):
            a Conversa também virou `elevated` (é onde o trabalho acontece
            agora), só a Linha do tempo (histórico) ficou `flat` — as 4 caixas
            de mesmo peso que existiam antes eram parte da reclamação de
            "tela sem vida". */}
        {/* Telefone e Avaliação saíram deste card — já aparecem no
            `RecordHeader` acima, mostrar os dois de novo aqui era a mesma
            informação duplicada duas vezes na mesma tela. Este card guarda só
            o que É exclusivo de "Contato": endereço, site, tags, proveniência. */}
        <Card variant="elevated" className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Contato</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <LabeledField icon={MapPin} label="Endereço">
              {lead.address ?? '—'}
            </LabeledField>
            <LabeledField icon={Globe} label="Site">
              {lead.website ? (
                <a href={lead.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {lead.website}
                </a>
              ) : (
                '—'
              )}
            </LabeledField>

            {lead.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {lead.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-3 text-xs text-muted-foreground">
              <p>Coletado em {formatDateTime(lead.source.collectedAt)}</p>
              <p>Última vez visto em {formatDateTime(lead.lastSeenAt)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <CardTitle className="text-base">Linha do tempo</CardTitle>
            {timelineActivities.length > 0 && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground">
                {timelineActivities.length}
              </span>
            )}
          </CardHeader>
          <CardContent>
            <LeadTimeline activities={timelineActivities} />
          </CardContent>
        </Card>
      </div>

      {/* `elevated`: a conversa é onde o trabalho acontece agora que há
          contato real — protagonista da ficha, não mais uma caixa de
          histórico ao lado de um formulário separado. O compositor mora no
          RODAPÉ deste mesmo card (chat), não num card paralelo. */}
      <Card variant="elevated">
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="size-4 text-primary" aria-hidden="true" />
            Conversa
          </CardTitle>
          <LiveUpdateIndicator failed={liveUpdateFailed} />
        </CardHeader>
        <CardContent className="flex flex-col gap-0 p-0">
          <LeadConversation messages={lead.messages} activities={lead.activities} />
          <div className="border-t border-border bg-muted/30 px-4 py-4 sm:px-6">
            <MessageComposer lead={lead} onSent={handleMessageSent} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Não é `Alert` de propósito — uma falha de revalidação em segundo plano é
 * transitória e não deve competir visualmente com o conteúdo (mesmo
 * espírito do aviso inline de `SearchJobProgress` quando o polling de
 * progresso falha uma vez: mostra o último dado bom, tenta de novo sozinho).
 */
function LiveUpdateIndicator({ failed }: { failed: boolean }) {
  if (failed) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <CircleAlert className="size-3.5 text-warning-foreground dark:text-warning" aria-hidden="true" />
        Atualização automática falhou — tentando de novo
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-success motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      Ao vivo
    </span>
  );
}

function BackLink() {
  return (
    <Link
      href="/leads"
      className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Voltar para leads
    </Link>
  );
}
