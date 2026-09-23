/**
 * client/wire.ts
 *
 * ⚠️ ÚNICO arquivo com o formato de payload/endpoint da Evolution API v2.x.
 * Mesmo espírito de `packages/scraper/src/extraction/selectors.ts`: se a
 * Evolution mudar algo (é API não-oficial de terceiros — muda sem aviso de
 * versão em versão), o conserto é "editar este arquivo", não "caçar
 * endpoint/campo espalhado por vários módulos".
 *
 * ⚠️ NÃO VALIDADO CONTRA SERVIDOR REAL — não há Evolution API rodando neste
 * ambiente (ver PENDÊNCIAS no handoff do Vega, tarefa "packages/messaging").
 * Escrito contra a documentação pública (doc.evolution-api.com, Evolution
 * API v2.x) e o formato descrito em ARQUITETURA §4.8. Os `parse*` abaixo são
 * propositalmente defensivos (aceitam mais de uma forma plausível de shape,
 * nunca lançam por causa de um campo ausente) para reduzir o risco de
 * quebrar por uma divergência pequena de versão — mas isto TEM que ser
 * validado contra um servidor real antes de ligar em produção.
 */

export type EvolutionIntegration = 'WHATSAPP-BAILEYS';

/** Nomes de evento aceitos por `POST /webhook/set/:instance` (v2, maiúsculas com underscore). */
export type EvolutionWebhookEventName =
  | 'CONNECTION_UPDATE'
  | 'QRCODE_UPDATED'
  | 'MESSAGES_UPSERT'
  | 'MESSAGES_UPDATE';

/** Os 4 eventos que `webhook/parser.ts` sabe interpretar (ARQUITETURA §4.8) — default de `setWebhook`. */
export const DEFAULT_WEBHOOK_EVENTS: EvolutionWebhookEventName[] = [
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
];

/** Nomes/caminhos de endpoint — todos relativos a `EVOLUTION_API_URL`. */
export const EVOLUTION_PATHS = {
  /** Lista as instâncias do servidor — usado por `EvolutionClient.testConnection` (Fase 4.B) como checagem "URL alcançável + apikey válida" que não depende de nenhuma instância existir ainda. */
  fetchInstances: () => '/instance/fetchInstances',
  createInstance: () => '/instance/create',
  connect: (instanceName: string) => `/instance/connect/${encodeURIComponent(instanceName)}`,
  connectionState: (instanceName: string) => `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  logout: (instanceName: string) => `/instance/logout/${encodeURIComponent(instanceName)}`,
  deleteInstance: (instanceName: string) => `/instance/delete/${encodeURIComponent(instanceName)}`,
  sendText: (instanceName: string) => `/message/sendText/${encodeURIComponent(instanceName)}`,
  setWebhook: (instanceName: string) => `/webhook/set/${encodeURIComponent(instanceName)}`,
  checkNumbers: (instanceName: string) => `/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Corpos de requisição
// ─────────────────────────────────────────────────────────────────────────

export type CreateInstanceRequestBody = {
  instanceName: string;
  qrcode: true;
  integration: EvolutionIntegration;
};

/** `number` vai sem "+" (dígitos com DDI, ex.: "5511987654321") — ver `toEvolutionNumber` em `evolution-client.ts`. */
export type SendTextRequestBody = {
  number: string;
  text: string;
  /** ms de "digitando..." simulado antes do envio, quando suportado pela versão instalada. */
  delay?: number;
  linkPreview?: boolean;
};

export type SetWebhookRequestBody = {
  webhook: {
    url: string;
    enabled: true;
    events: EvolutionWebhookEventName[];
    webhookByEvents: false;
  };
};

export type CheckNumbersRequestBody = {
  numbers: string[];
};

// ─────────────────────────────────────────────────────────────────────────
// Parsing defensivo de resposta — nunca lança, aceita variações de shape
// ─────────────────────────────────────────────────────────────────────────

export type RawInstanceState = 'open' | 'close' | 'connecting';

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export type ParsedQr = { base64: string; code: string | null };

function readQr(root: Record<string, unknown>): ParsedQr | null {
  const qrRaw = asRecord(root.qrcode) ?? asRecord(root.qr);
  const base64 = readString(root.base64) ?? readString(qrRaw?.base64);
  if (!base64) return null;
  return { base64, code: readString(root.code) ?? readString(qrRaw?.code) };
}

/**
 * Chave (`apikey`) ESPECÍFICA da instância — distinta da chave GLOBAL do
 * servidor (`EvolutionServer`, cifrada em
 * `apps/web/src/lib/evolution-server-crypto.ts`). Achado do dono
 * (2026-09-23, painel da Evolution): cada instância v2 tem a SUA PRÓPRIA
 * `apikey`. NÃO CONFIRMADO contra servidor real (mesma ressalva do arquivo
 * inteiro) qual dos formatos abaixo a v2.3.7 realmente devolve — aceita
 * todos os plausíveis, do mais específico (documentado publicamente para a
 * v2: `hash.apikey`) ao mais genérico:
 *   - `hash` como OBJETO: `{ apikey: "..." }` (formato v2 documentado)
 *   - `hash` como STRING direta (formato v1, por segurança de versão antiga)
 *   - `token`/`apikey` soltos na raiz ou dentro de `instance` (visto em
 *     variações de fork/versão da Evolution API)
 * Devolve `null` se nenhum campo reconhecido existir — quem chama (
 * `EvolutionClient.createInstance`/`fetchInstances`) trata `null` como "sem
 * credencial própria capturada", nunca lança por isso.
 */
function readInstanceApiKey(root: Record<string, unknown>, instance: Record<string, unknown> | null): string | null {
  const hashRaw = root.hash;
  if (typeof hashRaw === 'string' && hashRaw.length > 0) return hashRaw;
  const hashRecord = asRecord(hashRaw);
  return (
    readString(hashRecord?.apikey) ??
    readString(root.token) ??
    readString(root.apikey) ??
    readString(instance?.token) ??
    readString(instance?.apikey) ??
    readString(instance?.hash) ??
    null
  );
}

/** `POST /instance/create` — resposta traz instância criada e, com `qrcode:true`, o QR já na mesma chamada. */
export function parseCreateInstanceResponse(body: unknown): {
  instanceName: string | null;
  instanceId: string | null;
  state: RawInstanceState | null;
  qr: ParsedQr | null;
  /** 🆕 credencial própria da instância (ver `readInstanceApiKey` acima) — `null` se não capturada. */
  apiKey: string | null;
} {
  const root = asRecord(body) ?? {};
  const instance = asRecord(root.instance) ?? root;
  return {
    instanceName: readString(instance.instanceName) ?? readString(root.instanceName),
    instanceId: readString(instance.instanceId) ?? readString(root.instanceId),
    state: (readString(instance.status) ?? readString(instance.state)) as RawInstanceState | null,
    qr: readQr(root),
    apiKey: readInstanceApiKey(root, instance),
  };
}

export type FetchedInstanceInfo = {
  /** `evolutionInstanceName` (o nome dentro do container Evolution, não o `id`/`name` amigável nosso). */
  instanceName: string | null;
  /** Credencial própria desta instância — `null` se a Evolution não devolveu nenhum campo reconhecido para ela. */
  apiKey: string | null;
};

/**
 * `GET /instance/fetchInstances` — usado pelo comando operacional
 * `apps/web/scripts/sync-instance-api-keys.ts` para preencher a credencial
 * própria de instâncias JÁ PAREADAS (criadas antes desta correção, ou cuja
 * captura em `parseCreateInstanceResponse` falhou). NÃO CONFIRMADO contra
 * servidor real qual dos dois formatos abaixo a v2.3.7 usa — aceita os dois,
 * mesma convenção de aninhamento de `parseCreateInstanceResponse`:
 *   - achatado: `[{ name/instanceName, token/hash/apikey, ... }]`
 *   - aninhado: `[{ instance: { instanceName, token/hash/apikey } }]`
 */
export function parseFetchInstancesResponse(body: unknown): FetchedInstanceInfo[] {
  const root = asRecord(body);
  const list: unknown[] = Array.isArray(body) ? body : Array.isArray(root?.instances) ? (root!.instances as unknown[]) : [];
  return list.map((item) => {
    const itemRoot = asRecord(item) ?? {};
    const instance = asRecord(itemRoot.instance);
    const instanceName =
      readString(instance?.instanceName) ?? readString(instance?.name) ?? readString(itemRoot.instanceName) ?? readString(itemRoot.name);
    return { instanceName, apiKey: readInstanceApiKey(itemRoot, instance) };
  });
}

/** `GET /instance/connect/:name` — devolve QR (ainda conectando) OU `{instance:{state:'open'}}` se já pareado. */
export function parseConnectResponse(body: unknown): { state: RawInstanceState | null; qr: ParsedQr | null } {
  const root = asRecord(body) ?? {};
  const instance = asRecord(root.instance);
  const qr = readQr(root);
  return {
    state: (instance && (readString(instance.state) as RawInstanceState | null)) ?? (qr ? 'connecting' : null),
    qr,
  };
}

/** `GET /instance/connectionState/:name`. */
export function parseConnectionStateResponse(body: unknown): RawInstanceState | null {
  const root = asRecord(body) ?? {};
  const instance = asRecord(root.instance) ?? root;
  return readString(instance.state) as RawInstanceState | null;
}

/** `POST /message/sendText/:name`. */
export function parseSendTextResponse(body: unknown): {
  providerMessageId: string | null;
  remoteJid: string | null;
  status: string | null;
} {
  const root = asRecord(body) ?? {};
  const key = asRecord(root.key);
  return {
    providerMessageId: readString(key?.id),
    remoteJid: readString(key?.remoteJid),
    status: readString(root.status),
  };
}

/**
 * `POST /chat/whatsappNumbers/:name` — endpoint experimental deste cliente
 * (não exigido pelo contrato original, adicionado como pré-checagem
 * opcional de `INVALID_NUMBER` antes de gastar uma tentativa de envio). O
 * shape exato da resposta (array na raiz vs `{numbers:[...]}`) NÃO foi
 * confirmado contra doc — aceita as duas formas.
 */
export function parseCheckNumbersResponse(
  body: unknown,
): Array<{ number: string | null; exists: boolean; jid: string | null }> {
  const root = asRecord(body);
  const list: unknown[] = Array.isArray(body) ? body : Array.isArray(root?.numbers) ? (root?.numbers as unknown[]) : [];
  return list.map((item) => {
    const record = asRecord(item) ?? {};
    return {
      number: readString(record.number),
      exists: record.exists === true,
      jid: readString(record.jid),
    };
  });
}

/** Extrai uma mensagem de erro legível de um corpo de erro da Evolution (o formato varia por versão/endpoint). */
export function extractErrorMessage(body: unknown, fallback: string): string {
  const root = asRecord(body);
  if (!root) return fallback;

  const direct = readString(root.message) ?? readString(root.error);
  if (direct) return direct;

  const messageArray = extractStringArray(root.message);
  if (messageArray) return messageArray;

  const response = asRecord(root.response);
  if (response) {
    const nested = readString(response.message);
    if (nested) return nested;
    const nestedArray = extractStringArray(response.message);
    if (nestedArray) return nestedArray;
  }

  return fallback;
}

function extractStringArray(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const joined = value.filter((m): m is string => typeof m === 'string').join('; ');
  return joined.length > 0 ? joined : null;
}
