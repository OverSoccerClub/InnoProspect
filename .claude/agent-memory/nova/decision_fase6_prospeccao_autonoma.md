---
name: innoprospect-fase6-prospeccao-autonoma
description: Porquês da §8.11 (máquina de prospecção autônoma, v1.4) — ângulo calculado vs. frase gerada, medição como pré-requisito, escada de autonomia N0-N4 e por que a IA não é o produto
metadata:
  type: project
---

Desenhada em 2026-09-26 (`ARQUITETURA.md` v1.4, §8.11, invariantes A33-A38). **Estende** a §8.10;
os dois invariantes de lá (IA é conselho; geração na montagem, nunca no envio) continuam intactos.
O "o quê" está no documento. Aqui só os porquês, que o código não conta.

**1. O ângulo é CALCULADO, a frase é gerada (A33) — é a decisão que segura a fase inteira.**
A matéria-prima é magra de propósito (§7.1 proíbe ampliar), mas os ângulos comerciais fortes são
**combinações e ausências** de campos coletados — "4.8 com 180 avaliações **e sem site**". Cada um
é um predicado determinístico: calculável em código puro, testável com fixture, auditável. Logo o
modelo nunca **seleciona fato**; recebe conjunto fechado e declara `factsCited[]`, verificado por
código (`⊆` entrada). Isso converte "instruí o modelo a não inventar" em verificação de tipo — a
mesma manobra do `checkedAt` do opt-out, que funcionou melhor que a regra escrita.
Corolário: **`offNiche` força ângulo genérico.** A `category` desse lead é sabidamente não confiável
(foi assim que "escritório de arquitetura" trouxe Magazine Luiza) — o dado que produz a alucinação
já está marcado no schema. E números só são citáveis se `lastSeenAt` for fresco.

**2. Medir é pré-requisito de gerar, não relatório posterior — e o motivo é um defeito, não uma
preferência.** 🔴 Hoje responder **"SAIR" conta como RESPOSTA**: em `webhook.ts#handleInboundMessage`
o alvo ativo avança para `responded` **antes** de `registerOptOutFromInbound` rodar, e nada o faz
voltar. Ligar aprendizado sobre esse sinal ensina a máquina a **premiar a abordagem que mais
irrita**. `replied` ≠ `optedOut` (A35) não é refinamento de métrica; é a diferença entre uma máquina
que melhora e uma que piora com confiança.

**3. `ApproachOutcome` é tabela separada porque `CampaignTarget` cascateia na eliminação LGPD.**
Ao longo de 24 meses de retenção, os leads eliminados — desproporcionalmente os que se incomodaram —
somem do conjunto de aprendizado, deixando **toda abordagem parecer melhor do que foi**. É viés de
sobrevivência, não perda de volume. O precedente já existe e o Cronos o documentou: `Campaign.*Count`
são agregados anônimos que não retrocedem, pelo mesmo motivo.
Escrita **na mesma transação do write-ahead, dentro de `@inno/sending`** (A34): fora dali, o envio
unitário nunca registraria e o conjunto nasceria enviesado para o caminho automático. Mesma lógica
do corte do §6.8.0 — um escritor só, onde é impossível esquecer.
**Sem rollup e sem coluna de desfecho de funil**, de propósito: rollup em milhares de linhas/ano é a
quinta função-sem-chamador; desfecho de funil exigiria um **terceiro** escritor (`PATCH /leads/:id`).

**4. Autonomia é escada, e a propriedade que a torna reversível é arquitetural, não de processo.**
N0 hoje → N1 assistente na ficha → N2 lote com revisão **por ângulo** (revisar 430 textos é teatro;
3 por ângulo é revisão) → N3 escolha por desempenho → N4 público autônomo. O nível é config
persistida lida em runtime, **ausente = N0** (mesma assimetria da pausa global, A31). Cada degrau
acrescenta um **autor** e não muda **nada à direita de `executeSendAttempt`** — portão, gate, cota,
janela, lease e `@unique` são o mesmo código em qualquer nível. Descer de degrau é mudar um valor.
**N4 tem dois tetos de donos diferentes:** a cota por instância protege **o número**; o orçamento
diário de contatos frios protege **a base** — queimar 5.000 leads com abordagem ruim não dispara
limite de anti-ban nenhum e destrói o ativo. E `ALERT_WEBHOOK_URL` ligada é **bloqueio duro** de N4:
é o primeiro ator autônomo de segundo grau (escolhe público **e** dispara).

**5. A IA não é o produto — o motor de ângulos determinístico é.** Recomendação: catálogo de ângulos
+ um texto base por ângulo como **base permanente**, modelo como camada por cima. Dois motivos: o
ganho vem de *escolher o ângulo certo*, não da prosa; e sem o braço `source='template'` existindo
primeiro, **"a IA converte mais" é incomparável** — não há grupo de controle no mesmo ângulo, nicho
e cidade. Custo confirmado como **não sendo a variável de decisão**: campanha de 500 alvos custa
~US$0,55 em Haiku 4.5 e ~US$2,75 em Opus 5. A variável é alucinação e capacidade de medir.
A38: modelo caro nunca vê dado de lead, só agregado (corta custo, latência e superfície LGPD junto).

**6. A metáfora do dono ("equipe de agentes/vendedores") é boa como resultado e ruim como desenho.**
Agentes conversando entre si são mais caros, mais lentos e — o que decide — **impossíveis de
atribuir**: não há como dizer qual agente causou a resposta. Pipeline determinístico com um passo de
redação entrega o mesmo e é inspecionável passo a passo. Regra geral que fica: **quando o pedido vem
em metáfora, traduza para o pipeline antes de escolher a arquitetura.**

**7. Buracos de fato achados ao desenhar contra o código (não presumidos):**
- O texto final por alvo é recalculado do `renderedTemplateSnapshot` em **três** lugares no momento
  do envio (`web/campaigns.ts`, `web/messages.ts`, `worker/dispatch-tick.job.ts`). Não existe coluna
  por alvo → não há onde texto gerado morar, e a §8.10 ("gerar antes, auditar antes de sair") era
  irrealizável. Fix: `CampaignTarget.renderedBody`, lido antes do fallback nos três chamadores.
- `minReviewCount` continua faltando no `leadFilterSchema` (a §8.9 já apontava); dois dos sete
  ângulos dependem dele.
- O achado `medium` do Órion em 4.H (corrida de `recordInstanceResponseIfFirstToday`) tinha gatilho
  datado "consertar antes da heurística de taxa de resposta". **O gatilho chegou nesta fase.**

Relacionado: [[innoprospect-fase4-motor]], [[innoprospect-onde-o-envio-mora]],
[[innoprospect-armadilhas]], [[nova-licoes-plano-faseado]], [[innoprospect-estado-real]].
