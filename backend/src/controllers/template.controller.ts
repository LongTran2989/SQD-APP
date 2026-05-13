import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
      // For anyone else, do not leak draftSchema
      let returnedTemplate = { ...t, draftSchema: undefined };

      if (t.draftSchema && (t.ownerId === userId || isAdminOrDirector)) {
        returnedTemplate = {
          ...returnedTemplate,
          status: 'Draft',
          ...(Array.isArray(t.draftSchema) 
            ? { formSchema: t.draftSchema as any } 
            : {
                title: (t.draftSchema as any).title,
                description: (t.draftSchema as any).description,
                formSchema: (t.draftSchema as any).formSchema,
                requiresApproval: (t.draftSchema as any).requiresApproval,
                allowsFindings: (t.draftSchema as any).allowsFindings,
              })
        };
      }
      return returnedTemplate;
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

    let responseTemplate: any = { ...template, draftSchema: undefined };
    if (template.draftSchema && (template.ownerId === userId || isAdminOrDirector)) {
      responseTemplate = {
        ...responseTemplate,
        status: 'Draft',
        ...(Array.isArray(template.draftSchema) 
          ? { formSchema: template.draftSchema } 
          : {
              title: (template.draftSchema as any).title,
              description: (template.draftSchema as any).description,
              formSchema: (template.draftSchema as any).formSchema,
              requiresApproval: (template.draftSchema as any).requiresApproval,
              allowsFindings: (template.draftSchema as any).allowsFindings,
            })
      };
    }

    res.json(responseTemplate);
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
    const { title, description, formSchema, requiresApproval, allowsFindings } = req.body;

    const existingTemplate = await prisma.template.findUnique({ where: { id } });

    if (!existingTemplate) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    // Check ownership
    if (existingTemplate.ownerId !== userId && !['Admin', 'Director'].includes(userRole)) {
      res.status(403).json({ message: 'Only the template owner can modify this template.' });
      return;
    }

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
      };
    } else {
      dataToUpdate.title = title;
      dataToUpdate.description = description;
      dataToUpdate.formSchema = formSchema;
      dataToUpdate.requiresApproval = requiresApproval !== undefined ? requiresApproval : existingTemplate.requiresApproval;
      dataToUpdate.allowsFindings = allowsFindings !== undefined ? allowsFindings : existingTemplate.allowsFindings;
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

    let responseTemplate: any = { ...updatedTemplate, draftSchema: undefined };
    if (updatedTemplate.draftSchema && (updatedTemplate.ownerId === userId || ['Admin', 'Director'].includes(userRole))) {
      responseTemplate = {
        ...responseTemplate,
        status: 'Draft',
        ...(Array.isArray(updatedTemplate.draftSchema) 
          ? { formSchema: updatedTemplate.draftSchema } 
          : {
              title: (updatedTemplate.draftSchema as any).title,
              description: (updatedTemplate.draftSchema as any).description,
              formSchema: (updatedTemplate.draftSchema as any).formSchema,
              requiresApproval: (updatedTemplate.draftSchema as any).requiresApproval,
              allowsFindings: (updatedTemplate.draftSchema as any).allowsFindings,
            })
      };
    }

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

    const result = await prisma.$transaction(async (tx) => {
      const template = await tx.template.findUnique({ where: { id } });
      if (!template) throw new Error('Template not found');

      // Check ownership
      if (template.ownerId !== userId && !['Admin', 'Director'].includes(userRole)) {
        throw new Error('Only the template owner can publish this template.');
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
        const draft = template.draftSchema as any;
        if (Array.isArray(draft)) {
          dataToPublish.formSchema = draft;
        } else {
          dataToPublish.title = draft.title;
          dataToPublish.description = draft.description;
          dataToPublish.formSchema = draft.formSchema;
          dataToPublish.requiresApproval = draft.requiresApproval;
          dataToPublish.allowsFindings = draft.allowsFindings;
        }
      } else {
        dataToPublish.formSchema = template.formSchema;
      }

      if (!dataToPublish.formSchema || (Array.isArray(dataToPublish.formSchema) && dataToPublish.formSchema.length === 0)) {
        throw new Error('Cannot publish a template with an empty formSchema');
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

    // Only owner or privileged user can transfer
    if (template.ownerId !== userId && !['Admin', 'Director'].includes(userRole)) {
      res.status(403).json({ message: 'Only the template owner or an Admin can transfer ownership.' });
      return;
    }

    // Check if new owner exists
    const newOwner = await prisma.user.findUnique({ where: { id: parseInt(newOwnerId) } });
    if (!newOwner) {
      res.status(404).json({ message: 'New owner user not found' });
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
