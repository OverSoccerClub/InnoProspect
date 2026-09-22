import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEND_WINDOW_CONFIG,
  isBrazilianNationalHoliday,
  isWithinBusinessWindow,
  isWithinQuietHoursFloor,
  nextBusinessWindowOpensAt,
  nextLocalMidnight,
  nextQuietHoursFloorOpensAt,
} from './send-window';

const TZ = 'America/Sao_Paulo';

/** `2026-MM-DDT..." em UTC, escolhido para cair exatamente na hora local desejada em America/Sao_Paulo (UTC-3, sem horário de verão desde 2019). */
function saoPauloInstant(month: number, day: number, hour: number, minute = 0): Date {
  const utcHour = hour + 3; // America/Sao_Paulo é UTC-3 o ano inteiro desde 2019.
  return new Date(Date.UTC(2026, month - 1, day, utcHour, minute, 0));
}

describe('isWithinQuietHoursFloor (G5 — piso duro)', () => {
  it('permite dentro de 08:00-20:00 num dia de semana comum', () => {
    // 2026-09-22 é uma terça-feira.
    expect(isWithinQuietHoursFloor(saoPauloInstant(9, 22, 10), DEFAULT_SEND_WINDOW_CONFIG)).toBe(true);
  });

  it('bloqueia antes das 08:00', () => {
    expect(isWithinQuietHoursFloor(saoPauloInstant(9, 22, 7, 59), DEFAULT_SEND_WINDOW_CONFIG)).toBe(false);
  });

  it('bloqueia a partir das 20:00', () => {
    expect(isWithinQuietHoursFloor(saoPauloInstant(9, 22, 20, 0), DEFAULT_SEND_WINDOW_CONFIG)).toBe(false);
  });

  it('bloqueia domingo mesmo em horário comercial', () => {
    // 2026-09-20 é um domingo.
    expect(isWithinQuietHoursFloor(saoPauloInstant(9, 20, 10), DEFAULT_SEND_WINDOW_CONFIG)).toBe(false);
  });

  it('bloqueia feriado nacional fixo (7 de setembro)', () => {
    expect(isWithinQuietHoursFloor(saoPauloInstant(9, 7, 10), DEFAULT_SEND_WINDOW_CONFIG)).toBe(false);
  });

  it('bloqueia feriado móvel (Sexta-feira da Paixão, calculado a partir da Páscoa)', () => {
    // Páscoa de 2026 cai em 5 de abril — Sexta-feira da Paixão é 3 de abril.
    expect(isWithinQuietHoursFloor(saoPauloInstant(4, 3, 10), DEFAULT_SEND_WINDOW_CONFIG)).toBe(false);
  });

  it('permite sábado dentro do horário do piso (só domingo/feriado são duros)', () => {
    // 2026-09-19 é um sábado.
    expect(isWithinQuietHoursFloor(saoPauloInstant(9, 19, 10), DEFAULT_SEND_WINDOW_CONFIG)).toBe(true);
  });

  it('respeita um piso ESTREITADO (start maior que o padrão)', () => {
    const narrowed = { ...DEFAULT_SEND_WINDOW_CONFIG, quietHours: { startHour: 9, endHour: 18 } };
    expect(isWithinQuietHoursFloor(saoPauloInstant(9, 22, 8, 30), narrowed)).toBe(false);
    expect(isWithinQuietHoursFloor(saoPauloInstant(9, 22, 10), narrowed)).toBe(true);
  });
});

describe('isBrazilianNationalHoliday', () => {
  it('reconhece feriados fixos', () => {
    expect(isBrazilianNationalHoliday(saoPauloInstant(1, 1, 10), TZ)).toBe(true);
    expect(isBrazilianNationalHoliday(saoPauloInstant(12, 25, 10), TZ)).toBe(true);
  });

  it('reconhece Corpus Christi (móvel, Páscoa + 60 dias)', () => {
    // Páscoa 2026 = 5 de abril → Corpus Christi = 4 de junho de 2026.
    expect(isBrazilianNationalHoliday(saoPauloInstant(6, 4, 10), TZ)).toBe(true);
  });

  it('não marca um dia comum qualquer', () => {
    expect(isBrazilianNationalHoliday(saoPauloInstant(9, 22, 10), TZ)).toBe(false);
  });
});

describe('isWithinBusinessWindow (G6 — janela comercial)', () => {
  it('permite terça 10h (dentro de 09-18, fora do almoço)', () => {
    expect(isWithinBusinessWindow(saoPauloInstant(9, 22, 10), DEFAULT_SEND_WINDOW_CONFIG)).toBe(true);
  });

  it('bloqueia durante a pausa de almoço (12:30)', () => {
    expect(isWithinBusinessWindow(saoPauloInstant(9, 22, 12, 30), DEFAULT_SEND_WINDOW_CONFIG)).toBe(false);
  });

  it('permite exatamente às 13:30 (fim da pausa, exclusive no início)', () => {
    expect(isWithinBusinessWindow(saoPauloInstant(9, 22, 13, 30), DEFAULT_SEND_WINDOW_CONFIG)).toBe(true);
  });

  it('bloqueia antes das 09:00 mesmo dentro do piso duro', () => {
    expect(isWithinBusinessWindow(saoPauloInstant(9, 22, 8, 30), DEFAULT_SEND_WINDOW_CONFIG)).toBe(false);
  });

  it('bloqueia sábado inteiro (mesmo em horário comercial)', () => {
    expect(isWithinBusinessWindow(saoPauloInstant(9, 19, 10), DEFAULT_SEND_WINDOW_CONFIG)).toBe(false);
  });
});

describe('nextQuietHoursFloorOpensAt / nextBusinessWindowOpensAt', () => {
  it('acha a abertura do piso duro no dia seguinte quando "agora" é depois das 20h', () => {
    const now = saoPauloInstant(9, 22, 21, 0);
    const next = nextQuietHoursFloorOpensAt(now, DEFAULT_SEND_WINDOW_CONFIG);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(now.getTime());
    expect(isWithinQuietHoursFloor(next!, DEFAULT_SEND_WINDOW_CONFIG)).toBe(true);
  });

  it('acha a próxima abertura da janela comercial durante o almoço', () => {
    const now = saoPauloInstant(9, 22, 12, 30);
    const next = nextBusinessWindowOpensAt(now, DEFAULT_SEND_WINDOW_CONFIG);
    expect(next).not.toBeNull();
    expect(isWithinBusinessWindow(next!, DEFAULT_SEND_WINDOW_CONFIG)).toBe(true);
  });
});

describe('nextLocalMidnight', () => {
  it('devolve um instante cuja hora local em America/Sao_Paulo é 00:00 do dia seguinte', () => {
    const now = saoPauloInstant(9, 22, 15, 0);
    const midnight = nextLocalMidnight(now, TZ);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(midnight).map((p) => [p.type, p.value]));
    expect(parts.day).toBe('23');
    expect(parts.hour === '00' || parts.hour === '24').toBe(true);
  });
});
