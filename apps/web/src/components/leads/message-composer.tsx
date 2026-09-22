'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, Loader2, Send, Sparkles, Unplug } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { previewLeadMessage, sendLeadMessage } from '@/lib/api/leads';
import { listTemplates } from '@/lib/api/templates';
import { listInstances } from '@/lib/api/whatsapp';
import { ApiRequestError } from '@/lib/fetcher';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LeadDetail } from '@/types/lead';
import type { LeadMessagePreviewItem, SendLeadMessageResponse } from '@/types/lead-message';
import type { InstanceListItem } from '@/types/whatsapp';
import type { TemplateItem } from '@/types/template';

type Mode = 'template' | 'raw';

type PendingConfirm = { kind: 'non_mobile' | 'outside_window'; message: string } | null;

/** `resetsAt`/`nextWindowOpensAt`/`optedOutAt` viajam em `details[]` (path = chave, message = ISO), não num campo `meta` — confirmado em `lib/services/messages.ts#throwForBlockedVerdict` (Vega). */
function findDetail(details: ApiRequestError['details'], path: string): string | null {
  return details?.find((d) => d.path === path)?.message ?? null;
}

/** Texto humano por `error.reason` (ARQUITETURA §4.9.7) — nunca mostrar o código puro. */
function describeError(err: ApiRequestError): { message: string; action?: React.ReactNode } {
  switch (err.reason) {
    case 'LEAD_HAS_NO_PHONE':
      return { message: 'Este lead não tem telefone cadastrado. Edite o lead para adicionar um número antes de enviar.' };
    case 'INSTANCE_NOT_FOUND':
    case 'INSTANCE_NOT_CONNECTED':
    case 'INSTANCE_BANNED':
    case 'INSTANCE_MISSING_UPSTREAM':
      return {
        message: err.message,
        action: (
          <Button asChild size="sm" variant="outline" className="w-fit">
            <Link href="/whatsapp">
              <Unplug />
              Ver instâncias de WhatsApp
            </Link>
          </Button>
        ),
      };
    case 'DAILY_LIMIT_REACHED': {
      const resetsAt = findDetail(err.details, 'resetsAt');
      return {
        message: resetsAt ? `${err.message} A cota é renovada em ${formatDateTime(resetsAt)}.` : err.message,
      };
    }
    case 'QUIET_HOURS':
      return { message: err.message };
    case 'DUPLICATE_SEND':
      return { message: err.message };
    case 'MISSING_OPTOUT_NOTICE':
    case 'MISSING_COMPANY_NAME':
    case 'UNKNOWN_VARIABLE':
    case 'INVALID_SPINTAX':
      return {
        message: err.message,
        action: (
          <Button asChild size="sm" variant="outline" className="w-fit">
            <Link href="/templates">Editar templates</Link>
          </Button>
        ),
      };
    case 'NUMBER_HAS_NO_WHATSAPP':
      return { message: 'A Evolution confirmou que este número não tem WhatsApp. Considere marcar o lead como inválido.' };
    // Os dois casos abaixo pedem ações OPOSTAS, e por isso não caem no texto
    // genérico: no incerto, reenviar pode duplicar a mensagem no WhatsApp do
    // lead; no expirado, nada saiu e reenviar é seguro.
    case 'EVOLUTION_SEND_UNCERTAIN':
      return {
        message:
          'Não foi possível confirmar se a mensagem saiu: o WhatsApp demorou a responder e ela pode ter sido entregue. Confira a conversa, porque a confirmação pode chegar em instantes, antes de reenviar. Reenviar agora pode fazer o lead receber a mesma mensagem duas vezes.',
      };
    case 'SEND_WINDOW_EXPIRED':
      return {
        message: 'O envio demorou mais que o permitido e foi cancelado antes de sair. Nada foi enviado, e você pode tentar de novo.',
      };
    default:
      return { message: err.message };
  }
}

export function MessageComposer({
  lead,
  onSent,
}: {
  lead: LeadDetail;
  onSent: (response: SendLeadMessageResponse) => void;
}) {
  const [mode, setMode] = useState<Mode>('template');
  const [templates, setTemplates] = useState<TemplateItem[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [preview, setPreview] = useState<LeadMessagePreviewItem[] | null>(null);
  const [missingVariables, setMissingVariables] = useState<string[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedVariation, setSelectedVariation] = useState(0);

  const [rawBody, setRawBody] = useState('');

  const [instances, setInstances] = useState<InstanceListItem[] | null>(null);
  const [instancesError, setInstancesError] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState('');

  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<{ message: string; action?: React.ReactNode } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const [lastSuccess, setLastSuccess] = useState<SendLeadMessageResponse | null>(null);

  const isColdFirstContact = lead.messages.length === 0;
  const blockReason = lead.isOptedOut
    ? 'Envio bloqueado — este lead está descadastrado (ver aviso no topo da página).'
    : !lead.phoneE164
      ? 'Este lead não tem telefone cadastrado — edite o lead para adicionar um número antes de enviar.'
      : null;

  useEffect(() => {
    listTemplates({ isActive: true, limit: 50 })
      .then((res) => {
        setTemplates(res.data);
        if (res.data.length > 0) setSelectedTemplateId((current) => current || res.data[0]!.id);
      })
      .catch(() => setTemplatesError('Não foi possível carregar os templates.'));
    listInstances()
      .then(setInstances)
      .catch(() => setInstancesError('Não foi possível carregar as instâncias de WhatsApp.'));
  }, []);

  useEffect(() => {
    if (mode !== 'template' || !selectedTemplateId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setIsPreviewing(true);
    setPreviewError(null);
    previewLeadMessage(lead.id, selectedTemplateId, 3)
      .then((res) => {
        if (cancelled) return;
        setPreview(res.previews);
        setMissingVariables(res.missingVariables);
        setSelectedVariation(0);
      })
      .catch(() => {
        if (!cancelled) setPreviewError('Não foi possível gerar a prévia desta mensagem.');
      })
      .finally(() => {
        if (!cancelled) setIsPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedTemplateId, lead.id]);

  const connectedInstances = useMemo(() => (instances ?? []).filter((i) => i.status === 'connected'), [instances]);

  async function submit(overrides?: { confirmOutsideBusinessWindow?: boolean; allowNonMobile?: boolean }) {
    setSendError(null);
    setPendingConfirm(null);
    setIsSending(true);
    try {
      const chosenPreview = preview?.[selectedVariation];
      const response = await sendLeadMessage(lead.id, {
        templateId: mode === 'template' ? selectedTemplateId || undefined : undefined,
        body: mode === 'raw' ? rawBody.trim() : undefined,
        instanceId: instanceId || undefined,
        spintaxSeed: mode === 'template' ? chosenPreview?.spintaxSeed : undefined,
        confirmOutsideBusinessWindow: overrides?.confirmOutsideBusinessWindow ?? false,
        allowNonMobile: overrides?.allowNonMobile ?? false,
      });
      setLastSuccess(response);
      if (mode === 'raw') setRawBody('');
      onSent(response);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.reason === 'LEAD_NOT_MOBILE') {
          setPendingConfirm({ kind: 'non_mobile', message: err.message });
          return;
        }
        if (err.reason === 'OUTSIDE_BUSINESS_WINDOW') {
          setPendingConfirm({ kind: 'outside_window', message: err.message });
          return;
        }
        setSendError(describeError(err));
      } else {
        setSendError({ message: 'Não foi possível enviar a mensagem. Tente novamente.' });
      }
    } finally {
      setIsSending(false);
    }
  }

  const canSubmit =
    !isSending &&
    !blockReason &&
    (mode === 'template' ? Boolean(selectedTemplateId) && Boolean(preview) : rawBody.trim().length > 0);

  return (
    <div className="flex flex-col gap-4" aria-disabled={Boolean(blockReason)}>
      {blockReason && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{blockReason}</AlertDescription>
        </Alert>
      )}

      {lastSuccess && (
        <Alert variant="success">
          <AlertTitle>Mensagem enviada</AlertTitle>
          <AlertDescription>
            Via {lastSuccess.instance.name} · restam {lastSuccess.quota.remaining} envios hoje nesta instância.
            {lastSuccess.warnings.length > 0 && (
              <ul className="mt-1.5 list-inside list-disc">
                {lastSuccess.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      {sendError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Não foi possível enviar</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{sendError.message}</span>
            {sendError.action}
          </AlertDescription>
        </Alert>
      )}

      {pendingConfirm && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Confirmação necessária</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{pendingConfirm.message}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                disabled={isSending}
                onClick={() =>
                  submit(
                    pendingConfirm.kind === 'non_mobile'
                      ? { allowNonMobile: true }
                      : { confirmOutsideBusinessWindow: true },
                  )
                }
              >
                {isSending && <Loader2 className="animate-spin" aria-hidden="true" />}
                Enviar mesmo assim
              </Button>
              <Button size="sm" variant="ghost" className="w-fit" onClick={() => setPendingConfirm(null)} disabled={isSending}>
                Cancelar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <fieldset disabled={Boolean(blockReason)} className="flex flex-col gap-4">
      <legend className="sr-only">Compor mensagem</legend>
      <div className="flex gap-1 rounded-md bg-muted p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode('template')}
          aria-pressed={mode === 'template'}
          className={cn(
            'flex-1 rounded-sm px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            mode === 'template' ? 'bg-card shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Usar template
        </button>
        <button
          type="button"
          onClick={() => setMode('raw')}
          aria-pressed={mode === 'raw'}
          className={cn(
            'flex-1 rounded-sm px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            mode === 'raw' ? 'bg-card shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Escrever mensagem
        </button>
      </div>

      {mode === 'template' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="composer-template">Template</Label>
            {templatesError ? (
              <p className="text-sm text-destructive">{templatesError}</p>
            ) : templates && templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum template ativo.{' '}
                <Link href="/templates" className="text-primary hover:underline">
                  Crie um template
                </Link>{' '}
                antes de enviar.
              </p>
            ) : (
              <Select
                id="composer-template"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                disabled={!templates}
              >
                {!templates && <option>Carregando…</option>}
                {templates?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {isPreviewing && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Gerando prévia…
            </p>
          )}
          {previewError && <p className="text-sm text-destructive">{previewError}</p>}

          {missingVariables.length > 0 && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertDescription>
                Este template usa {missingVariables.length === 1 ? 'uma variável' : 'variáveis'} que este lead não tem
                cadastrada ({missingVariables.join(', ')}) — a prévia usa um valor de exemplo no lugar.
              </AlertDescription>
            </Alert>
          )}

          {preview && preview.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Prévia — escolha a variação para enviar
              </legend>
              <div className="flex flex-col gap-2">
                {preview.map((item, index) => (
                  <label
                    key={item.spintaxSeed}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm leading-relaxed transition-colors',
                      selectedVariation === index ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="spintax-variation"
                      className="mt-1 accent-primary"
                      checked={selectedVariation === index}
                      onChange={() => setSelectedVariation(index)}
                    />
                    <span className="whitespace-pre-wrap">{item.text}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="composer-raw-body">Mensagem</Label>
          <Textarea
            id="composer-raw-body"
            value={rawBody}
            onChange={(e) => setRawBody(e.target.value)}
            placeholder="Digite a mensagem para responder este lead…"
            maxLength={4000}
            rows={4}
          />
          <p className="text-right text-xs text-muted-foreground">{rawBody.length}/4000</p>
          {isColdFirstContact && (
            <p className="text-xs text-muted-foreground">
              Este seria o primeiro contato com este lead — inclua uma forma fácil de sair (ex.: &quot;responda
              SAIR para não receber mais mensagens&quot;).
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="composer-instance">Enviar por</Label>
        {instancesError ? (
          <p className="text-sm text-destructive">{instancesError}</p>
        ) : (
          <Select id="composer-instance" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
            <option value="">Automático (recomendado)</option>
            {instances?.map((instance) => (
              // Não desabilita a opção de propósito: escolher uma instância
              // desconectada ou sem cota é um estado válido de explorar — o
              // envio (e não o seletor) é quem explica o motivo e dá a ação
              // certa (link para reconectar), ver `describeError` acima.
              <option key={instance.id} value={instance.id}>
                {instance.name}
                {instance.status !== 'connected'
                  ? ' — desconectada'
                  : instance.today.remaining === 0
                    ? ' — cota do dia esgotada'
                    : ` — restam ${instance.today.remaining} hoje`}
              </option>
            ))}
          </Select>
        )}
        {connectedInstances.length === 0 && instances && (
          <p className="flex items-center gap-1.5 text-sm text-warning-foreground dark:text-warning">
            <Unplug className="size-3.5" aria-hidden="true" />
            Nenhuma instância conectada —{' '}
            <Link href="/whatsapp" className="underline">
              conecte uma
            </Link>{' '}
            antes de enviar.
          </p>
        )}
      </div>
      </fieldset>

      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" aria-hidden="true" />
          Envios respeitam o horário comercial e a cota diária da instância.
        </p>
        <Button onClick={() => submit()} disabled={!canSubmit}>
          {isSending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
          {isSending ? 'Enviando…' : 'Enviar'}
        </Button>
      </div>

      {templates && templates.length > 0 && mode === 'template' && preview && preview.length > 0 && (
        <p className="sr-only" role="status">
          Variação {selectedVariation + 1} selecionada
        </p>
      )}

      <Badge variant="outline" className="w-fit text-[11px] font-normal text-muted-foreground">
        A mensagem consome a mesma cota e as mesmas regras de horário de uma campanha — não é modo de teste.
      </Badge>
    </div>
  );
}
