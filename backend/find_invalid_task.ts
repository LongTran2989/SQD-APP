import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Querying for tasks with extremely large deadlines...");
  try {
    // We cast deadline to text so Prisma doesn't attempt to parse it into a JS Date object
    // and crash before we can see it.
    const tasks = await prisma.$queryRaw`
      SELECT id, "taskId", title, "status", deadline::text as deadline_text 
      FROM "Task" 
      WHERE deadline > '3000-01-01'::timestamp;
    `;
    console.log("Found tasks:");
    console.dir(tasks, { depth: null });
  } catch (error) {
    console.error("Query failed:", error);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
