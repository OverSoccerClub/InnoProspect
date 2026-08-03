'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePolling } from '@/hooks/usePolling';
import { connectInstance, getInstanceQr } from '@/lib/api/whatsapp';
import type { InstanceQrResponse } from '@/types/whatsapp';

type QrCodeDialogProps = {
  instanceId: string;
  instanceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** avisa a tela de fora para recarregar a lista (instância mudou de status) */
  onConnected: () => void;
};

/**
 * Poll de 2s em `GET /whatsapp/instances/:id/qr` enquanto o modal estiver
 * aberto (ARQUITETURA.md §4.6: "o QR expira em ~60s e o endpoint devolve um
 * novo automaticamente"). Some sozinho ao conectar; "Gerar novo QR" é o
 * fallback manual pedido no escopo.
 */
export function QrCodeDialog({ instanceId, instanceName, open, onOpenChange, onConnected }: QrCodeDialogProps) {
  const { data, error, isLoading, refetch } = usePolling<InstanceQrResponse>(() => getInstanceQr(instanceId), {
    intervalMs: 2000,
    enabled: open,
    shouldContinue: (res) => res.status !== 'connected',
  });

  const [isRegenerating, setIsRegenerating] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (data?.status === 'qr_pending') setSecondsLeft(data.expiresInSeconds);
  }, [data]);

  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => (s !== null ? s - 1 : s)), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  useEffect(() => {
    if (data?.status === 'connected') onConnected();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);

  async function handleRegenerate() {
    setIsRegenerating(true);
    try {
      await connectInstance(instanceId);
    } finally {
      setIsRegenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar {instanceName}</DialogTitle>
          <DialogDescription>
            Abra o WhatsApp no celular do número que vai enviar mensagens, vá em Aparelhos conectados → Conectar
            aparelho, e aponte a câmera para o QR Code abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {isLoading && !data && (
            <div className="flex h-64 w-64 items-center justify-center rounded-md border border-dashed border-border">
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Gerando QR Code…" />
            </div>
          )}

          {error && !data && (
            <div className="w-full">
              <ErrorState title="Não foi possível carregar o QR Code" message={error.message} onRetry={refetch} />
            </div>
          )}

          {error && data && (
            <Alert variant="warning" className="w-full">
              <AlertDescription>
                Não foi possível atualizar agora ({error.message}). Mostrando o último QR conhecido — tentando de
                novo automaticamente.
              </AlertDescription>
            </Alert>
          )}

          {data?.status === 'connected' && (
            <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-md border border-success bg-success/10 text-success">
              <CheckCircle2 className="size-10" aria-hidden="true" />
              <p className="text-sm font-medium">Conectado!</p>
            </div>
          )}

          {data?.status === 'qr_pending' && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- base64 dinâmico vindo da API, não é um asset estático */}
              <img
                src={
                  data.qrCodeBase64.startsWith('data:') ? data.qrCodeBase64 : `data:image/png;base64,${data.qrCodeBase64}`
                }
                alt="QR Code para conectar o WhatsApp"
                className="size-64 rounded-md border border-border"
              />
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {secondsLeft !== null && secondsLeft > 0
                  ? `Expira em ${secondsLeft}s — um novo código é gerado automaticamente.`
                  : 'Gerando um novo código…'}
              </p>
            </>
          )}

          <Button type="button" variant="outline" size="sm" onClick={handleRegenerate} disabled={isRegenerating}>
            {isRegenerating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw />}
            Gerar novo QR agora
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
