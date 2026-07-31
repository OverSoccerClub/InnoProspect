/**
 * leads/phone.ts — normalização de telefone brasileiro para E.164 e
 * classificação fixo vs celular. Ver ARQUITETURA §3.2 regra 4 ("só celular
 * recebe WhatsApp") e handoff do Cronos: "telefone brasileiro tem armadilha
 * de DDD e do nono dígito — trate e teste".
 *
 * Armadilhas conhecidas do telefone BR que este módulo trata explicitamente:
 *   1. O "nono dígito": todo celular BR tem 9 dígitos locais (começa com
 *      `9`) desde a migração concluída em 2016-2017; um fixo tem 8. O
 *      scraper do Maps às vezes captura o número SEM o 9 (ex.: "11
 *      8765-4321" para um celular). Antes da adição do nono dígito, celular
 *      já começava por 6/7/8/9 (8 dígitos) — por isso um local de 8 dígitos
 *      começando em 6-9 é tratado como celular ao qual falta o 9 (e é
 *      reinserido); começando em 2-5 é fixo de verdade (8 dígitos é o
 *      padrão de fixo, nunca leva o 9).
 *   2. DDDs válidos no Brasil são um conjunto FECHADO de 67 códigos — não é
 *      "qualquer 2 dígitos". Um número com DDD fora dessa lista é lixo de
 *      extração (ex.: capturou parte do CEP por engano), não celular exótico.
 *   3. Um valor que não se encaixa em nenhum padrão reconhecível vira
 *      `unknown` — mais seguro que adivinhar (classificar errado como
 *      `mobile` dispararia WhatsApp para um número que pode ser fixo;
 *      `unknown` nunca dispara, por design em §3.2).
 */

/** DDDs válidos no Brasil (ANATEL) — conjunto fechado, não é "01-99". */
const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF
  62, 64, // GO
  63, // TO
  65, 66, // MT
  67, // MS
  68, // AC
  69, // RO
  71, 73, 74, 75, 77, // BA
  79, // SE
  81, 87, // PE
  82, // AL
  83, // PB
  84, // RN
  85, 88, // CE
  86, 89, // PI
  91, 93, 94, // PA
  92, 97, // AM
  95, // RR
  96, // AP
  98, 99, // MA
]);

export type PhoneType = 'mobile' | 'landline' | 'unknown';

export type NormalizedPhone = {
  /** `null` quando o valor de entrada não pôde ser reconhecido como telefone BR. */
  e164: string | null;
  type: PhoneType;
};

/** Remove tudo que não é dígito. */
function onlyDigits(raw: string): string {
  return raw.replace(/\D+/g, '');
}

/**
 * Extrai `{ ddd, local }` de uma string de dígitos já sem formatação,
 * tratando os prefixos comuns capturados do Maps: código do país (`55`),
 * dígito de discagem doméstica (`0`) antes do DDD, etc. Retorna `null` se
 * não for possível identificar um DDD válido nem um `local` de 8 ou 9
 * dígitos.
 */
function splitDddAndLocal(digits: string): { ddd: number; local: string } | null {
  let d = digits;

  // Remove código do país "55" quando o restante ainda fecha um número BR
  // plausível (DDD + 8 ou 9 dígitos = 10 ou 11 dígitos ao todo).
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    d = d.slice(2);
  }

  // Remove "0" de discagem doméstica antes do DDD (ex.: "021 98765-4321" para
  // fixo — 11 dígitos com o 0 — ou "0 21 98765-4321" para celular — 12
  // dígitos com o 0, já que o local tem 9 dígitos em vez de 8).
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) {
    d = d.slice(1);
  }

  if (d.length !== 10 && d.length !== 11) return null;

  const ddd = Number.parseInt(d.slice(0, 2), 10);
  const local = d.slice(2);

  if (!VALID_DDDS.has(ddd)) return null;
  if (local.length !== 8 && local.length !== 9) return null;

  return { ddd, local };
}

/**
 * Normaliza um telefone brasileiro capturado do scraping para E.164 e
 * classifica fixo/celular/desconhecido. Nunca lança — telefone malformado é
 * dado esperado (scraping de HTML de terceiros), não uma exceção.
 */
export function normalizeBrPhone(raw: string | null | undefined): NormalizedPhone {
  if (!raw) return { e164: null, type: 'unknown' };

  const digits = onlyDigits(raw);
  if (digits.length === 0) return { e164: null, type: 'unknown' };

  const split = splitDddAndLocal(digits);
  if (!split) return { e164: null, type: 'unknown' };

  const { ddd, local } = split;
  const first = local[0];

  let normalizedLocal: string;
  let type: PhoneType;

  if (local.length === 9) {
    // Celular sempre tem 9 dígitos locais, e o primeiro é obrigatoriamente
    // '9'. 9 dígitos sem começar em '9' não é um padrão BR reconhecível.
    if (first !== '9') return { e164: null, type: 'unknown' };
    normalizedLocal = local;
    type = 'mobile';
  } else if (first !== undefined && ['2', '3', '4', '5'].includes(first)) {
    // 8 dígitos, prefixo de fixo — fixo nunca leva o nono dígito.
    normalizedLocal = local;
    type = 'landline';
  } else if (first !== undefined && ['6', '7', '8', '9'].includes(first)) {
    // 8 dígitos com prefixo histórico de celular — o scraper perdeu o nono
    // dígito na captura; reinserimos.
    normalizedLocal = `9${local}`;
    type = 'mobile';
  } else {
    return { e164: null, type: 'unknown' };
  }

  return { e164: `+55${ddd}${normalizedLocal}`, type };
}

/** Atalho quando só o E.164 interessa (ex.: preencher `Lead.phoneE164`). */
export function toE164(raw: string | null | undefined): string | null {
  return normalizeBrPhone(raw).e164;
}

/** Atalho quando só a classificação interessa. */
export function classifyPhone(raw: string | null | undefined): PhoneType {
  return normalizeBrPhone(raw).type;
}
