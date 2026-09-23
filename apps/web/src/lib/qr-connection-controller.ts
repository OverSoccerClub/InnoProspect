/**
 * qr-connection-controller.ts — orquestra as duas responsabilidades do modal
 * de conexão de WhatsApp (`components/whatsapp/qr-code-dialog.tsx`), sem
 * acoplar a React (testável com timers falsos, sem precisar montar
 * componente — ver `qr-connection-controller.test.ts`).
 *
 * Nasceu de um bug real de produção (2026-09-23): a tela fazia poll de 2s
 * direto em `GET .../qr`, que a cada chamada (re)inicia o pareamento na
 * Evolution e emite um QR novo — o código nunca durava tempo suficiente
 * para ser escaneado. A correção separa:
 *
 * - `status`: sondado a cada `statusIntervalMs` via `fetchStatus`
 *   (`GET .../status` → `EvolutionClient.getConnectionState`, leitura pura)
 *   — só para saber a hora de fechar o modal. Nunca dispara `fetchQr`.
 * - `qr`: buscado uma vez em `start()` e reagendado só quando o QR atual
 *   VENCE, segundo o `expiresInSeconds` que a própria resposta trouxe (nunca
 *   um número fixo re-adivinhado aqui), ou sob demanda via `regenerateNow()`
 *   (botão "Gerar novo QR agora").
 *
 * NÃO reintroduzir um poll de intervalo curto e fixo contra `fetchQr` — é
 * exatamente como o bug nasceu.
 */
import type { InstanceQrResponse, InstanceStatusResponse } from '@/types/whatsapp';

export type QrConnectionCallbacks = {
  /** Toda resposta (sucesso) de `fetchQr`, inclusive `status: 'connected'` (a Evolution pode confirmar o pareamento na própria chamada de `connect`, antes do próximo tick do poll de status). */
  onQr: (qr: InstanceQrResponse) => void;
  /** `fetchQr` falhou — quem chama decide o que mostrar (mantém o último QR bom, ou erro se nunca teve nenhum). Nunca interrompe o reagendamento: uma nova tentativa é sempre agendada. */
  onQrError: (error: Error) => void;
  /** Toda resposta (sucesso) de `fetchStatus`. */
  onStatus: (status: InstanceStatusResponse) => void;
};

export type QrConnectionDeps = {
  /** `GET .../qr` — (re)inicia o pareamento, SEMPRE emite QR novo. */
  fetchQr: () => Promise<InstanceQrResponse>;
  /** `GET .../status` — leitura pura, seguro sondar com frequência. */
  fetchStatus: () => Promise<InstanceStatusResponse>;
  /** ms entre sondagens de estado (padrão 2000 — mesma cadência que já existia na tela antes do bug, agora contra o endpoint certo). */
  statusIntervalMs?: number;
  /** ms de espera antes de tentar de novo depois de uma falha ao buscar QR — NÃO é a renovação por vencimento, é só não desistir diante de erro transitório (padrão 5000). */
  qrErrorRetryMs?: number;
};

export type QrConnectionController = {
  /** Dispara a primeira busca de QR e o primeiro poll de status; agenda os dois adiante. */
  start: () => void;
  /** Cancela tudo que estiver agendado — chamar ao fechar o modal/desmontar. */
  stop: () => void;
  /** Cancela a renovação agendada do QR e busca um novo AGORA (botão manual). */
  regenerateNow: () => void;
};

export function createQrConnectionController(
  deps: QrConnectionDeps,
  callbacks: QrConnectionCallbacks,
): QrConnectionController {
  const { fetchQr, fetchStatus, statusIntervalMs = 2000, qrErrorRetryMs = 5000 } = deps;

  let stopped = true;
  let qrTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let statusTimeoutId: ReturnType<typeof setTimeout> | undefined;

  async function runQr(): Promise<void> {
    if (stopped) return;
    try {
      const res = await fetchQr();
      if (stopped) return;
      callbacks.onQr(res);
      // `status: 'connected'` não reagenda — já pareou, não há QR novo para
      // buscar depois disto.
      if (res.status === 'qr_pending') {
        qrTimeoutId = setTimeout(runQr, res.expiresInSeconds * 1000);
      }
    } catch (err) {
      if (stopped) return;
      callbacks.onQrError(err instanceof Error ? err : new Error('Falha ao gerar o QR Code.'));
      qrTimeoutId = setTimeout(runQr, qrErrorRetryMs);
    }
  }

  async function runStatus(): Promise<void> {
    if (stopped) return;
    try {
      const res = await fetchStatus();
      if (stopped) return;
      callbacks.onStatus(res);
      if (res.status === 'connected') return; // pareou — para de sondar estado.
    } catch {
      // Erro transitório de status: silencioso de propósito (quem quer
      // saber de falha é o `fetchQr`, via `onQrError`) — só tenta de novo no
      // próximo tick, no mesmo intervalo.
    }
    if (!stopped) statusTimeoutId = setTimeout(runStatus, statusIntervalMs);
  }

  function start(): void {
    stopped = false;
    void runQr();
    void runStatus();
  }

  function stop(): void {
    stopped = true;
    if (qrTimeoutId) clearTimeout(qrTimeoutId);
    if (statusTimeoutId) clearTimeout(statusTimeoutId);
  }

  function regenerateNow(): void {
    if (stopped) return;
    if (qrTimeoutId) clearTimeout(qrTimeoutId);
    void runQr();
  }

  return { start, stop, regenerateNow };
}
