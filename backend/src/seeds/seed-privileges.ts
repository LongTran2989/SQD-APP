import { PrismaClient, Prisma } from '@prisma/client';
import { DEFAULT_PRIVILEGES, ROLE_NAMES } from '../constants/privileges';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Idempotently seeds PrivilegeConfig rows for every role from DEFAULT_PRIVILEGES.
 *
 * Uses `update: {}` on conflict so an existing (possibly Admin-customised) config
 * is never overwritten — this only fills in missing rows. Safe to call on every
 * boot / seed run. Roles must already exist.
 *
 * Returns the number of roles processed.
 */
export async function seedPrivileges(client: PrismaLike): Promise<number> {
  const roles = await client.role.findMany({
    where: { name: { in: ROLE_NAMES } },
    select: { id: true, name: true },
  });

  let count = 0;
  for (const role of roles) {
    const permissions = DEFAULT_PRIVILEGES[role.name as keyof typeof DEFAULT_PRIVILEGES];
    if (!permissions) continue;
    await client.privilegeConfig.upsert({
      where: { roleId: role.id },
      update: {}, // never clobber an existing (customised) config
      create: { roleId: role.id, permissions: permissions as Prisma.InputJsonValue },
    });
    count++;
  }
  return count;
}
