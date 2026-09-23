import { describe, expect, it, vi } from 'vitest';

import { formatDayLabel, formatTime } from '@/lib/format';

describe('formatTime', () => {
  it('formata só hora:minuto, sem data', () => {
    expect(formatTime('2026-09-23T14:05:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('devolve "—" para entrada ausente/invalida', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatTime(undefined)).toBe('—');
    expect(formatTime('not-a-date')).toBe('—');
  });
});

// `new Date(ano, mês, dia, ...)` (não ISO com "Z") de propósito: constrói os
// instantes de teste no MESMO fuso local que `vi.setSystemTime` e que
// `formatDayLabel` usa para extrair o dia — evita o teste quebrar dependendo
// do fuso horário da máquina/CI que rodar o Vitest (ISO fixo em UTC mudaria
// de dia local para fusos como UTC+9, dando "Hoje"/"Ontem" errado no teste
// mesmo com a função correta).
describe('formatDayLabel', () => {
  it('devolve "Hoje" para a data de hoje', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 23, 12, 0, 0));
    expect(formatDayLabel(new Date(2026, 8, 23, 8, 0, 0).toISOString())).toBe('Hoje');
    vi.useRealTimers();
  });

  it('devolve "Ontem" para o dia anterior', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 23, 12, 0, 0));
    expect(formatDayLabel(new Date(2026, 8, 22, 23, 50, 0).toISOString())).toBe('Ontem');
    vi.useRealTimers();
  });

  it('devolve a data completa para qualquer dia mais antigo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 23, 12, 0, 0));
    expect(formatDayLabel(new Date(2026, 8, 1, 12, 0, 0).toISOString())).toBe('01/09/2026');
    vi.useRealTimers();
  });

  it('devolve "—" para entrada ausente/invalida', () => {
    expect(formatDayLabel(null)).toBe('—');
    expect(formatDayLabel('not-a-date')).toBe('—');
  });
});
