const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
});

const relativeFormatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

/** Só hora:minuto — usado em bolhas de conversa, onde a data já aparece como separador de dia. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return timeFormatter.format(date);
}

/** "Hoje" / "Ontem" / data completa — separador de dia numa lista cronológica (ex.: conversa). */
export function formatDayLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const today = new Date();
  const diffDays = Math.round(
    (startOfDay(today).getTime() - startOfDay(date).getTime()) / 86_400_000,
  );
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  return dateFormatter.format(date);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return relativeFormatter.format(diffSeconds, 'second');
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), 'hour');
  return relativeFormatter.format(Math.round(diffSeconds / 86400), 'day');
}

export function formatPhone(phoneE164: string | null | undefined): string {
  if (!phoneE164) return '—';
  // +55DDNNNNNNNNN -> (DD) NNNNN-NNNN
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(phoneE164);
  if (!match) return phoneE164;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}

/** `137` -> "2h17min"; `8` -> "8min". Usado nas estimativas de duração de busca. */
export function formatDurationMinutes(totalMinutes: number): string {
  const minutes = Math.max(1, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours}h${rest}min`;
}

/**
 * Valida formato E.164 — mesma regex de `e164Schema` em `@inno/contracts`
 * (ARQUITETURA.md §4.0). Não valida DDD/operadora, só a forma.
 */
export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value.trim());
}
