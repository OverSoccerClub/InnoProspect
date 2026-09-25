/**
 * lib/dispatch-state.ts — 🆕 Fase 4.F.3: leitura E escrita (do lado do web) do
 * freio global do motor de disparo (ARQUITETURA §6.8.9/§4.10). Diferente de
 * `lib/queue-state.ts` (scrape): lá o WORKER decide pausar (sanidade/erro de
 * coleta) e o web só lê/limpa; aqui é o OPERADOR, pela tela, quem decide
 * pausar/retomar — então `apps/web` precisa poder ESCREVER a chave também,
 * não só ler.
 *
 * 🔒 SEMÂNTICA INVERTIDA DE PROPÓSITO (ARQUITETURA §6.8.9, ver o mesmo aviso
 * em `apps/worker/src/lib/dispatch-state.ts`): ausência da chave de "motor
 * ligado" = PAUSADO. Contrário do scraper. NÃO alinhar as duas semânticas
 * num refactor futuro — é o comportamento pretendido, não uma inconsistência.
 *
 * Leituras são "fail-soft" (nunca lançam — mesma regra de `queue-state.ts`,
 * para `GET /api/v1/dispatch/queue` continuar respondendo com o Redis fora
 * do ar). ESCRITAS (pausar/retomar) LANÇAM em erro real de Redis — quem
 * chama (`lib/services/dispatch.ts`) está executando uma AÇÃO explícita do
 * operador e precisa saber se ela falhou, não receber um 200 mentiroso.
 */
import { getDispatchTickQueue } from './dispatch-queue';

export const DISPATCH_ENABLED_META_KEY = 'inno:dispatch:queue:enabled-meta';
/**
 * 🆕 Registro de QUEM pausou e QUANDO — chave SEPARADA, e ela existe por uma
 * razão estrutural, não por capricho: com a semântica invertida (§6.8.9),
 * "pausado" é a AUSÊNCIA de `DISPATCH_ENABLED_META_KEY`, e ausência não
 * carrega dado nenhum. Não havia onde gravar a autoria da pausa. O resultado
 * era uma assimetria que a Lyra achou ao construir a tela: retomar ficava
 * registrado (`enabledBy`), pausar não — e "por que isso está pausado?" é a
 * PRIMEIRA pergunta de quem chega depois, às duas da manhã, sem contexto.
 *
 * Esta chave é puramente informativa: ela NUNCA decide se o motor está
 * rodando (quem decide é a ausência/presença da outra). Só é lida quando o
 * motor está pausado, e é limpa ao retomar — um `pausedBy` sobrevivendo a um
 * `resume` faria a tela contar uma história velha como se fosse a atual.
 */
export const DISPATCH_PAUSED_META_KEY = 'inno:dispatch:queue:paused-meta';
export const DISPATCH_TICK_HEARTBEAT_KEY = 'inno:dispatch:tick:heartbeat';
/** Folga de 3x o intervalo de gravação (`DISPATCH_HEARTBEAT_INTERVAL_MS` = 15s no worker) — mesmo raciocínio do heartbeat geral do worker. */
export const DISPATCH_HEARTBEAT_TTL_SECONDS = 45;

export type DispatchEnabledMeta = {
  enabledAt: string;
  enabledBy: string;
};

export type DispatchPausedMeta = {
  pausedAt: string;
  pausedBy: string;
  /** Opcional — quem pausa pela TELA não digita nada (a pausa é um clique, por desenho §6.8.9); quem chama a API pode explicar. */
  reason?: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Redis não respondeu em ${ms}ms.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Mesma proteção de `lib/queue-state.ts#getClientOrNull` — timeout curto para o Redis totalmente inacessível não travar a rota. */
async function getClientOrNull(timeoutMs = 2000) {
  try {
    return await withTimeout(getDispatchTickQueue().client, timeoutMs);
  } catch {
    return null;
  }
}

/** Fail-soft: `null` tanto para "pausado" quanto para "não consegui perguntar ao Redis" — o chamador (`getDispatchQueueStatus`) distingue os dois casos separadamente (ver `redisReachable` lá). */
export async function readDispatchEnabledMeta(): Promise<DispatchEnabledMeta | null> {
  const client = await getClientOrNull();
  if (!client) return null;
  try {
    const raw = await withTimeout(client.get(DISPATCH_ENABLED_META_KEY), 2000);
    if (!raw) return null;
    return JSON.parse(raw) as DispatchEnabledMeta;
  } catch {
    return null;
  }
}

export async function readDispatchTickHeartbeat(): Promise<{ lastTickAt: string; ageSeconds: number } | null> {
  const client = await getClientOrNull();
  if (!client) return null;
  try {
    const raw = await withTimeout(client.get(DISPATCH_TICK_HEARTBEAT_KEY), 2000);
    if (!raw) return null;
    const ageSeconds = (Date.now() - new Date(raw).getTime()) / 1000;
    if (!Number.isFinite(ageSeconds)) return null;
    return { lastTickAt: raw, ageSeconds };
  } catch {
    return null;
  }
}

/**
 * LANÇA em falha real de Redis (ver comentário do cabeçalho) — `pauseDispatchQueue`/
 * `resumeDispatchQueue` (`lib/services/dispatch.ts`) decidem o que fazer com
 * o erro (hoje: deixa borbulhar para `apiRoute` virar `500`, que é honesto:
 * a ação pedida pelo operador NÃO aconteceu).
 */
export async function writeDispatchEnabledMeta(meta: DispatchEnabledMeta): Promise<void> {
  const client = await getDispatchTickQueue().client;
  await client.set(DISPATCH_ENABLED_META_KEY, JSON.stringify(meta));
}

export async function clearDispatchEnabledMeta(): Promise<void> {
  const client = await getDispatchTickQueue().client;
  await client.del(DISPATCH_ENABLED_META_KEY);
}

/** Fail-soft, igual à leitura do `enabled` — informação de auditoria nunca pode derrubar `GET /dispatch/queue`. */
export async function readDispatchPausedMeta(): Promise<DispatchPausedMeta | null> {
  const client = await getClientOrNull();
  if (!client) return null;
  try {
    const raw = await withTimeout(client.get(DISPATCH_PAUSED_META_KEY), 2000);
    if (!raw) return null;
    return JSON.parse(raw) as DispatchPausedMeta;
  } catch {
    return null;
  }
}

/**
 * Gravada DEPOIS de `clearDispatchEnabledMeta` (ver `pauseDispatchQueue`): se
 * esta escrita falhar, o motor já está parado — perder a autoria é ruim,
 * deixar o motor rodando seria pior. A ordem codifica essa prioridade.
 */
export async function writeDispatchPausedMeta(meta: DispatchPausedMeta): Promise<void> {
  const client = await getDispatchTickQueue().client;
  await client.set(DISPATCH_PAUSED_META_KEY, JSON.stringify(meta));
}

export async function clearDispatchPausedMeta(): Promise<void> {
  const client = await getDispatchTickQueue().client;
  await client.del(DISPATCH_PAUSED_META_KEY);
}
