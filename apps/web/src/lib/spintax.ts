import {
  countSpintaxVariations,
  extractKnownVariables as coreExtractKnownVariables,
  extractVariableTokens,
  hasSpintax as coreHasSpintax,
  parseSpintax,
  renderTemplate,
  resolveSpintax,
  SpintaxSyntaxError,
  validateTemplateVariables,
  type SpintaxParseErrorCode,
  type TemplateVariableValues,
} from '@inno/core';
import { TEMPLATE_ALLOWED_VARIABLES, type TemplateVariable } from '@inno/contracts';

/**
 * lib/spintax.ts — camada de APRESENTAÇÃO do preview local do editor de
 * templates (ARQUITETURA §4.4/§6.4/§4.9.4). A análise de sintaxe de verdade
 * — o que decide se `{opção a|opção b}` é válido, se `{{...}}` é bloco
 * opaco, e como sortear uma variação — é `@inno/core` (`templates/render.ts`
 * + `templates/spintax.ts`), a MESMA engine que `lib/services/templates.ts`
 * (POST /templates) e o motor de envio usam.
 *
 * Antes deste arquivo tinha o SEU PRÓPRIO tokenizer, reimplementando a
 * contagem de chaves `{`/`}` — e discordava do `@inno/core` bem no caso que
 * mais importa: `{a|b {{nome}}}` (spintax com variável dentro de uma
 * opção). O tokenizer daqui parava na primeira `}` de `{{nome}}` (a
 * primeira das duas), via um `{` sobrando e recusava como "aninhado" —
 * enquanto o motor de envio (`@inno/core`) sempre tratou `{{...}}` como
 * bloco opaco e aceitava o texto sem problema. Resultado: o dono via
 * "sintaxe inválida" na tela para um texto que seria enviado normalmente
 * (e, no caminho inverso, o preview reconstruía as opções truncadas —
 * "{a|b" — e escondia esse erro maior). Duas implementações do mesmo
 * parser SEMPRE voltam a divergir no primeiro ajuste; a correção é ter uma
 * só. Não recriar um segundo parser aqui, mesmo que pareça mais simples
 * para um caso novo — estender `@inno/core` em vez disso.
 *
 * O que continua só aqui, de propósito (adaptação legítima, não duplicata):
 *   - `KNOWN_VARIABLES`/`VARIABLE_LABEL`/`SAMPLE_VALUES`: rótulos e valores
 *     de exemplo em PT-BR para a UI — não é regra de negócio.
 *   - `checkSpintaxSyntax`: traduz o `SpintaxParseErrorCode` do core para
 *     uma frase em português que o dono entende sem saber o que é "spintax
 *     aninhado" — a REGRA (o que é válido) vem do core; só a REDAÇÃO da
 *     mensagem é daqui.
 *   - `variationRisk`, `renderSample(s)`: puramente de exibição (cor do
 *     badge, gerar N amostras diferentes para "sentir" a variação).
 *   - `renderWithSeed`: usado só pelo mock de dev (`mocks/leads.ts`, atrás
 *     de `USE_MOCKS`) para simular o preview/envio reais sem round-trip —
 *     mesmo pipeline do core (`renderTemplate` → `resolveSpintax`), só com
 *     o fallback de "sem valor real, usa a amostra genérica" que o preview
 *     do editor também quer (o backend de verdade não faz esse fallback —
 *     ele avisa com `missingVariables` em vez de inventar um valor).
 */

export const KNOWN_VARIABLES = TEMPLATE_ALLOWED_VARIABLES;

export type KnownVariable = TemplateVariable;

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

export type SpintaxDiagnostic = { message: string };

/** Tradução de `SpintaxParseErrorCode` (`@inno/core`) para uma frase que o dono entende, sem jargão de parser. */
const SPINTAX_ERROR_MESSAGE: Record<SpintaxParseErrorCode, string> = {
  NESTED_SPINTAX: 'Chaves de variação não podem ser aninhadas — use só um nível: {opção a|opção b}.',
  UNCLOSED_BRACE: 'Uma chave de variação "{opção a|opção b}" não foi fechada.',
  UNEXPECTED_CLOSING_BRACE: 'Há uma "}" sem uma "{" correspondente antes dela.',
  EMPTY_OPTION: 'Uma opção de variação está vazia — revise o texto entre as barras "|".',
};

/**
 * Posição de um `{{` sem `}}` de fechamento correspondente, ou `null` se
 * não houver. Isto é sobre VARIÁVEL (`{{...}}`), não sobre spintax — por
 * isso não usa `parseSpintax`: `@inno/core` trata `{{` sem fechamento como
 * bloco opaco até o fim do texto (silencioso — pra ele, variável malformada
 * só significa "não vai ser substituída", não é erro de sintaxe). Aqui
 * vale bloquear ANTES de salvar, porque senão a chave crua ("Oi {{nome")
 * vaza pro texto que sai pro WhatsApp. Checagem independente das chaves de
 * spintax — não é uma segunda análise da MESMA coisa, é sobre outro padrão.
 */
function findUnclosedVariableBrace(body: string): number | null {
  let i = 0;
  while (i < body.length) {
    if (body[i] === '{' && body[i + 1] === '{') {
      const close = body.indexOf('}}', i + 2);
      if (close === -1) return i;
      i = close + 2;
      continue;
    }
    i++;
  }
  return null;
}

/** Diagnóstico de sintaxe (chaves desbalanceadas/aninhadas/vazias) — mesma regra de `@inno/core#parseSpintax`, mensagem em português. */
export function checkSpintaxSyntax(body: string): SpintaxDiagnostic[] {
  if (findUnclosedVariableBrace(body) !== null) {
    return [{ message: 'Uma variável "{{...}}" não foi fechada corretamente.' }];
  }
  const result = parseSpintax(body);
  if (result.valid) return [];
  return [{ message: SPINTAX_ERROR_MESSAGE[result.error.code] }];
}

/** `true` se o corpo tiver ao menos um bloco spintax válido. */
export function hasSpintax(body: string): boolean {
  return coreHasSpintax(body);
}

/** Combinações possíveis de texto — produto do nº de opções de cada grupo de spintax. */
export function countVariations(body: string): number {
  return countSpintaxVariations(body);
}

/** Todas as variáveis `{{...}}` usadas no corpo, na ordem em que aparecem, sem repetição (inclui desconhecidas). */
export function extractVariables(body: string): string[] {
  return extractVariableTokens(body);
}

/** Variáveis usadas que não estão na lista permitida pelo contrato (§4.4) — geram 422 UNKNOWN_VARIABLE no backend. */
export function findUnknownVariables(body: string): string[] {
  const result = validateTemplateVariables(body);
  return result.valid ? [] : result.unknownVariables;
}

/**
 * Igual a `extractVariables`, mas só devolve as que batem com `KNOWN_VARIABLES`
 * — usado para preencher `TemplateItem.variablesUsed` (tipado como
 * `TemplateVariable[]` em `@inno/contracts`, não `string[]`). Chamar depois
 * de `findUnknownVariables` já ter validado que não sobrou nenhuma desconhecida.
 */
export function extractKnownVariables(body: string): KnownVariable[] {
  return coreExtractKnownVariables(body);
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

/**
 * `resolveSpintax` (`@inno/core`) LANÇA em sintaxe inválida — correto para o
 * envio real (nunca deveria receber um template inválido, já bloqueado na
 * criação por `checkSpintaxSyntax`/`422 INVALID_SPINTAX`). Mas o preview
 * local roda a CADA TECLA, inclusive com o corpo num estado intermediário
 * normal de digitação (ex.: `{opção a` — chave ainda não fechada). Deixar
 * a exceção subir quebraria a tela no meio da digitação; aqui é só exibição,
 * então em caso de sintaxe inválida cai para o texto com as variáveis já
 * substituídas mas sem sortear a variação — melhor um preview "cru" e
 * legível do que a tela inteira quebrando (mesmo espírito do tokenizer
 * antigo, que também nunca lançava).
 */
function resolveSpintaxForPreview(rendered: string, seed: string): string {
  try {
    return resolveSpintax(rendered, { seed });
  } catch (err) {
    if (err instanceof SpintaxSyntaxError) return rendered;
    throw err;
  }
}

/**
 * Como `renderSample`, mas com valores reais (do lead) em vez dos genéricos
 * de `SAMPLE_VALUES`, e com seed string (não numérico) — usado no mock de
 * dev do compositor de envio (`mocks/leads.ts`, ARQUITETURA §4.9.4: "o que
 * eu vi no preview é o que sai"). Mesmo pipeline do core (`renderTemplate`
 * → `resolveSpintax`); a única adaptação é o fallback pro valor de exemplo
 * quando falta o valor real (mantém o preview legível) — o backend de
 * verdade não faz esse fallback, ele avisa via `missingVariables`.
 */
export function renderWithSeed(body: string, spintaxSeed: string, values: Partial<Record<KnownVariable, string>>): string {
  const merged: TemplateVariableValues = { ...SAMPLE_VALUES, ...values };
  const rendered = renderTemplate(body, merged);
  return resolveSpintaxForPreview(rendered, spintaxSeed);
}

/** Renderiza uma amostra: substitui variáveis por valores de exemplo e sorteia uma opção por grupo de spintax. */
export function renderSample(body: string, seed: number): string {
  const rendered = renderTemplate(body, SAMPLE_VALUES);
  return resolveSpintaxForPreview(rendered, String(seed));
}

/** Gera `count` amostras com seeds diferentes — para o preview mostrar a variação "de verdade", não só uma versão. */
export function renderSamples(body: string, count = 3): string[] {
  return Array.from({ length: count }, (_, i) => renderSample(body, 1000 + i * 977));
}
