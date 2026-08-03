import { describe, expect, it } from 'vitest';
import { buildPublicOptOutToken, generateOptOutToken, parsePublicOptOutToken, verifyOptOutToken } from './token.js';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('generateOptOutToken / verifyOptOutToken', () => {
  it('é determinístico: mesmo telefone + mesmo segredo geram sempre o mesmo token', () => {
    const a = generateOptOutToken('+5511987654321', { secret: SECRET });
    const b = generateOptOutToken('+5511987654321', { secret: SECRET });
    expect(a).toBe(b);
  });

  it('telefones diferentes geram tokens diferentes (não enumerável)', () => {
    const a = generateOptOutToken('+5511987654321', { secret: SECRET });
    const b = generateOptOutToken('+5521987654321', { secret: SECRET });
    expect(a).not.toBe(b);
  });

  it('segredos diferentes geram tokens diferentes para o mesmo telefone', () => {
    const a = generateOptOutToken('+5511987654321', { secret: SECRET });
    const b = generateOptOutToken('+5511987654321', { secret: 'outro-segredo' });
    expect(a).not.toBe(b);
  });

  it('verifyOptOutToken aceita o token correto', () => {
    const token = generateOptOutToken('+5511987654321', { secret: SECRET });
    expect(verifyOptOutToken(token, '+5511987654321', { secret: SECRET })).toBe(true);
  });

  it('verifyOptOutToken rejeita token de outro telefone', () => {
    const token = generateOptOutToken('+5511987654321', { secret: SECRET });
    expect(verifyOptOutToken(token, '+5521987654321', { secret: SECRET })).toBe(false);
  });

  it('verifyOptOutToken rejeita token malformado sem lançar', () => {
    expect(verifyOptOutToken('não é hex', '+5511987654321', { secret: SECRET })).toBe(false);
    expect(verifyOptOutToken('', '+5511987654321', { secret: SECRET })).toBe(false);
    expect(verifyOptOutToken('abcd', '+5511987654321', { secret: SECRET })).toBe(false);
  });
});

describe('buildPublicOptOutToken / parsePublicOptOutToken', () => {
  it('gera um token que, decomposto, devolve o telefone original', () => {
    const token = buildPublicOptOutToken('+5511987654321', { secret: SECRET });
    expect(parsePublicOptOutToken(token, { secret: SECRET })).toBe('+5511987654321');
  });

  it('rejeita token com HMAC adulterado (telefone trocado sem o segredo)', () => {
    const tokenA = buildPublicOptOutToken('+5511987654321', { secret: SECRET });
    const [, hmacA] = tokenA.split('.');
    const tokenB = buildPublicOptOutToken('+5521987654321', { secret: SECRET });
    const [encodedPhoneB] = tokenB.split('.');
    // Tenta forjar um token para o telefone B usando a assinatura do telefone A.
    const forged = `${encodedPhoneB}.${hmacA}`;
    expect(parsePublicOptOutToken(forged, { secret: SECRET })).toBeNull();
  });

  it('rejeita token com segredo diferente do usado na geração', () => {
    const token = buildPublicOptOutToken('+5511987654321', { secret: SECRET });
    expect(parsePublicOptOutToken(token, { secret: 'outro-segredo' })).toBeNull();
  });

  it('rejeita entrada malformada sem lançar', () => {
    expect(parsePublicOptOutToken('', { secret: SECRET })).toBeNull();
    expect(parsePublicOptOutToken('sem-ponto', { secret: SECRET })).toBeNull();
    expect(parsePublicOptOutToken('.semtelefone', { secret: SECRET })).toBeNull();
    expect(parsePublicOptOutToken('semhmac.', { secret: SECRET })).toBeNull();
    expect(parsePublicOptOutToken('!!!invalido!!!.abcd', { secret: SECRET })).toBeNull();
  });
});
