/**
 * Ferramenta de manutenção do usuário admin.
 *
 * POR QUE EXISTE
 * O seed cria o admin uma vez e, de propósito, NUNCA reseta a senha de um
 * admin já existente (senão todo deploy trocaria a senha por baixo do
 * usuário). Isso é correto, mas deixa um beco sem saída em produção: se a
 * senha se perdeu, ou se o usuário foi criado com o e-mail errado, não havia
 * nenhuma forma de consertar sem abrir o Postgres e escrever SQL na mão.
 *
 * O login falha com `CredentialsSignin` genérico nos dois casos (e-mail
 * inexistente e senha errada) — por segurança, para não revelar quais contas
 * existem. O efeito colateral é que, sem esta ferramenta, não dá para
 * distinguir "não rodei o seed" de "errei a senha".
 *
 * USO (dentro do container, a partir de packages/db):
 *   node ../../node_modules/.bin/tsx prisma/admin.ts list
 *   node ../../node_modules/.bin/tsx prisma/admin.ts set-password <email> [senha]
 *
 * Sem `senha`, gera uma forte e mostra UMA vez.
 */
import { prisma } from '../src/client.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

// Mesma normalização do `authorize` em apps/web/src/lib/auth.ts. Se as duas
// divergirem, o login quebra silenciosamente — ver comentário no seed.ts.
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

async function list() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (users.length === 0) {
    console.log('\n⚠ Nenhum usuário no banco.');
    console.log('  O seed provavelmente não rodou. Rode:');
    console.log('    node ../../node_modules/.bin/tsx prisma/seed.ts\n');
    return;
  }

  console.log(`\n${users.length} usuário(s):\n`);
  for (const u of users) {
    const alerta = u.email !== u.email.toLowerCase() ? '  ⚠ TEM MAIÚSCULA — o login nunca vai achar' : '';
    console.log(`  ${u.email}  [${u.role}]  ${u.name}${alerta}`);
  }
  console.log('');
}

async function setPassword(rawEmail: string, rawPassword?: string) {
  const email = normalizeEmail(rawEmail);
  const existing = await prisma.user.findUnique({ where: { email } });

  const password = rawPassword?.trim() || randomBytes(18).toString('base64url');
  const generated = !rawPassword?.trim();
  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    await prisma.user.update({ where: { email }, data: { passwordHash } });
    console.log(`\n✔ Senha de "${email}" redefinida.`);
  } else {
    await prisma.user.create({
      data: { email, passwordHash, name: process.env.ADMIN_NAME?.trim() || 'Administrador', role: 'admin' },
    });
    console.log(`\n✔ Admin "${email}" não existia e foi criado.`);
  }

  if (generated) {
    console.log(`⚠ SENHA (mostrada só agora, salve já): ${password}`);
  }
  console.log('');
}

async function main() {
  const [, , comando, ...args] = process.argv;

  switch (comando) {
    case 'list':
      return list();
    case 'set-password': {
      if (!args[0]) {
        console.error('Uso: set-password <email> [senha]');
        process.exitCode = 1;
        return;
      }
      return setPassword(args[0], args[1]);
    }
    default:
      console.log('\nComandos: list | set-password <email> [senha]\n');
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
