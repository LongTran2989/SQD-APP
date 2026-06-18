import { PrismaClient } from '@prisma/client';
import { hasPrivilege } from './src/utils/privilegeAccess';

const prisma = new PrismaClient();
async function main() {
  const manager = await prisma.user.findFirst({
    where: { role: { name: 'Manager' } },
    include: { role: { include: { privilegeConfig: true } } }
  });
  if (!manager) {
    console.log('No manager found');
    return;
  }
  
  const actor = {
    userId: manager.id,
    role: manager.role.name,
    divisionId: manager.divisionId,
    permissions: manager.role.privilegeConfig?.permissions as Record<string, boolean> | null
  };
  
  console.log('Actor:', JSON.stringify(actor, null, 2));
  console.log('task:create allowed?', hasPrivilege(actor, 'task:create'));
  console.log('task:assign_any allowed?', hasPrivilege(actor, 'task:assign_any'));
  console.log('task:assign_div allowed?', hasPrivilege(actor, 'task:assign_div'));
}
main().catch(console.error).finally(() => prisma.$disconnect());
