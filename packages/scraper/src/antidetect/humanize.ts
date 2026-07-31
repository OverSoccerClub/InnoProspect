/**
 * antidetect/humanize.ts — scroll com curva, pausas, movimento de mouse
 * (ARQUITETURA §5.3). Não é perfeito — é o suficiente para não parecer um
 * `while(true) scroll`. Único arquivo além de `navigate.ts` que interage
 * com a página viva; nenhum seletor do Maps aqui (recebe o container já
 * resolvido por quem chama, via `extraction/selectors.ts`).
 */
import type { Page } from 'playwright';

export type ScrollStepOptions = {
  minPauseMs: number;
  maxPauseMs: number;
};

export const DEFAULT_SCROLL_PAUSE: ScrollStepOptions = { minPauseMs: 900, maxPauseMs: 2200 };

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Rola `containerSelector` em passos incrementais de tamanho variável (nunca
 * `scrollTo(bottom)` de uma vez — periodicidade/salto perfeito é assinatura
 * de bot). Retorna quantos passos foram dados.
 */
export async function humanScrollStep(
  page: Page,
  containerSelector: string,
  opts: ScrollStepOptions = DEFAULT_SCROLL_PAUSE,
): Promise<void> {
  const distance = 200 + Math.floor(Math.random() * 500);
  await page.evaluate(
    ({ selector, distance }: { selector: string; distance: number }) => {
      const el = document.querySelector(selector);
      el?.scrollBy({ top: distance, behavior: 'smooth' });
    },
    { selector: containerSelector, distance },
  );
  await page.waitForTimeout(randomBetween(opts.minPauseMs, opts.maxPauseMs));
}

/** Pequeno movimento de mouse antes de rolar — simula um humano ajustando a posição do cursor. */
export async function humanMouseJiggle(page: Page): Promise<void> {
  const x = 80 + Math.random() * 700;
  const y = 100 + Math.random() * 500;
  await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
}

/**
 * Hover ocasional (não a cada card, ~30% das vezes) num card de resultado —
 * ARQUITETURA §5.3: "ocasional hover em um card". Silencioso em falha (o
 * card pode ter saído do viewport entre o find e o hover).
 */
export async function maybeHoverCard(page: Page, cardSelector: string, probability = 0.3): Promise<void> {
  if (Math.random() > probability) return;
  const locator = page.locator(cardSelector).first();
  const count = await locator.count().catch(() => 0);
  if (count > 0) {
    await locator.hover({ timeout: 2000 }).catch(() => {});
  }
}
