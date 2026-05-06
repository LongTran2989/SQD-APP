import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    const { roleName } = req.body;

    if (isNaN(userId) || !roleName) {
      res.status(400).json({ message: 'User ID and roleName are required' });
      return;
    }

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      res.status(400).json({ message: 'Invalid role provided' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { roleId: role.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        divisionId: true
      }
    });

    res.json({ message: 'User privileges updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Error updating user privileges:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
