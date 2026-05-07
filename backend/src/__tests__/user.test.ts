import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('User RBAC Endpoints', () => {
  let adminToken: string;
  let staffToken: string;
  let targetUserId: number;

  beforeAll(async () => {
    const roles = ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'];
    for (const roleName of roles) {
      await prisma.role.upsert({ where: { name: roleName }, update: {}, create: { name: roleName } });
    }

    const adminRole = await prisma.role.findUnique({ where: { name: 'Admin' } });
    const staffRole = await prisma.role.findUnique({ where: { name: 'Staff' } });
    
    const department = await prisma.department.create({ data: { name: 'RBAC Dept' } });
    const division = await prisma.division.create({ data: { name: 'RBAC Div', departmentId: department.id } });

    const adminUser = await prisma.user.create({
      data: { name: 'Admin', email: 'adminrbac@sqd.com', passwordHash: 'hash', divisionId: division.id, roleId: adminRole!.id }
    });

    const staffUser = await prisma.user.create({
      data: { name: 'Staff', email: 'staffrbac@sqd.com', passwordHash: 'hash', divisionId: division.id, roleId: staffRole!.id }
    });

    const targetUser = await prisma.user.create({
      data: { name: 'Target', email: 'target@sqd.com', passwordHash: 'hash', divisionId: division.id, roleId: staffRole!.id }
    });
    targetUserId = targetUser.id;

    adminToken = jwt.sign({ userId: adminUser.id, role: 'Admin', divisionId: division.id }, process.env.JWT_SECRET || 'fallback_secret');
    staffToken = jwt.sign({ userId: staffUser.id, role: 'Staff', divisionId: division.id }, process.env.JWT_SECRET || 'fallback_secret');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({});
    await prisma.division.deleteMany({});
    await prisma.department.deleteMany({});
    await prisma.$disconnect();
  });

  it('should block Staff from modifying user role', async () => {
    const res = await request(app)
      .put(`/api/users/${targetUserId}/role`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ roleName: 'Manager' });
    
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Forbidden/);
  });

  it('should allow Admin to modify user role', async () => {
    const res = await request(app)
      .put(`/api/users/${targetUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleName: 'Manager' });
    
    expect(res.status).toBe(200);
    expect(res.body.user.role.name).toBe('Manager');
  });
});
