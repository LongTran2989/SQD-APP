import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Roles that may own/edit/publish templates (a template owner must be one of these).
const TEMPLATE_OWNER_ROLES = ['Manager', 'Director', 'Admin'];

/**
 * Optimistic concurrency guard. The client echoes the `updatedAt` it last saw;
 * if it no longer matches the DB row, the row changed under it → 409 Conflict.
 * When the client omits the token we skip the check (back-compat). Returns false
 * (and writes the response) on conflict so callers can early-return.
 */
function assertNotStale(dbUpdatedAt: Date, clientUpdatedAt: unknown, res: Response): boolean {
  if (clientUpdatedAt === undefined || clientUpdatedAt === null) return true;
  const client = new Date(String(clientUpdatedAt)).getTime();
  if (Number.isNaN(client) || client !== dbUpdatedAt.getTime()) {
    res.status(409).json({ message: 'This template was modified by someone else. Please reload and try again.' });
    return false;
  }
  return true;
}

/** Canonical JSON (sorted object keys) for order-insensitive deep comparison. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc, k) => {
        acc[k] = canonicalize((value as Record<string, unknown>)[k]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return value;
}

function deepEqualCanonical(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

// ─── GET /api/templates ──────────────────────────────────────────────
export const getTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const templates = await prisma.template.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        division: { select: { name: true, code: true } },
        revisedByUser: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
      }
    });

    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const isAdminOrDirector = ['Admin', 'Director'].includes(userRole);

    const mappedTemplates = templates.map(t => {
      const canSeeDraft = t.ownerId === userId || isAdminOrDirector;
      // PR7: no longer mask Published-with-draft as 'Draft'. Return the TRUE status
      // plus a hasPendingChanges flag; expose draftSchema only to owner/Admin/Director.
      return {
        ...t,
        hasPendingChanges: t.draftSchema != null,
        draftSchema: canSeeDraft ? t.draftSchema : undefined,
      };
    });

    res.json(mappedTemplates);
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
        owner: { select: { id: true, name: true } },
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

    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const isAdminOrDirector = ['Admin', 'Director'].includes(userRole);
    const canSeeDraft = template.ownerId === userId || isAdminOrDirector;

    // PR7: return the TRUE status + hasPendingChanges; expose draftSchema only to
    // owner/Admin/Director so the builder can edit the pending draft.
    const responseTemplate = {
      ...template,
      hasPendingChanges: template.draftSchema != null,
      draftSchema: canSeeDraft ? template.draftSchema : undefined,
    };

    res.json(responseTemplate);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/templates ─────────────────────────────────────────────
export const createTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, formSchema, status, requiresApproval, allowsFindings, divisionId, estimatedHours, skillLevel, type } = req.body;
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    if (!title || !formSchema) {
      res.status(400).json({ message: 'Title and form schema are required' });
      return;
    }

    // Use the creator's divisionId if none specified
    const targetDivisionId = divisionId || req.user!.divisionId;

    // Managers are scoped to their own division
    if (userRole === 'Manager' && targetDivisionId !== req.user!.divisionId) {
      res.status(403).json({ message: 'Managers can only create templates for their own division' });
      return;
    }

    // Auto-generate templateId atomically
    const template = await prisma.$transaction(async (tx) => {
      // Get the division code and lock the row to serialize concurrent creations for the same division
      const divRaw = await tx.$queryRaw<{ id: number, code: string }[]>`SELECT id, code FROM "Division" WHERE id = ${targetDivisionId} FOR UPDATE`;
      if (divRaw.length === 0) throw new Error('Division not found');
      const division = divRaw[0]!;

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
          estimatedHours: estimatedHours || null,
          skillLevel: skillLevel ?? 0,
          type: type || null,
          revision: 1,
          divisionId: targetDivisionId,
          revisedByUserId: userId,
          revisedAt: new Date(),
          publishedAt: status === 'Published' ? new Date() : null,
          ownerId: userId, // Assign ownership to creator
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
    const userRole = req.user!.role;
    const { title, description, formSchema, requiresApproval, allowsFindings, estimatedHours, skillLevel, type, updatedAt } = req.body;

    const existingTemplate = await prisma.template.findUnique({ where: { id } });

    if (!existingTemplate) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    if (existingTemplate.status === 'Archived') {
      res.status(403).json({ message: 'Cannot edit an archived template.' });
      return;
    }

    // Check ownership
    if (existingTemplate.ownerId !== userId && !['Admin', 'Director'].includes(userRole)) {
      res.status(403).json({ message: 'Only the template owner can modify this template.' });
      return;
    }

    // Optimistic concurrency (PR7): the client echoes the updatedAt it last saw.
    // Treat it as an opaque token; reject if the row has moved on since.
    if (!assertNotStale(existingTemplate.updatedAt, updatedAt, res)) return;

    let dataToUpdate: any = {
      revisedByUserId: userId,
      revisedAt: new Date(),
    };

    if (existingTemplate.status === 'Published') {
      dataToUpdate.draftSchema = {
        title,
        description,
        formSchema,
        requiresApproval: requiresApproval !== undefined ? requiresApproval : existingTemplate.requiresApproval,
        allowsFindings: allowsFindings !== undefined ? allowsFindings : existingTemplate.allowsFindings,
        estimatedHours: estimatedHours !== undefined ? estimatedHours : existingTemplate.estimatedHours,
        skillLevel: skillLevel !== undefined ? skillLevel : existingTemplate.skillLevel,
        type: type !== undefined ? type : existingTemplate.type,
      };
    } else {
      dataToUpdate.title = title;
      dataToUpdate.description = description;
      dataToUpdate.formSchema = formSchema;
      dataToUpdate.requiresApproval = requiresApproval !== undefined ? requiresApproval : existingTemplate.requiresApproval;
      dataToUpdate.allowsFindings = allowsFindings !== undefined ? allowsFindings : existingTemplate.allowsFindings;
      if (estimatedHours !== undefined) dataToUpdate.estimatedHours = estimatedHours;
      if (skillLevel !== undefined) dataToUpdate.skillLevel = skillLevel;
      if (type !== undefined) dataToUpdate.type = type;
    }

    const updatedTemplate = await prisma.template.update({
      where: { id },
      data: dataToUpdate,
      include: {
        division: { select: { name: true, code: true } },
        revisedByUser: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        revisionArchives: {
          orderBy: { revision: 'desc' },
          include: { revisedByUser: { select: { name: true } } }
        },
      }
    });

    const canSeeDraft = updatedTemplate.ownerId === userId || ['Admin', 'Director'].includes(userRole);
    const responseTemplate = {
      ...updatedTemplate,
      hasPendingChanges: updatedTemplate.draftSchema != null,
      draftSchema: canSeeDraft ? updatedTemplate.draftSchema : undefined,
    };

    res.json(responseTemplate);
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
    const userRole = req.user!.role;
    const { updatedAt: clientUpdatedAt } = req.body ?? {};

    const result = await prisma.$transaction(async (tx) => {
      const template = await tx.template.findUnique({ where: { id } });
      if (!template) throw new Error('Template not found');

      if (template.status === 'Archived') {
        throw new Error('Cannot publish an archived template.');
      }

      // Check ownership
      if (template.ownerId !== userId && !['Admin', 'Director'].includes(userRole)) {
        throw new Error('Only the template owner can publish this template.');
      }

      // Optimistic concurrency (PR7) — inside the tx so a concurrent draft write
      // cannot slip between the read and the publish.
      if (clientUpdatedAt !== undefined && clientUpdatedAt !== null) {
        const client = new Date(String(clientUpdatedAt)).getTime();
        if (Number.isNaN(client) || client !== template.updatedAt.getTime()) {
          throw new Error('STALE_TEMPLATE');
        }
      }

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

      // The new schema is either the draftSchema (if publishing pending changes) or the current formSchema
      let dataToPublish: any = {
        status: 'Published',
        revision: newRevision,
        publishedAt: new Date(),
        revisedByUserId: userId,
        revisedAt: new Date(),
        draftSchema: Prisma.DbNull,
      };

      if (template.draftSchema) {
        // draftSchema is always the standardized object form (PR1 normalization;
        // legacy array form no longer exists).
        const draft = template.draftSchema as any;
        dataToPublish.title = draft.title;
        dataToPublish.description = draft.description;
        dataToPublish.formSchema = draft.formSchema;
        dataToPublish.requiresApproval = draft.requiresApproval;
        dataToPublish.allowsFindings = draft.allowsFindings;
        if (draft.estimatedHours !== undefined) dataToPublish.estimatedHours = draft.estimatedHours;
        if (draft.skillLevel !== undefined) dataToPublish.skillLevel = draft.skillLevel;
        if (draft.type !== undefined) dataToPublish.type = draft.type;
      } else {
        dataToPublish.formSchema = template.formSchema;
      }

      if (!dataToPublish.formSchema || (Array.isArray(dataToPublish.formSchema) && dataToPublish.formSchema.length === 0)) {
        throw new Error('Cannot publish a template with an empty formSchema');
      }

      // PR7: when republishing a Published template's pending draft, abort if the
      // draft is identical to what is already live (order-insensitive deep compare).
      if (template.status === 'Published' && template.draftSchema != null) {
        const nextState = {
          title: dataToPublish.title ?? template.title,
          description: dataToPublish.description ?? template.description,
          formSchema: dataToPublish.formSchema,
          requiresApproval: dataToPublish.requiresApproval ?? template.requiresApproval,
          allowsFindings: dataToPublish.allowsFindings ?? template.allowsFindings,
          estimatedHours: dataToPublish.estimatedHours ?? template.estimatedHours,
          skillLevel: dataToPublish.skillLevel ?? template.skillLevel,
          type: dataToPublish.type ?? template.type,
        };
        const currentState = {
          title: template.title,
          description: template.description,
          formSchema: template.formSchema,
          requiresApproval: template.requiresApproval,
          allowsFindings: template.allowsFindings,
          estimatedHours: template.estimatedHours,
          skillLevel: template.skillLevel,
          type: template.type,
        };
        if (deepEqualCanonical(nextState, currentState)) {
          throw new Error('NO_CHANGES');
        }
      }

      // Publish
      return tx.template.update({
        where: { id },
        data: dataToPublish,
        include: {
          division: { select: { name: true, code: true } },
          revisedByUser: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
          revisionArchives: {
            orderBy: { revision: 'desc' },
            include: { revisedByUser: { select: { name: true } } }
          },
        }
      });
    });

    res.json(result);
  } catch (error: any) {
    if (error.message === 'Template not found') {
      res.status(404).json({ message: 'Template not found' });
      return;
    }
    if (error.message === 'Only the template owner can publish this template.') {
      res.status(403).json({ message: error.message });
      return;
    }
    if (error.message === 'Cannot publish a template with an empty formSchema') {
      res.status(400).json({ message: error.message });
      return;
    }
    if (error.message === 'Cannot publish an archived template.') {
      res.status(403).json({ message: error.message });
      return;
    }
    if (error.message === 'STALE_TEMPLATE') {
      res.status(409).json({ message: 'This template was modified by someone else. Please reload and try again.' });
      return;
    }
    if (error.message === 'NO_CHANGES') {
      res.status(400).json({ message: 'No changes to publish — the draft is identical to the current published version.' });
      return;
    }
    console.error('Error publishing template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/templates/:id/transfer ────────────────────────────────
export const transferOwnership = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const { newOwnerId } = req.body;

    if (!newOwnerId || isNaN(parseInt(newOwnerId))) {
      res.status(400).json({ message: 'Valid newOwnerId is required' });
      return;
    }

    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    const isGlobal = ['Admin', 'Director'].includes(userRole); // Director/Admin act cross-division

    // Who may transfer: the owner, or a global role (Director/Admin).
    if (template.ownerId !== userId && !isGlobal) {
      res.status(403).json({ message: 'Only the template owner or a Director/Admin can transfer ownership.' });
      return;
    }

    // The new owner must exist and hold a task-creator role (Manager/Director/Admin).
    const newOwner = await prisma.user.findUnique({
      where: { id: parseInt(newOwnerId), deletedAt: null },
      include: { role: { select: { name: true } } }
    });
    if (!newOwner) {
      res.status(404).json({ message: 'New owner user not found' });
      return;
    }
    if (!TEMPLATE_OWNER_ROLES.includes(newOwner.role.name)) {
      res.status(400).json({ message: 'New owner must be a Manager, Director, or Admin.' });
      return;
    }

    // The new owner must be in the template's division unless the actor is global.
    if (!isGlobal && newOwner.divisionId !== template.divisionId) {
      res.status(403).json({ message: 'New owner must belong to the same division as the template.' });
      return;
    }

    const updated = await prisma.template.update({
      where: { id },
      data: { ownerId: parseInt(newOwnerId) },
      include: { owner: { select: { id: true, name: true } } }
    });

    res.json({ message: 'Ownership transferred successfully', owner: updated.owner });
  } catch (error) {
    console.error('Error transferring ownership:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── DELETE /api/templates/:id ───────────────────────────────────────
export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    if (template.ownerId !== userId && !['Admin', 'Director'].includes(userRole)) {
      res.status(403).json({ message: 'Only the template owner can delete this template.' });
      return;
    }

    const tasksCount = await prisma.task.count({ where: { templateId: id, deletedAt: null } });
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

// ─── PATCH /api/templates/:id/archive ────────────────────────────────
export const archiveTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    if (template.ownerId !== userId && !['Admin', 'Director'].includes(userRole)) {
      res.status(403).json({ message: 'Only the template owner can archive this template.' });
      return;
    }

    await prisma.template.update({
      where: { id },
      data: { status: 'Archived' }
    });

    res.json({ message: 'Template archived successfully' });
  } catch (error) {
    console.error('Error archiving template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PATCH /api/templates/:id/unarchive ──────────────────────────────
export const unarchiveTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    if (template.ownerId !== userId && !['Admin', 'Director'].includes(userRole)) {
      res.status(403).json({ message: 'Only the template owner can unarchive this template.' });
      return;
    }

    if (template.status !== 'Archived') {
      res.status(400).json({ message: 'Template is not archived.' });
      return;
    }

    await prisma.template.update({
      where: { id },
      data: { status: 'Draft' }
    });

    res.json({ message: 'Template unarchived successfully and moved to Draft.' });
  } catch (error) {
    console.error('Error unarchiving template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
