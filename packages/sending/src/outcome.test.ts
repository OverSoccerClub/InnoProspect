/**
 * outcome.test.ts — `EVOLUTION_ERROR_EFFECT` é a ÚNICA fonte de classificação
 * de erro da Evolution (ARQUITETURA §6.8.0.4: "nunca duplicar"). Estes testes
 * guardam as duas invariantes que sustentam essa promessa: a tabela cobre
 * TODO `MessagingErrorCode` (nenhum código novo passa em branco — ver
 * `[[project-innoprospect]]`, gap dos "quatro campos inertes") e a
 * classificação `outcome:'uncertain'` fica restrita aos dois códigos que
 * podem significar "talvez tenha saído" (achado do Órion, 2026-09-22).
 */
import { describe, expect, it } from 'vitest';
import { MESSAGING_ERROR_POLICY, type MessagingErrorCode } from '@inno/messaging';
import { EVOLUTION_ERROR_EFFECT } from './outcome.js';

describe('EVOLUTION_ERROR_EFFECT', () => {
  it('cobre TODO MessagingErrorCode conhecido (a partir de MESSAGING_ERROR_POLICY, não de uma lista duplicada)', () => {
    const codes = Object.keys(MESSAGING_ERROR_POLICY) as MessagingErrorCode[];
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(EVOLUTION_ERROR_EFFECT[code], `EVOLUTION_ERROR_EFFECT não tem entrada para "${code}"`).toBeDefined();
    }
  });

  it('só TRANSIENT_ERROR e TIMEOUT são "uncertain" — os únicos onde a Evolution pode ter processado o envio antes do erro chegar', () => {
    const uncertainCodes = (Object.keys(EVOLUTION_ERROR_EFFECT) as MessagingErrorCode[]).filter(
      (code) => EVOLUTION_ERROR_EFFECT[code].outcome === 'uncertain',
    );
    expect(uncertainCodes.sort()).toEqual(['TIMEOUT', 'TRANSIENT_ERROR']);
  });

  it('todo "uncertain" nunca incrementa consecutiveFailures nem desconecta a instância (não é falha CONFIRMADA dela)', () => {
    for (const effect of Object.values(EVOLUTION_ERROR_EFFECT)) {
      if (effect.outcome === 'uncertain') {
        expect(effect.incrementConsecutiveFailures).toBe(false);
        expect(effect.disconnectInstance).toBe(false);
      }
    }
  });

  it('INSTANCE_DISCONNECTED e INSTANCE_NOT_FOUND são os ÚNICOS que desconectam a instância', () => {
    const disconnecting = (Object.keys(EVOLUTION_ERROR_EFFECT) as MessagingErrorCode[]).filter(
      (code) => EVOLUTION_ERROR_EFFECT[code].disconnectInstance,
    );
    expect(disconnecting.sort()).toEqual(['INSTANCE_DISCONNECTED', 'INSTANCE_NOT_FOUND']);
  });

  it('httpStatus só assume 409 (regra de negócio nossa) ou 502 (defeito do provedor) — nunca 500', () => {
    for (const effect of Object.values(EVOLUTION_ERROR_EFFECT)) {
      expect([409, 502]).toContain(effect.httpStatus);
    }
  });
});
