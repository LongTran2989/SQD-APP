import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function isLockValid(lockedAt: Date | null): boolean {
  if (!lockedAt) return false;
  return Date.now() - new Date(lockedAt).getTime() < LOCK_DURATION_MS;
}

// ─── GET /api/templates ──────────────────────────────────────────────
export const getTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const templates = await prisma.template.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        division: { select: { name: true, code: true } },
        revisedByUser: { select: { id: true, name: true } },
        lockedByUser: { select: { id: true, name: true } },
      }
    });

    const result = templates.map(t => ({
      ...t,
      isLocked: !!t.lockedByUserId && isLockValid(t.lockedAt),
      lockedByName: t.lockedByUser?.name || null,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/templates/:id ──────────────────────────────────────────
export const getTemplateById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const template = await prisma.template.findUnique({
      where: { id },
      include: {
        division: { select: { name: true, code: true } },
        revisedByUser: { select: { id: true, name: true } },
        lockedByUser: { select: { id: true, name: true } },
        revisionArchives: {
          orderBy: { revision: 'desc' },
          include: { revisedByUser: { select: { name: true } } }
        },
      }
    });

    if (!template) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    res.json({
      ...template,
      isLocked: !!template.lockedByUserId && isLockValid(template.lockedAt),
      lockedByName: template.lockedByUser?.name || null,
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/templates ─────────────────────────────────────────────
export const createTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, formSchema, status, requiresApproval, allowsFindings, divisionId } = req.body;
    const userId = req.user!.userId;

    if (!title || !formSchema) {
      res.status(400).json({ message: 'Title and form schema are required' });
      return;
    }

    // Use the creator's divisionId if none specified
    const targetDivisionId = divisionId || req.user!.divisionId;

    // Auto-generate templateId atomically
    const template = await prisma.$transaction(async (tx) => {
      // Get the division code
      const division = await tx.division.findUnique({ where: { id: targetDivisionId } });
      if (!division) throw new Error('Division not found');

      // Find the highest sequence number for this division
      const lastTemplate = await tx.template.findFirst({
        where: { divisionId: targetDivisionId },
        orderBy: { id: 'desc' },
        select: { templateId: true }
      });

      let nextSeq = 1;
      if (lastTemplate?.templateId) {
        const parts = lastTemplate.templateId.split('-');
        nextSeq = parseInt(parts[parts.length - 1] as string) + 1;
      }

      const generatedTemplateId = `${division.code}-${String(nextSeq).padStart(3, '0')}`;

      return tx.template.create({
        data: {
          templateId: generatedTemplateId,
          title,
          description,
          formSchema,
          status: status || 'Draft',
          requiresApproval: requiresApproval || false,
          allowsFindings: allowsFindings !== undefined ? allowsFindings : true,
          revision: 1,
          divisionId: targetDivisionId,
          revisedByUserId: userId,
          revisedAt: new Date(),
          publishedAt: status === 'Published' ? new Date() : null,
        },
        include: {
          division: { select: { name: true, code: true } },
        }
      });
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/templates/:id ──────────────────────────────────────────
export const updateTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;
    const { title, description, formSchema, requiresApproval, allowsFindings } = req.body;

    const existingTemplate = await prisma.template.findUnique({ where: { id } });
    
    if (!existingTemplate) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    // Check lock: if locked by another user and lock is still valid, reject
    if (existingTemplate.lockedByUserId && existingTemplate.lockedByUserId !== userId && isLockValid(existingTemplate.lockedAt)) {
      res.status(409).json({ message: 'Template is currently locked by another user.' });
      return;
    }

    const updatedTemplate = await prisma.template.update({
      where: { id },
      data: {
        title,
        description,
        formSchema,
        requiresApproval: requiresApproval !== undefined ? requiresApproval : existingTemplate.requiresApproval,
        allowsFindings: allowsFindings !== undefined ? allowsFindings : existingTemplate.allowsFindings,
        revisedByUserId: userId,
        revisedAt: new Date(),
      }
    });

    res.json(updatedTemplate);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/templates/:id/publish ─────────────────────────────────
export const publishTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;

    const result = await prisma.$transaction(async (tx) => {
      const template = await tx.template.findUnique({ where: { id } });
      if (!template) throw new Error('Template not found');

      // If already published, archive the current version before overwriting
      if (template.status === 'Published' && template.publishedAt) {
        await tx.templateRevisionArchive.create({
          data: {
            templateId: template.id,
            revision: template.revision,
            formSchema: template.formSchema as any,
            publishedAt: template.publishedAt,
            revisedByUserId: template.revisedByUserId || userId,
          }
        });
      }

      // Determine new revision number
      const newRevision = template.status === 'Published' ? template.revision + 1 : template.revision;

      // Publish and release lock
      return tx.template.update({
        where: { id },
        data: {
          status: 'Published',
          revision: newRevision,
          publishedAt: new Date(),
          revisedByUserId: userId,
          revisedAt: new Date(),
          lockedByUserId: null,
          lockedAt: null,
        }
      });
    });

    res.json(result);
  } catch (error: any) {
    if (error.message === 'Template not found') {
      res.status(404).json({ message: 'Template not found' });
      return;
    }
    console.error('Error publishing template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/templates/:id/lock ────────────────────────────────────
export const lockTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;

    const template = await prisma.template.findUnique({
      where: { id },
      include: { lockedByUser: { select: { name: true } } }
    });

    if (!template) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    // If already locked by another user and lock is still valid
    if (template.lockedByUserId && template.lockedByUserId !== userId && isLockValid(template.lockedAt)) {
      res.status(409).json({
        message: `Template is locked by ${template.lockedByUser?.name}. Try again later.`,
        lockedBy: template.lockedByUser?.name,
        lockedAt: template.lockedAt,
      });
      return;
    }

    const updated = await prisma.template.update({
      where: { id },
      data: {
        lockedByUserId: userId,
        lockedAt: new Date(),
      }
    });

    res.json({ message: 'Template locked successfully.', lockedAt: updated.lockedAt });
  } catch (error) {
    console.error('Error locking template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/templates/:id/unlock ──────────────────────────────────
export const unlockTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    const template = await prisma.template.findUnique({ where: { id } });

    if (!template) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    // Only the lock owner or Admin/Director can unlock
    const isOwner = template.lockedByUserId === userId;
    const isPrivileged = ['Admin', 'Director'].includes(userRole);

    if (!isOwner && !isPrivileged) {
      res.status(403).json({ message: 'Only the lock owner or an Admin/Director can unlock this template.' });
      return;
    }

    await prisma.template.update({
      where: { id },
      data: {
        lockedByUserId: null,
        lockedAt: null,
      }
    });

    res.json({ message: 'Template unlocked successfully.' });
  } catch (error) {
    console.error('Error unlocking template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── DELETE /api/templates/:id ───────────────────────────────────────
export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);

    const tasksCount = await prisma.task.count({ where: { templateId: id } });
    if (tasksCount > 0) {
      await prisma.template.update({
        where: { id },
        data: { status: 'Archived' }
      });
      res.json({ message: 'Template archived as it is currently in use by existing tasks.' });
      return;
    }

    await prisma.template.delete({ where: { id } });
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
