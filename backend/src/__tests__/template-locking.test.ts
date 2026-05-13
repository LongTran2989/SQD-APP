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

describe('Template Pessimistic Locking', () => {
  let ownerToken: string;
  let otherToken: string;
  let adminToken: string;
  
  let ownerId: number;
  let otherId: number;
  let templateId: number;

  beforeAll(async () => {
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    
    const department = await prisma.department.upsert({ where: { name: 'Test Dept Lock' }, update: {}, create: { name: 'Test Dept Lock' } });
    const division = await prisma.division.upsert({ where: { code: 'LCK' }, update: {}, create: { name: 'Locking Div', code: 'LCK', departmentId: department.id } });

    const ownerUser = await prisma.user.upsert({
      where: { email: 'owner@sqd.com' },
      update: {},
      create: { name: 'Owner', email: 'owner@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: division.id, roleId: managerRole.id }
    });
    ownerId = ownerUser.id;

    const otherUser = await prisma.user.upsert({
      where: { email: 'other@sqd.com' },
      update: {},
      create: { name: 'Other', email: 'other@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: division.id, roleId: managerRole.id }
    });
    otherId = otherUser.id;

    const adminUser = await prisma.user.upsert({
      where: { email: 'adminlock@sqd.com' },
      update: {},
      create: { name: 'Admin', email: 'adminlock@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: division.id, roleId: adminRole.id }
    });

    ownerToken = jwt.sign({ userId: ownerUser.id, role: 'Manager', divisionId: division.id }, process.env.JWT_SECRET || 'fallback_secret');
    otherToken = jwt.sign({ userId: otherUser.id, role: 'Manager', divisionId: division.id }, process.env.JWT_SECRET || 'fallback_secret');
    adminToken = jwt.sign({ userId: adminUser.id, role: 'Admin', divisionId: division.id }, process.env.JWT_SECRET || 'fallback_secret');
  });

  beforeEach(async () => {
    await prisma.template.deleteMany({});
    
    // Create a fresh template for each test
    const div = await prisma.division.findUnique({ where: { code: 'LCK' } });
    const t = await prisma.template.create({
      data: {
        templateId: 'LCK-001',
        title: 'Locking Template',
        formSchema: { fields: [] },
        divisionId: div!.id,
      }
    });
    templateId = t.id;
  });

  afterAll(async () => {
    await prisma.template.deleteMany({});
    await prisma.$disconnect();
  });

  it('should lock an unlocked template successfully', async () => {
    const res = await request(app)
      .post(`/api/templates/${templateId}/lock`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/successfully/);
    
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    expect(t?.lockedByUserId).toBe(ownerId);
    expect(t?.lockedAt).not.toBeNull();
  });

  it('should return 409 when template is already locked by a different user within 30 min', async () => {
    // Lock it first
    await prisma.template.update({
      where: { id: templateId },
      data: { lockedByUserId: ownerId, lockedAt: new Date() }
    });

    const res = await request(app)
      .post(`/api/templates/${templateId}/lock`)
      .set('Authorization', `Bearer ${otherToken}`);
    
    expect(res.status).toBe(409);
    expect(res.body.lockedBy).toBe('Owner');
  });

  it('should allow the same user to re-lock their own template', async () => {
    // Lock it first by owner
    await prisma.template.update({
      where: { id: templateId },
      data: { lockedByUserId: ownerId, lockedAt: new Date(Date.now() - 1000 * 60 * 5) } // 5 mins ago
    });

    const res = await request(app)
      .post(`/api/templates/${templateId}/lock`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
  });

  it('should allow locking if the existing lock is older than 30 minutes', async () => {
    // Lock it first by owner, but make it expired
    await prisma.template.update({
      where: { id: templateId },
      data: { lockedByUserId: ownerId, lockedAt: new Date(Date.now() - 1000 * 60 * 35) } // 35 mins ago
    });

    const res = await request(app)
      .post(`/api/templates/${templateId}/lock`)
      .set('Authorization', `Bearer ${otherToken}`);
    
    expect(res.status).toBe(200);
    
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    expect(t?.lockedByUserId).toBe(otherId);
  });

  it('should allow lock owner to unlock', async () => {
    await prisma.template.update({
      where: { id: templateId },
      data: { lockedByUserId: ownerId, lockedAt: new Date() }
    });

    const res = await request(app)
      .post(`/api/templates/${templateId}/unlock`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    expect(t?.lockedByUserId).toBeNull();
  });

  it('should return 403 when a non-owner tries to unlock', async () => {
    await prisma.template.update({
      where: { id: templateId },
      data: { lockedByUserId: ownerId, lockedAt: new Date() }
    });

    const res = await request(app)
      .post(`/api/templates/${templateId}/unlock`)
      .set('Authorization', `Bearer ${otherToken}`);
    
    expect(res.status).toBe(403);
  });

  it('should allow Admin to unlock even if not the owner', async () => {
    await prisma.template.update({
      where: { id: templateId },
      data: { lockedByUserId: ownerId, lockedAt: new Date() }
    });

    const res = await request(app)
      .post(`/api/templates/${templateId}/unlock`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(res.status).toBe(200);
  });

  it('should include lock info in GET /api/templates/:id response', async () => {
    await prisma.template.update({
      where: { id: templateId },
      data: { lockedByUserId: ownerId, lockedAt: new Date() }
    });

    const res = await request(app)
      .get(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.isLocked).toBe(true);
    expect(res.body.lockedByName).toBe('Owner');
    expect(res.body.lockedAt).toBeDefined();
  });
});
