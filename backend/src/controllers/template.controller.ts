import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const getTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const templates = await prisma.template.findMany({
      orderBy: { updatedAt: 'desc' }
    });
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getTemplateById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const template = await prisma.template.findUnique({
      where: { id }
    });

    if (!template) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    res.json(template);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, formSchema, status, requiresApproval, allowsFindings } = req.body;

    if (!title || !formSchema) {
      res.status(400).json({ message: 'Title and form schema are required' });
      return;
    }

    const template = await prisma.template.create({
      data: {
        title,
        description,
        formSchema,
        status: status || 'Draft',
        requiresApproval: requiresApproval || false,
        allowsFindings: allowsFindings !== undefined ? allowsFindings : true,
        revision: 1,
        publishedAt: status === 'Published' ? new Date() : null
      }
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { title, description, formSchema, status, requiresApproval, allowsFindings } = req.body;

    const existingTemplate = await prisma.template.findUnique({ where: { id } });
    
    if (!existingTemplate) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    // Logic: If transitioning from Draft to Published, set publishedAt.
    // If it was already Published and we are updating it, increment revision.
    let revision = existingTemplate.revision;
    let publishedAt = existingTemplate.publishedAt;

    if (status === 'Published' && existingTemplate.status !== 'Published') {
      publishedAt = new Date();
    } else if (existingTemplate.status === 'Published') {
      // Modifying an already published template creates a new revision
      revision += 1;
    }

    const updatedTemplate = await prisma.template.update({
      where: { id },
      data: {
        title,
        description,
        formSchema,
        status: status || existingTemplate.status,
        requiresApproval: requiresApproval !== undefined ? requiresApproval : existingTemplate.requiresApproval,
        allowsFindings: allowsFindings !== undefined ? allowsFindings : existingTemplate.allowsFindings,
        revision,
        publishedAt
      }
    });

    res.json(updatedTemplate);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);

    // Check if the template is used by any tasks
    const tasksCount = await prisma.task.count({ where: { templateId: id } });
    if (tasksCount > 0) {
      // Soft delete by archiving
      await prisma.template.update({
        where: { id },
        data: { status: 'Archived' }
      });
      res.json({ message: 'Template archived as it is currently in use by existing tasks.' });
      return;
    }

    await prisma.template.delete({
      where: { id }
    });

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
