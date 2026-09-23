'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getInstanceQr, getInstanceStatus } from '@/lib/api/whatsapp';
import { createQrConnectionController } from '@/lib/qr-connection-controller';
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
 * 🐛 Bug real de produção corrigido em 2026-09-22/23: esta tela fazia poll
 * de 2s em `GET .../qr`, que a cada chamada (re)inicia o pareamento e emite
 * um QR NOVO na Evolution — o código anterior nunca durava tempo
 * suficiente para o operador abrir o WhatsApp e escanear. Ver a nota de bug
 * completa em `lib/services/whatsapp-instances.ts#getWhatsAppInstanceQr`.
 *
 * Correção: `createQrConnectionController` (`lib/qr-connection-controller.ts`,
 * testado isoladamente sem React) separa as duas responsabilidades —
 * sondagem de ESTADO (`.../status`, pura, a cada 2s) e busca de QR (`.../qr`,
 * só ao abrir, quando o código vence, ou sob pedido manual). Este componente
 * só liga o controlador ao estado do React; não tem lógica de agendamento
 * própria.
 */
export function QrCodeDialog({ instanceId, instanceName, open, onOpenChange, onConnected }: QrCodeDialogProps) {
  const [qr, setQr] = useState<InstanceQrResponse | null>(null);
  const [qrError, setQrError] = useState<Error | null>(null);
  const [isFetchingQr, setIsFetchingQr] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const controllerRef = useRef<ReturnType<typeof createQrConnectionController> | null>(null);

  useEffect(() => {
    if (!open) {
      setQr(null);
      setQrError(null);
      setSecondsLeft(null);
      setIsConnected(false);
      return;
    }

    setIsFetchingQr(true);
    const controller = createQrConnectionController(
      { fetchQr: () => getInstanceQr(instanceId), fetchStatus: () => getInstanceStatus(instanceId) },
      {
        onQr: (res) => {
          setIsFetchingQr(false);
          setQr(res);
          setQrError(null);
          if (res.status === 'qr_pending') setSecondsLeft(res.expiresInSeconds);
          if (res.status === 'connected') setIsConnected(true);
        },
        onQrError: (err) => {
          setIsFetchingQr(false);
          setQrError(err);
        },
        onStatus: (res) => {
          if (res.status === 'connected') setIsConnected(true);
        },
      },
    );
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, [open, instanceId]);

  useEffect(() => {
    if (isConnected) onConnected();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // Contador visível de 1 em 1s — só cosmético (a renovação real é
  // controlada pelo controller, independente deste timer).
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => (s !== null ? s - 1 : s)), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  function handleRegenerate() {
    setIsFetchingQr(true);
    controllerRef.current?.regenerateNow();
  }

  const showInitialLoading = isFetchingQr && !qr;

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
          {showInitialLoading && (
            <div className="flex h-64 w-64 items-center justify-center rounded-md border border-dashed border-border">
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Gerando QR Code…" />
            </div>
          )}

          {qrError && !qr && (
            <div className="w-full">
              <ErrorState
                title="Não foi possível gerar o QR Code"
                message={qrError.message}
                onRetry={handleRegenerate}
              />
            </div>
          )}

          {qrError && qr && (
            <Alert variant="warning" className="w-full">
              <AlertDescription>
                Não foi possível renovar o código agora ({qrError.message}). Mostrando o último QR conhecido —
                tentando de novo automaticamente.
              </AlertDescription>
            </Alert>
          )}

          {qr?.status === 'connected' && (
            <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-md border border-success bg-success/10 text-success">
              <CheckCircle2 className="size-10" aria-hidden="true" />
              <p className="text-sm font-medium">Conectado!</p>
            </div>
          )}

          {qr?.status === 'qr_pending' && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- base64 dinâmico vindo da API, não é um asset estático */}
              <img
                src={
                  qr.qrCodeBase64.startsWith('data:') ? qr.qrCodeBase64 : `data:image/png;base64,${qr.qrCodeBase64}`
                }
                alt="QR Code para conectar o WhatsApp"
                className="size-64 rounded-md border border-border"
              />
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {isFetchingQr
                  ? 'Gerando um novo código…'
                  : secondsLeft !== null && secondsLeft > 0
                    ? `Expira em ${secondsLeft}s — um novo código é gerado automaticamente.`
                    : 'Gerando um novo código…'}
              </p>
            </>
          )}

          <Button type="button" variant="outline" size="sm" onClick={handleRegenerate} disabled={isFetchingQr}>
            {isFetchingQr ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw />}
            Gerar novo QR agora
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
