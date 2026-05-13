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

describe('Template Builder & Management', () => {
  let adminToken: string;
  let ownerToken: string;
  let otherManagerToken: string;
  
  let ownerId: number;
  let otherId: number;
  let divisionId: number;

  beforeAll(async () => {
    // Setup roles
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    
    // Setup division
    const department = await prisma.department.upsert({ where: { name: 'Template Dept' }, update: {}, create: { name: 'Template Dept' } });
    const division = await prisma.division.upsert({ where: { code: 'TMP' }, update: {}, create: { name: 'Template Div', code: 'TMP', departmentId: department.id } });
    divisionId = division.id;

    // Create users & tokens
    const adminUser = await prisma.user.create({
      data: { name: 'Admin', email: 'admin_tmpl@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: adminRole.id }
    });
    const ownerUser = await prisma.user.create({
      data: { name: 'Owner', email: 'owner_tmpl@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id }
    });
    ownerId = ownerUser.id;
    const otherUser = await prisma.user.create({
      data: { name: 'Other', email: 'other_tmpl@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id }
    });
    otherId = otherUser.id;

    const secret = process.env.JWT_SECRET || 'fallback_secret';
    adminToken = jwt.sign({ userId: adminUser.id, role: 'Admin', divisionId }, secret);
    ownerToken = jwt.sign({ userId: ownerUser.id, role: 'Manager', divisionId }, secret);
    otherManagerToken = jwt.sign({ userId: otherUser.id, role: 'Manager', divisionId }, secret);
  });

  beforeEach(async () => {
    // Wipe templates and archives
    await prisma.templateRevisionArchive.deleteMany({});
    await prisma.template.deleteMany({});
  });

  afterAll(async () => {
    await prisma.templateRevisionArchive.deleteMany({});
    await prisma.template.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { in: ['admin_tmpl@sqd.com', 'owner_tmpl@sqd.com', 'other_tmpl@sqd.com'] } }
    });
    await prisma.$disconnect();
  });

  describe('Happy Paths & Transitions', () => {
    it('should allow a manager to create and publish a template', async () => {
      // 1. Create (Draft)
      const createRes = await request(app).post('/api/templates').set('Authorization', `Bearer ${ownerToken}`).send({
        title: 'Happy Template',
        formSchema: [{ id: '1', type: 'text', label: 'Test' }]
      });
      expect(createRes.status).toBe(201);
      const templateId = createRes.body.id;

      // 2. Publish
      const pubRes = await request(app).post(`/api/templates/${templateId}/publish`).set('Authorization', `Bearer ${ownerToken}`);
      expect(pubRes.status).toBe(200);
      expect(pubRes.body.status).toBe('Published');
    });
  });

  describe('Draft Encapsulation Edge Cases (Bug Catching)', () => {
    // Protects against: The severe bug where editing a published template leaked changes to the live DB row
    it('should correctly encapsulate drafts without mutating active published schema', async () => {
      // 1. Create and Publish
      const div = await prisma.division.findUnique({ where: { code: 'TMP' } });
      const t = await prisma.template.create({
        data: {
          templateId: 'TMP-001',
          title: 'Live Title',
          description: 'Live Desc',
          formSchema: [{ id: '1', type: 'text', label: 'Live Field' }],
          status: 'Published',
          publishedAt: new Date(),
          ownerId,
          divisionId: div!.id
        }
      });

      // 2. Owner saves a draft with new title/schema
      const updateRes = await request(app).put(`/api/templates/${t.id}`).set('Authorization', `Bearer ${ownerToken}`).send({
        title: 'Draft Title',
        description: 'Draft Desc',
        formSchema: [{ id: '2', type: 'number', label: 'Draft Field' }]
      });
      expect(updateRes.status).toBe(200);

      // Verify DB row remains untouched
      const dbRow = await prisma.template.findUnique({ where: { id: t.id } });
      expect(dbRow?.title).toBe('Live Title'); // The leak bug would have this as 'Draft Title'
      expect((dbRow?.formSchema as any)[0].label).toBe('Live Field');
      expect(dbRow?.draftSchema).toBeDefined();

      // 3. Verify Owner sees the unpacked Draft state via API
      const ownerGet = await request(app).get(`/api/templates/${t.id}`).set('Authorization', `Bearer ${ownerToken}`);
      expect(ownerGet.body.status).toBe('Draft');
      expect(ownerGet.body.title).toBe('Draft Title');
      expect(ownerGet.body.formSchema[0].label).toBe('Draft Field');

      // 4. Verify Other User sees the Published state via API
      const otherGet = await request(app).get(`/api/templates/${t.id}`).set('Authorization', `Bearer ${otherManagerToken}`);
      expect(otherGet.body.status).toBe('Published');
      expect(otherGet.body.title).toBe('Live Title');
      expect(otherGet.body.formSchema[0].label).toBe('Live Field');
      expect(otherGet.body.draftSchema).toBeUndefined(); // Stripped

      // 5. Verify publish clears the draftSchema
      const pubRes = await request(app).post(`/api/templates/${t.id}/publish`).set('Authorization', `Bearer ${ownerToken}`);
      expect(pubRes.status).toBe(200);
      
      const finalDbRow = await prisma.template.findUnique({ where: { id: t.id } });
      expect(finalDbRow?.title).toBe('Draft Title');
      expect(finalDbRow?.draftSchema).toBeNull();
    });
  });

  describe('Ownership Boundaries', () => {
    // Protects against: Users modifying templates they do not own
    it('should reject non-owner trying to edit or publish', async () => {
      const div = await prisma.division.findUnique({ where: { code: 'TMP' } });
      const t = await prisma.template.create({
        data: { templateId: 'TMP-002', title: 'Test', formSchema: [], ownerId, divisionId: div!.id }
      });

      const editRes = await request(app).put(`/api/templates/${t.id}`).set('Authorization', `Bearer ${otherManagerToken}`).send({ title: 'Hacked' });
      expect(editRes.status).toBe(403);

      const pubRes = await request(app).post(`/api/templates/${t.id}/publish`).set('Authorization', `Bearer ${otherManagerToken}`);
      expect(pubRes.status).toBe(403);
    });

    // Protects against: Breaking the admin override capability
    it('should allow Admin to edit any template', async () => {
      const div = await prisma.division.findUnique({ where: { code: 'TMP' } });
      const t = await prisma.template.create({
        data: { templateId: 'TMP-003', title: 'Test', formSchema: [], ownerId, divisionId: div!.id }
      });

      const editRes = await request(app).put(`/api/templates/${t.id}`).set('Authorization', `Bearer ${adminToken}`).send({ title: 'Admin Override', formSchema: [] });
      expect(editRes.status).toBe(200);
    });

    // Protects against: Previous owner retaining access after transfer, or unauthorized transfers
    it('should immediately revoke access upon ownership transfer', async () => {
      const div = await prisma.division.findUnique({ where: { code: 'TMP' } });
      const t = await prisma.template.create({
        data: { templateId: 'TMP-004', title: 'Transfer Test', formSchema: [], ownerId, divisionId: div!.id }
      });

      // Unauthorized transfer attempt
      const badTrans = await request(app).post(`/api/templates/${t.id}/transfer`).set('Authorization', `Bearer ${otherManagerToken}`).send({ newOwnerId: otherId });
      expect(badTrans.status).toBe(403);

      // Valid transfer
      const validTrans = await request(app).post(`/api/templates/${t.id}/transfer`).set('Authorization', `Bearer ${ownerToken}`).send({ newOwnerId: otherId });
      expect(validTrans.status).toBe(200);

      // Old owner tries to edit
      const editRes = await request(app).put(`/api/templates/${t.id}`).set('Authorization', `Bearer ${ownerToken}`).send({ title: 'Try to edit' });
      expect(editRes.status).toBe(403);
    });
  });

  describe('Validation & Structural Regressions', () => {
    // Protects against: Bad data state in DB
    it('should reject creation without title or schema', async () => {
      const res = await request(app).post('/api/templates').set('Authorization', `Bearer ${ownerToken}`).send({ title: '' });
      expect(res.status).toBe(400);
    });

    // Protects against: Publishing an empty template which would break UI/execution
    it('should not allow publishing an empty formSchema', async () => {
      const div = await prisma.division.findUnique({ where: { code: 'TMP' } });
      const t = await prisma.template.create({
        data: { templateId: 'TMP-005', title: 'Empty', formSchema: [], ownerId, divisionId: div!.id }
      });

      const pubRes = await request(app).post(`/api/templates/${t.id}/publish`).set('Authorization', `Bearer ${ownerToken}`);
      expect(pubRes.status).toBe(400);
      expect(pubRes.body.message).toMatch(/empty/i);
    });

    // Protects against: Reintroducing a missing endpoint and confirming nested inclusion works
    it('should return nested revisions on GET and 404 on standalone /revisions', async () => {
      const div = await prisma.division.findUnique({ where: { code: 'TMP' } });
      const t = await prisma.template.create({
        data: { templateId: 'TMP-006', title: 'History Test', formSchema: [], ownerId, divisionId: div!.id }
      });

      const getRes = await request(app).get(`/api/templates/${t.id}`).set('Authorization', `Bearer ${ownerToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.revisionArchives).toBeDefined();
      expect(Array.isArray(getRes.body.revisionArchives)).toBe(true);

      const standaloneRes = await request(app).get(`/api/templates/${t.id}/revisions`).set('Authorization', `Bearer ${ownerToken}`);
      expect(standaloneRes.status).toBe(404);
    });
  });
});
