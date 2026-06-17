import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  FILE_UPLOAD_CONFIG_KEY,
  DEFAULT_FILE_UPLOAD_CONFIG,
} from '../constants/fileUpload';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function makeToken(userId: number, role: string, divisionId: number): string {
  const secret = process.env.JWT_SECRET || 'fallback_secret';
  return jwt.sign({ userId, role, divisionId }, secret);
}

const PDF = 'application/pdf';
const PNG = 'image/png';

describe('Attachments / File Upload infrastructure', () => {
  let uploaderToken: string;
  let otherStaffToken: string;
  let managerToken: string;

  let uploaderId: number;
  let otherStaffId: number;

  let divisionId: number;
  let templateId: number;
  let taskId: number;

  const TEST_EMAILS = ['att_uploader@sqd.com', 'att_other@sqd.com', 'att_manager@sqd.com'];

  // Removes everything this suite creates, in FK-safe order. Tasks/templates are
  // wiped so they never leak into suites (e.g. rbac.test) that assume no tasks
  // exist; users are removed so a re-run's beforeAll doesn't hit a unique email.
  async function cleanupSuiteData() {
    await prisma.attachment.deleteMany({});
    await prisma.taskData.deleteMany({ where: { task: { taskId: { startsWith: 'ATT-' } } } });
    await prisma.feedPost.deleteMany({ where: { scope: 'TASK' } });
    await prisma.task.deleteMany({ where: { taskId: { startsWith: 'ATT-' } } });
    await prisma.template.deleteMany({ where: { templateId: 'ATT-T-001' } });
    await prisma.user.deleteMany({ where: { email: { in: TEST_EMAILS } } });
  }

  beforeAll(async () => {
    await cleanupSuiteData();

    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'Attach Test Dept' }, update: {}, create: { name: 'Attach Test Dept' } });
    const div = await prisma.division.upsert({ where: { code: 'ATT' }, update: {}, create: { name: 'Attach Test Div', code: 'ATT', departmentId: dept.id } });
    divisionId = div.id;

    const uploader = await prisma.user.create({ data: { name: 'Att Uploader', email: 'att_uploader@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    uploaderId = uploader.id;
    const otherStaff = await prisma.user.create({ data: { name: 'Att Other', email: 'att_other@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    otherStaffId = otherStaff.id;
    const manager = await prisma.user.create({ data: { name: 'Att Manager', email: 'att_manager@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id } });

    uploaderToken = makeToken(uploaderId, 'Staff', divisionId);
    otherStaffToken = makeToken(otherStaffId, 'Staff', divisionId);
    managerToken = makeToken(manager.id, 'Manager', divisionId);

    const tpl = await prisma.template.create({
      data: { templateId: 'ATT-T-001', title: 'Attach Template', formSchema: [] as any, status: 'Published', publishedAt: new Date(), ownerId: manager.id, divisionId },
    });
    templateId = tpl.id;
  });

  beforeEach(async () => {
    await prisma.attachment.deleteMany({});
    await prisma.feedPost.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.taskData.deleteMany({});
    await prisma.task.deleteMany({});

    const task = await prisma.task.create({
      data: {
        taskId: 'ATT-900001',
        templateId,
        issuerId: uploaderId,
        targetDivisionId: divisionId,
        status: 'Assigned',
        assignedToUserId: uploaderId,
        schemaSnapshot: [] as any,
      },
    });
    taskId = task.id;
  });

  // Always restore the default policy so config-mutating tests don't bleed.
  afterEach(async () => {
    await prisma.systemSetting.upsert({
      where: { key: FILE_UPLOAD_CONFIG_KEY },
      update: { value: JSON.stringify(DEFAULT_FILE_UPLOAD_CONFIG) },
      create: { key: FILE_UPLOAD_CONFIG_KEY, value: JSON.stringify(DEFAULT_FILE_UPLOAD_CONFIG) },
    });
  });

  afterAll(async () => {
    await cleanupSuiteData();
    await prisma.$disconnect();
    await pool.end();
  });

  // ─── Auth ─────────────────────────────────────────────────────────────────
  it('A01 — rejects unauthenticated upload', async () => {
    const res = await request(app)
      .post('/api/attachments')
      .field('entityType', 'TASK')
      .field('entityId', String(taskId))
      .attach('file', Buffer.from('hi'), { filename: 'a.pdf', contentType: PDF });
    expect(res.status).toBe(401);
  });

  // ─── Upload happy path + dual-write ─────────────────────────────────────────
  it('A02 — uploads a valid file, writes AuditLog + FeedPost, hides storageKey', async () => {
    const body = Buffer.from('%PDF-1.4 fake pdf bytes');
    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK')
      .field('entityId', String(taskId))
      .field('fieldId', 'field-1')
      .attach('file', body, { filename: 'evidence.pdf', contentType: PDF });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.fileName).toBe('evidence.pdf');
    expect(res.body.fileSize).toBe(body.length);
    expect(res.body.storageKey).toBeUndefined();
    expect(res.body.bucket).toBeUndefined();

    const row = await prisma.attachment.findUnique({ where: { id: res.body.id } });
    expect(row?.bucket).toBe('sqd-tasks');
    expect(row?.fieldId).toBe('field-1');

    const audit = await prisma.auditLog.findFirst({ where: { actionType: 'ATTACHMENT_UPLOADED', entityId: String(taskId) } });
    expect(audit).not.toBeNull();

    const feed = await prisma.feedPost.findFirst({ where: { scope: 'TASK', scopeId: taskId, type: 'SYSTEM_EVENT' } });
    expect(feed?.content).toContain('evidence.pdf');
  });

  it('A03 — missing file part → 400', async () => {
    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK')
      .field('entityId', String(taskId));
    expect(res.status).toBe(400);
  });

  it('A04 — disallowed MIME type → 415', async () => {
    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK')
      .field('entityId', String(taskId))
      .attach('file', Buffer.from('PK'), { filename: 'a.zip', contentType: 'application/zip' });
    expect(res.status).toBe(415);
  });

  it('A05 — invalid entityType → 400', async () => {
    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'NOPE')
      .field('entityId', String(taskId))
      .attach('file', Buffer.from('x'), { filename: 'a.pdf', contentType: PDF });
    expect(res.status).toBe(400);
  });

  it('A06 — non-existent entity → 404', async () => {
    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK')
      .field('entityId', '99999999')
      .attach('file', Buffer.from('x'), { filename: 'a.pdf', contentType: PDF });
    expect(res.status).toBe(404);
  });

  // ─── Policy limits (Admin-configurable) ─────────────────────────────────────
  it('A07 — per-file size over the policy limit → 413', async () => {
    await prisma.systemSetting.upsert({
      where: { key: FILE_UPLOAD_CONFIG_KEY },
      update: { value: JSON.stringify({ categories: [{ label: 'Documents', mimeTypes: [PDF], maxSizeBytes: 10 }], totalPerEntityBytes: 1000 }) },
      create: { key: FILE_UPLOAD_CONFIG_KEY, value: JSON.stringify({ categories: [{ label: 'Documents', mimeTypes: [PDF], maxSizeBytes: 10 }], totalPerEntityBytes: 1000 }) },
    });
    const res = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK')
      .field('entityId', String(taskId))
      .attach('file', Buffer.from('this is more than ten bytes'), { filename: 'big.pdf', contentType: PDF });
    expect(res.status).toBe(413);
  });

  it('A08 — exceeding the per-entity total → 413', async () => {
    await prisma.systemSetting.upsert({
      where: { key: FILE_UPLOAD_CONFIG_KEY },
      update: { value: JSON.stringify({ categories: [{ label: 'Documents', mimeTypes: [PDF], maxSizeBytes: 1000 }], totalPerEntityBytes: 30 }) },
      create: { key: FILE_UPLOAD_CONFIG_KEY, value: JSON.stringify({ categories: [{ label: 'Documents', mimeTypes: [PDF], maxSizeBytes: 1000 }], totalPerEntityBytes: 30 }) },
    });
    const first = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK')
      .field('entityId', String(taskId))
      .attach('file', Buffer.from('twenty bytes exactly'), { filename: 'one.pdf', contentType: PDF });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK')
      .field('entityId', String(taskId))
      .attach('file', Buffer.from('another twenty bytes!'), { filename: 'two.pdf', contentType: PDF });
    expect(second.status).toBe(413);
  });

  // ─── List + download ────────────────────────────────────────────────────────
  it('A09 — lists only non-deleted attachments for an entity', async () => {
    await request(app).post('/api/attachments').set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK').field('entityId', String(taskId))
      .attach('file', Buffer.from('one'), { filename: 'one.pdf', contentType: PDF });
    await request(app).post('/api/attachments').set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK').field('entityId', String(taskId))
      .attach('file', Buffer.from('two'), { filename: 'two.png', contentType: PNG });

    const res = await request(app)
      .get('/api/attachments')
      .query({ entityType: 'TASK', entityId: String(taskId) })
      .set('Authorization', `Bearer ${uploaderToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].storageKey).toBeUndefined();
  });

  it('A10 — downloads the stored bytes with the right content type', async () => {
    const body = Buffer.from('%PDF download me');
    const up = await request(app).post('/api/attachments').set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK').field('entityId', String(taskId))
      .attach('file', body, { filename: 'dl.pdf', contentType: PDF });

    const dl = await request(app)
      .get(`/api/attachments/${up.body.id}/download`)
      .set('Authorization', `Bearer ${uploaderToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain(PDF);
    expect(Buffer.from(dl.body).equals(body)).toBe(true);
  });

  // ─── Delete (soft) + RBAC ───────────────────────────────────────────────────
  it('A11 — uploader can soft-delete; row keeps deletedAt and drops from list/download', async () => {
    const up = await request(app).post('/api/attachments').set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK').field('entityId', String(taskId))
      .attach('file', Buffer.from('del'), { filename: 'del.pdf', contentType: PDF });

    const del = await request(app).delete(`/api/attachments/${up.body.id}`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(del.status).toBe(200);

    const row = await prisma.attachment.findUnique({ where: { id: up.body.id } });
    expect(row?.deletedAt).not.toBeNull(); // soft-deleted, compliance row preserved

    const audit = await prisma.auditLog.findFirst({ where: { actionType: 'ATTACHMENT_DELETED' } });
    expect(audit).not.toBeNull();

    const list = await request(app).get('/api/attachments').query({ entityType: 'TASK', entityId: String(taskId) }).set('Authorization', `Bearer ${uploaderToken}`);
    expect(list.body).toHaveLength(0);

    const dl = await request(app).get(`/api/attachments/${up.body.id}/download`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(dl.status).toBe(404);
  });

  it('A12 — another Staff cannot delete; a Manager can', async () => {
    const up = await request(app).post('/api/attachments').set('Authorization', `Bearer ${uploaderToken}`)
      .field('entityType', 'TASK').field('entityId', String(taskId))
      .attach('file', Buffer.from('del'), { filename: 'del.pdf', contentType: PDF });

    const forbidden = await request(app).delete(`/api/attachments/${up.body.id}`).set('Authorization', `Bearer ${otherStaffToken}`);
    expect(forbidden.status).toBe(403);

    const allowed = await request(app).delete(`/api/attachments/${up.body.id}`).set('Authorization', `Bearer ${managerToken}`);
    expect(allowed.status).toBe(200);
  });

  // ─── Config endpoint ──────────────────────────────────────────────────────
  it('A13 — exposes the active upload policy', async () => {
    const res = await request(app).get('/api/attachments/config').set('Authorization', `Bearer ${uploaderToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.totalPerEntityBytes).toBeGreaterThan(0);
  });
});
