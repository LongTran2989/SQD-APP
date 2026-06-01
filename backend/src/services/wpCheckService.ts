import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export interface CheckTaskResult {
  generated: boolean;
  taskId?: string;
  taskDbId?: number;
  checkTemplateWarning?: string;
  reason?: string;
}

/**
 * Generates a daily CHECK task for a Work Package.
 * 
 * This function is designed to be called from:
 * - On-demand: GET /api/work-packages/:id (current Phase 5.1)
 * - Cron job: Phase 7 (node-cron, 00:01 UTC daily)
 * 
 * Guards:
 * - WP must be CHECK type with a checkTemplateId
 * - WP computed status must be "In Progress" (current date within timeframe)
 * - Template must be Published (not Archived/Draft/deleted)
 * - A task must not have already been generated today for this WP
 * 
 * @param wpId - The internal database ID (number) of the Work Package
 * @param prismaClient - Optional Prisma client instance for dependency injection (testing)
 */
export async function generateDailyCheckTasks(
  wpId: number,
  prismaClient?: PrismaClient
): Promise<CheckTaskResult> {
  const db = prismaClient || prisma;

  // 1. Fetch the WP
  const wp = await db.workPackage.findUnique({
    where: { id: wpId, deletedAt: null },
    include: { division: { select: { code: true } } }
  });

  if (!wp) {
    return { generated: false, reason: 'Work Package not found' };
  }

  // 2. Must be CHECK type
  if (wp.type !== 'CHECK') {
    return { generated: false, reason: 'Work Package is not CHECK type' };
  }

  // 3. Must have a checkTemplateId
  if (!wp.checkTemplateId) {
    return { generated: false, reason: 'No checkTemplateId configured' };
  }

  // 4. Must NOT be manually Closed or Inactive
  if (wp.status === 'Closed' || wp.status === 'Inactive') {
    return { generated: false, reason: `Work Package is ${wp.status}` };
  }

  // 5. Compute status — must be "In Progress"
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (today < new Date(wp.timeframeFrom.getFullYear(), wp.timeframeFrom.getMonth(), wp.timeframeFrom.getDate())) {
    return { generated: false, reason: 'Work Package has not started yet (status: Open)' };
  }

  // 6. Check template validity
  const template = await db.template.findUnique({
    where: { id: wp.checkTemplateId }
  });

  if (!template) {
    return {
      generated: false,
      checkTemplateWarning: 'Template not found. Daily task could not be generated.'
    };
  }

  if (template.status === 'Archived') {
    return {
      generated: false,
      checkTemplateWarning: 'Template is archived. Daily task could not be generated.'
    };
  }

  if (template.status !== 'Published') {
    return {
      generated: false,
      checkTemplateWarning: `Template is in ${template.status} status. Only Published templates can generate tasks.`
    };
  }

  // 7. Guard: check if a task was already generated today for this WP
  const startOfDay = new Date(today);
  const endOfDay = new Date(today);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const existingTask = await db.task.findFirst({
    where: {
      wpId: wp.id,
      templateId: template.id,
      deletedAt: null,
      createdAt: {
        gte: startOfDay,
        lt: endOfDay
      }
    }
  });

  if (existingTask) {
    return {
      generated: false,
      reason: 'A CHECK task has already been generated today for this Work Package'
    };
  }

  // 8. Generate the task
  const divCode = wp.division.code;

  // Find highest sequence for this division's tasks
  const lastTask = await db.task.findFirst({
    where: { taskId: { startsWith: `${divCode}-` }, deletedAt: null },
    orderBy: { id: 'desc' },
    select: { taskId: true }
  });

  let nextSeq = 1;
  if (lastTask?.taskId) {
    const parts = lastTask.taskId.split('-');
    const seqPart = parts[parts.length - 1];
    if (seqPart) {
      nextSeq = parseInt(seqPart) + 1;
    }
  }

  const generatedTaskId = `${divCode}-${String(nextSeq).padStart(6, '0')}`;

  const task = await db.task.create({
    data: {
      taskId: generatedTaskId,
      templateId: template.id,
      issuerId: wp.creatorId,
      status: 'Unassigned',
      wpId: wp.id,
      schemaSnapshot: template.formSchema as any,
      estimatedHours: template.estimatedHours,
      targetDivisionId: wp.divisionId,
      assignmentType: 'INDIVIDUAL',
      deadline: new Date(endOfDay.getTime() - 1),
    }
  });

  // 9. Log a SYSTEM_EVENT in the FeedPost feed
  await db.feedPost.create({
    data: {
      scope: 'TASK',
      scopeId: task.id,
      type: 'SYSTEM_EVENT',
      content: `Task auto-generated from CHECK Work Package ${wp.wpId}`,
      metadata: {
        wpId: wp.wpId,
        templateId: template.templateId,
        generationType: 'CHECK_DAILY'
      }
    }
  });

  // 10. Log to AuditLog
  await db.auditLog.create({
    data: {
      actionType: 'TASK_AUTO_GENERATED',
      entityType: 'Task',
      entityId: String(task.id),
      performedByUserId: wp.creatorId,
      details: {
        wpId: wp.wpId,
        templateId: template.templateId,
        generationType: 'CHECK_DAILY',
        taskId: generatedTaskId
      }
    }
  });

  return {
    generated: true,
    taskId: generatedTaskId,
    taskDbId: task.id
  };
}
