/**
 * sanity/incident.ts — captura screenshot + HTML bruto no momento de uma
 * pausa automática (ARQUITETURA §5.7: "é o material que faz o conserto do
 * selectors.ts levar 20 minutos em vez de 3 horas"). Chamado pelo engine
 * quando um `ScrapeError` fatal/grave é lançado (`LAYOUT_CHANGED`,
 * `CAPTCHA_DETECTED`), nunca em erro comum (`NAVIGATION_TIMEOUT` isolado).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

export type IncidentCapture = {
  screenshotPath: string | null;
  htmlPath: string | null;
};

/**
 * Salva `screenshot.png` + `page.html` em `<baseDir>/<eventId>/`. Nunca
 * lança — falhar ao capturar o incidente não pode mascarar o erro original
 * que o disparou (o `ScrapeError` já foi/será lançado por quem chamou isto).
 */
export async function captureIncident(
  page: Page,
  eventId: string,
  baseDir: string = process.env.SCRAPE_INCIDENT_DIR ?? './storage/incidents',
): Promise<IncidentCapture> {
  const dir = path.join(baseDir, eventId);
  const result: IncidentCapture = { screenshotPath: null, htmlPath: null };

  try {
    await mkdir(dir, { recursive: true });
  } catch {
    return result;
  }

  const screenshotPath = path.join(dir, 'screenshot.png');
  const htmlPath = path.join(dir, 'page.html');

  await page
    .screenshot({ path: screenshotPath, fullPage: true })
    .then(() => {
      result.screenshotPath = screenshotPath;
    })
    .catch(() => {});

  await page
    .content()
    .then((html) => writeFile(htmlPath, html, 'utf8'))
    .then(() => {
      result.htmlPath = htmlPath;
    })
    .catch(() => {});

  return result;
}
