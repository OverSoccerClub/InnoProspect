import { mulberry32 } from '@/lib/utils';

/**
 * Parser de variáveis `{{var}}` e spintax `{opção a|opção b}` — só para o
 * preview ao vivo do editor de templates (ARQUITETURA.md §4.4/§6.4).
 *
 * NÃO é a fonte de verdade: quem valida e renderiza de verdade no envio é o
 * backend (`packages/core/templates/spintax.ts`, do Vega — `POST
 * /api/v1/templates` responde 422 UNKNOWN_VARIABLE/INVALID_SPINTAX). Este
 * módulo existe porque o preview precisa reagir a cada tecla digitada sem
 * round-trip de rede, e porque templates ainda não salvos (modo "novo
 * template") não têm `id` para chamar `POST /templates/:id/preview`. Mantém
 * a mesma sintaxe do contrato de propósito — se o backend mudar a
 * gramática, este arquivo precisa acompanhar.
 */

export const KNOWN_VARIABLES = [
  'nome',
  'primeiro_nome',
  'cidade',
  'uf',
  'categoria',
  'site',
  'telefone',
  'minha_empresa',
] as const;

export type KnownVariable = (typeof KNOWN_VARIABLES)[number];

export const VARIABLE_LABEL: Record<KnownVariable, string> = {
  nome: 'Nome da empresa',
  primeiro_nome: 'Primeiro nome',
  cidade: 'Cidade',
  uf: 'UF',
  categoria: 'Categoria',
  site: 'Site',
  telefone: 'Telefone',
  minha_empresa: 'Sua empresa',
};

/** Valores de exemplo usados só no preview local (o preview do servidor usa um lead real). */
const SAMPLE_VALUES: Record<KnownVariable, string> = {
  nome: 'Clínica Sorriso Ltda',
  primeiro_nome: 'Clínica',
  cidade: 'Campinas',
  uf: 'SP',
  categoria: 'clínica odontológica',
  site: 'clinicasorriso.com.br',
  telefone: '(19) 99876-5432',
  minha_empresa: 'Sua Empresa',
};

function isKnownVariable(name: string): name is KnownVariable {
  return (KNOWN_VARIABLES as readonly string[]).includes(name);
}

type Token =
  | { type: 'text'; value: string }
  | { type: 'variable'; name: string }
  | { type: 'spintax'; options: string[] };

export type SpintaxDiagnostic = { message: string };

/**
 * Tokeniza em uma única passada — de propósito, em vez de duas regexes
 * independentes para variável e spintax, porque `{{nome}}` e `{opção}` usam
 * o mesmo caractere `{` e uma regex de spintax ingênua (`\{[^{}]+\}`)
 * confundiria o miolo de uma variável com um grupo de spintax.
 */
function tokenize(body: string): { tokens: Token[]; diagnostics: SpintaxDiagnostic[] } {
  const tokens: Token[] = [];
  const diagnostics: SpintaxDiagnostic[] = [];
  let i = 0;
  let textBuf = '';

  const flushText = () => {
    if (textBuf) {
      tokens.push({ type: 'text', value: textBuf });
      textBuf = '';
    }
  };

  while (i < body.length) {
    if (body[i] === '{' && body[i + 1] === '{') {
      const end = body.indexOf('}}', i + 2);
      if (end === -1) {
        diagnostics.push({ message: 'Uma variável "{{...}}" não foi fechada corretamente.' });
        textBuf += body.slice(i);
        break;
      }
      flushText();
      tokens.push({ type: 'variable', name: body.slice(i + 2, end).trim() });
      i = end + 2;
      continue;
    }

    if (body[i] === '{') {
      const end = body.indexOf('}', i + 1);
      if (end === -1) {
        diagnostics.push({ message: 'Uma chave de variação "{opção a|opção b}" não foi fechada.' });
        textBuf += body.slice(i);
        break;
      }
      const inner = body.slice(i + 1, end);
      if (inner.includes('{')) {
        diagnostics.push({
          message: 'Chaves de variação não podem ser aninhadas — use só um nível: {opção a|opção b}.',
        });
      }
      flushText();
      tokens.push({ type: 'spintax', options: inner.split('|').map((s) => s.trim()) });
      i = end + 1;
      continue;
    }

    if (body[i] === '}') {
      diagnostics.push({ message: 'Há uma "}" sem uma "{" correspondente antes dela.' });
    }

    textBuf += body[i];
    i++;
  }
  flushText();
  return { tokens, diagnostics };
}

/** Todas as variáveis `{{...}}` usadas no corpo, na ordem em que aparecem, sem repetição. */
export function extractVariables(body: string): string[] {
  const found: string[] = [];
  for (const t of tokenize(body).tokens) {
    if (t.type === 'variable' && !found.includes(t.name)) found.push(t.name);
  }
  return found;
}

/** Variáveis usadas que não estão na lista permitida pelo contrato (§4.4) — geram 422 UNKNOWN_VARIABLE no backend. */
export function findUnknownVariables(body: string): string[] {
  return extractVariables(body).filter((v) => !isKnownVariable(v));
}

/**
 * Igual a `extractVariables`, mas só devolve as que batem com `KNOWN_VARIABLES`
 * — usado para preencher `TemplateItem.variablesUsed` (tipado como
 * `TemplateVariable[]` em `@inno/contracts`, não `string[]`). Chamar depois
 * de `findUnknownVariables` já ter validado que não sobrou nenhuma desconhecida.
 */
export function extractKnownVariables(body: string): KnownVariable[] {
  return extractVariables(body).filter(isKnownVariable);
}

/** Diagnóstico de sintaxe de spintax (chaves desbalanceadas/aninhadas) — espelha o 422 INVALID_SPINTAX do backend. */
export function checkSpintaxSyntax(body: string): SpintaxDiagnostic[] {
  return tokenize(body).diagnostics;
}

export function hasSpintax(body: string): boolean {
  return tokenize(body).tokens.some((t) => t.type === 'spintax');
}

/** Combinações possíveis de texto — produto do nº de opções de cada grupo de spintax. */
export function countVariations(body: string): number {
  let total = 1;
  for (const t of tokenize(body).tokens) {
    if (t.type === 'spintax') total *= Math.max(1, t.options.length);
  }
  return total;
}

export type VariationRisk = 'low' | 'medium' | 'good';

/**
 * `low` (<3): mesmo limiar do aviso `LOW_VARIATION` que o backend devolve no
 * `POST /templates`. `medium` (<10): limiar que bloqueia o `start` da
 * campanha com `> 50` alvos (`409 INSUFFICIENT_TEXT_VARIATION`, §6.4).
 */
export function variationRisk(count: number): VariationRisk {
  if (count < 3) return 'low';
  if (count < 10) return 'medium';
  return 'good';
}

/** Renderiza uma amostra: substitui variáveis por valores de exemplo e sorteia uma opção por grupo de spintax. */
export function renderSample(body: string, seed: number): string {
  const random = mulberry32(seed);
  return tokenize(body)
    .tokens.map((t) => {
      if (t.type === 'text') return t.value;
      if (t.type === 'variable') {
        return isKnownVariable(t.name) ? SAMPLE_VALUES[t.name] : `{{${t.name}}}`;
      }
      const idx = Math.floor(random() * t.options.length);
      return t.options[idx] ?? '';
    })
    .join('');
}

/** Gera `count` amostras com seeds diferentes — para o preview mostrar a variação "de verdade", não só uma versão. */
export function renderSamples(body: string, count = 3): string[] {
  return Array.from({ length: count }, (_, i) => renderSample(body, 1000 + i * 977));
}
