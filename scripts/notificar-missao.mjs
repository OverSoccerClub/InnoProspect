#!/usr/bin/env node
// CLI standalone (sem dependências — usa fetch nativo do Node >= 18) para
// projetos externos reportarem eventos ao Painel de Missões InnovareCode.
// Pensado para ser copiado/baixado sozinho para dentro de outro repositório
// (ex.: `Pontua.me/scripts/notificar-missao.mjs`) e chamado pelos agentes
// (Atlas) durante o fluxo de trabalho — não depende de nada deste projeto.
//
// Configuração via variáveis de ambiente:
//   MISSOES_URL         URL base do painel, ex.: https://missoes.innovarecode.com.br
//   MISSOES_PROJECT_ID  id do Project, ex.: PM-A7K2
//   MISSOES_API_KEY     chave de API do Project (mk_live_...)
//
// Uso:
//   node notificar-missao.mjs open "título da missão" ["texto de entrega opcional"]
//   node notificar-missao.mjs event <missionId> <fase 0-8> <agente> <kind> "mensagem"
//   node notificar-missao.mjs close <missionId> ["texto de entrega opcional"]
//   node notificar-missao.mjs --help
//
// Exemplos:
//   node notificar-missao.mjs open "Corrigir bug de upload"
//   node notificar-missao.mjs event PM-A7K2:cksomeid 3 vega work "Implementando validação"
//   node notificar-missao.mjs close cksomeid "Bug corrigido e testado"

const HELP = `notificar-missao.mjs — cliente de ingestão do Painel de Missões InnovareCode

Uso:
  node notificar-missao.mjs open "título" ["entrega opcional"]
  node notificar-missao.mjs event <missionId> <fase 0-8> <agente> <kind> "mensagem"
  node notificar-missao.mjs close <missionId> ["entrega opcional"]
  node notificar-missao.mjs --help

Env obrigatórias:
  MISSOES_URL          ex.: https://missoes.innovarecode.com.br
  MISSOES_PROJECT_ID   ex.: PM-A7K2
  MISSOES_API_KEY       ex.: mk_live_...

agente: atlas|nova|cronos|vega|lyra|iris|orion|vulcano|alexandria|system
kind:   work|done|say|system
`;

function fail(message) {
  console.error(`[notificar-missao] ${message}`);
  process.exit(1);
}

function readEnvConfig() {
  const url = process.env.MISSOES_URL;
  const projectId = process.env.MISSOES_PROJECT_ID;
  const apiKey = process.env.MISSOES_API_KEY;
  if (!url || !projectId || !apiKey) {
    fail(
      "Variáveis de ambiente ausentes. Defina MISSOES_URL, MISSOES_PROJECT_ID e MISSOES_API_KEY (veja --help)."
    );
  }
  return { url: url.replace(/\/+$/, ""), projectId, apiKey };
}

async function callApi(config, path, body) {
  let response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-project-id": config.projectId,
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail(`Falha de rede ao chamar ${path}: ${err.message ?? err}`);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // resposta sem corpo JSON — segue com payload nulo
  }

  if (!response.ok) {
    const message = payload?.error ?? `HTTP ${response.status}`;
    fail(`${path} respondeu ${response.status}: ${message}`);
  }

  return payload;
}

async function cmdOpen(config, args) {
  const [title, deliver] = args;
  if (!title) fail('Uso: open "título" ["entrega opcional"]');
  const result = await callApi(config, "/api/ingest/missions", {
    action: "open",
    title,
    ...(deliver ? { deliver } : {}),
  });
  console.log(JSON.stringify(result));
  return result;
}

async function cmdEvent(config, args) {
  const [missionId, phaseRaw, agent, kind, message] = args;
  if (!missionId || phaseRaw === undefined || !agent || !kind || !message) {
    fail('Uso: event <missionId> <fase 0-8> <agente> <kind> "mensagem"');
  }
  const phase = Number.parseInt(phaseRaw, 10);
  if (!Number.isInteger(phase) || phase < 0 || phase > 8) {
    fail("fase precisa ser um número inteiro entre 0 e 8.");
  }
  const result = await callApi(config, "/api/ingest/events", {
    missionId,
    events: [{ phase, agent, kind, message }],
  });
  console.log(JSON.stringify(result));
  return result;
}

async function cmdClose(config, args) {
  const [missionId, deliver] = args;
  if (!missionId) fail('Uso: close <missionId> ["entrega opcional"]');
  const result = await callApi(config, "/api/ingest/missions", {
    action: "close",
    missionId,
    ...(deliver ? { deliver } : {}),
  });
  console.log(JSON.stringify(result));
  return result;
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }

  const config = readEnvConfig();

  switch (command) {
    case "open":
      return cmdOpen(config, args);
    case "event":
      return cmdEvent(config, args);
    case "close":
      return cmdClose(config, args);
    default:
      console.log(HELP);
      fail(`Comando desconhecido: ${command}`);
  }
}

main().catch((err) => fail(err?.message ?? String(err)));
