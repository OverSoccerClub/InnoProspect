import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractCard } from './extract-card.js';

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`../sanity/fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

describe('extractCard', () => {
  it('extrai todos os campos de um card completo (fixture real congelada)', () => {
    const raw = extractCard(loadFixture('card-full.html'));

    expect(raw).not.toBeNull();
    expect(raw?.name).toBe('Padaria Nova Esperança');
    expect(raw?.phoneRaw).toBe('(21) 98765-4321');
    expect(raw?.address).toBe('Rua das Flores, 123 - Centro, Rio de Janeiro - RJ');
    expect(raw?.category).toBe('Padaria');
    expect(raw?.ratingRaw).toBe('4,5 estrelas');
    expect(raw?.reviewCountRaw).toBe('123 avaliações');
    expect(raw?.website).toBe('https://padarianovaesperanca.com.br');
    expect(raw?.detailUrl).toContain('Padaria+Nova+Esperan');
    expect(raw?.externalRef).toBe('0x9bde559108a05b:0x513a40d5c37d3a5c');
  });

  it('trata telefone ausente como null, não como erro (nem toda empresa publica telefone)', () => {
    const raw = extractCard(loadFixture('card-no-phone.html'));

    expect(raw).not.toBeNull();
    expect(raw?.name).toBe('Consultoria Alfa');
    expect(raw?.phoneRaw).toBeNull();
    expect(raw?.website).toBeNull();
    expect(raw?.ratingRaw).toBeNull();
    expect(raw?.address).toBe('Av. Paulista, 1000 - Bela Vista, São Paulo - SP');
  });

  it('devolve null quando nenhuma alternativa de SELECTORS.card.name casa (não inventa nome)', () => {
    const raw = extractCard(loadFixture('card-missing-name.html'));
    expect(raw).toBeNull();
  });

  it('devolve null para HTML vazio/ausente sem lançar', () => {
    expect(extractCard('')).toBeNull();
    expect(extractCard('   ')).toBeNull();
    expect(extractCard(null)).toBeNull();
    expect(extractCard(undefined)).toBeNull();
  });
});
