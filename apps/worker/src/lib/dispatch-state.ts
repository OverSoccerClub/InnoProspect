/**
 * lib/dispatch-state.ts — 🆕 Fase 4.F.3: o freio do motor de disparo
 * (ARQUITETURA §6.8.9/§4.10), construído ANTES do tick existir (§8 Fase 4.F,
 * "o freio é construído antes do acelerador"). Mesmo padrão de
 * `lib/queue-state.ts` (estado operacional que precisa sobreviver a um
 * restart do processo vai para o Redis que o BullMQ já usa, via
 * `Queue#client` — nunca um `ioredis` próprio, ver
 * `[[bug-bullmq-client-not-ioredis]]` pela assinatura certa).
 *
 * 🔒 SEMÂNTICA INVERTIDA DE PROPÓSITO (ARQUITETURA §6.8.9): ausência da chave
 * `DISPATCH_ENABLED_META_KEY` no Redis = motor PAUSADO. É o CONTRÁRIO do
 * scraper (`SCRAPE_QUEUE_PAUSE_META_KEY`, onde ausência = fila RODANDO). A
 * inversão é deliberada — o motor é a primeira coisa deste sistema que age
 * sem ninguém olhando (§6.8.8), e um Redis limpo (volátil por desenho, §1.3)
 * precisa devolver o sistema ao estado *pausado*, nunca ao estado
 * *disparando*. NÃO "corrigir" esta assimetria num refactor futuro achando
 * que é bug de simetria com o scraper — está escrita aqui e no §6.8.9
 * exatamente para isso não acontecer.
 *
 * ⚠️ Chaves duplicadas de propósito com `apps/web/src/lib/dispatch-state.ts`
 * (mesmo contrato de protocolo do nome de fila — `apps/web` não importa
 * `apps/worker`, ARQUITETURA §2). `apps/web` é quem ESCREVE a chave de
 * enabled (o operador paus a/retoma pela tela); `apps/worker` só LÊ (o
 * futuro `dispatch-tick.job`, Fase 4.F.4, vai checar `readDispatchEnabled`
 * antes de processar qualquer alvo) e ESCREVE o heartbeat.
 */
import type { Queue } from 'bullmq';

export const DISPATCH_ENABLED_META_KEY = 'inno:dispatch:queue:enabled-meta';
export const DISPATCH_TICK_HEARTBEAT_KEY = 'inno:dispatch:tick:heartbeat';

/**
 * Intervalo/TTL do heartbeat do tick — mesmos números do heartbeat geral do
 * worker (`queue-state.ts`, `HEARTBEAT_INTERVAL_MS`/`HEARTBEAT_TTL_SECONDS`):
 * 15s de intervalo, TTL de 45s (3x de folga para jitter/GC pause).
 *
 * ✅ Fase 4.F.4 — a promessa acima virou verdade: a gravação MIGROU do
 * `setInterval` de boot (4.F.3) para DENTRO do processor do job
 * (`jobs/dispatch-tick.job.ts#runDispatchTick`, primeira linha,
 * INCONDICIONAL — roda mesmo com o motor pausado). `lastTickAt` agora prova
 * "o tick de fato rodou este ciclo", não só "o processo está de pé" — mesma
 * CHAVE, mesmo leitor (`GET /api/v1/dispatch/queue`), nada mudou do lado de
 * quem lê.
 */
export const DISPATCH_HEARTBEAT_INTERVAL_MS = 15_000;
export const DISPATCH_HEARTBEAT_TTL_SECONDS = 45;

export type DispatchEnabledMeta = {
  enabledAt: string;
  /** E-mail/id de quem clicou em retomar — auditoria simples, sem tabela própria. */
  enabledBy: string;
};

export async function readDispatchEnabledMeta(dispatchQueue: Queue): Promise<DispatchEnabledMeta | null> {
  const client = await dispatchQueue.client;
  const raw = await client.get(DISPATCH_ENABLED_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DispatchEnabledMeta;
  } catch {
    return null;
  }
}

/** `true` só quando a chave existe E é JSON válido — Redis corrompido/parcial conta como "pausado" (default seguro, ARQUITETURA §8.0 regra 4). */
export async function isDispatchEnabled(dispatchQueue: Queue): Promise<boolean> {
  return (await readDispatchEnabledMeta(dispatchQueue)) !== null;
}

export async function recordDispatchTickHeartbeat(dispatchQueue: Queue): Promise<void> {
  const client = await dispatchQueue.client;
  // ⚠️ `'EX', <segundos>` POSICIONAL — nunca `{ EX: ... }` (ver
  // `queue-state.ts#recordHeartbeat`: o cliente real em runtime é `ioredis`,
  // que não aceita objeto de opções nessa sobrecarga).
  const clienteIoredis = client as unknown as {
    set(chave: string, valor: string, modo: 'EX', segundos: number): Promise<unknown>;
  };
  await clienteIoredis.set(DISPATCH_TICK_HEARTBEAT_KEY, new Date().toISOString(), 'EX', DISPATCH_HEARTBEAT_TTL_SECONDS);
}
