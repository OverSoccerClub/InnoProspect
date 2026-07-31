'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Globe, Loader2, MapPin, Phone, Star } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { LeadTimeline } from '@/components/leads/lead-timeline';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { getLead, patchLead } from '@/lib/api/leads';
import { ApiRequestError } from '@/lib/fetcher';
import { formatDateTime, formatPhone } from '@/lib/format';
import { LEAD_STATUS_LABEL, type LeadDetail as LeadDetailType, type LeadStatus } from '@/types/lead';

const ALL_STATUSES = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[];

export function LeadDetail({ id }: { id: string }) {
  const [lead, setLead] = useState<LeadDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{lead.name}</h1>
          <p className="text-sm text-muted-foreground">
            {lead.category ?? 'Sem categoria'} {lead.city && `· ${lead.city} — ${lead.uf}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSavingStatus && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
          <div className="flex flex-col gap-1">
            <Label htmlFor="lead-status" className="sr-only">
              Status do lead
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

      {statusError && <ErrorState message={statusError} />}

      {lead.isOptedOut && (
        <Alert variant="destructive">
          <AlertDescription>
            Este lead pediu para não receber mais mensagens (opt-out). Ele não pode ser incluído em campanhas.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Contato</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <InfoRow icon={Phone} label="Telefone">
              {formatPhone(lead.phoneE164)}
              {lead.phoneType === 'landline' && (
                <span className="ml-1 text-xs text-muted-foreground">(fixo — não recebe WhatsApp)</span>
              )}
            </InfoRow>
            <InfoRow icon={MapPin} label="Endereço">
              {lead.address ?? '—'}
            </InfoRow>
            <InfoRow icon={Globe} label="Site">
              {lead.website ? (
                <a href={lead.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {lead.website}
                </a>
              ) : (
                '—'
              )}
            </InfoRow>
            <InfoRow icon={Star} label="Avaliação">
              {lead.rating !== null ? `${lead.rating.toFixed(1)} (${lead.reviewCount ?? 0} avaliações)` : '—'}
            </InfoRow>

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
          <CardHeader>
            <CardTitle className="text-base">Linha do tempo</CardTitle>
          </CardHeader>
          <CardContent>
            <LeadTimeline activities={lead.activities} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mensagens</CardTitle>
        </CardHeader>
        <CardContent>
          {lead.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma mensagem ainda — o envio de WhatsApp chega na Fase 3.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {lead.messages.map((message) => (
                <li
                  key={message.id}
                  className={
                    message.direction === 'outbound'
                      ? 'ml-auto max-w-md rounded-lg bg-primary/10 p-3 text-sm'
                      : 'max-w-md rounded-lg bg-muted p-3 text-sm'
                  }
                >
                  <p>{message.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(message.sentAt)} · {message.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Phone;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p>{children}</p>
      </div>
    </div>
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
