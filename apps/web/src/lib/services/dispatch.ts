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
  clearDispatchPausedMeta,
  readDispatchEnabledMeta,
  readDispatchPausedMeta,
  readDispatchTickHeartbeat,
  writeDispatchEnabledMeta,
  writeDispatchPausedMeta,
} from '@/lib/dispatch-state';

export type DispatchQueueStatusView = {
  status: 'paused' | 'running';
  enabledAt: string | null;
  enabledBy: string | null;
  /** `null` sem nenhum heartbeat ainda (worker nunca subiu) — distinto de `lastTickAt` antigo (worker caiu). A rota não decide "morto"; devolve o dado bruto para a tela decidir a cor do sinal. */
  lastTickAt: string | null;
  tickAgeSeconds: number | null;
  /** Só preenchidos quando `status === 'paused'` — ver `DISPATCH_PAUSED_META_KEY`. `null` numa pausa também significa "pausado antes desta funcionalidade existir", ou Redis limpo (o motor NASCE pausado, e nesse caso não houve ninguém a registrar). */
  pausedAt: string | null;
  pausedBy: string | null;
  pausedReason: string | null;
};

/**
 * `redisReachable: false` (Redis fora do ar) cai no MESMO status que
 * "pausado" — não porque sabemos que está pausado, mas porque não sabemos
 * se está rodando, e "não sabemos" tem que resolver para o lado seguro
 * (ARQUITETURA §8.0 regra 4), igual à semântica de "ausência = pausado" já é.
 */
export async function getDispatchQueueStatus(): Promise<DispatchQueueStatusView> {
  const [meta, heartbeat, pausedMeta] = await Promise.all([
    readDispatchEnabledMeta(),
    readDispatchTickHeartbeat(),
    readDispatchPausedMeta(),
  ]);

  const status = meta ? 'running' : 'paused';

  return {
    status,
    enabledAt: meta?.enabledAt ?? null,
    enabledBy: meta?.enabledBy ?? null,
    lastTickAt: heartbeat?.lastTickAt ?? null,
    tickAgeSeconds: heartbeat ? Math.round(heartbeat.ageSeconds) : null,
    // Só faz sentido enquanto PARADO. Rodando, a autoria da última pausa é
    // história — e história exibida como se fosse o estado atual é o mesmo
    // defeito que a reconciliação de instância consertou ontem.
    pausedAt: status === 'paused' ? (pausedMeta?.pausedAt ?? null) : null,
    pausedBy: status === 'paused' ? (pausedMeta?.pausedBy ?? null) : null,
    pausedReason: status === 'paused' ? (pausedMeta?.reason ?? null) : null,
  };
}

/**
 * `POST /api/v1/dispatch/queue` — pausa manual (o botão de incidente). Sem
 * `acknowledge`: é a ação de PARAR, precisa funcionar num clique.
 *
 * `reason` é OPCIONAL e continua opcional de propósito: exigir justificativa
 * para parar transformaria o botão de incidente num formulário, que é
 * exatamente o que a §6.8.9 diz para não fazer. Quem pausa pela tela não
 * digita nada; a autoria (`pausedBy`) é capturada da sessão de qualquer
 * forma, e já responde a maior parte de "por que isso está pausado?".
 */
export async function pauseDispatchQueue(
  actor: { id: string; email?: string | null },
  reason?: string,
): Promise<{ ok: true; status: 'paused' }> {
  const meta = await readDispatchEnabledMeta();
  if (!meta) {
    conflict('O motor de disparo já está pausado — não há o que pausar.');
  }
  // PARAR primeiro. A autoria é registrada depois porque ela é informação; o
  // motor parado é o objetivo. Ver o comentário de `writeDispatchPausedMeta`.
  await clearDispatchEnabledMeta();
  await writeDispatchPausedMeta({
    pausedAt: new Date().toISOString(),
    pausedBy: actor.email ?? actor.id,
    ...(reason ? { reason } : {}),
  });
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
  // Limpa a autoria da pausa anterior: mantê-la faria a tela, no próximo
  // ciclo de pausa, poder exibir quem parou da vez PASSADA como se fosse
  // agora. Falha aqui não desfaz o resume (o motor já está rodando) — por
  // isso não é `await` dentro de transação nenhuma, é limpeza best-effort.
  await clearDispatchPausedMeta();
  return { ok: true, status: 'running', enabledAt };
}
