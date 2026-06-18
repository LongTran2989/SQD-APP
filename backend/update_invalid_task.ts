import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Updating deadline for task ID 3 to today...");
  try {
    // We use executeRaw to bypass Prisma's validation on the existing invalid date 
    // during the fetch phase, though an update might just overwrite it.
    await prisma.$executeRaw`UPDATE "Task" SET deadline = CURRENT_TIMESTAMP WHERE id = 3;`;
    console.log("Task updated successfully!");
  } catch (error) {
    console.error("Failed to update task:", error);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
