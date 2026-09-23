/**
 * apps/web/scripts/sync-instance-api-keys.ts — comando operacional que
 * preenche `WhatsAppInstance.instanceApiKey*` para instância(s) JÁ PAREADAS
 * (nasceram ANTES da correção de 2026-09-23, ou a captura em
 * `POST /instance/create` falhou naquela hora) — SEM ISSO, essas instâncias
 * só aceitam o webhook pela chave GLOBAL do `EvolutionServer`; se a Evolution
 * assinar o webhook com a chave DA INSTÂNCIA, todo evento de retorno
 * continua recusado em silêncio (o mesmo incidente que motivou esta
 * correção).
 *
 * ⚠️ SEGURO PARA INSTÂNCIA JÁ CONECTADA — este script SÓ LÊ
 * (`GET /instance/fetchInstances`), NUNCA chama `connect`/`create`. Não
 * reinicia pareamento, não gera QR novo, não desconecta nada (mesma
 * distinção crítica de `bug-qr-poll-invalidava-codigo`: "leitura pura" vs.
 * "verbo que reinicia estado").
 *
 * USO (dentro do container `web`, working dir `/app`, mesmo padrão de
 * `packages/db/prisma/evolution-servers.ts`):
 *   node node_modules/tsx/dist/cli.mjs apps/web/scripts/sync-instance-api-keys.ts
 *
 * Idempotente: pode rodar quantas vezes quiser — sempre RECIFRA com o valor
 * mais recente que a Evolution devolver (se a Evolution já tiver uma
 * credencial gravada aqui, ela é sobrescrita, nunca duplicada).
 */
import { prisma, type EvolutionServer } from '@inno/db';
import { EvolutionClient } from '@inno/messaging';
import { decryptEvolutionApiKey, encryptEvolutionApiKey, toPrismaBytes } from '../src/lib/evolution-server-crypto.js';

function evolutionClientForServer(server: EvolutionServer): EvolutionClient {
  const apiKey = decryptEvolutionApiKey(server);
  return new EvolutionClient({ baseUrl: server.baseUrl, apiKey });
}

async function syncServer(server: EvolutionServer): Promise<{ updated: number; skipped: number }> {
  console.log(`\n○ Servidor "${server.name}" (${server.baseUrl})`);

  const localInstances = await prisma.whatsAppInstance.findMany({ where: { evolutionServerId: server.id } });
  if (localInstances.length === 0) {
    console.log('  (nenhuma instância cadastrada para este servidor — nada a fazer)');
    return { updated: 0, skipped: 0 };
  }

  const client = evolutionClientForServer(server);
  const remoteInstances = await client.fetchInstances();
  const byName = new Map(remoteInstances.filter((r) => r.instanceName).map((r) => [r.instanceName as string, r]));

  let updated = 0;
  let skipped = 0;
  for (const local of localInstances) {
    const remote = byName.get(local.evolutionInstanceName);
    if (!remote || !remote.apiKey) {
      console.log(`  ⚠ ${local.name} (${local.evolutionInstanceName}): Evolution não devolveu credencial própria — continua pela chave do servidor.`);
      skipped++;
      continue;
    }

    const encrypted = encryptEvolutionApiKey(remote.apiKey);
    await prisma.whatsAppInstance.update({
      where: { id: local.id },
      data: {
        instanceApiKeyCiphertext: toPrismaBytes(encrypted.ciphertext),
        instanceApiKeyIv: toPrismaBytes(encrypted.iv),
        instanceApiKeyAuthTag: toPrismaBytes(encrypted.authTag),
        instanceApiKeyKeyVersion: encrypted.keyVersion,
      },
    });
    console.log(`  ✔ ${local.name} (${local.evolutionInstanceName}): credencial própria capturada e cifrada.`);
    updated++;
  }
  return { updated, skipped };
}

async function main(): Promise<void> {
  const onlyInstanceName = process.argv[2]; // filtro opcional: nome da instância na Evolution (evolutionInstanceName), para rodar contra 1 só.

  const servers = await prisma.evolutionServer.findMany({ where: { isActive: true } });
  if (servers.length === 0) {
    console.log('Nenhum EvolutionServer ativo cadastrado — rode `evolution-servers.ts bootstrap` primeiro.');
    return;
  }

  let totalUpdated = 0;
  let totalSkipped = 0;
  for (const server of servers) {
    const { updated, skipped } = onlyInstanceName ? await syncOne(server, onlyInstanceName) : await syncServer(server);
    totalUpdated += updated;
    totalSkipped += skipped;
  }

  console.log(`\n— Resumo —\n  Credenciais capturadas: ${totalUpdated}\n  Sem credencial própria na Evolution (continuam pela chave do servidor): ${totalSkipped}\n`);
}

async function syncOne(server: EvolutionServer, evolutionInstanceName: string): Promise<{ updated: number; skipped: number }> {
  const local = await prisma.whatsAppInstance.findFirst({ where: { evolutionServerId: server.id, evolutionInstanceName } });
  if (!local) return { updated: 0, skipped: 0 }; // não é deste servidor — o loop de `main` tenta o próximo.

  console.log(`\n○ Servidor "${server.name}" (${server.baseUrl}) — só ${evolutionInstanceName}`);
  const client = evolutionClientForServer(server);
  const remoteInstances = await client.fetchInstances();
  const remote = remoteInstances.find((r) => r.instanceName === evolutionInstanceName);
  if (!remote || !remote.apiKey) {
    console.log(`  ⚠ Evolution não devolveu credencial própria para ${evolutionInstanceName} — continua pela chave do servidor.`);
    return { updated: 0, skipped: 1 };
  }

  const encrypted = encryptEvolutionApiKey(remote.apiKey);
  await prisma.whatsAppInstance.update({
    where: { id: local.id },
    data: {
      instanceApiKeyCiphertext: toPrismaBytes(encrypted.ciphertext),
      instanceApiKeyIv: toPrismaBytes(encrypted.iv),
      instanceApiKeyAuthTag: toPrismaBytes(encrypted.authTag),
      instanceApiKeyKeyVersion: encrypted.keyVersion,
    },
  });
  console.log(`  ✔ ${local.name} (${evolutionInstanceName}): credencial própria capturada e cifrada.`);
  return { updated: 1, skipped: 0 };
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
