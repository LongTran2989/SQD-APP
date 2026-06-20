import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('WP Blueprint Backend', () => {
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
        templateId: `BP-T${tplSeq++}-${Date.now() % 100000}`,
        title: 'BP Template',
        formSchema: [{ id: '1', type: 'text', label: 'x' }],
        status,
        publishedAt: status === 'Published' ? new Date() : null,
        ownerId: managerId,
        divisionId: divId,
      },
    });

  const baseBody = (over: Record<string, unknown> = {}) => ({
    name: 'Line audit blueprint',
    type: 'AUDIT',
    divisionId,
    defaultDuration: 14,
    ...over,
  });

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'BP Dept' }, update: {}, create: { name: 'BP Dept' } });
    const divA = await prisma.division.upsert({ where: { code: 'BPA' }, update: {}, create: { name: 'BP Div A', code: 'BPA', departmentId: dept.id } });
    const divB = await prisma.division.upsert({ where: { code: 'BPB' }, update: {}, create: { name: 'BP Div B', code: 'BPB', departmentId: dept.id } });
    divisionId = divA.id;
    otherDivisionId = divB.id;

    const manager = await prisma.user.create({
      data: { name: 'BP Manager', email: 'manager_bp@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id },
    });
    managerId = manager.id;
    const director = await prisma.user.create({
      data: { name: 'BP Director', email: 'director_bp@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id },
    });
    const staff = await prisma.user.create({
      data: { name: 'BP Staff', email: 'staff_bp@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id },
    });

    await prisma.wpType.upsert({ where: { code: 'AUDIT' }, update: {}, create: { code: 'AUDIT', description: 'Audit' } });
    await prisma.wpType.upsert({ where: { code: 'CHECK' }, update: {}, create: { code: 'CHECK', description: 'Check' } });

    const secret = process.env.JWT_SECRET || 'fallback_secret';
    managerToken = jwt.sign({ userId: managerId, role: 'Manager', divisionId }, secret);
    directorToken = jwt.sign({ userId: director.id, role: 'Director', divisionId }, secret);
    staffToken = jwt.sign({ userId: staff.id, role: 'Staff', divisionId }, secret);
  });

  beforeEach(async () => {
    await prisma.workPackage.deleteMany({});
    await prisma.wpBlueprint.deleteMany({});
    await prisma.templateSetItem.deleteMany({});
    await prisma.templateSet.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.feedPost.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.template.deleteMany({});
  });

  afterAll(async () => {
    await prisma.workPackage.deleteMany({});
    await prisma.wpBlueprint.deleteMany({});
    await prisma.templateSetItem.deleteMany({});
    await prisma.templateSet.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.feedPost.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.template.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { in: ['manager_bp@sqd.com', 'director_bp@sqd.com', 'staff_bp@sqd.com'] } } });
    await prisma.$disconnect();
    await pool.end();
  });

  // ── create ──────────────────────────────────────────────────────────────────
  describe('POST /api/wp-blueprints', () => {
    it('creates a blueprint with autogen defaults (201)', async () => {
      const t = await publishTemplate(divisionId);
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({
          description: 'Standard line audit',
          defaultAutoGenerate: true, defaultAutoGenMode: 'REPEAT', defaultAutoGenInterval: 7, defaultAutoGenTemplateId: t.id,
        }));
      expect(res.status).toBe(201);
      expect(res.body.ownerId).toBe(managerId);
      expect(res.body.defaultDuration).toBe(14);
      expect(res.body.defaultAutoGenerate).toBe(true);
      expect(res.body.defaultAutoGenMode).toBe('REPEAT');
      expect(res.body.defaultAutoGenTemplateId).toBe(t.id);
    });

    it('rejects a non-positive defaultDuration (400)', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ defaultDuration: 0 }));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/defaultDuration/);
    });

    it('rejects an unknown WP type (400)', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ type: 'NOPE' }));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid WP type/);
    });

    it('rejects bad autogen defaults — REPEAT without a template (400)', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ defaultAutoGenerate: true, defaultAutoGenMode: 'REPEAT', defaultAutoGenInterval: 7 }));
      expect(res.status).toBe(400);
    });

    it('creates with a CALENDAR recurrence and seeds nextRunAt to the start date', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: '2026-07-01' }));
      expect(res.status).toBe(201);
      const row = await prisma.wpBlueprint.findUnique({ where: { id: res.body.id } });
      expect(row?.recurrenceType).toBe('CALENDAR');
      expect(row?.recurrenceInterval).toBe(30);
      expect(row?.recurrenceStartDate?.toISOString().slice(0, 10)).toBe('2026-07-01');
      expect(row?.nextRunAt?.toISOString().slice(0, 10)).toBe('2026-07-01');
    });

    it('rejects recurrenceType without interval/startDate (400)', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ recurrenceType: 'CALENDAR' }));
      expect(res.status).toBe(400);
    });

    it('rejects an invalid recurrenceType (400)', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ recurrenceType: 'WEEKLY', recurrenceInterval: 7, recurrenceStartDate: '2026-07-01' }));
      expect(res.status).toBe(400);
    });

    it('rejects a non-positive recurrenceInterval (400)', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ recurrenceType: 'LAST_DONE', recurrenceInterval: 0, recurrenceStartDate: '2026-07-01' }));
      expect(res.status).toBe(400);
    });

    it('forbids Staff (403)', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(baseBody());
      expect(res.status).toBe(403);
    });

    it('forbids a Manager creating in another division (403)', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ divisionId: otherDivisionId }));
      expect(res.status).toBe(403);
    });

    it('allows a Director to create in any division (201)', async () => {
      const res = await request(app)
        .post('/api/wp-blueprints')
        .set('Authorization', `Bearer ${directorToken}`)
        .send(baseBody({ divisionId: otherDivisionId }));
      expect(res.status).toBe(201);
    });
  });

  // ── update / disable / list ───────────────────────────────────────────────
  describe('PUT + DELETE + GET', () => {
    it('updates name + autogen defaults', async () => {
      const t = await publishTemplate(divisionId);
      const created = await request(app).post('/api/wp-blueprints').set('Authorization', `Bearer ${managerToken}`).send(baseBody());
      const res = await request(app)
        .put(`/api/wp-blueprints/${created.body.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Renamed', defaultAutoGenerate: true, defaultAutoGenMode: 'SINGLE_SHOT', defaultAutoGenTemplateId: t.id });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Renamed');
      expect(res.body.defaultAutoGenTemplateId).toBe(t.id);
    });

    it('reseeds nextRunAt when the schedule is edited, and clears it when recurrence is removed', async () => {
      const created = await request(app).post('/api/wp-blueprints').set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: '2026-07-01' }));

      // Edit the start date → nextRunAt follows.
      const edited = await request(app).put(`/api/wp-blueprints/${created.body.id}`).set('Authorization', `Bearer ${managerToken}`)
        .send({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: '2026-08-15' });
      expect(edited.status).toBe(200);
      let row = await prisma.wpBlueprint.findUnique({ where: { id: created.body.id } });
      expect(row?.nextRunAt?.toISOString().slice(0, 10)).toBe('2026-08-15');

      // Clearing recurrenceType nulls the whole block.
      const cleared = await request(app).put(`/api/wp-blueprints/${created.body.id}`).set('Authorization', `Bearer ${managerToken}`)
        .send({ recurrenceType: null });
      expect(cleared.status).toBe(200);
      row = await prisma.wpBlueprint.findUnique({ where: { id: created.body.id } });
      expect(row?.recurrenceType).toBeNull();
      expect(row?.recurrenceInterval).toBeNull();
      expect(row?.recurrenceStartDate).toBeNull();
      expect(row?.nextRunAt).toBeNull();
    });

    it('leaves recurrence untouched when no recurrence field is sent', async () => {
      const created = await request(app).post('/api/wp-blueprints').set('Authorization', `Bearer ${managerToken}`)
        .send(baseBody({ recurrenceType: 'LAST_DONE', recurrenceInterval: 14, recurrenceStartDate: '2026-07-01' }));
      await request(app).put(`/api/wp-blueprints/${created.body.id}`).set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Just a rename' });
      const row = await prisma.wpBlueprint.findUnique({ where: { id: created.body.id } });
      expect(row?.recurrenceType).toBe('LAST_DONE');
      expect(row?.recurrenceInterval).toBe(14);
      expect(row?.nextRunAt?.toISOString().slice(0, 10)).toBe('2026-07-01');
    });

    it('forbids cross-division manager update (403)', async () => {
      const created = await request(app).post('/api/wp-blueprints').set('Authorization', `Bearer ${directorToken}`).send(baseBody({ divisionId: otherDivisionId }));
      const res = await request(app).put(`/api/wp-blueprints/${created.body.id}`).set('Authorization', `Bearer ${managerToken}`).send({ name: 'X' });
      expect(res.status).toBe(403);
    });

    it('soft-disables and filters from activeOnly', async () => {
      const created = await request(app).post('/api/wp-blueprints').set('Authorization', `Bearer ${managerToken}`).send(baseBody());
      const del = await request(app).delete(`/api/wp-blueprints/${created.body.id}`).set('Authorization', `Bearer ${managerToken}`);
      expect(del.status).toBe(200);
      expect(del.body.isActive).toBe(false);
      const active = await request(app).get('/api/wp-blueprints?activeOnly=true').set('Authorization', `Bearer ${managerToken}`);
      expect(active.body.some((b: { id: number }) => b.id === created.body.id)).toBe(false);
    });
  });

  // ── launch ────────────────────────────────────────────────────────────────
  describe('POST /api/wp-blueprints/:id/launch', () => {
    it('launches a WP pre-filled from the blueprint (no overrides)', async () => {
      const t = await publishTemplate(divisionId);
      const bp = await request(app).post('/api/wp-blueprints').set('Authorization', `Bearer ${managerToken}`).send(baseBody({
        name: 'Quarterly audit', defaultDuration: 10,
        defaultAutoGenerate: true, defaultAutoGenMode: 'REPEAT', defaultAutoGenInterval: 5, defaultAutoGenTemplateId: t.id,
      }));

      const res = await request(app).post(`/api/wp-blueprints/${bp.body.id}/launch`).set('Authorization', `Bearer ${managerToken}`).send({});
      expect(res.status).toBe(201);
      expect(res.body.blueprintId).toBe(bp.body.id);
      expect(res.body.isRoutine).toBe(false);
      expect(res.body.name).toBe('Quarterly audit');
      expect(res.body.type).toBe('AUDIT');
      expect(res.body.autoGenTemplateId).toBe(t.id);
      expect(res.body.autoGenMode).toBe('REPEAT');
      expect(res.body.wpId).toMatch(/^BPA-WP-\d{6}$/);
      // timeframeTo = from + 10 days.
      const days = Math.round((new Date(res.body.timeframeTo).getTime() - new Date(res.body.timeframeFrom).getTime()) / 86400000);
      expect(days).toBe(10);

      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'WorkPackage', entityId: String(res.body.id), actionType: 'BLUEPRINT_LAUNCHED' } });
      expect(audit).not.toBeNull();
    });

    it('applies name + timeframe overrides', async () => {
      const bp = await request(app).post('/api/wp-blueprints').set('Authorization', `Bearer ${managerToken}`).send(baseBody());
      const res = await request(app).post(`/api/wp-blueprints/${bp.body.id}/launch`).set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Custom name', timeframeFrom: '2026-07-01', timeframeTo: '2026-07-05' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Custom name');
      expect(new Date(res.body.timeframeFrom).toISOString().slice(0, 10)).toBe('2026-07-01');
      expect(new Date(res.body.timeframeTo).toISOString().slice(0, 10)).toBe('2026-07-05');
    });

    it('forbids Staff and cross-division managers; allows Director cross-division', async () => {
      const bp = await request(app).post('/api/wp-blueprints').set('Authorization', `Bearer ${directorToken}`).send(baseBody({ divisionId: otherDivisionId }));
      const staffRes = await request(app).post(`/api/wp-blueprints/${bp.body.id}/launch`).set('Authorization', `Bearer ${staffToken}`).send({});
      expect(staffRes.status).toBe(403);
      const mgrRes = await request(app).post(`/api/wp-blueprints/${bp.body.id}/launch`).set('Authorization', `Bearer ${managerToken}`).send({});
      expect(mgrRes.status).toBe(403);
      const dirRes = await request(app).post(`/api/wp-blueprints/${bp.body.id}/launch`).set('Authorization', `Bearer ${directorToken}`).send({});
      expect(dirRes.status).toBe(201);
    });

    it('cannot launch a disabled blueprint (404)', async () => {
      const bp = await request(app).post('/api/wp-blueprints').set('Authorization', `Bearer ${managerToken}`).send(baseBody());
      await request(app).delete(`/api/wp-blueprints/${bp.body.id}`).set('Authorization', `Bearer ${managerToken}`);
      const res = await request(app).post(`/api/wp-blueprints/${bp.body.id}/launch`).set('Authorization', `Bearer ${managerToken}`).send({});
      expect(res.status).toBe(404);
    });
  });
});
