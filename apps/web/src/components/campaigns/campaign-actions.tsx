'use client';

import { useState } from 'react';
import { AlertOctagon, Loader2, Pause, Play, ShieldAlert, XCircle } from 'lucide-react';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { cancelCampaign, pauseCampaign, resumeCampaign, startCampaign } from '@/lib/api/campaigns';
import { ApiRequestError } from '@/lib/fetcher';
import type { CampaignDetail } from '@/types/campaign';

function describeActionError(err: ApiRequestError): string {
  switch (err.reason) {
    case 'INSTANCE_NOT_CONNECTED': {
      const detailMsg = err.details?.map((d) => d.message).join(' ');
      return detailMsg ? `${err.message} ${detailMsg}` : err.message;
    }
    case 'INSUFFICIENT_TEXT_VARIATION':
      return err.message;
    case 'EMPTY_AUDIENCE':
      return err.message;
    case 'HALT_NOT_ACKNOWLEDGED':
      return err.message;
    case 'INVALID_CAMPAIGN_TRANSITION':
      return err.message;
    default:
      return err.message;
  }
}

/**
 * Ações de ciclo de vida (ARQUITETURA §4.5.9) — cada uma só aparece quando o
 * status atual permite (mostrar um botão "Iniciar" numa campanha já
 * `running` seria pior que escondê-lo). `resume` de `halted` SEMPRE passa
 * por confirmação explícita com `acknowledgeHalt: true` — é a diferença
 * documentada entre `paused` (decisão humana) e `halted` (incidente que
 * exige reconhecer o motivo antes de seguir, DESIGN-SYSTEM.md §5.3).
 */
export function CampaignActions({ campaign, onChanged }: { campaign: CampaignDetail; onChanged: () => void }) {
  const [pendingCancel, setPendingCancel] = useState(false);
  const [pendingResumeHalt, setPendingResumeHalt] = useState(false);
  const [busy, setBusy] = useState<'start' | 'pause' | 'resume' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: 'start' | 'pause' | 'resume' | 'cancel', fn: () => Promise<unknown>) {
    setError(null);
    setBusy(action);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? describeActionError(err) : 'Não foi possível concluir a ação agora.');
    } finally {
      setBusy(null);
      setPendingCancel(false);
      setPendingResumeHalt(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {(campaign.status === 'draft' || campaign.status === 'scheduled') && (
          <Button size="sm" onClick={() => run('start', () => startCampaign(campaign.id))} disabled={busy !== null}>
            {busy === 'start' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play />}
            Iniciar campanha
          </Button>
        )}

        {campaign.status === 'running' && (
          <Button variant="outline" size="sm" onClick={() => run('pause', () => pauseCampaign(campaign.id))} disabled={busy !== null}>
            {busy === 'pause' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Pause />}
            Pausar
          </Button>
        )}

        {campaign.status === 'paused' && (
          <Button size="sm" onClick={() => run('resume', () => resumeCampaign(campaign.id, {}))} disabled={busy !== null}>
            {busy === 'resume' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play />}
            Retomar
          </Button>
        )}

        {campaign.status === 'halted' && (
          <Button variant="outline" size="sm" onClick={() => setPendingResumeHalt(true)} disabled={busy !== null}>
            <ShieldAlert />
            Revisar e retomar
          </Button>
        )}

        {(campaign.status === 'draft' ||
          campaign.status === 'scheduled' ||
          campaign.status === 'running' ||
          campaign.status === 'paused' ||
          campaign.status === 'halted') && (
          <Button variant="destructive" size="sm" onClick={() => setPendingCancel(true)} disabled={busy !== null}>
            <XCircle />
            Cancelar campanha
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={pendingCancel}
        onOpenChange={setPendingCancel}
        title="Cancelar esta campanha?"
        description="É irreversível: os alvos que ainda estão na fila viram 'pulado' e não recebem mensagem. Quem já recebeu continua no histórico normalmente."
        confirmLabel="Cancelar campanha"
        onConfirm={() => run('cancel', () => cancelCampaign(campaign.id))}
        errorMessage={error}
      />

      <ConfirmDialog
        open={pendingResumeHalt}
        onOpenChange={setPendingResumeHalt}
        title="Retomar depois de uma parada automática"
        description={
          <>
            Esta campanha parou sozinha por segurança:
            <span className="mt-2 flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
              <AlertOctagon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {campaign.haltReason ?? 'Motivo não registrado.'}
            </span>
            <span className="mt-2 block">
              Confirme que já investigou a causa antes de retomar — se ela ainda estiver de pé (ex.: instância ainda desconectada), a campanha vai
              recusar de novo.
            </span>
          </>
        }
        confirmLabel="Já revisei, retomar"
        confirmVariant="outline"
        onConfirm={() => run('resume', () => resumeCampaign(campaign.id, { acknowledgeHalt: true }))}
        errorMessage={error}
      />
    </div>
  );
}
