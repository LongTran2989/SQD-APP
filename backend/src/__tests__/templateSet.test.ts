import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { validateAutoGenConfig } from '../services/autoGenService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Template Set Backend', () => {
  let directorToken: string;
  let managerToken: string;
  let staffToken: string;
  let managerId: number;
  let divisionId: number;       // manager's division (A)
  let otherDivisionId: number;  // division B
  let tplSeq = 0;

  const publishTemplate = (divId: number, status = 'Published') =>
    prisma.template.create({
      data: {
        templateId: `TS-T${tplSeq++}-${Date.now() % 100000}`,
        title: 'TS Template',
        formSchema: [{ id: '1', type: 'text', label: 'x' }],
        status,
        publishedAt: status === 'Published' ? new Date() : null,
        ownerId: managerId,
        divisionId: divId,
      },
    });

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'TS Dept' }, update: {}, create: { name: 'TS Dept' } });
    const divA = await prisma.division.upsert({ where: { code: 'TSA' }, update: {}, create: { name: 'TS Div A', code: 'TSA', departmentId: dept.id } });
    const divB = await prisma.division.upsert({ where: { code: 'TSB' }, update: {}, create: { name: 'TS Div B', code: 'TSB', departmentId: dept.id } });
    divisionId = divA.id;
    otherDivisionId = divB.id;

    const manager = await prisma.user.create({
      data: { name: 'TS Manager', email: 'manager_ts@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id },
    });
    managerId = manager.id;
    const director = await prisma.user.create({
      data: { name: 'TS Director', email: 'director_ts@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id },
    });
    const staff = await prisma.user.create({
      data: { name: 'TS Staff', email: 'staff_ts@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id },
    });

    const secret = process.env.JWT_SECRET || 'fallback_secret';
    managerToken = jwt.sign({ userId: managerId, role: 'Manager', divisionId }, secret);
    directorToken = jwt.sign({ userId: director.id, role: 'Director', divisionId }, secret);
    staffToken = jwt.sign({ userId: staff.id, role: 'Staff', divisionId }, secret);
  });

  beforeEach(async () => {
    await prisma.workPackage.deleteMany({});
    await prisma.templateSetItem.deleteMany({});
    await prisma.templateSet.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.template.deleteMany({});
  });

  afterAll(async () => {
    await prisma.workPackage.deleteMany({});
    await prisma.templateSetItem.deleteMany({});
    await prisma.templateSet.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.template.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { in: ['manager_ts@sqd.com', 'director_ts@sqd.com', 'staff_ts@sqd.com'] } } });
    await prisma.$disconnect();
    await pool.end();
  });

  // ── create ──────────────────────────────────────────────────────────────────
  describe('POST /api/template-sets', () => {
    it('creates a set with ordered items (201)', async () => {
      const t1 = await publishTemplate(divisionId);
      const t2 = await publishTemplate(divisionId);
      const res = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Pre-flight set',
          description: 'A set',
          divisionId,
          items: [
            { templateId: t2.id, orderIndex: 1, deadlineOffsetDays: 2 },
            { templateId: t1.id, orderIndex: 0 },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.ownerId).toBe(managerId);
      expect(res.body.items.map((i: { templateId: number }) => i.templateId)).toEqual([t1.id, t2.id]);
      expect(res.body.items[1].deadlineOffsetDays).toBe(2);
    });

    it('rejects a non-Published template (400)', async () => {
      const draft = await publishTemplate(divisionId, 'Draft');
      const res = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'X', divisionId, items: [{ templateId: draft.id }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Published/);
    });

    it('allows a template owned by another division (templates are global)', async () => {
      const foreign = await publishTemplate(otherDivisionId);
      const res = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'X', divisionId, items: [{ templateId: foreign.id }] });
      expect(res.status).toBe(201);
      expect(res.body.items[0].templateId).toBe(foreign.id);
    });

    it('rejects duplicate orderIndex (400)', async () => {
      const t1 = await publishTemplate(divisionId);
      const t2 = await publishTemplate(divisionId);
      const res = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'X', divisionId, items: [{ templateId: t1.id, orderIndex: 0 }, { templateId: t2.id, orderIndex: 0 }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/orderIndex/);
    });

    it('rejects an empty item list (400)', async () => {
      const res = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'X', divisionId, items: [] });
      expect(res.status).toBe(400);
    });

    it('forbids Staff (403)', async () => {
      const t1 = await publishTemplate(divisionId);
      const res = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: 'X', divisionId, items: [{ templateId: t1.id }] });
      expect(res.status).toBe(403);
    });

    it('forbids a Manager creating in another division (403)', async () => {
      const t1 = await publishTemplate(otherDivisionId);
      const res = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'X', divisionId: otherDivisionId, items: [{ templateId: t1.id }] });
      expect(res.status).toBe(403);
    });

    it('allows a Director to create in any division (201)', async () => {
      const t1 = await publishTemplate(otherDivisionId);
      const res = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ name: 'Cross-div', divisionId: otherDivisionId, items: [{ templateId: t1.id }] });
      expect(res.status).toBe(201);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────
  describe('PUT /api/template-sets/:id', () => {
    it('replaces items wholesale', async () => {
      const t1 = await publishTemplate(divisionId);
      const t2 = await publishTemplate(divisionId);
      const t3 = await publishTemplate(divisionId);
      const created = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'X', divisionId, items: [{ templateId: t1.id }, { templateId: t2.id }] });

      const res = await request(app)
        .put(`/api/template-sets/${created.body.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Renamed', items: [{ templateId: t3.id }] });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Renamed');
      expect(res.body.items.map((i: { templateId: number }) => i.templateId)).toEqual([t3.id]);
    });
  });

  // ── disable ─────────────────────────────────────────────────────────────────
  describe('DELETE /api/template-sets/:id', () => {
    it('soft-disables the set and validateAutoGenConfig then rejects it', async () => {
      const t1 = await publishTemplate(divisionId);
      const created = await request(app)
        .post('/api/template-sets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'X', divisionId, items: [{ templateId: t1.id }] });
      const setId = created.body.id;

      // Active set is accepted as a SINGLE_SHOT source.
      const okConfig = await validateAutoGenConfig(prisma, { autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenSetId: setId });
      expect('data' in okConfig).toBe(true);

      const del = await request(app).delete(`/api/template-sets/${setId}`).set('Authorization', `Bearer ${managerToken}`);
      expect(del.status).toBe(200);
      expect(del.body.isActive).toBe(false);

      const badConfig = await validateAutoGenConfig(prisma, { autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenSetId: setId });
      expect('error' in badConfig).toBe(true);
    });
  });

  // ── list ────────────────────────────────────────────────────────────────────
  describe('GET /api/template-sets', () => {
    it('filters by activeOnly and divisionId', async () => {
      const tA = await publishTemplate(divisionId);
      const tB = await publishTemplate(otherDivisionId);
      const a = await request(app).post('/api/template-sets').set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'A', divisionId, items: [{ templateId: tA.id }] });
      await request(app).post('/api/template-sets').set('Authorization', `Bearer ${directorToken}`)
        .send({ name: 'B', divisionId: otherDivisionId, items: [{ templateId: tB.id }] });
      await request(app).delete(`/api/template-sets/${a.body.id}`).set('Authorization', `Bearer ${managerToken}`);

      const byDiv = await request(app).get(`/api/template-sets?divisionId=${divisionId}`).set('Authorization', `Bearer ${managerToken}`);
      expect(byDiv.body.every((s: { divisionId: number }) => s.divisionId === divisionId)).toBe(true);

      const activeOnly = await request(app).get('/api/template-sets?activeOnly=true').set('Authorization', `Bearer ${managerToken}`);
      expect(activeOnly.body.some((s: { id: number }) => s.id === a.body.id)).toBe(false);
    });
  });
});
