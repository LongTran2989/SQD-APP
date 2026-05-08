import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Returns data for dynamic dropdowns in the template builder.
 * Supports: departments, divisions, users, aircrafts
 */
export const getDataSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const source = req.params.source as string;

    switch (source) {
      case 'departments': {
        const departments = await prisma.department.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' }
        });
        res.json(departments.map(d => ({ value: String(d.id), label: d.name })));
        return;
      }
      case 'divisions': {
        const divisions = await prisma.division.findMany({
          select: { id: true, name: true, department: { select: { name: true } } },
          orderBy: { name: 'asc' }
        });
        res.json(divisions.map(d => ({
          value: String(d.id),
          label: `${d.name} (${d.department.name})`
        })));
        return;
      }
      case 'users': {
        const users = await prisma.user.findMany({
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' }
        });
        res.json(users.map(u => ({ value: String(u.id), label: `${u.name} (${u.email})` })));
        return;
      }
      case 'aircrafts': {
        const aircrafts = await prisma.aircraftType.findMany({
          select: { id: true, code: true, description: true },
          orderBy: { code: 'asc' }
        });
        res.json(aircrafts.map(a => ({
          value: String(a.id),
          label: `${a.code}${a.description ? ' — ' + a.description : ''}`
        })));
        return;
      }
      default:
        res.status(400).json({ message: `Unknown data source: ${source}` });
    }
  } catch (error) {
    console.error('Error fetching data source:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
