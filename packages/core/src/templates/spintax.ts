/**
 * templates/spintax.ts — sintaxe `{opção a|opção b|opção c}`, sem
 * aninhamento no MVP (ARQUITETURA §4.4, §6.4). Convive no mesmo corpo de
 * template com variáveis `{{variável}}` (../templates/render.ts) — por isso
 * o parser aqui trata qualquer `{{...}}` como um bloco opaco (não é
 * spintax), em vez de confundir o segundo `{` com um spintax aninhado.
 */

export class SpintaxSyntaxError extends Error {}

export type SpintaxParseErrorCode =
  | 'UNCLOSED_BRACE'
  | 'UNEXPECTED_CLOSING_BRACE'
  | 'NESTED_SPINTAX'
  | 'EMPTY_OPTION';

export type SpintaxParseError = {
  code: SpintaxParseErrorCode;
  message: string;
  index: number;
};

export type SpintaxParseResult =
  | { valid: true; optionSets: string[][] }
  | { valid: false; error: SpintaxParseError };

/**
 * Varre `text` uma única vez, coletando o conjunto de opções de cada bloco
 * `{a|b|c}`. Blocos `{{...}}` (variável) são pulados inteiros e não contam
 * como spintax. Retorna erro estruturado em vez de lançar — quem valida
 * `POST /templates` (Vega, próxima rodada) transforma isso em
 * `422 INVALID_SPINTAX`.
 */
export function parseSpintax(text: string): SpintaxParseResult {
  const optionSets: string[][] = [];
  let depth = 0;
  let blockStart = -1;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // `{{...}}` é placeholder de variável — bloco opaco, não spintax.
    if (ch === '{' && text[i + 1] === '{') {
      const close = text.indexOf('}}', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }

    if (ch === '{') {
      if (depth === 1) {
        return {
          valid: false,
          error: {
            code: 'NESTED_SPINTAX',
            message: `spintax aninhado não é suportado (posição ${i})`,
            index: i,
          },
        };
      }
      depth = 1;
      blockStart = i;
    } else if (ch === '}') {
      if (depth === 0) {
        return {
          valid: false,
          error: {
            code: 'UNEXPECTED_CLOSING_BRACE',
            message: `'}' sem '{' correspondente (posição ${i})`,
            index: i,
          },
        };
      }
      const inner = text.slice(blockStart + 1, i);
      const options = inner.split('|').map((o) => o.trim());
      if (options.some((o) => o.length === 0)) {
        return {
          valid: false,
          error: {
            code: 'EMPTY_OPTION',
            message: `opção vazia dentro de '{${inner}}' (posição ${blockStart})`,
            index: blockStart,
          },
        };
      }
      optionSets.push(options);
      depth = 0;
    }

    i++;
  }

  if (depth !== 0) {
    return {
      valid: false,
      error: {
        code: 'UNCLOSED_BRACE',
        message: `chave '{' aberta sem fechamento correspondente (posição ${blockStart})`,
        index: blockStart,
      },
    };
  }

  return { valid: true, optionSets };
}

/** `true` se o corpo tiver ao menos um bloco spintax válido. */
export function hasSpintax(text: string): boolean {
  const result = parseSpintax(text);
  return result.valid && result.optionSets.length > 0;
}

/**
 * Combinações possíveis geradas pelos blocos `{a|b|c}` (produto do nº de
 * opções de cada bloco). Corpo sem spintax = 1 variação. Corpo com sintaxe
 * inválida também retorna 1 — quem cria/edita o template já bloqueia isso
 * separadamente com `parseSpintax` (`422 INVALID_SPINTAX`); esta função é
 * para exibição (`TemplateItem.spintaxVariations`), não validação.
 */
export function countSpintaxVariations(text: string): number {
  const result = parseSpintax(text);
  if (!result.valid || result.optionSets.length === 0) return 1;
  return result.optionSets.reduce((total, options) => total * options.length, 1);
}

// ─────────────────────────────────────────────────────────────────────────
// Sorteio determinístico (ARQUITETURA §6.4: "semente por campaignTargetId —
// o mesmo alvo, em retry, recebe o mesmo texto").
// ─────────────────────────────────────────────────────────────────────────

/** Hash determinístico de string → inteiro 32-bit (FNV-1a). */
function hashStringToSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** PRNG determinístico leve (mulberry32) — suficiente para escolher opções, não para criptografia. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ResolveSpintaxOptions = {
  /**
   * Semente estável (ex.: `campaignTargetId`). Mesmo texto + mesma semente
   * = mesmo resultado sempre — é isso que garante que um retry de envio não
   * manda uma segunda "versão" da mensagem para o mesmo lead. Sem semente,
   * usa `Math.random()` (útil para preview, onde variar a cada chamada é o
   * comportamento desejado).
   */
  seed?: string;
};

/**
 * Resolve `text` escolhendo uma opção de cada bloco spintax. Lança
 * `SpintaxSyntaxError` se a sintaxe for inválida — o chamador deve ter
 * validado com `parseSpintax` antes (na criação do template), então isto só
 * deveria acontecer se um template inválido escapou da validação.
 */
export function resolveSpintax(text: string, opts: ResolveSpintaxOptions = {}): string {
  const rng = opts.seed !== undefined ? mulberry32(hashStringToSeed(opts.seed)) : Math.random;

  let result = '';
  let depth = 0;
  let blockStart = -1;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '{' && text[i + 1] === '{') {
      const close = text.indexOf('}}', i + 2);
      const end = close === -1 ? text.length : close + 2;
      if (depth === 0) result += text.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '{') {
      if (depth === 1) {
        throw new SpintaxSyntaxError(`spintax aninhado não é suportado (posição ${i})`);
      }
      depth = 1;
      blockStart = i;
    } else if (ch === '}') {
      if (depth === 0) {
        throw new SpintaxSyntaxError(`'}' sem '{' correspondente (posição ${i})`);
      }
      const inner = text.slice(blockStart + 1, i);
      const options = inner.split('|').map((o) => o.trim());
      if (options.some((o) => o.length === 0)) {
        throw new SpintaxSyntaxError(`opção vazia dentro de '{${inner}}' (posição ${blockStart})`);
      }
      const pickIndex = Math.min(Math.floor(rng() * options.length), options.length - 1);
      result += options[pickIndex];
      depth = 0;
    } else if (depth === 0) {
      result += ch;
    }

    i++;
  }

  if (depth !== 0) {
    throw new SpintaxSyntaxError(`chave '{' aberta sem fechamento correspondente (posição ${blockStart})`);
  }

  return result;
}
