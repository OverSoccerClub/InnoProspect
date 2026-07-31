import { describe, expect, it } from 'vitest';
import { detectOptOut, findOptOutTrigger } from './detect.js';

describe('detectOptOut', () => {
  it('detecta os gatilhos do ARQUITETURA §6.7, com e sem acento, case-insensitive', () => {
    expect(detectOptOut('Pode SAIR da lista, por favor')).toBe(true);
    expect(detectOptOut('não quero mais receber')).toBe(true);
    expect(detectOptOut('nao quero mais receber')).toBe(true);
    expect(detectOptOut('me tira dessa lista')).toBe(true);
    expect(detectOptOut('STOP')).toBe(true);
    expect(detectOptOut('unsubscribe please')).toBe(true);
    expect(detectOptOut('sem interesse, obrigado')).toBe(true);
  });

  it('não casa substring dentro de outra palavra (evita falso positivo)', () => {
    // "aparecer" contém "pare" como substring solta — não deve disparar.
    expect(detectOptOut('vou aparecer aí amanhã')).toBe(false);
    // "cancelaria" contém "cancela" mas não a palavra isolada "cancelar".
    expect(detectOptOut('eu cancelaria se pudesse, mas não é o caso')).toBe(false);
  });

  it('não detecta em mensagens neutras/positivas comuns', () => {
    expect(detectOptOut('Oi, tudo bem? Gostei da proposta, vamos conversar mais.')).toBe(false);
    expect(detectOptOut('Qual o valor?')).toBe(false);
  });

  it('findOptOutTrigger retorna a palavra que casou', () => {
    expect(findOptOutTrigger('por favor, descadastre meu número')).toBe('descadastre');
    expect(findOptOutTrigger('mensagem qualquer')).toBeNull();
  });
});
