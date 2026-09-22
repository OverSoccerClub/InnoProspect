// TODO: trocar por import de @inno/contracts quando o Vega publicar (ARQUITETURA.md §4.0)

export type Paginated<T> = {
  data: T[];
  page: {
    cursor: string | null;
    nextCursor: string | null;
    limit: number;
    total: number;
  };
};

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    /**
     * Sub-código SCREAMING_SNAKE, legível por máquina (ARQUITETURA.md §4.0,
     * "CONTRATO ALTERADO na v1.1"). É o único campo em que se pode ramificar
     * lógica de UI — nunca `message` (texto livre em pt-BR, pode mudar).
     * O conjunto de valores é fechado por rota (ex.: §4.9.7 para envio de mensagem).
     */
    reason?: string;
    message: string;
    /**
     * Erro de campo (validação) usa `path` = nome do campo. Regra de negócio
     * usa `details[]` também para "meta" pontual (ex.: `DAILY_LIMIT_REACHED`
     * → `{ path: 'resetsAt', message: '<ISO>' }`) — confirmado lendo
     * `lib/services/messages.ts#throwForBlockedVerdict` (Vega, 2026-09-22):
     * `resetsAt`, `nextWindowOpensAt`, `optedOutAt` viajam em `details[]`,
     * não num campo `meta` separado (hipótese anterior, descartada).
     */
    details?: Array<{ path: string; message: string }>;
    requestId: string;
  };
};
