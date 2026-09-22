import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractCard } from './extract-card.js';

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`../sanity/fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

describe('extractCard', () => {
  it('extrai os campos que a lista real expõe hoje (fixture real congelada, 2026-09-22 — ver nota em selectors.ts)', () => {
    const raw = extractCard(loadFixture('card-full.html'));

    expect(raw).not.toBeNull();
    expect(raw?.name).toBe('Pinheirão Casa & Construção');
    expect(raw?.phoneRaw).toBe('(84) 3113-0884');
    // Endereço curto (sem bairro/cidade/UF) — é o que a lista publica; o
    // badge de acessibilidade entre categoria e endereço NÃO deve ser lido
    // como endereço (regressão direta do bug de estrutura de 2026-09-22).
    expect(raw?.address).toBe('R. Cruzeiro do Sul, 920');
    expect(raw?.category).toBe('Loja de materiais de construção');
    expect(raw?.ratingRaw).toBe('4,5 estrelas');
    // Não observado na lista real (ver nota grande em selectors.ts, item 6) — null é o correto aqui.
    expect(raw?.reviewCountRaw).toBeNull();
    expect(raw?.website).toBeNull();
    expect(raw?.detailUrl).toContain('Pinheir%C3%A3o+Casa');
    expect(raw?.externalRef).toBe('0x7b2571afd9a994b:0x5596438a67afd04');
  });

  it('trata telefone ausente como null, não como erro (nem toda empresa publica telefone)', () => {
    const raw = extractCard(loadFixture('card-no-phone.html'));

    expect(raw).not.toBeNull();
    expect(raw?.name).toBe('Consultoria Alfa');
    expect(raw?.phoneRaw).toBeNull();
    expect(raw?.website).toBeNull();
    expect(raw?.ratingRaw).toBeNull();
    expect(raw?.address).toBe('Av. Paulista, 1000');
  });

  it('categoria sem endereço publicado: bloco com um único span não é lido como endereço', () => {
    // Sintético (não fixture) — testa especificamente a guarda
    // `:not(:only-child)` do seletor de endereço: quando só há categoria (um
    // único span no bloco), o endereço deve ficar null, não repetir a
    // categoria. Não observado ao vivo na amostra de 2026-09-22 (todos os 7
    // cards tinham endereço), mas é uma forma plausível da mesma estrutura
    // real (ex.: empresa sem endereço público).
    const html = `
      <div role="article">
        <a class="hfpxzc" aria-label="Empresa Sem Endereço"></a>
        <div class="W4Efsd">
          <div class="W4Efsd"><span><span>Serviço de entrega</span></span></div>
        </div>
      </div>`;
    const raw = extractCard(html);
    expect(raw).not.toBeNull();
    expect(raw?.category).toBe('Serviço de entrega');
    expect(raw?.address).toBeNull();
  });

  it('reviewCount/website: extraem corretamente SE presentes (sintético — não observado ao vivo, ver selectors.ts itens 6/7)', () => {
    const html = `
      <div role="article">
        <a class="hfpxzc" aria-label="Empresa Com Tudo"></a>
        <span class="UY7F9" aria-label="123 avaliações">(123)</span>
        <a data-value="Website" href="https://empresa.example.com" aria-label="Visitar site"></a>
      </div>`;
    const raw = extractCard(html);
    expect(raw).not.toBeNull();
    expect(raw?.reviewCountRaw).toBe('123 avaliações');
    expect(raw?.website).toBe('https://empresa.example.com');
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
