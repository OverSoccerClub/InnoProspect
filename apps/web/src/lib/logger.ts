/**
 * lib/logger.ts — logger estruturado do processo `apps/web` (Route
 * Handlers). Saída em JSON (1 linha por evento) para bater com o padrão de
 * observabilidade do `apps/worker` (`pino`) sem trazer `pino`/`pino-pretty`
 * para o bundle do Next.js — o transport do pino roda em worker_threads e é
 * uma fonte conhecida de dor de bundling em apps Next (resolução de caminho
 * do transport quebra em build standalone). `console` com JSON estruturado
 * resolve o mesmo problema (log grepável/parseável por ferramenta de
 * observabilidade) sem esse risco.
 *
 * ⚠️ NUNCA logar segredo, senha, token, `passwordHash` nem dado pessoal de
 * lead (telefone/endereço/nome) em texto livre — só id/contagem.
 */
type LogFields = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', message: string, fields?: LogFields): void {
  const entry = {
    level,
    time: new Date().toISOString(),
    app: 'web',
    msg: message,
    ...fields,
  };
  const line = JSON.stringify(entry, (_key, value) => (value instanceof Error ? serializeError(value) : value));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function serializeError(err: Error) {
  return { name: err.name, message: err.message, stack: err.stack };
}

export const logger = {
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
};
