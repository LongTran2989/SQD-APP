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

describe('Template Publish & Archiving', () => {
  let userToken: string;
  let userId: number;
  let templateId: number;

  beforeAll(async () => {
    const role = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const department = await prisma.department.upsert({ where: { name: 'Test Dept Pub' }, update: {}, create: { name: 'Test Dept Pub' } });
    const division = await prisma.division.upsert({ where: { code: 'PUB' }, update: {}, create: { name: 'Publish Div', code: 'PUB', departmentId: department.id } });

    const user = await prisma.user.upsert({
      where: { email: 'publisher@sqd.com' },
      update: {},
      create: { name: 'Publisher', email: 'publisher@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: division.id, roleId: role.id }
    });
    userId = user.id;

    userToken = jwt.sign({ userId: user.id, role: 'Admin', divisionId: division.id }, process.env.JWT_SECRET || 'fallback_secret');
  });

  beforeEach(async () => {
    await prisma.templateRevisionArchive.deleteMany({});
    await prisma.template.deleteMany({});
    
    const div = await prisma.division.findUnique({ where: { code: 'PUB' } });
    const t = await prisma.template.create({
      data: {
        templateId: 'PUB-001',
        title: 'Publish Template',
        formSchema: { fields: [{ id: 'f1', type: 'text' }] },
        divisionId: div!.id,
        status: 'Draft',
        revision: 1,
        lockedByUserId: userId, // simulate it being locked by the user before publishing
        lockedAt: new Date(),
      }
    });
    templateId = t.id;
  });

  afterAll(async () => {
    await prisma.templateRevisionArchive.deleteMany({});
    await prisma.template.deleteMany({});
    await prisma.$disconnect();
  });

  it('should publish a draft template and increment revision to 1 (if draft usually keeps 1, wait, check logic)', async () => {
    const res = await request(app)
      .post(`/api/templates/${templateId}/publish`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    expect(t?.status).toBe('Published');
    expect(t?.revision).toBe(1); // Draft to Published keeps it at 1 initially
    expect(t?.publishedAt).not.toBeNull();
    expect(t?.revisedByUserId).toBe(userId);
    expect(t?.lockedByUserId).toBeNull();
    expect(t?.lockedAt).toBeNull();

    // Archive shouldn't be created on first publish from Draft
    const archives = await prisma.templateRevisionArchive.findMany({ where: { templateId } });
    expect(archives.length).toBe(0);
  });

  it('should archive existing published version and increment revision when publishing an already published template', async () => {
    // Manually set to Published first
    await prisma.template.update({
      where: { id: templateId },
      data: { status: 'Published', publishedAt: new Date(Date.now() - 100000) }
    });

    const res = await request(app)
      .post(`/api/templates/${templateId}/publish`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);

    const t = await prisma.template.findUnique({ where: { id: templateId } });
    expect(t?.revision).toBe(2);
    expect(t?.lockedByUserId).toBeNull();

    const archives = await prisma.templateRevisionArchive.findMany({ where: { templateId } });
    expect(archives.length).toBe(1);
    expect(archives[0].revision).toBe(1);
    expect(archives[0].revisedByUserId).toBe(userId);
  });
});
