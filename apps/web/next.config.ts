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
};

export default nextConfig;
