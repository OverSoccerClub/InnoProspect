/**
 * observability/logger.ts — logger estruturado (pino) do processo worker.
 * Ver ARQUITETURA §1.2 (worker é processo separado, tem sua própria
 * observabilidade) e a regra de ouro de segurança: NUNCA logar segredo,
 * senha, token ou dado pessoal sensível (telefone/endereço de lead entram só
 * como contagem/ids, nunca o valor bruto).
 */
import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'worker' },
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

export type Logger = typeof logger;
