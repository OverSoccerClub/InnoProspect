import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { constantTimeEqual, parseEvolutionWebhookEvent } from './parser.js';

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('parseEvolutionWebhookEvent — connection.update', () => {
  it('state=open vira connection_update connected, banned=false', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('connection-update-open.json'));
    expect(event).toEqual({
      type: 'connection_update',
      instance: 'vendas-01',
      state: 'connected',
      banned: false,
      statusReason: null,
    });
  });

  it('state=close + statusReason=401 vira banned=true (ARQUITETURA §4.8/§6.6)', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('connection-update-close-banned.json'));
    expect(event).toEqual({
      type: 'connection_update',
      instance: 'vendas-01',
      state: 'disconnected',
      banned: true,
      statusReason: 401,
    });
  });

  it('state=close com outro statusReason vira disconnected, banned=false', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('connection-update-close-generic.json'));
    expect(event).toEqual({
      type: 'connection_update',
      instance: 'vendas-01',
      state: 'disconnected',
      banned: false,
      statusReason: 428,
    });
  });
});

describe('parseEvolutionWebhookEvent — qrcode.updated', () => {
  it('normaliza base64 e pairingCode (code)', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('qrcode-updated.json'));
    expect(event.type).toBe('qr_updated');
    if (event.type !== 'qr_updated') throw new Error('unreachable');
    expect(event.instance).toBe('vendas-01');
    expect(event.qrCodeBase64).toContain('data:image/png;base64,');
    expect(event.pairingCode).toBe('2@AbCdEfGh1234567890');
  });
});

describe('parseEvolutionWebhookEvent — messages.upsert', () => {
  it('mensagem de texto normal (conversation) vira message_received, sem opt-out', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('messages-upsert-text.json'));
    expect(event).toEqual({
      type: 'message_received',
      instance: 'vendas-01',
      providerMessageId: '3EB0C767D26A1D2F4B',
      fromJid: '5511987654321@s.whatsapp.net',
      text: 'Oi, gostaria de saber mais sobre o produto',
      pushName: 'João',
      timestamp: new Date(1735689600 * 1000).toISOString(),
      isOptOutRequest: false,
      optOutTrigger: null,
    });
  });

  it('extendedTextMessage com pedido de opt-out ("sair") sinaliza isOptOutRequest=true', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('messages-upsert-extended-text-optout.json'));
    expect(event.type).toBe('message_received');
    if (event.type !== 'message_received') throw new Error('unreachable');
    expect(event.text).toBe('Quero sair da lista, obrigado');
    expect(event.isOptOutRequest).toBe(true);
    expect(event.optOutTrigger).toBe('sair');
  });

  it('fromMe=true é ignorado (eco da nossa própria mensagem)', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('messages-upsert-from-me.json'));
    expect(event).toEqual({ type: 'ignored', instance: 'vendas-01', reason: 'from_me' });
  });

  it('remoteJid de grupo (@g.us) é ignorado', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('messages-upsert-group.json'));
    expect(event).toEqual({ type: 'ignored', instance: 'vendas-01', reason: 'group_message' });
  });
});

describe('parseEvolutionWebhookEvent — messages.update', () => {
  it('mapeia DELIVERY_ACK para delivered (CONTRATO ARQUITETURA §4.8)', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('messages-update-delivered.json'));
    expect(event).toEqual({
      type: 'message_status',
      instance: 'vendas-01',
      providerMessageId: '3EB0C767D26A1D2F4B',
      status: 'delivered',
    });
  });
});

describe('parseEvolutionWebhookEvent — payload inválido', () => {
  it('evento fora do union conhecido vira ignored/invalid_payload, nunca lança', () => {
    const event = parseEvolutionWebhookEvent(loadFixture('invalid-payload.json'));
    expect(event).toEqual({ type: 'ignored', instance: 'vendas-01', reason: 'invalid_payload' });
  });

  it('body completamente fora de forma (string, null, array) nunca lança', () => {
    expect(parseEvolutionWebhookEvent('not json shaped').type).toBe('ignored');
    expect(parseEvolutionWebhookEvent(null).type).toBe('ignored');
    expect(parseEvolutionWebhookEvent([1, 2, 3]).type).toBe('ignored');
    expect(parseEvolutionWebhookEvent(undefined).type).toBe('ignored');
  });
});

describe('constantTimeEqual', () => {
  it('true para strings iguais', () => {
    expect(constantTimeEqual('segredo-123', 'segredo-123')).toBe(true);
  });

  it('false para strings diferentes (mesmo tamanho)', () => {
    expect(constantTimeEqual('segredo-123', 'segredo-456')).toBe(false);
  });

  it('false para tamanhos diferentes', () => {
    expect(constantTimeEqual('curto', 'um-pouco-mais-longo')).toBe(false);
  });
});
