/**
 * qr-connection-controller.test.ts — cobre a correção do bug real de
 * produção (2026-09-23): poll de estado nunca deve buscar QR novo, e a
 * busca de QR só deve se repetir quando o código atual vence (ou sob pedido
 * manual). Timers falsos (`vi.useFakeTimers`) porque o controlador agenda
 * `setTimeout` de verdade — mesmo padrão de
 * `packages/messaging/src/client/evolution-client.test.ts`
 * (ver memória `bug-vitest-fake-timers-retry-backoff`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQrConnectionController } from './qr-connection-controller';
import type { InstanceQrResponse, InstanceStatusResponse } from '@/types/whatsapp';

function qrPending(expiresInSeconds: number): InstanceQrResponse {
  return { status: 'qr_pending', qrCodeBase64: 'base64', expiresInSeconds };
}

function qrConnected(): InstanceQrResponse {
  return { status: 'connected', qrCodeBase64: null };
}

function status(s: InstanceStatusResponse['status']): InstanceStatusResponse {
  return { status: s };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createQrConnectionController', () => {
  it('sonda o estado a cada statusIntervalMs SEM nunca chamar fetchQr — o bug era exatamente isto', async () => {
    const fetchQr = vi.fn(async () => qrPending(60));
    const fetchStatus = vi.fn(async () => status('qr_pending'));
    const onQr = vi.fn();
    const onQrError = vi.fn();
    const onStatus = vi.fn();

    const controller = createQrConnectionController(
      { fetchQr, fetchStatus, statusIntervalMs: 2000 },
      { onQr, onQrError, onStatus },
    );
    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchQr).toHaveBeenCalledTimes(1); // busca inicial do QR, uma vez.
    expect(fetchStatus).toHaveBeenCalledTimes(1); // e a primeira sondagem de estado.

    // 10 sondagens de estado (20s) — bem menos que os 60s de validade do QR.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }

    expect(fetchStatus).toHaveBeenCalledTimes(11);
    expect(fetchQr).toHaveBeenCalledTimes(1); // continua UMA vez só — o poll de estado nunca dispara o QR.

    controller.stop();
  });

  it('só busca QR novo quando o `expiresInSeconds` da resposta anterior vence, nunca antes', async () => {
    const fetchQr = vi.fn(async () => qrPending(60));
    const fetchStatus = vi.fn(async () => status('qr_pending'));
    const onQr = vi.fn();

    const controller = createQrConnectionController(
      { fetchQr, fetchStatus },
      { onQr, onQrError: vi.fn(), onStatus: vi.fn() },
    );
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchQr).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchQr).toHaveBeenCalledTimes(1); // ainda dentro da validade — não renovou antes da hora.

    await vi.advanceTimersByTimeAsync(1_000); // completa os 60s.
    expect(fetchQr).toHaveBeenCalledTimes(2);
    expect(onQr).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('regenerateNow cancela a renovação agendada e busca um QR novo imediatamente', async () => {
    const fetchQr = vi.fn(async () => qrPending(60));
    const controller = createQrConnectionController(
      { fetchQr, fetchStatus: vi.fn(async () => status('qr_pending')) },
      { onQr: vi.fn(), onQrError: vi.fn(), onStatus: vi.fn() },
    );
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchQr).toHaveBeenCalledTimes(1);

    controller.regenerateNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchQr).toHaveBeenCalledTimes(2); // veio do clique, não do timer de 60s.

    // O timer de 60s antigo foi cancelado — avançar até lá não soma uma
    // terceira chamada vinda dele; só a renovação agendada a partir do
    // `regenerateNow` (mais 60s) deve disparar.
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchQr).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchQr).toHaveBeenCalledTimes(3);

    controller.stop();
  });

  it('detecta a transição para connected pelo poll de status e para de sondar', async () => {
    let call = 0;
    const fetchStatus = vi.fn(async () => {
      call += 1;
      return status(call >= 3 ? 'connected' : 'qr_pending');
    });
    const onStatus = vi.fn();

    const controller = createQrConnectionController(
      { fetchQr: vi.fn(async () => qrPending(60)), fetchStatus, statusIntervalMs: 2000 },
      { onQr: vi.fn(), onQrError: vi.fn(), onStatus },
    );
    controller.start();
    await vi.advanceTimersByTimeAsync(0); // chamada 1: qr_pending
    await vi.advanceTimersByTimeAsync(2000); // chamada 2: qr_pending
    await vi.advanceTimersByTimeAsync(2000); // chamada 3: connected

    expect(onStatus).toHaveBeenLastCalledWith(status('connected'));
    expect(fetchStatus).toHaveBeenCalledTimes(3);

    // Depois de `connected`, nenhuma nova sondagem é agendada.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchStatus).toHaveBeenCalledTimes(3);

    controller.stop();
  });

  it('detecta a transição para connected também pela resposta do próprio fetchQr, e para de renovar', async () => {
    const fetchQr = vi.fn(async () => qrConnected());
    const onQr = vi.fn();

    const controller = createQrConnectionController(
      { fetchQr, fetchStatus: vi.fn(async () => status('connecting')) },
      { onQr, onQrError: vi.fn(), onStatus: vi.fn() },
    );
    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onQr).toHaveBeenCalledWith(qrConnected());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchQr).toHaveBeenCalledTimes(1); // `connected` não reagenda renovação.

    controller.stop();
  });

  it('em erro ao buscar QR, chama onQrError e tenta de novo depois de qrErrorRetryMs — nunca desiste sozinho', async () => {
    const err = new Error('Evolution fora do ar');
    const fetchQr = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(qrPending(60));
    const onQrError = vi.fn();

    const controller = createQrConnectionController(
      { fetchQr, fetchStatus: vi.fn(async () => status('qr_pending')), qrErrorRetryMs: 5000 },
      { onQr: vi.fn(), onQrError, onStatus: vi.fn() },
    );
    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onQrError).toHaveBeenCalledWith(err);
    expect(fetchQr).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchQr).toHaveBeenCalledTimes(1); // ainda dentro do backoff de erro.

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchQr).toHaveBeenCalledTimes(2); // tentou de novo.

    controller.stop();
  });

  it('stop() cancela tudo — nenhuma chamada nova depois, mesmo avançando o relógio', async () => {
    const fetchQr = vi.fn(async () => qrPending(60));
    const fetchStatus = vi.fn(async () => status('qr_pending'));

    const controller = createQrConnectionController(
      { fetchQr, fetchStatus, statusIntervalMs: 2000 },
      { onQr: vi.fn(), onQrError: vi.fn(), onStatus: vi.fn() },
    );
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.stop();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchQr).toHaveBeenCalledTimes(1);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});
