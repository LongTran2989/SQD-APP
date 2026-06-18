import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const roles = await prisma.role.findMany({ include: { privilegeConfig: true } });
  console.log(JSON.stringify(roles.map(r => {
    const p: any = r.privilegeConfig?.permissions || {};
    return { name: r.name, create: p['task:create'], assign_any: p['task:assign_any'], assign_div: p['task:assign_div'] };
  }), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
