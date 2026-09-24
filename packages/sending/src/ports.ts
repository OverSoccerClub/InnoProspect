/**
 * ports.ts — as ÚNICAS portas que `executeSendAttempt` aceita (ARQUITETURA
 * §6.8.0.3): `prisma`, `evolutionClient`, `logger`, `notify`, e os opcionais
 * `now`/`rng` para teste determinístico. Nada além disso é injetado — toda
 * porta extra é um lugar onde `apps/web` e `apps/worker` podem se comportar
 * diferente, que é exatamente o que este pacote existe para impedir.
 *
 * `prisma` PODERIA ser importado direto de `@inno/db` (mesmo singleton nos
 * dois processos) — entra como porta só para o teste (`messages.test.ts`)
 * poder passar o fake Prisma que já tem, sem depender de
 * `vi.mock('@inno/db', ...)` atravessar a fronteira do pacote (não
 * comprovado que funcione de forma confiável em todo setup do vitest do
 * monorepo — a porta elimina a dúvida).
 *
 * `logger`/`notify` são portas porque `apps/web` e `apps/worker` têm
 * implementações PRÓPRIAS e deliberadamente duplicadas (`console` JSON vs
 * `pino`; vocabulário de alerta ligeiramente diferente) — ver
 * `apps/web/src/lib/logger.ts`/`lib/alerts.ts` e
 * `apps/worker/src/observability/logger.ts`/`alerts.ts`. Este pacote NUNCA
 * importa nenhum dos quatro arquivos.
 */
import type { EvolutionClient, SendTextInput, SendTextResult } from '@inno/messaging';
import type { PrismaClient } from '@inno/db';

export type { SendTextInput, SendTextResult };

/** Só o método que este pacote de fato chama — nunca o `EvolutionClient` inteiro (menor acoplamento ao cliente HTTP concreto; o chamador resolve QUAL cliente/servidor usar, ARQUITETURA §6.8.0.3). */
export type SendTextClient = Pick<EvolutionClient, 'sendText'>;

export type SendingLogFields = Record<string, unknown>;

/**
 * Mesma ordem de `apps/web/src/lib/logger.ts` (mensagem primeiro, campos
 * depois). `apps/worker` usa `pino`, cuja convenção é a ordem INVERSA
 * (`logger.info(fields, mensagem)`) — quando o motor (Fase 4.F.4) ligar este
 * pacote, o adaptador do LADO DO WORKER inverte a ordem; este pacote não
 * escolhe por nenhum dos dois.
 */
export type SendingLogger = {
  info(message: string, fields?: SendingLogFields): void;
  warn(message: string, fields?: SendingLogFields): void;
  error(message: string, fields?: SendingLogFields): void;
};

/**
 * Mesmo shape de `AlertEvent` (`apps/web/src/lib/alerts.ts` /
 * `apps/worker/src/observability/alerts.ts`) — fecha nos 4 tipos que a
 * sequência protegida de fato dispara. Este pacote nunca importa nenhum dos
 * dois módulos de alerta, só recebe a função pronta (`deps.notify`).
 */
export type SendNotifyEvent =
  | { kind: 'instance_disconnected'; instanceId: string; instanceName: string | null; reason: 'banned' | 'disconnected'; message: string }
  | { kind: 'instance_degraded'; instanceId: string; instanceName: string | null; consecutiveFailures: number; threshold: number }
  | { kind: 'campaign_halted'; campaignIds: string[]; instanceId: string }
  | { kind: 'evolution_api_error'; action: string; code: string };

export type SendingNotify = (event: SendNotifyEvent) => void | Promise<void>;

export type SendingRandomSource = () => number;

export type SendAttemptDeps = {
  prisma: PrismaClient;
  evolutionClient: SendTextClient;
  logger: SendingLogger;
  notify: SendingNotify;
  /** Default `() => new Date()` — testes de expiração de decisão injetam um relógio fixo, sem esperar de verdade. */
  now?: () => Date;
  /** Default `Math.random` (via `@inno/core`) — testes de distribuição de jitter injetam um RNG determinístico. */
  rng?: SendingRandomSource;
};
