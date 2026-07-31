/**
 * templates/render.ts — substituição de `{{variável}}` (ARQUITETURA §4.4).
 * A lista de variáveis permitidas vem de `@inno/contracts`
 * (`TEMPLATE_ALLOWED_VARIABLES`) — fonte única, para não divergir entre a
 * validação de `POST /templates` (Vega) e esta renderização.
 *
 * Pipeline recomendado no worker/preview: `renderTemplate` (substitui
 * variáveis) roda ANTES de `../templates/spintax.ts#resolveSpintax` (sorteia
 * a variação) — depois de renderizar variáveis não sobra `{{` no texto, o
 * que também evita qualquer ambiguidade entre placeholder de variável e
 * bloco spintax. `resolveSpintax` tolera `{{...}}` não renderizado também,
 * então chamar na ordem inversa não quebra, só é o caminho não recomendado.
 */
import { TEMPLATE_ALLOWED_VARIABLES, type TemplateVariable } from '@inno/contracts';

const VARIABLE_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export type TemplateVariableValues = Partial<Record<TemplateVariable, string>>;

function isKnownVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_ALLOWED_VARIABLES as readonly string[]).includes(name);
}

/** Todos os nomes de variável referenciados no corpo, únicos, na ordem de 1ª aparição (inclui desconhecidos). */
export function extractVariableTokens(body: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of body.matchAll(VARIABLE_REGEX)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  }
  return ordered;
}

/** Só as variáveis referenciadas que pertencem à lista permitida. */
export function extractKnownVariables(body: string): TemplateVariable[] {
  return extractVariableTokens(body).filter(isKnownVariable);
}

export type VariableValidationResult =
  | { valid: true; variablesUsed: TemplateVariable[] }
  | { valid: false; unknownVariables: string[] };

/**
 * `422 UNKNOWN_VARIABLE` (ARQUITETURA §4.4) — qualquer `{{x}}` fora de
 * `TEMPLATE_ALLOWED_VARIABLES` faz esta função devolver `valid: false`.
 */
export function validateTemplateVariables(body: string): VariableValidationResult {
  const tokens = extractVariableTokens(body);
  const unknownVariables = tokens.filter((name) => !isKnownVariable(name));
  if (unknownVariables.length > 0) {
    return { valid: false, unknownVariables };
  }
  return { valid: true, variablesUsed: tokens.filter(isKnownVariable) };
}

/**
 * Substitui `{{variável}}` pelo valor correspondente em `values`. Variável
 * sem valor vira string vazia — use `findMissingVariables` antes se
 * precisar avisar o usuário (é o que alimenta
 * `PreviewTemplateResponse.missingVariables` em `@inno/contracts`).
 */
export function renderTemplate(body: string, values: TemplateVariableValues): string {
  return body.replace(VARIABLE_REGEX, (_full, name: string) => {
    if (!isKnownVariable(name)) return _full;
    return values[name] ?? '';
  });
}

/** Variáveis conhecidas referenciadas no corpo que não têm valor (ausente ou vazio) em `values`. */
export function findMissingVariables(body: string, values: TemplateVariableValues): TemplateVariable[] {
  return extractKnownVariables(body).filter((name) => {
    const value = values[name];
    return value === undefined || value === '';
  });
}

/** `{{primeiro_nome}}` — primeiro token do nome completo do Lead. */
export function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}
