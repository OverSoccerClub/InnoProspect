/**
 * lib/services/dispatch.ts — 🆕 Fase 4.F.3: o "botão único do incidente" do
 * motor de disparo (ARQUITETURA §6.8.9). `GET /api/v1/dispatch/queue` (status,
 * qualquer operador autenticado) + `POST /api/v1/dispatch/queue` (pausa —
 * a ação de emergência, sem confirmação, para funcionar em UM clique sob
 * estresse) + `POST /api/v1/dispatch/queue/resume` (liga o motor — a ação de
 * MAIOR risco daqui, por isso exige `{ acknowledge: true }`, mesmo espírito
 * de `resumeScraperQueue`).
 *
 * 🔒 O motor nasce PAUSADO (§6.8.9): ausência da chave no Redis = pausado.
 * Um Redis limpo (restart, deploy novo) devolve o sistema ao estado seguro,
 * nunca ao estado disparando.
 */
import { conflict } from '@/lib/api-handler';
import {
  clearDispatchEnabledMeta,
  readDispatchEnabledMeta,
  readDispatchTickHeartbeat,
  writeDispatchEnabledMeta,
} from '@/lib/dispatch-state';

export type DispatchQueueStatusView = {
  status: 'paused' | 'running';
  enabledAt: string | null;
  enabledBy: string | null;
  /** `null` sem nenhum heartbeat ainda (worker nunca subiu) — distinto de `lastTickAt` antigo (worker caiu). A rota não decide "morto"; devolve o dado bruto para a tela decidir a cor do sinal. */
  lastTickAt: string | null;
  tickAgeSeconds: number | null;
};

/**
 * `redisReachable: false` (Redis fora do ar) cai no MESMO status que
 * "pausado" — não porque sabemos que está pausado, mas porque não sabemos
 * se está rodando, e "não sabemos" tem que resolver para o lado seguro
 * (ARQUITETURA §8.0 regra 4), igual à semântica de "ausência = pausado" já é.
 */
export async function getDispatchQueueStatus(): Promise<DispatchQueueStatusView> {
  const [meta, heartbeat] = await Promise.all([readDispatchEnabledMeta(), readDispatchTickHeartbeat()]);

  return {
    status: meta ? 'running' : 'paused',
    enabledAt: meta?.enabledAt ?? null,
    enabledBy: meta?.enabledBy ?? null,
    lastTickAt: heartbeat?.lastTickAt ?? null,
    tickAgeSeconds: heartbeat ? Math.round(heartbeat.ageSeconds) : null,
  };
}

/** `POST /api/v1/dispatch/queue` — pausa manual (o botão de incidente). Sem `acknowledge`: é a ação de PARAR, precisa funcionar num clique. */
export async function pauseDispatchQueue(): Promise<{ ok: true; status: 'paused' }> {
  const meta = await readDispatchEnabledMeta();
  if (!meta) {
    conflict('O motor de disparo já está pausado — não há o que pausar.');
  }
  await clearDispatchEnabledMeta();
  return { ok: true, status: 'paused' };
}

/** `POST /api/v1/dispatch/queue/resume` — liga/retoma o motor. `actor` fica registrado em `enabledBy` (auditoria simples, sem tabela própria). */
export async function resumeDispatchQueue(actor: { id: string; email?: string | null }): Promise<{ ok: true; status: 'running'; enabledAt: string }> {
  const meta = await readDispatchEnabledMeta();
  if (meta) {
    conflict('O motor de disparo já está rodando — não há o que retomar.');
  }
  const enabledAt = new Date().toISOString();
  await writeDispatchEnabledMeta({ enabledAt, enabledBy: actor.email ?? actor.id });
  return { ok: true, status: 'running', enabledAt };
}
