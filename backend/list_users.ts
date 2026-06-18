import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ include: { role: true, division: true } });
  console.log(JSON.stringify(users.map(u => ({ id: u.id, name: u.name, role: u.role.name, division: u.division.name })), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
