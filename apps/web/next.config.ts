import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// __dirname não existe em ESM ("type": "module" no package.json) — deriva
// do próprio módulo. Usado só para `outputFileTracingRoot` abaixo.
const currentDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O lint NÃO roda dentro do `next build`. A imagem Docker instala só o que
  // `--filter web...` alcança, e o `apps/web/eslint.config.mjs` importa o
  // `eslint.config.js` da RAIZ, que por sua vez importa `packages/config` —
  // pacote fora desse filtro. Resultado no build da imagem:
  // "⨯ ESLint: Cannot find module '/app/eslint.config.js'".
  // Copiar a cadeia de config de lint para dentro da imagem de produção seria
  // carregar peso morto: o lint já é obrigatório via `pnpm lint` no monorepo
  // (turbo, 6/6), que é onde ele pertence. A checagem de TIPOS continua
  // ligada no build — essa sim precisa rodar aqui.
  eslint: { ignoreDuringBuilds: true },
  // Necessário para o Dockerfile (apps/web/Dockerfile): gera `.next/standalone`
  // com server.js + só os node_modules que a árvore de import realmente usa
  // (tracing), em vez de copiar o node_modules inteiro pra imagem final.
  output: 'standalone',
  // Em monorepo pnpm, o Next precisa saber onde fica a RAIZ do workspace pra
  // resolver corretamente os pacotes internos (@inno/contracts, @inno/core,
  // @inno/db, resolvidos via symlink de `packages/*`) durante o tracing do
  // standalone. Sem isso o Next às vezes acerta sozinho (detecção automática
  // de lockfile), mas setar explícito evita o warning "inferred workspace
  // root" e garante que o `.next/standalone` saia com a estrutura
  // `apps/web/server.js` que o Dockerfile espera. Ver ARQUITETURA.md §2.
  // ⚠️ Não validado com `docker build` nesta máquina (sem Docker instalado) —
  // é o padrão oficial do Next.js para monorepos, revisar no primeiro build real.
  outputFileTracingRoot: path.join(currentDir, '../../'),
  // Pacotes internos importados como fonte TS pura (`exports: { ".":
  // "./src/index.ts" }`, sem build próprio) — o Next precisa transpilá-los
  // ele mesmo, senão o webpack tenta resolver `./common.js` etc. literalmente
  // (extensão `.js` usada nos imports do pacote fonte, ESM-style) e falha em
  // `next build` (não aparece em `next dev`/`tsc`, só no build de produção).
  // NUNCA incluir `@inno/scraper` aqui — carrega Playwright/Chromium no
  // import de nível de módulo, e isso não pode entrar no bundle do servidor
  // Next.js (ver lib/services/searches.ts para o motivo completo).
  transpilePackages: ['@inno/contracts', '@inno/core', '@inno/db'],
  // Os pacotes internos importam entre si com extensão `.js` explícita
  // apontando pra arquivo `.ts` fonte (convenção ESM/NodeNext do monorepo,
  // ver tsconfig.base.json `moduleResolution: "Bundler"`) — o webpack do
  // Next não resolve isso por padrão (só o `tsc` entende via
  // `moduleResolution: Bundler`). `extensionAlias` ensina o webpack a tentar
  // `.ts`/`.tsx` quando o import pede `.js`.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    // `bullmq` tenta resolver opcionalmente o backend alternativo
    // `@valkey/valkey-glide` (não instalado — usamos Redis via `ioredis`,
    // o backend default). Sem isso o build só gera um warning inofensivo,
    // mas `false` faz o webpack tratar o import como módulo vazio em vez
    // de tentar (e falhar) resolver o pacote de verdade.
    config.resolve.alias = { ...config.resolve.alias, '@valkey/valkey-glide': false };
    return config;
  },
  // ─────────────────────────────────────────────────────────────────────
  // Headers de segurança (Vulcano, pendência aberta desde a Fase 1,
  // reafirmada pela revisão do Órion em 2026-08-03). Motivo de subir de
  // prioridade agora: existe uma página PÚBLICA real (`/descadastro/:token`,
  // Fase 3, sem sessão) — a superfície de clickjacking/injeção deixou de ser
  // teórica.
  //
  // Aplicado a TODAS as rotas (`/:path*`), incluindo `/api/**` — headers
  // como CSP/X-Frame-Options são inofensivos em respostas JSON e o custo de
  // uma exceção por rota não compensa a chance de esquecer uma rota nova.
  //
  // ⚠️ Isto é CSP estático via `next.config.ts` (headers de build), NÃO um
  // CSP com nonce por request. Um CSP com nonce (mais estrito: eliminaria o
  // `'unsafe-inline'` de `script-src`) exige gerar o nonce no
  // `apps/web/src/middleware.ts` a cada request e devolvê-lo no próprio
  // header — arquivo que está fora do escopo desta entrega (território do
  // Vega/Lyra). Registrado como melhoria futura, não como esquecimento.
  //
  // Testado com `pnpm --filter web run build` nesta entrega (ver handoff) —
  // isso confirma que o CSP não quebra o BUILD (nenhum asset do Next é
  // servido de origem bloqueada). Não confirma runtime: CSP só é aplicado
  // pelo navegador contra requests reais, e as chamadas de API do cliente
  // aqui são todas mesma-origem (`/api/v1/*`, ver `apps/web/src/lib/fetcher.ts`)
  // — não há nenhum domínio externo conhecido que o app precise chamar do
  // browser. Se isso mudar (ex.: SDK de terceiro carregado no client), esta
  // CSP vai bloquear silenciosamente até alguém abrir o console do navegador
  // e ver o erro "Refused to connect/load ... violates CSP" — é o sintoma a
  // procurar primeiro se algo "some" visualmente depois deste commit.
  async headers() {
    const csp = [
      // Bloqueia por padrão qualquer origem não listada explicitamente.
      "default-src 'self'",
      // 'unsafe-inline' necessário: o Next.js App Router injeta um <script>
      // inline (dados de hidratação/streaming) sem nonce nesta configuração
      // (ver nota acima sobre middleware). Sem isto, a APLICAÇÃO INTEIRA
      // fica em tela branca (é o jeito mais comum de "CSP quebra o app na
      // hora" — testado mentalmente contra o próprio aviso desta tarefa).
      "script-src 'self' 'unsafe-inline'",
      // 'unsafe-inline' necessário: Radix UI (base dos componentes em
      // `components/ui/*`, ex. `dialog.tsx`) define posição/animação via
      // atributo `style` inline no elemento, não por classe CSS — isso é
      // governado por style-src, não por script-src.
      "style-src 'self' 'unsafe-inline'",
      // `data:` para o QR Code do WhatsApp, renderizado como
      // `data:image/png;base64,...` (`components/whatsapp/qr-code-dialog.tsx`,
      // `lib/services/whatsapp-instances.ts`) — sem isso o QR não aparece.
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // Todo fetch do client é mesma origem (`/api/v1/*`, `/api/webhooks/*`)
      // — nunca chama a Evolution API nem nenhum serviço externo diretamente
      // do navegador (isso é sempre proxied pelo servidor Next). Se um dia
      // isso mudar, listar o domínio aqui explicitamente, nunca abrir para '*'.
      "connect-src 'self'",
      // Bloqueia plugins tipo Flash/Java/PDF embutido — não usados aqui.
      "object-src 'none'",
      // Impede que ESTE app seja carregado dentro de um <iframe> em
      // qualquer origem — defesa de clickjacking moderna (substitui/reforça
      // o header X-Frame-Options abaixo, que fica como fallback para
      // navegadores mais antigos que não leem frame-ancestors).
      "frame-ancestors 'none'",
      // Impede injeção de <base href> para sequestrar caminhos relativos.
      "base-uri 'self'",
      // Formulários (login, etc.) só podem submeter para a própria origem.
      "form-action 'self'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          // Fallback de navegadores antigos para frame-ancestors (acima).
          { key: 'X-Frame-Options', value: 'DENY' },
          // Impede o navegador de "adivinhar" o content-type de uma
          // resposta (ex.: tratar um upload como HTML/script executável).
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Não vaza a URL completa (que pode conter query strings
          // sensíveis, ex. token de descadastro) para sites de terceiro
          // quando o usuário clica num link que sai do app; ainda envia a
          // origem em navegação same-origin.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Desliga APIs de browser que este app não usa (câmera, microfone,
          // geolocalização, etc.) — reduz superfície mesmo se algum script
          // de terceiro futuro tentar usá-las.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          // Força HTTPS por 1 ano (com subdomínios) depois da primeira
          // visita bem-sucedida em HTTPS. O EasyPanel já termina TLS antes
          // do container (Traefik) — CONFIRME no EasyPanel que o domínio
          // tem "Force HTTPS"/redirect HTTP→HTTPS ligado antes de depender
          // deste header; senão um acesso HTTP acidental (ex.: teste local
          // sem domínio, ou domínio novo sem certificado ainda emitido) fica
          // banido do HTTPS pelo próprio navegador até o preload/max-age
          // expirar. Sem `preload` de propósito — entrar na lista de
          // preload dos navegadores é praticamente irreversível.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
