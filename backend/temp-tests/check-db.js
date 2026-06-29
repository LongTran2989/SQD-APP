const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const capas = await prisma.capaAction.findMany({ include: { linkedItems: true, finding: { select: { findingId: true } } } });
  console.log('CAPAs:', JSON.stringify(capas, null, 2));
  
  const followUps = await prisma.task.findMany({ where: { parentFindingId: { not: null } }, select: { taskId: true, parentFindingId: true, title: true } });
  console.log('Follow-ups:', JSON.stringify(followUps, null, 2));
  
  const capaLinks = await prisma.capaTaskLink.findMany();
  console.log('CapaTaskLinks:', JSON.stringify(capaLinks, null, 2));
}
main().finally(() => prisma.$disconnect());
