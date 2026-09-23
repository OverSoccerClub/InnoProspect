/**
 * client/evolution-client.ts — cliente HTTP tipado da Evolution API
 * (ARQUITETURA §4.6/§4.8). Junto com `client/wire.ts`, é o único ponto de
 * acoplamento com a Evolution API no projeto inteiro — `apps/worker`
 * (dispatch worker) e a rota de instâncias de `apps/web` (rodadas futuras)
 * importam só daqui.
 */
import { e164Schema } from '@inno/contracts';
import { MessagingError } from '../errors.js';
import { evolutionRequest, type EvolutionHttpConfig } from './http.js';
import {
  DEFAULT_WEBHOOK_EVENTS,
  EVOLUTION_PATHS,
  parseCheckNumbersResponse,
  parseConnectResponse,
  parseConnectionStateResponse,
  parseCreateInstanceResponse,
  parseFetchInstancesResponse,
  parseSendTextResponse,
  type CheckNumbersRequestBody,
  type CreateInstanceRequestBody,
  type ParsedQr,
  type RawInstanceState,
  type SendTextRequestBody,
  type SetWebhookRequestBody,
} from './wire.js';
import type {
  ConnectResult,
  ConnectionState,
  CreateInstanceInput,
  CreateInstanceResult,
  FetchedInstanceInfo,
  NumberCheckResult,
  QrCode,
  SendTextInput,
  SendTextResult,
  SetWebhookInput,
} from '../types.js';

/** Config pública do cliente — mesmo shape do transporte (`EvolutionHttpConfig`), com nome mais amigável para quem consome de fora do pacote. */
export type EvolutionClientConfig = EvolutionHttpConfig;

/**
 * Lê `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` do ambiente (`env`, default
 * `process.env`). Lança `MessagingError('VALIDATION_ERROR', ...)` se alguma
 * faltar — é erro de configuração do processo, não de dado de usuário, mas
 * reaproveita o mesmo tipo de erro para quem já trata `MessagingError` no
 * chamador não precisar de um segundo tipo de exceção só para isto.
 */
export function evolutionConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): EvolutionClientConfig {
  const baseUrl = env.EVOLUTION_API_URL;
  const apiKey = env.EVOLUTION_API_KEY;
  if (!baseUrl) {
    throw new MessagingError('VALIDATION_ERROR', 'EVOLUTION_API_URL não configurada');
  }
  if (!apiKey) {
    throw new MessagingError('VALIDATION_ERROR', 'EVOLUTION_API_KEY não configurada');
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
}

function toConnectionState(raw: RawInstanceState | null): ConnectionState {
  if (raw === 'open') return 'connected';
  if (raw === 'connecting') return 'connecting';
  // 'close' ou desconhecido — mais seguro tratar como desconectado do que
  // assumir conectado (ARQUITETURA §6.6: kill switch prefere falso positivo
  // de "desconectado" a deixar campanha achando que a instância está viva).
  return 'disconnected';
}

function toQr(raw: ParsedQr | null): QrCode | null {
  return raw ? { base64: raw.base64, pairingCode: raw.code } : null;
}

/** Converte E.164 (`+5511987654321`) para o formato que a Evolution API espera no envio (dígitos, sem `+`). */
function toEvolutionNumber(e164: string): string {
  return e164.replace(/^\+/, '');
}

function assertInstanceName(instanceName: string): void {
  if (!instanceName || instanceName.trim().length === 0) {
    throw new MessagingError('VALIDATION_ERROR', 'instanceName não pode ser vazio');
  }
}

function parseE164OrThrow(raw: string): string {
  const check = e164Schema.safeParse(raw);
  if (!check.success) {
    throw new MessagingError('INVALID_NUMBER', `Número fora do formato E.164: "${raw}"`);
  }
  return check.data;
}

export class EvolutionClient {
  constructor(private readonly config: EvolutionClientConfig) {}

  /**
   * `GET /instance/fetchInstances` — checagem de conectividade do SERVIDOR
   * (Fase 4.B, botão "testar conexão" do cadastro de `EvolutionServer`), não
   * de uma instância específica: confirma que `baseUrl` é alcançável E que
   * `apiKey` é aceita, sem depender de nenhuma instância já existir naquele
   * servidor. `retryable: false` de propósito — é um teste manual, disparado
   * por clique; o operador quer saber AGORA se funcionou, não esperar o
   * backoff de retry de transporte. Lança `MessagingError` em qualquer falha
   * (rede/timeout/401/etc.) — quem chama decide o que fazer com isso (a rota
   * de teste, `apps/web`, converte para `{ok:false, error}`, nunca deixa
   * borbulhar como erro HTTP da PRÓPRIA rota de teste).
   */
  async testConnection(): Promise<void> {
    await evolutionRequest(this.config, { method: 'GET', path: EVOLUTION_PATHS.fetchInstances(), retryable: false });
  }

  /**
   * `GET /instance/fetchInstances` — lista as instâncias do servidor JUNTO
   * com a credencial de webhook PRÓPRIA de cada uma (achado do dono,
   * 2026-09-23 — ver `client/wire.ts#parseFetchInstancesResponse`). Único
   * chamador hoje: `apps/web/scripts/sync-instance-api-keys.ts` (comando
   * operacional que preenche a credencial de instâncias JÁ PAREADAS, sem
   * reconectar/gerar QR novo — este endpoint é uma LEITURA pura, mesmo
   * espírito de `testConnection`, que usa o mesmo caminho mas descarta o
   * corpo).
   */
  async fetchInstances(): Promise<FetchedInstanceInfo[]> {
    const raw = await evolutionRequest(this.config, { method: 'GET', path: EVOLUTION_PATHS.fetchInstances(), retryable: false });
    return parseFetchInstancesResponse(raw);
  }

  /** `POST /instance/create` — cria a instância na Evolution e já pede o QR (`qrcode:true`). */
  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult> {
    if (!input.instanceName || input.instanceName.trim().length < 2) {
      throw new MessagingError('VALIDATION_ERROR', 'instanceName precisa ter ao menos 2 caracteres');
    }
    const body: CreateInstanceRequestBody = {
      instanceName: input.instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    };
    const raw = await evolutionRequest(this.config, { method: 'POST', path: EVOLUTION_PATHS.createInstance(), body });
    const parsed = parseCreateInstanceResponse(raw);
    return {
      instanceName: parsed.instanceName ?? input.instanceName,
      instanceId: parsed.instanceId,
      state: toConnectionState(parsed.state),
      qr: toQr(parsed.qr),
      apiKey: parsed.apiKey,
    };
  }

  /** `GET /instance/connect/:name` — (re)inicia a conexão e devolve QR novo, ou `state:'connected'` se já pareado. */
  async connect(instanceName: string): Promise<ConnectResult> {
    assertInstanceName(instanceName);
    const raw = await evolutionRequest(this.config, { method: 'GET', path: EVOLUTION_PATHS.connect(instanceName) });
    const parsed = parseConnectResponse(raw);
    return { state: toConnectionState(parsed.state), qr: toQr(parsed.qr) };
  }

  /** `GET /instance/connectionState/:name`. */
  async getConnectionState(instanceName: string): Promise<ConnectionState> {
    assertInstanceName(instanceName);
    const raw = await evolutionRequest(this.config, {
      method: 'GET',
      path: EVOLUTION_PATHS.connectionState(instanceName),
    });
    return toConnectionState(parseConnectionStateResponse(raw));
  }

  /** `DELETE /instance/logout/:name` — desconecta o WhatsApp mas MANTÉM a instância (pode reconectar via `connect`). */
  async disconnect(instanceName: string): Promise<void> {
    assertInstanceName(instanceName);
    await evolutionRequest(this.config, { method: 'DELETE', path: EVOLUTION_PATHS.logout(instanceName) });
  }

  /** `DELETE /instance/delete/:name` — apaga a instância de vez (irreversível do lado da Evolution). */
  async deleteInstance(instanceName: string): Promise<void> {
    assertInstanceName(instanceName);
    await evolutionRequest(this.config, { method: 'DELETE', path: EVOLUTION_PATHS.deleteInstance(instanceName) });
  }

  /**
   * `POST /webhook/set/:name` — configura o webhook POR INSTÂNCIA (decisão
   * de arquitetura, ARQUITETURA §4.8: "não global"). `input.url` deve ser a
   * URL completa já com o `:instanceKey` secreto da nossa rota
   * (`/api/webhooks/evolution/:instanceKey`), não o nome da instância.
   */
  async setWebhook(instanceName: string, input: SetWebhookInput): Promise<void> {
    assertInstanceName(instanceName);
    if (!input.url || !/^https?:\/\//.test(input.url)) {
      throw new MessagingError('VALIDATION_ERROR', 'url do webhook precisa ser http(s) absoluta');
    }
    const body: SetWebhookRequestBody = {
      webhook: {
        url: input.url,
        enabled: true,
        events: input.events ?? DEFAULT_WEBHOOK_EVENTS,
        webhookByEvents: false,
      },
    };
    await evolutionRequest(this.config, { method: 'POST', path: EVOLUTION_PATHS.setWebhook(instanceName), body });
  }

  /**
   * `POST /message/sendText/:name` — envia texto. Valida `to` (E.164) e
   * `text` (não vazio) ANTES de chamar a rede — número mal formado nunca
   * gasta uma chamada HTTP nem entra na política de retry.
   *
   * `retryable: false` (achado do Órion, revisão de 2026-09-22): esta é a
   * ÚNICA chamada do cliente sem retry automático de transporte. Um envio
   * não é idempotente do ponto de vista do lead — se a Evolution recebeu a
   * chamada e só a RESPOSTA se perdeu (timeout) ou veio um 5xx depois de já
   * ter processado, reenviar automaticamente duplica a mensagem. Quem chama
   * `sendText` (`apps/web/src/lib/services/messages.ts`) trata
   * `TIMEOUT`/`TRANSIENT_ERROR` como resultado INCERTO — não repete, não
   * confirma, registra e deixa o operador decidir.
   */
  async sendText(instanceName: string, input: SendTextInput): Promise<SendTextResult> {
    assertInstanceName(instanceName);
    const to = parseE164OrThrow(input.to);
    const text = input.text.trim();
    if (text.length === 0) {
      throw new MessagingError('VALIDATION_ERROR', 'text não pode ser vazio');
    }

    const body: SendTextRequestBody = {
      number: toEvolutionNumber(to),
      text,
      ...(input.delayMs !== undefined ? { delay: input.delayMs } : {}),
      ...(input.linkPreview !== undefined ? { linkPreview: input.linkPreview } : {}),
    };
    const raw = await evolutionRequest(this.config, { method: 'POST', path: EVOLUTION_PATHS.sendText(instanceName), body, retryable: false });
    const parsed = parseSendTextResponse(raw);
    if (!parsed.providerMessageId) {
      throw new MessagingError('UNKNOWN', 'Evolution API não devolveu key.id no envio', { cause: raw });
    }
    return {
      providerMessageId: parsed.providerMessageId,
      remoteJid: parsed.remoteJid,
      rawStatus: parsed.status,
    };
  }

  /**
   * `POST /chat/whatsappNumbers/:name` — checa se números existem no
   * WhatsApp ANTES de gastar um envio. Endpoint EXPERIMENTAL: adicionado
   * como valor extra (pré-checagem de `INVALID_NUMBER`), não fazia parte do
   * contrato original — ver PENDÊNCIAS no handoff antes de depender disto
   * em produção. Devolve `[]` para `numbers` vazio sem chamar a rede.
   */
  async checkNumbers(instanceName: string, numbers: string[]): Promise<NumberCheckResult[]> {
    assertInstanceName(instanceName);
    if (numbers.length === 0) return [];

    const inputs = numbers.map(parseE164OrThrow);
    const body: CheckNumbersRequestBody = { numbers: inputs.map(toEvolutionNumber) };
    const raw = await evolutionRequest(this.config, { method: 'POST', path: EVOLUTION_PATHS.checkNumbers(instanceName), body });
    const parsed = parseCheckNumbersResponse(raw);
    const byDigits = new Map(parsed.filter((p) => p.number !== null).map((p) => [p.number as string, p]));

    // Correlaciona primeiro pelo número devolvido pela Evolution; se o
    // shape da resposta não trouxer `number` (não confirmado, ver
    // `wire.ts`), cai para correlação por posição como melhor esforço.
    return inputs.map((input, i) => {
      const digits = toEvolutionNumber(input);
      const match = byDigits.get(digits) ?? parsed[i] ?? null;
      return { input, exists: match?.exists ?? false, jid: match?.jid ?? null };
    });
  }
}
