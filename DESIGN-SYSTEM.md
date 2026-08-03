# DESIGN-SYSTEM.md — InnoProspect

Fonte da verdade para identidade visual e sistema de design do InnoProspect.
Autora: Lyra. Escrito para que quem estender a UI (eu mesma numa próxima
rodada, ou outro agente) não precise adivinhar o porquê de um valor — cada
decisão tem a razão ao lado. Se um valor mudar, atualize este arquivo no
mesmo commit.

O InnoProspect é uma plataforma B2B de prospecção — uso diário e prolongado,
muito dado tabular, e alguns estados que **precisam gritar** porque o custo
de passarem despercebidos é alto (WhatsApp banido, scraper quebrado, campanha
parada). A referência de sofisticação pedida foi o Stripe: claro, espaçoso,
tipografia forte, dado apresentado como informação — não planilha crua.

---

## 1. Identidade e paleta

### 1.1 Por que esta cor

**Decisão travada com o dono:** identidade própria do InnoProspect, não a da
InnovareCode (o produto é vendido/licenciado a clientes — eles compram o
InnoProspect, não a agência). A paleta anterior (`oklch(0.47 0.17 258)`) era
literalmente o azul padrão do template shadcn com um comentário dizendo
"marca InnoProspect" — não era uma decisão, era ausência de uma.

A cor de marca escolhida é um **azul-azure** (hue ≈ 231 em OKLCH):

```
--primary: oklch(0.47 0.16 231)   /* light → #0066a3 */
--primary: oklch(0.72 0.12 231)   /* dark  → #44b2e2 */
```

Por que hue 231 especificamente: o navy da InnovareCode (`#0030b8`) fica em
torno de hue ≈ 262 no OKLCH — um azul puxando para **roxo/índigo**. Hue 231 é
um azul puxando para **ciano/azure**, perceptualmente distinto ao lado a
lado, mesmo os dois sendo "azul" (parentesco aceitável — azul é convenção de
confiança em B2B; **cópia** do tom específico não é). Se algum dia a marca
migrar de hue, mantenha a distância de pelo menos ~25° do navy da
InnovareCode para não colidir de novo.

### 1.2 Canvas vs. painel (não "tudo branco")

Em vez do padrão shadcn de fundo e card na mesma cor (`oklch(1 0 0)` para os
dois, sem separação visual real), o InnoProspect usa dois níveis:

- `--background` — o **canvas** da página, um cinza levemente frio
  (`oklch(0.975 0.004 250)` light / `oklch(0.17 0.012 250)` dark).
- `--card` — o **painel** elevado (cards, sidebar, topbar, tabelas,
  dialogs), quase branco puro (`oklch(0.995 0.002 250)` light /
  `oklch(0.225 0.014 250)` dark).

Essa diferença tonal sutil (visível, mas não um contraste forte) é o que dá a
sensação de profundidade "premium" sem depender de sombra pesada — é como
Stripe/Linear separam canvas de conteúdo.

### 1.3 Todos os tokens (light / dark)

| Token | Light | Dark | Uso |
|---|---|---|---|
| `background` | `#f5f7f9` | `#0b1015` | canvas da página |
| `foreground` | `#111419` | `#f0f2f4` | texto principal |
| `card` / `popover` | `#fcfdff` | `#171c22` | painéis elevados |
| `primary` | `#0066a3` | `#44b2e2` | marca, CTA, link, foco |
| `primary-foreground` | `#fcfcfc` | `#080c10` | texto sobre `primary` |
| `secondary` | `#edf0f4` | `#21272d` | botão secundário, pill neutro |
| `muted` | `#eff2f5` | `#22272c` | fundo discreto (skeleton, hover leve) |
| `muted-foreground` | `#55585e` | `#999fa6` | texto de apoio |
| `accent` | `#deeef6` | `#1e313a` | hover de item de navegação, avatar |
| `destructive` | `#b71824` | `#c92f33` | erro, ação destrutiva, risco crítico |
| `success` | `#006d2c` | `#329d5a` | sucesso, ganho, saudável |
| `warning` | `#dfa11a` | `#e9ab2b` | atenção, em andamento, degradado |
| `border` / `input` | cinza frio ~90% L | branco a 10–16% opacidade | divisórias, contorno de campo |
| `ring` | = `primary` | = `primary` | anel de foco |

Todos os pares texto/fundo relevantes foram verificados com um conversor
OKLCH→sRGB dedicado (não visual) contra WCAG 2.1 — ver §7 para a tabela
completa de razões calculadas. Não ajuste um valor sem recalcular lá.

### 1.4 Regra de ouro ao adicionar uma cor nova

Verde e âmbar são hues **perceptualmente claras** (alta contribuição no canal
G da luminância relativa) — em L moderado, texto **escuro** lê melhor sobre
elas do que texto branco, nos dois temas. Azul e vermelho são hues mais
**escuras** perceptualmente — em L moderado, texto branco lê melhor. Foi por
isso que:

- `primary-foreground` e `success-foreground`/`warning-foreground` **não**
  seguem a mesma regra entre si (branco vs. escuro) — cada par foi calculado
  para o hue específico, não copiado de um para o outro.
- Um único token de cor **não serve simultaneamente** para "preenchimento
  sólido com texto branco em cima" (badge/botão) e "texto colorido direto
  sobre fundo quase-preto" (alerta em dark mode) quando o hue é vermelho —
  ver o caso do Alert em §4.

---

## 2. Tipografia

Duas famílias, via `next/font/google` (self-hosted no build — obrigatório
pela CSP `font-src 'self'` que o Vulcano ativou; nada é buscado de CDN em
runtime). Configuradas em `apps/web/src/app/layout.tsx`, expostas como
variáveis CSS e mapeadas em `globals.css` (`@theme inline`):

- **Inter** (`--font-inter` → utilitário `font-sans`, padrão do `<body>`) —
  corpo de texto, formulários, e principalmente as **tabelas densas de
  leads**: excelente legibilidade em 12–14px e algarismos tabulares nativos
  (`tabular-nums`).
- **Plus Jakarta Sans** (`--font-jakarta` → utilitário `font-display`,
  pesos 500/600/700/800) — títulos de página, `CardTitle`, `DialogTitle`,
  KPIs. É o que dá a "voz" de marca além de tamanho/peso — não é só Inter
  maior.

Subsets `latin` + `latin-ext` nos dois (o `latin` sozinho não garante 100%
dos diacríticos do português — `ã`, `õ`, `ç` idealmente cobertos também pelo
`latin-ext` dependendo da fonte).

### Escala

| Papel | Classe | Fonte |
|---|---|---|
| Título de página (H1) | `font-display text-2xl font-semibold tracking-tight` | Jakarta |
| Título de card/dialog | `font-display text-lg font-semibold` (`CardTitle`/`DialogTitle` já aplicam) | Jakarta |
| KPI / número grande | `font-display text-3xl font-semibold tabular-nums` | Jakarta |
| Corpo | `text-sm` (14px, padrão) | Inter |
| Apoio / meta | `text-xs text-muted-foreground` | Inter |
| Números em tabela/coluna numérica | `tabular-nums` (alinha algarismos) | Inter |

Regra prática: **números que o olho precisa comparar em coluna** (avaliação,
telefone, contagens de KPI, totais) sempre levam `tabular-nums`. É isso que
faz a tabela parecer "informação", não uma planilha desalinhada.

---

## 3. Espaçamento, raio, elevação, densidade de tabela

- **Raio:** `--radius: 0.625rem` (10px), mantido do valor original — já
  estava numa faixa correta (nem "pilula" nem quadrado duro). Escala
  derivada: `sm = radius - 4px`, `md = radius - 2px`, `lg = radius`,
  `xl = radius + 4px`.
- **Sombra:** 4 níveis (`--shadow-xs/sm/md/lg`) definidos com matiz azul-
  marinho sutil (`rgb(15 23 42 / …)`) em vez de preto puro — sombra mais
  "macia"/premium, quase imperceptível nos níveis baixos (`xs`/`sm`, usados
  em input/botão/tabela) e mais presente em `md`/`lg` (hover de card, dialog).
  Tailwind v4 gera `shadow-xs`…`shadow-lg` automaticamente a partir desses
  tokens em `@theme`.
- **Densidade de tabela** (`components/ui/table.tsx`): header `h-11`
  (44px) com label `text-xs font-semibold uppercase tracking-wide`, célula
  `px-4 py-3`. Cabeçalho **sticky** (`sticky top-0` dentro do contêiner com
  `overflow-auto`) — listas de leads podem crescer bastante, e perder a
  referência de coluna ao rolar é o tipo de fricção que "planilha" tem e
  "informação" não deveria ter. Linha com hover em `bg-accent/40` (mesmo
  tom usado no hover da navegação — consistência de "isto é interativo").

---

## 4. Componentes base — o que foi refinado e por quê

Todos em `apps/web/src/components/ui/`. Nenhum uso do CLI do shadcn (sem
acesso ao registry aqui) — primitivos recriados à mão com `cva` + `cn()`,
Radix só onde compensa (`Dialog`, `Label`), como já era convenção do projeto.

- **Button:** sombra `shadow-xs` no estado padrão (elevação real, não só
  cor), `hover:shadow-sm`, `active:translate-y-px` (feedback tátil de
  "pressionado"). Variante `outline` agora usa `bg-card` (painel) em vez de
  `bg-background` (canvas) — no novo modelo de dois níveis, um botão outline
  sobre o canvas precisa se destacar como painel, senão fica visualmente
  "solto".
- **Input / Select:** `bg-card`, `shadow-xs`, borda ganha
  `hover:border-foreground/20` antes do foco (affordance de "isto é
  editável" sem esperar o clique) — desliga no `disabled`.
- **Table:** ver §3.
- **Badge:** `font-semibold` (era `font-medium` — em `text-xs`, semibold lê
  melhor como rótulo curto), variante `outline` agora usa `bg-card` em vez
  de transparente (mesma razão do Button outline).
- **Dialog:** overlay com leve `backdrop-blur`, conteúdo com sombra `lg` e
  cantos maiores (`sm:rounded-xl`). Animação de abrir/fechar feita à mão via
  `data-state` do Radix + `@keyframes` em `globals.css` (sem o plugin
  `tailwindcss-animate`, que não está instalado) — **cuidado**: a animação do
  conteúdo anima só `opacity` + a propriedade CSS individual `scale` (não
  `transform`), porque `DialogContent` é reusado tanto centralizado
  (`-translate-1/2`) quanto como painel lateral no `MobileNav`
  (`translate-0`) — animar `transform` quebraria um dos dois usos.
  Respeita `prefers-reduced-motion`.
- **Alert — redesenhado, corrigiu um bug de acessibilidade real:** a versão
  anterior tinha `variant="success"` usando `text-success-foreground`
  (branco) como cor do texto sobre `bg-success/10` (verde quase-branco) —
  contraste medido: **1.02:1**, texto praticamente invisível. A causa raiz:
  reusar o token pensado para "texto branco sobre preenchimento sólido"
  (badge/botão) como se fosse "texto colorido sobre fundo quase-branco"
  (alerta) — são papéis diferentes que nem sempre o mesmo valor de L
  atende (ver §1.4).

  A correção não foi só trocar a cor — foi mudar o **padrão**: `AlertTitle` e
  `AlertDescription` agora usam **sempre** `text-foreground`/
  `text-muted-foreground` (nunca a cor semântica), e só o **ícone** e a
  **borda esquerda** (`border-l-4`) carregam a cor de status. Ícone/borda são
  "componentes gráficos" pelo WCAG 1.4.11 (piso 3:1), não texto (piso 4.5:1)
  — isso dá margem para funcionar nos dois temas sem um token por papel.
  Exceção: `warning` precisou de um ajuste extra —
  `--warning` é um amarelo claro por natureza, ilegível como ícone sobre
  fundo claro (2.23:1 medido); a variante usa `text-warning-foreground`
  (tom escuro) no light e `dark:text-warning` (o próprio amarelo, brilhante
  o bastante contra fundo quase-preto) no dark.

  **Se for adicionar uma nova variante de Alert:** meça o ícone contra
  `--card` nos dois temas antes de decidir qual token usar — não assuma que
  o token "cor base" funciona nos dois lados só porque funcionou para
  destructive/success.

---

## 5. Semântica de status — o mapa completo

Esta é a parte que "precisa gritar" (pedido do dono). A regra geral: **cor
reforça, nunca é o único sinal** — todo estado de risco também tem
ícone e/ou texto diferente, nunca depende só da cor (WCAG 1.4.1 e também
porque cor sozinha não escala bem quando há 7 status disputando 4 hues).

### 5.1 Lead — 7 status (`components/leads/lead-status-badge.tsx`)

Agrupados por estágio de funil, não um hue por status (evita "sopa de
cores" em 7 categorias):

| Status | Variante | Por quê |
|---|---|---|
| `new` | `secondary` (neutro) | ainda não qualificado |
| `validated` | `outline` (neutro, contornado) | qualificado, ainda frio |
| `contacted` | `default` (cor de marca) | ação em andamento, iniciada por nós |
| `responded` | `warning` (âmbar) | **precisa de atenção humana agora** |
| `negotiating` | `warning` (âmbar) | idem — mesmo grupo "engajamento ativo" |
| `won` | `success` (verde) | terminal positivo |
| `discarded` | `destructive` (vermelho) | terminal negativo |

`responded` e `negotiating` compartilham a cor de propósito — ambos são
"exige ação sua", o texto do badge (não a cor) diferencia o estágio exato.

### 5.2 Saúde de instância de WhatsApp — 4 estados

`instanceHealthSchema`: `ok` / `warming` / `degraded` / `blocked`
(`@inno/contracts`, `apps/web/src/components/whatsapp/instance-health-badge.tsx`).

**Achado importante para a próxima rodada:** o componente atual mapeia
`degraded` **e** `blocked` para a mesma variante (`destructive`) — os dois
ficam visualmente idênticos, só o texto do badge muda. Isso viola
diretamente o pedido do dono ("sinais de risco precisam gritar" e "estados
diferentes não podem parecer iguais"). Mapeamento correto a aplicar quando
essa tela entrar em pauta:

| Health | Variante recomendada | Por quê |
|---|---|---|
| `ok` | `success` | saudável |
| `warming` | `warning` | esperado, temporário (aquecimento de número novo) |
| `degraded` | `warning` (não `destructive`) | precisa de atenção, ainda operando |
| `blocked` | `destructive` **+ ícone de alerta forte** (ex. `AlertOctagon`) | crítico, ação imediata |

Isso também vale para `whatsAppInstanceStatusSchema` (`banned` já usa
`destructive`, correto — é terminal e crítico).

### 5.3 Campanha — `halted` vs. `paused`, a distinção que mais importa

`campaignStatusSchema`: `draft` / `scheduled` / `running` / `paused` /
`completed` / `cancelled` / `halted`. Ainda não tem UI (Fase 4, tela
`Campanhas` é `ComingSoon` hoje) — mas a semântica **precisa** estar definida
agora para a próxima rodada não inventar algo divergente:

- **`paused`** = ação humana deliberada, esperada, não é problema.
  Tratamento: **neutro** — `variant="outline"` (ou `secondary`), ícone
  `Pause`, texto "Pausada". Não deve chamar atenção como um erro.
- **`halted`** = parada automática de segurança (o worker decidiu parar
  sozinho — ex. taxa de erro/ban alta). É semanticamente um **alerta que
  exige reconhecimento humano** (o próprio contrato exige
  `acknowledgeHalt: true` para retomar — ver `campaign.contract.ts`).
  Tratamento: **crítico** — `variant="destructive"`, ícone `AlertOctagon` ou
  `ShieldAlert`, texto "Interrompida automaticamente", idealmente com uma
  chamada de ação visível ("Revisar e retomar"), não só um badge passivo.

A diferença entre os dois **não pode ser só a cor** — o texto já diz
"pausada" vs. "interrompida automaticamente", e o ícone (pause vs. alerta)
é o segundo sinal. Mesma lógica de "cor + ícone + texto, nunca só cor" de
todo o resto deste documento.

`campaignTargetStatusSchema` (`pending`/`sent`/`delivered`/`read`/
`responded`/`failed`/`skipped`): variantes sugeridas — `pending`/`skipped`
→ `secondary`; `sent`/`delivered`/`read` → progressão neutra→`default`→
`success` (mensagem lida é o "melhor" estado observável); `responded` →
`warning` (mesmo grupo semântico do lead `responded`, exige ação);
`failed` → `destructive`.

---

## 6. Tema claro/escuro

**Decisão travada com o dono:** claro por padrão, escuro disponível — as
telas centrais são listas densas de leitura prolongada.

- **Sem flash de tema errado:** `components/theme/theme-script.tsx` é um
  Server Component que emite um `<script>` inline no `<head>` (antes da
  hidratação — permitido pela CSP `script-src 'self' 'unsafe-inline'` já em
  vigor). Ele lê `localStorage['inno-prospect-theme']`; se não houver
  preferência salva, usa `prefers-color-scheme` do sistema (primeira
  visita). Aplica a classe `.dark` em `<html>` **antes** do primeiro paint.
- `<html suppressHydrationWarning>` — necessário porque a classe aplicada
  pelo script diverge de propósito do HTML enviado pelo servidor; é o jeito
  documentado de silenciar esse mismatch esperado sem mascarar outros.
- `components/theme/theme-provider.tsx` (client) expõe `useTheme()` — o
  `useState` inicial é sempre `'light'` (SSR não tem `document`) e sincroniza
  com a classe real via `useEffect` no mount, sem nunca decidir cor por conta
  própria (quem decide é sempre a classe `.dark` + os tokens CSS).
  Sincroniza entre abas via evento `storage`.
- `components/theme/theme-toggle.tsx` — botão sol/lua no `Topbar` (dashboard)
  e no cabeçalho do `(auth)/layout.tsx` (login). Ícone fica com `opacity-0`
  (mas ocupando o espaço, sem layout shift) até montar no client, para nunca
  arriscar mostrar o ícone errado por um frame.
- Chave única: `lib/theme.ts` (`THEME_STORAGE_KEY`) — script e provider
  importam a mesma constante, nunca duplicar a string.

---

## 7. Verificação WCAG — tabela de razões calculadas

Calculado com um conversor OKLCH→sRGB feito à mão (fórmulas padrão do OKLab/
OKLCH, sem biblioteca) + fórmula de contraste do WCAG 2.1
(`(L1+0.05)/(L2+0.05)`). Piso: **4.5:1** para texto normal, **3:1** para
componentes gráficos/texto grande. Todos os pares abaixo passam no piso
aplicável.

**Light**

| Par | Ratio |
|---|---|
| `foreground` / `background` | 17.18:1 |
| `foreground` / `card` | 18.13:1 |
| `muted-foreground` / `background` | 6.64:1 |
| `muted-foreground` / `card` | 7.01:1 |
| `primary` / `primary-foreground` (botão) | 5.97:1 |
| `primary` / `background` (link) | 5.70:1 |
| `secondary-foreground` / `secondary` | 12.77:1 |
| `accent-foreground` / `accent` | 13.66:1 |
| `destructive` / `destructive-foreground` (botão) | 6.46:1 |
| `destructive` / `background` (texto/ícone) | 6.17:1 |
| `success` / `success-foreground` (botão) | 6.35:1 |
| `success` / `background` (texto/ícone) | 6.07:1 |
| `warning-foreground` / `warning` (badge) | 7.65:1 |
| `warning-foreground` / `card` (ícone de alerta, piso 3:1) | alto (escuro sobre quase-branco) |

**Dark**

| Par | Ratio |
|---|---|
| `foreground` / `background` | 17.02:1 |
| `foreground` / `card` | 15.27:1 |
| `muted-foreground` / `background` | 7.15:1 |
| `primary` / `primary-foreground` (botão) | 8.14:1 |
| `primary` / `background` (ícone/borda, piso 3:1) | 7.93:1 |
| `secondary-foreground` / `secondary` | 12.64:1 |
| `accent-foreground` / `accent` | 10.68:1 |
| `destructive` / `destructive-foreground` (botão) | 5.20:1 |
| `destructive` / `background` (ícone, **piso 3:1, não 4.5:1**) | 3.58:1 |
| `success` / `success-foreground` (botão) | 5.78:1 |
| `success` / `background` (ícone, piso 3:1) | 5.56:1 |
| `warning-foreground` / `warning` (badge) | 8.89:1 |
| `warning` / `background` (ícone dark, piso 3:1) | 9.39:1 |

**Nota sobre `destructive` no dark (3.58:1):** esse par só é usado como
**ícone/borda** (piso 3:1, WCAG 1.4.11), nunca como texto corrido (piso
4.5:1) — é exatamente por isso que o Alert (§4) não usa a cor semântica no
corpo do texto. Vermelho é a hue que menos "abre" em luminância relativa por
unidade de L no OKLCH (baixo peso do canal R na fórmula de luminância
0.2126R+0.7152G+0.0722B) — não existe um L que sirva ao mesmo tempo para
"preenchimento sólido com texto branco" (precisa L baixo/médio) e "texto
solto sobre fundo quase-preto" (precisa L alto) nessa hue. Se um componente
novo precisar de vermelho como texto corrido no dark mode, **não reuse
`--destructive`** — meça um L mais alto especificamente para esse uso (algo
em torno de L 0.65 mediu 5.24:1 nos meus testes) e documente aqui.

---

## 8. Telas aplicadas nesta rodada

Login (`app/(auth)/login`, `app/(auth)/layout.tsx`), shell (`components/shell/*`),
dashboard (`app/(dashboard)/page.tsx`), leads lista (`app/(dashboard)/leads/page.tsx`,
`components/leads/lead-table.tsx`, `lead-filters.tsx`) e ficha do lead
(`components/leads/lead-detail.tsx`, `lead-timeline.tsx`, `lead-status-badge.tsx`).

Todos os componentes em `components/ui/*` foram refinados na base — então
**toda tela do produto herdou a atualização de tokens/primitivos
automaticamente** (cores, sombra, radius, badge, tabela, dialog), mesmo as
que não foram tocadas diretamente nesta rodada (Buscas, Templates, WhatsApp,
Opt-outs, Campanhas, Descadastro público). O que elas **não** ganharam foi
polimento específico de layout/hierarquia — isso fica para a próxima rodada,
seguindo exatamente a semântica de status definida em §5 (em especial o
achado do §5.2 sobre `degraded`/`blocked` e o mapa de `halted`/`paused`
do §5.3, que ainda não têm UI).
