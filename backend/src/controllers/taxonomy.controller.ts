import { Request, Response } from 'express';
import { hasPrivilege } from '../utils/privilegeAccess';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const activeOnly = (req: Request) => req.query.activeOnly === 'true';

// ─── ATA Chapters ─────────────────────────────────────────────────────────────

export const listAtaChapters = async (req: Request, res: Response): Promise<void> => {
  try {
    const chapters = await prisma.ataChapter.findMany({
      where: activeOnly(req) ? { isActive: true } : {},
      orderBy: { code: 'asc' },
    });
    res.json(chapters);
  } catch (error) {
    console.error('Error listing ATA chapters:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const upsertAtaChapter = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasPrivilege(req.user!, 'settings:taxonomy')) {
      res.status(403).json({ message: 'Only an Admin or Director can manage ATA chapters' });
      return;
    }
    const idParam = req.params.id;
    const { code, title, isActive } = req.body;

    if (idParam) {
      const updated = await prisma.ataChapter.update({
        where: { id: parseInt(String(idParam), 10) },
        data: {
          ...(code !== undefined ? { code } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });
      res.json(updated);
      return;
    }
    if (!code || !title) {
      res.status(400).json({ message: 'code and title are required' });
      return;
    }
    const created = await prisma.ataChapter.create({ data: { code, title } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error upserting ATA chapter:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── Cause Codes ──────────────────────────────────────────────────────────────

export const listCauseCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const codes = await prisma.causeCode.findMany({
      where: activeOnly(req) ? { isActive: true } : {},
      orderBy: { code: 'asc' },
    });
    res.json(codes);
  } catch (error) {
    console.error('Error listing cause codes:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const upsertCauseCode = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasPrivilege(req.user!, 'settings:taxonomy')) {
      res.status(403).json({ message: 'Only an Admin or Director can manage cause codes' });
      return;
    }
    const idParam = req.params.id;
    const { code, name, groupCode, groupName, isActive } = req.body;

    if (idParam) {
      const updated = await prisma.causeCode.update({
        where: { id: parseInt(String(idParam), 10) },
        data: {
          ...(code !== undefined ? { code } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(groupCode !== undefined ? { groupCode } : {}),
          ...(groupName !== undefined ? { groupName } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });
      res.json(updated);
      return;
    }
    if (!code || !name || !groupCode || !groupName) {
      res.status(400).json({ message: 'code, name, groupCode and groupName are required' });
      return;
    }
    const created = await prisma.causeCode.create({ data: { code, name, groupCode, groupName } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error upserting cause code:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── Hazard Tags ──────────────────────────────────────────────────────────────

export const listHazardTags = async (req: Request, res: Response): Promise<void> => {
  try {
    const tags = await prisma.hazardTag.findMany({
      where: activeOnly(req) ? { isActive: true } : {},
      orderBy: { label: 'asc' },
    });
    res.json(tags);
  } catch (error) {
    console.error('Error listing hazard tags:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const upsertHazardTag = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasPrivilege(req.user!, 'settings:taxonomy')) {
      res.status(403).json({ message: 'Only an Admin or Director can manage hazard tags' });
      return;
    }
    const idParam = req.params.id;
    const { label, description, isActive } = req.body;

    if (idParam) {
      const updated = await prisma.hazardTag.update({
        where: { id: parseInt(String(idParam), 10) },
        data: {
          ...(label !== undefined ? { label } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });
      res.json(updated);
      return;
    }
    if (!label) {
      res.status(400).json({ message: 'label is required' });
      return;
    }
    const created = await prisma.hazardTag.create({ data: { label, description: description ?? null } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error upserting hazard tag:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
