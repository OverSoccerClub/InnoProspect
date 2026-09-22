/**
 * Dispara o download de uma URL autenticada por cookie (ex.: `GET /api/v1/leads/export`,
 * que responde `Content-Disposition: attachment`) sem navegar a SPA para fora da página —
 * o navegador honra o header e mantém a rota atual.
 */
export function triggerUrlDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Dispara o download de um conteúdo já pronto no cliente — usado pelo modo mock
 * (`NEXT_PUBLIC_USE_MOCKS=true`), que não tem servidor gerando o arquivo de verdade.
 */
export function triggerBlobDownload(filename: string, content: BlobPart, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
