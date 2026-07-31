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
    message: string;
    details?: Array<{ path: string; message: string }>;
    requestId: string;
  };
};
