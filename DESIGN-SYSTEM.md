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

**Corrigido na 2ª rodada (2026-08-03):** o componente mapeava `degraded` **e**
`blocked` para a mesma variante (`destructive`) — ficavam visualmente
idênticos, só o texto do badge mudava. Mapeamento aplicado:

| Health | Variante | Ícone | Por quê |
|---|---|---|---|
| `ok` | `success` | `ShieldCheck` | saudável |
| `warming` | `warning` | `Flame` | esperado, temporário (aquecimento de número novo) |
| `degraded` | `warning` (não `destructive`) | `TrendingDown` | precisa de atenção, ainda operando |
| `blocked` | `destructive` | `AlertOctagon` | crítico, ação imediata |

`warming` e `degraded` dividem a cor de propósito (mesmo grupo "precisa de
atenção") — o ícone e o texto (não a cor) são o que os diferencia, mesma
lógica do `responded`/`negotiating` do lead em §5.1. `InstanceStatusBadge`
(`whatsAppInstanceStatusSchema`) ganhou o mesmo tratamento de ícone por
consistência (`banned` já usava `destructive`, correto — é terminal e
crítico).

Em `apps/web/src/components/whatsapp/instance-card.tsx`, a borda esquerda do
`Card` também reflete a saúde (`border-l-4`, mesma cor da variante do badge)
— quem varre a grade de instâncias enxerga o risco pela borda antes de ler
qualquer badge, mesma linguagem visual do `Alert` (§4).

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

**Badges deixados prontos na 2ª rodada** (sem tela ainda usando, de
propósito — Fase 4 não existe): `apps/web/src/components/campaigns/
campaign-status-badge.tsx` e `campaign-target-status-badge.tsx` implementam
exatamente os dois mapas acima, com ícone por status (`AlertOctagon` para
`halted`, `Pause` para `paused` — nunca só a cor). Import direto de
`CampaignStatus`/`CampaignTargetStatus` de `@inno/contracts` (schema já
publicado pelo Vega), sem tipo local. Quando a Fase 4 chegar: importe esses
dois componentes em vez de recriar a lógica de cor.

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

## 8. Telas aplicadas — histórico das duas rodadas

**1ª rodada (2026-08-03):** Login (`app/(auth)/login`, `app/(auth)/layout.tsx`),
shell (`components/shell/*`), dashboard (`app/(dashboard)/page.tsx`), leads
lista (`app/(dashboard)/leads/page.tsx`, `components/leads/lead-table.tsx`,
`lead-filters.tsx`) e ficha do lead (`components/leads/lead-detail.tsx`,
`lead-timeline.tsx`, `lead-status-badge.tsx`). Todos os componentes em
`components/ui/*` foram refinados na base nessa rodada.

**2ª rodada (2026-08-03, mesma data — chamada em sequência pelo Atlas):**
- **WhatsApp** (`app/(dashboard)/whatsapp/page.tsx`,
  `components/whatsapp/instance-card.tsx`, `instance-health-badge.tsx`,
  `instance-status-badge.tsx`) — corrigido o bug `degraded`/`blocked` (§5.2),
  ícone em todo badge de status/saúde, borda de severidade no card.
- **Templates** (`app/(dashboard)/templates/*`,
  `components/templates/template-editor.tsx`, `template-preview.tsx`,
  `variable-picker.tsx`, `template-variation-badge.tsx`, `template-table.tsx`)
  — textarea/pills alinhados ao padrão de Input/Select da 1ª rodada, preview
  de spintax com `lg:sticky` (ajustado para não ficar embaixo do Topbar, que
  também passou a ser sticky nesta rodada — ver `components/shell/topbar.tsx`
  e `sidebar.tsx`), checkbox nativo trocado pelo componente `Checkbox`
  compartilhado.
- **Opt-outs** (`app/(dashboard)/configuracoes/*`,
  `components/optouts/optout-table.tsx`) — heading, `tabular-nums`, cards do
  hub de configurações com o mesmo tratamento de ícone-em-caixa do dashboard.
- **Campanhas** — só o placeholder (`components/common/coming-soon.tsx`)
  alinhado ao padrão visual do `EmptyState`; a tela em si continua não
  implementada de propósito (Fase 4). Os badges de status de campanha (§5.3)
  foram deixados prontos em `components/campaigns/*` para quando a Fase 4
  chegar.
- **Descadastro público** (`app/descadastro/layout.tsx`,
  `components/public/unsubscribe-view.tsx`) — a única tela que um estranho
  julga sem contexto nenhum, tratada como peça de marca: mesmo halo de marca
  e wordmark do login, ícone de estado em círculo colorido (sucesso = verde,
  neutro = cinza), tipografia de título em `font-display`, e um rodapé de
  credibilidade explicando o que é o InnoProspect e reforçando que a página
  nunca pede senha/pagamento — mitigação de "isso parece phishing" para quem
  chega por um link de WhatsApp sem ter pedido nada.

Todo componente em `components/ui/*` continua sendo herdado automaticamente
por qualquer tela nova — a única coisa que precisa de trabalho manual por
tela é hierarquia/layout específico, exatamente o que essas duas rodadas
cobriram. Não sobrou nenhuma tela do produto sem passar por pelo menos os
tokens base; Buscas (`app/(dashboard)/buscas/*`) é a única área que só
recebeu a herança automática, sem polimento de layout dedicado — fica como
candidata natural de uma 3ª rodada, se o dono quiser.

**3ª rodada (2026-09-22) — "layout premium": landing pública + abertura do
painel.** Antes desta rodada o produto não tinha nenhuma página pública — `/`
caía direto no shell logado. Duas mudanças de rota acompanham este trabalho:
o painel saiu de `/` para `/painel` (nav "Visão geral", logo da sidebar,
redirecionamento pós-login em `lib/auth-client.ts` e o redirect de `/login`
para usuário já autenticado no `middleware.ts` foram todos atualizados juntos
— procurar por `/painel` se algo continuar apontando pra raiz) e `/` virou a
landing pública, liberada no middleware por checagem **exata** (`pathname ===
'/'`), nunca por prefixo (ver comentário no próprio arquivo sobre por que
`'/'` nunca pode entrar em `PUBLIC_PATH_PREFIXES`).

### 9.1 Hero e mockup de produto em código

`components/marketing/*` é a pasta nova desta rodada. O hero
(`hero.tsx` + `product-mockup.tsx`) não usa nenhuma imagem externa — a CSP do
Vulcano bloqueia recurso de fora, e um mockup em código fica nítido em
qualquer tela/tema e não pesa no LCP (é HTML+CSS puro, nenhum Client
Component no caminho crítico). O mockup reaproveita componentes reais do
produto (`LeadStatusBadge`, mesma densidade de tabela do §3) com dados
fictícios fixos — nunca inventar métrica real ali (ver regra de honestidade
da copy abaixo).

**Armadilha real encontrada e corrigida:** a 1ª versão do card flutuante
"Busca em andamento" usava posicionamento absoluto puro (`-top-5`) por cima
da janela do mockup — só depois de tirar screenshot de verdade (skill
`medir-antes-de-afirmar`) ficou claro que o card cobria inteiramente o
cabeçalho "Empresa/Status" da tabela por baixo, tornando os dois ilegíveis.
A correção não foi ajustar o valor de offset no escuro — foi trocar a
estratégia: o wrapper reserva o espaço no **fluxo normal** (`pt-28`) e o
card fica posicionado dentro dessa folga, com no máximo uma sobreposição
mínima e deliberada na borda/canto arredondado da janela abaixo, nunca no
conteúdo. **Regra pra próxima composição em camadas:** nunca usar só
`position: absolute` com offset negativo para empilhar cards — isso não
reserva espaço em lugar nenhum e o resultado só se revela numa screenshot
real, nunca lendo o JSX. Preferir padding/margin no fluxo normal para a
folga, e absolute só para o deslocamento fino por cima dela.

**Rodada de refinamento (2026-09-22, mesmo dia):** o dono reprovou a 1ª
versão do hero — título de 97 caracteres em 6 linhas, mockup pequeno e
desalinhado, faixa vazia grande antes de "Como funciona". Correções: título
reduzido pra uma frase de 2-3 linhas ("Leads B2B prontos para o WhatsApp."),
o detalhe (nicho/cidade/telefone/progresso) migrou pro subtítulo; a coluna do
mockup ficou mais larga (`lg:grid-cols-[1fr_1.1fr]`, era `[1.05fr_0.95fr]`
favorecendo o texto) e o mockup ganhou mais peso (`max-w-lg` → `max-w-xl`,
uma 5ª linha na tabela, uma barra de rodapé com contagem); o grid passou de
`items-center` pra `items-start` (o texto agora é mais curto que o mockup —
`items-center` deixava vazio embaixo dele) e o padding vertical do hero
encolheu (`py-16..28` → `pt-14..24`/`pb-14..24` assimétrico) pra fechar o
vão antes da próxima seção.

### 9.2 Seções de marketing — ritmo, variedade e regras de honestidade

**Rodada de refinamento (2026-09-22):** a 1ª versão tinha as 3 seções
seguindo a MESMA fórmula (título centralizado + grade de N cards iguais) —
reprovado como "parece template". A versão atual varia a composição seção a
seção, de propósito:

- `how-it-works.tsx` — passos **horizontais ligados por uma linha** (círculos
  numerados com ícone, linha conectora atrás via `absolute` + `z-index`
  implícito por ordem no DOM; no mobile a linha some e os passos empilham).
- `features.tsx` — **seção dividida**: lista de recursos em texto (não
  cards) à esquerda, `SearchProgressMockup` (2ª composição visual do
  produto — a tela de progresso de busca, distinta do mockup de leads do
  hero) à direita.
- `stat-band.tsx` (**nova**) — faixa cheia com `bg-primary`, números REAIS
  em destaque (5.571 municípios/27 UFs, seed do IBGE) — usa o par
  `primary`/`primary-foreground` já verificado em WCAG (§7, mesmo par do
  botão), nenhum contraste novo pra calcular. Existe pra dar um "âncora"
  visual forte entre Recursos e Conformidade, não só mais texto.
- `compliance-section.tsx` — também dividida, ordem INVERTIDA em relação a
  `features.tsx` (visual à esquerda, texto à direita no desktop via
  `lg:order-1`/`lg:order-2`) pra não repetir a mesma composição duas vezes
  seguidas. O visual é `DescadastroPreviewMockup` — uma 3ª composição, a
  prévia da página pública `/descadastro/:token` (mesmo ícone-em-círculo e
  rodapé de credibilidade da tela real, ver §8).

Título de seção subiu de `text-2xl sm:text-3xl` pra `text-3xl sm:text-4xl`
em todas (hierarquia mais próxima do hero, que é `text-5xl sm:text-6xl`
depois do mesmo refinamento) — o salto de escala entre hero e seção estava
grande demais na 1ª versão. Todo container de seção usa o MESMO
`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8` (a 1ª versão tinha a grade de
Conformidade presa a um `max-w-4xl` interno, mais estreita que as outras
seções — bug real de largura inconsistente, visível comparando os
screenshots lado a lado).

**Regra de honestidade que é decisão de produto, não só de copy:** nenhuma
seção de marketing pode alegar como pronto algo que só existe como schema
(`sendWindow` em `campaign.contract.ts`) ou como tela `ComingSoon` (Campanhas,
disparo de WhatsApp). O card "WhatsApp com anti-ban" em `features.tsx` leva
um badge `em construção` — o mesmo padrão visual de `comingSoon` em
`NAV_ITEMS` (`components/shell/nav-items.ts`) — em vez de fingir que a
feature já dispara mensagem. Antes de escrever qualquer frase de recurso
"pronto", grep pelo campo/rota no código; se só existir no contrato ou numa
tela placeholder, é "projetado", não "pronto" (ver também §5.3 sobre
`halted`, que segue a mesma lógica: designed ≠ shipped).

### 9.3 Banner de saúde da fila — `components/dashboard/queue-health-banner.tsx`

Consome `GET /api/v1/scraper/queue` (poll 20s via `hooks/useQueueStatus.ts`,
mais lento que o polling de progresso de busca de 3s — isto é um banner de
estado, não uma barra de progresso ao vivo) e `POST
/api/v1/scraper/queue/resume`. Mapa de variante por `status`:

| `status` | Variante do Alert | Ação |
|---|---|---|
| `running` | `success`, compacto (`py-3`, sem `AlertDescription`) | nenhuma — só confirma que está tudo bem, sem competir visualmente com o resto da tela |
| `unknown` (Redis fora do ar) | `warning` | nenhuma — não afirma que a fila parou, só que não dá pra confirmar daqui |
| `paused`, `severity: 'high'` | `warning` | botão "Revisar e retomar" |
| `paused`, `severity: 'critical'` | `destructive` | botão "Revisar e retomar" |

A ação de retomar nunca é um clique único: abre `ConfirmDialog`
(`components/common/confirm-dialog.tsx`) com o texto explicando **o que a
pessoa está confirmando** ("já investiguei e sei por que é seguro seguir"),
não só "tem certeza?" genérico — a pausa é uma decisão de segurança
automática (ARQUITETURA §5.7), e o botão precisa deixar claro que retomar
sem investigar tende a reproduzir o mesmo incidente. Mesma lógica de
`acknowledgeHalt` em campanhas (§5.3): builder de confirmação carrega o
"porquê", não só o "o quê".

**Cor do botão "Revisar e retomar" — revisado na rodada de refinamento
(2026-09-22):** a 1ª versão usava `variant="destructive"`/`"default"` no
botão conforme a severidade, ecoando a cor do Alert. Trocado para
`variant="outline"` (neutro) sempre, com o mesmo raciocínio do `ErrorState`
(`components/common/error-state.tsx`, que já usa um botão `outline`
"Tentar novamente" dentro de um `Alert variant="destructive"` — convenção
pré-existente, não inventada agora): **a cor do risco é do Alert, não da
ação**. Retomar não é uma ação destrutiva — é a ação de avanço depois de uma
pausa de segurança, e a confirmação explícita do `ConfirmDialog` já é a
proteção real contra clique acidental; colorir o botão de vermelho por cima
de um Alert já vermelho não reforça, só compete visualmente. O
`ConfirmDialog` interno também passou a usar sempre `confirmVariant="default"`
(nunca `destructive`) pelo mesmo motivo.

Tipos ainda locais em `types/scraper-queue.ts` (com o TODO de sempre) — o
próprio endpoint foi criado pelo Vega sem contrato prévio em
`packages/contracts` (ver comentário em
`app/api/v1/scraper/queue/route.ts`), então não havia nada pra importar.

### 9.4 Painel — redesenho completo (2026-09-22, mesma rodada)

A 1ª versão do painel (§9.3 acima) foi reprovada pelo dono como "fraca e
fria" — só 2 KPIs soltos, sem gráfico, sem riqueza visual, e um painel que
"termina a dois terços da tela". Redesenho completo em cima de um endpoint
novo, construído pelo Vega em paralelo: `GET /api/v1/dashboard/summary`
(tipo local em `types/dashboard.ts`, TODO de sempre — trocar por
`@inno/contracts` quando `dashboard.contract.ts` for publicado; o formato foi
combinado com o Atlas antes de mockar, não inventado). Orquestrador:
`components/dashboard/dashboard-content.tsx`, fonte única de dado via
`hooks/useDashboardSummary.ts`.

**Hierarquia da página, de cima pra baixo** (a "história" que a página
conta): 1) `SummaryHero` — saudação, avatar com iniciais, data por extenso, e
uma frase que reflete o estado real do dia (`buildStatusLine`, ex. "2 buscas
rodando · 134 leads novos esta semana" — nunca um rótulo fixo tipo "Sua visão
geral", reprovado por não dizer nada); 2) `QueueHealthBanner` (§9.3); 3)
`IndicatorCard` × 4 (leads na semana com delta vs. semana anterior, total de
leads, **% de leads com celular** — é o número que decide se o lead serve
pro WhatsApp, por isso ganhou indicador próprio em vez de ficar escondido em
uma ficha, e buscas ativas); 4) `LeadsAreaChart` (2/3) + `StatusFunnel` (1/3);
5) `RecentSearches` + `RecentLeads`; 6) `TopListCard` (UFs e categorias) +
`SystemHealthCard`.

**Gráficos em SVG próprio, sem lib (Recharts/D3/etc.) — decisão
justificada, não default por preguiça:** para uma série de 30 pontos e um
funil de 7 categorias, uma lib de gráfico pesaria no bundle sem necessidade,
e mais importante: a CSP do projeto (`next.config.ts`) não libera
`'unsafe-eval'`, e várias libs de gráfico geram/avaliam função em runtime —
arriscar isso exigiria auditar a lib inteira contra a CSP antes de usar (ver
[[bug-dev-csp-blocks-hydration]] pra um exemplo real de quanto isso já doeu
nesta mesma rodada). `components/dashboard/charts/{sparkline,area-chart}.tsx`
são `<svg>` com `<path>`/`<polyline>` calculados a mão — leves, sem
dependência nova, 100% controlados. Se o painel um dia precisar de séries
múltiplas, zoom ou pan, reconsiderar uma lib nesse momento, não antes.

**Cor com intenção nos indicadores:** cada `IndicatorCard` tem sua caixa de
ícone colorida — `primary` (leads/total), `success` (% com celular — verde
porque é uma métrica "boa" de qualificação), `accent` (buscas ativas, pra não
repetir a mesma cor 3x na fileira). A variação percentual usa a MESMA regra
do Alert/badges: **a seta é colorida (ícone, piso WCAG 3:1), o número da
variação fica em `text-muted-foreground`** — nunca o texto da variação em
verde/vermelho direto (ver §1.4/§4, é a mesma armadilha de token dual-role de
sempre, aplicada de novo aqui por consistência, não por acidente).

**Acabamento:** `useCountUp` (`hooks/useCountUp.ts`) anima os números de 0 até
o valor real (ease-out, ~700ms) e cai pro valor final direto quando
`prefers-reduced-motion: reduce` — sem RAF nenhum nesse caso, não só mais
rápido. Entrada escalonada das seções via classe `.inno-stagger-in`
(`globals.css`, `animation-delay` por `--stagger-delay` inline, 60ms por
seção) — só opacidade + 8px de translateY, nunca layout, e só roda dentro de
`@media (prefers-reduced-motion: no-preference)`, mesmo padrão das animações
do Dialog que já existiam.

**Estado de primeiro acesso é o estado padrão em produção, não um caso
extremo:** produção começa com ZERO leads — um painel bonito só com dado
mockado e "triste" com zero é reprovado (nota literal do dono). Quando
`summary.leads.total === 0`, `DashboardContent` renderiza
`FirstAccessChecklist` no lugar do painel rico inteiro: hero de boas-vindas +
3 passos (nova busca, conectar WhatsApp, criar template — cada um com link de
ação de verdade) + `QueueHealthBanner`/`SystemHealthCard` ainda visíveis
(saúde do sistema não depende de ter lead nenhum, e mantém a tela parecendo
"sistema profissional" mesmo vazia, em vez de um card solto no topo com o
resto da viewport em branco). Nenhum gráfico morto (eixo zerado) é mostrado —
troca por uma frase que orienta ("assim que os primeiros leads chegarem,
esta página ganha gráfico de evolução...").

**Mock rico, não sequência artificial:** `mocks/dashboard.ts` gera 30 dias
com tendência de crescimento + ruído + queda de fim de semana (seed fixa,
determinístico) — nunca uma progressão tipo "10, 20, 30..." que entregaria
o gráfico como fake à primeira vista. `mockGetEmptyDashboardSummary()` existe
à parte, só pra testar o estado de primeiro acesso — trocado manualmente em
`lib/api/dashboard.ts` durante o teste e revertido depois, nunca um flag
permanente no código de produção.

### 9.5 Papel de parede da Conversa — textura em vez de moldura de celular (2026-09-23)

Depois da 1ª conversa real em produção, o dono pediu para simular a tela do
WhatsApp dentro de uma moldura de celular. Argumento contra, aceito: moldura
desperdiça a largura que o redesenho anterior (§ ver `project-lead-conversation-redesign`
na memória da Lyra) tinha acabado de conquistar, cabe menos texto por tela, e
vira "celular dentro de celular" em telas pequenas. O pedido real por trás —
"a área de mensagens é um retângulo branco enorme e vazio" — foi resolvido
sem moldura, com 3 mudanças em `components/leads/lead-conversation.tsx`:

1. **Textura `.inno-chat-wallpaper` (`globals.css`)** — trama de pontos
   escalonados (dois `radial-gradient` intercalados por `background-position`)
   + um véu (`linear-gradient` sólido) sobre `var(--card)`, no mesmo hue de
   `--primary` (H≈231), literal (não `var()` com alpha anexado — CSS não
   permite compor alpha novo sobre uma custom property sem *relative color
   syntax*). Alpha por camada: light véu 5%/ponto 8%, dark véu 5%/ponto 7% —
   valores diferentes por tema porque o piso mais apertado é o texto
   `muted-foreground` que fica DIRETO sobre a textura (o aviso "nenhuma
   resposta chegou ainda"), não dentro de bolha: medido (conversor
   OKLCH→sRGB + fórmula WCAG, pior caso = pixel em cima do ponto, não no
   vão) em **5.82:1 (light) / 5.27:1 (dark)** — dark tem a margem mais
   estreita das duas, não aumentar a opacidade lá sem recalcular. Bolha de
   saída (`bg-primary/10`, translúcida, herda a textura por trás):
   **13.16:1 (light) / 12.51:1 (dark)** para o texto `foreground`. Bolha de
   entrada (`bg-muted`, opaca) cobre a textura por completo — contraste
   idêntico ao já validado em §7.
2. **2 bugs de contraste pré-existentes achados no caminho (mesma causa raiz
   de §1.4/§4 — token dual-role, texto vermelho direto sobre fundo tintado
   de vermelho) e corrigidos, independentes da textura:** o rótulo "Pedido de
   descadastro" e o aviso "Não foi entregue..." usavam `text-destructive`
   como corpo de texto — no dark, mediam **3.09:1** e **2.71:1**
   respectivamente (abaixo do piso 4.5:1), mesmo sem a textura nova (a
   textura só piorava mais, para 2.40:1/2.20:1). Os dois viraram
   `text-foreground`; o sinal semântico continua — ícone `ShieldOff`
   colorido (piso 3:1, onde passa) no primeiro, `MessageStatusBadge
   variant="destructive"` (fill sólido, já validado em §7) no segundo.
3. **Altura fixa (`h-[360px] sm:h-[420px]`), não mais `min-h`/`max-h`
   elástico** — compartilhada entre o estado populado E o vazio (mesma
   constante `CONVERSATION_HEIGHT`), para o card não mudar de tamanho quando
   a 1ª mensagem chega. Isso também resolveu o pedido nº2 do dono ("baixo o
   bastante para o compositor no rodapé ficar sempre alcançável sem rolar a
   página"): o compositor é o próximo irmão direto no fluxo normal, não
   precisa de cálculo de viewport. O estado vazio (`messages.length === 0`)
   passou a viver dentro do mesmo container com textura + altura fixa (antes
   era um `EmptyState` solto, sem textura, fora do fluxo da conversa) —
   `EmptyState` continua reaproveitado (não um componente novo), só
   recebendo `className` para tirar a borda tracejada/fundo próprios, que
   competiam com a textura em vez de se somar a ela.

Verificado com uma réplica estática do CSS + Chromium real via
`playwright-core` (sem subir `next dev` — servidor compartilhado, ver
`bug-shared-next-dev-cache-conflict` na memória da Lyra): altura fixa
confirmada (`clientHeight`/`scrollHeight` iguais quando cabe, rolagem própria
só aparece quando o conteúdo excede), textura visível e texto legível nos
dois temas por captura de tela real. Contraste calculado analiticamente
(mesmo método já em uso neste arquivo desde §7 — "não no olho"), não
estimado.
