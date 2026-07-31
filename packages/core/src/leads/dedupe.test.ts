import { describe, expect, it } from 'vitest';
import {
  HUMAN_OR_ORIGIN_FIELDS,
  MACHINE_UPDATABLE_FIELDS,
  buildMachineUpdate,
  computeDedupeKey,
} from './dedupe.js';

describe('MACHINE_UPDATABLE_FIELDS', () => {
  it('nunca contém um campo humano ou de origem — se alguém adicionar um por engano, este teste quebra', () => {
    const machineSet = new Set<string>(MACHINE_UPDATABLE_FIELDS);
    for (const humanField of HUMAN_OR_ORIGIN_FIELDS) {
      expect(machineSet.has(humanField)).toBe(false);
    }
  });

  it('lista exatamente os campos do handoff do Cronos', () => {
    expect([...MACHINE_UPDATABLE_FIELDS].sort()).toEqual(
      [
        'name',
        'phoneRaw',
        'phoneE164',
        'phoneType',
        'address',
        'website',
        'category',
        'rating',
        'reviewCount',
        'latitude',
        'longitude',
        'lastSeenAt',
      ].sort(),
    );
  });
});

describe('buildMachineUpdate', () => {
  it('aceita um objeto só com campos de MACHINE_UPDATABLE_FIELDS', () => {
    expect(buildMachineUpdate({ name: 'Padaria X', rating: 4.5 })).toEqual({
      name: 'Padaria X',
      rating: 4.5,
    });
  });

  it('lança ao receber um campo humano (ex.: status vindo de um objeto dinâmico)', () => {
    const dynamicallyBuilt = { name: 'Padaria X', status: 'won' } as unknown as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => buildMachineUpdate(dynamicallyBuilt as any)).toThrow(/status/);
  });

  it('lança ao receber ownerId', () => {
    const dynamicallyBuilt = { ownerId: 'user_123' } as unknown as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => buildMachineUpdate(dynamicallyBuilt as any)).toThrow(/ownerId/);
  });
});

describe('computeDedupeKey', () => {
  it('usa externalRef quando presente (maior precedência)', () => {
    expect(
      computeDedupeKey({
        externalRef: 'ChIJ_place_id_123',
        phoneE164: '+5511987654321',
        name: 'Clínica Sorriso',
        cityIbgeCode: '3550308',
      }),
    ).toBe('ChIJ_place_id_123');
  });

  it('usa phoneE164 quando não há externalRef', () => {
    expect(
      computeDedupeKey({
        externalRef: null,
        phoneE164: '+5511987654321',
        name: 'Clínica Sorriso',
        cityIbgeCode: '3550308',
      }),
    ).toBe('+5511987654321');
  });

  it('cai para slug(name):cityIbgeCode quando não há externalRef nem telefone', () => {
    expect(
      computeDedupeKey({
        externalRef: null,
        phoneE164: null,
        name: 'Clínica São José & Cia.',
        cityIbgeCode: '3550308',
      }),
    ).toBe('clinica-sao-jose-cia:3550308');
  });

  it('trata string vazia como ausente (cai para o próximo nível de precedência)', () => {
    expect(
      computeDedupeKey({
        externalRef: '',
        phoneE164: '   ',
        name: 'Padaria Central',
        cityIbgeCode: '4106902',
      }),
    ).toBe('padaria-central:4106902');
  });
});
