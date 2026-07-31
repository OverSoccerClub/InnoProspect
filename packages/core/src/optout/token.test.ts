import { describe, expect, it } from 'vitest';
import { generateOptOutToken, verifyOptOutToken } from './token.js';

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
