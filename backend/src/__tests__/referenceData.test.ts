import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function makeToken(userId: number, role: string, divisionId: number): string {
  const secret = process.env.JWT_SECRET || 'fallback_secret';
  return jwt.sign({ userId, role, divisionId }, secret);
}

const BASE = '/api/admin/reference-data';

describe('Reference Data admin API', () => {
  let adminToken: string;
  let staffToken: string;
  let divisionId: number;

  beforeAll(async () => {
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });
    const dept = await prisma.department.upsert({ where: { name: 'RefData Test Dept' }, update: {}, create: { name: 'RefData Test Dept' } });
    const div = await prisma.division.upsert({ where: { code: 'RFD' }, update: {}, create: { name: 'RefData Test Div', code: 'RFD', departmentId: dept.id } });
    divisionId = div.id;

    const admin = await prisma.user.upsert({
      where: { email: 'refdata.admin@sqd.com' },
      update: {},
      create: { name: 'RefData Admin', email: 'refdata.admin@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: div.id, roleId: adminRole.id },
    });
    const staff = await prisma.user.upsert({
      where: { email: 'refdata.staff@sqd.com' },
      update: {},
      create: { name: 'RefData Staff', email: 'refdata.staff@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: div.id, roleId: staffRole.id },
    });
    adminToken = makeToken(admin.id, 'Admin', div.id);
    staffToken = makeToken(staff.id, 'Staff', div.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  // ── RBAC ──
  it('blocks non-admins from reference data routes', async () => {
    const res = await request(app).get(`${BASE}/operators`).set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`${BASE}/operators`);
    expect(res.status).toBe(401);
  });

  // ── Operators CRUD ──
  it('creates, updates and deletes an operator', async () => {
    const code = 'ZZ';
    await prisma.operator.deleteMany({ where: { iataCode: code } });

    const create = await request(app).post(`${BASE}/operators`).set('Authorization', `Bearer ${adminToken}`).send({ iataCode: code, name: 'Test Air' });
    expect(create.status).toBe(201);
    expect(create.body.name).toBe('Test Air');

    const dup = await request(app).post(`${BASE}/operators`).set('Authorization', `Bearer ${adminToken}`).send({ iataCode: code, name: 'Again' });
    expect(dup.status).toBe(400);

    const update = await request(app).put(`${BASE}/operators/${code}`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'Renamed Air' });
    expect(update.status).toBe(200);
    expect(update.body.name).toBe('Renamed Air');

    const del = await request(app).delete(`${BASE}/operators/${code}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
  });

  it('blocks deleting an operator that still has registrations', async () => {
    const code = 'ZY';
    await prisma.aircraftRegistration.deleteMany({ where: { operatorCode: code } });
    await prisma.operator.deleteMany({ where: { iataCode: code } });
    await prisma.aircraftType.upsert({ where: { code: 'ZTYPE' }, update: {}, create: { code: 'ZTYPE' } });
    await prisma.operator.create({ data: { iataCode: code, name: 'Blocked Air' } });
    await prisma.aircraftRegistration.create({ data: { registration: 'ZY-REG1', operatorCode: code, aircraftTypeCode: 'ZTYPE' } });

    const del = await request(app).delete(`${BASE}/operators/${code}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(400);
    expect(del.body.message).toMatch(/registration/i);

    // cleanup
    await prisma.aircraftRegistration.deleteMany({ where: { operatorCode: code } });
    await prisma.operator.deleteMany({ where: { iataCode: code } });
    await prisma.aircraftType.deleteMany({ where: { code: 'ZTYPE' } });
  });

  // ── Registrations with FK validation + cascading filter ──
  it('creates a registration and rejects unknown FK codes', async () => {
    await prisma.aircraftRegistration.deleteMany({ where: { registration: 'ZX-TEST' } });
    await prisma.operator.upsert({ where: { iataCode: 'ZX' }, update: {}, create: { iataCode: 'ZX', name: 'Reg Test Air' } });
    await prisma.aircraftType.upsert({ where: { code: 'ZXT' }, update: {}, create: { code: 'ZXT' } });

    const bad = await request(app).post(`${BASE}/registrations`).set('Authorization', `Bearer ${adminToken}`)
      .send({ registration: 'ZX-TEST', operatorCode: 'NOPE' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/operator/i);

    const ok = await request(app).post(`${BASE}/registrations`).set('Authorization', `Bearer ${adminToken}`)
      .send({ registration: 'ZX-TEST', operatorCode: 'ZX', aircraftTypeCode: 'ZXT', description: 'Reg Test' });
    expect(ok.status).toBe(201);
    expect(ok.body.operatorCode).toBe('ZX');

    // operatorCode filter returns it
    const filtered = await request(app).get(`${BASE}/registrations?operatorCode=ZX`).set('Authorization', `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.some((r: { registration: string }) => r.registration === 'ZX-TEST')).toBe(true);

    // cleanup
    await prisma.aircraftRegistration.deleteMany({ where: { registration: 'ZX-TEST' } });
    await prisma.operator.deleteMany({ where: { iataCode: 'ZX' } });
    await prisma.aircraftType.deleteMany({ where: { code: 'ZXT' } });
  });

  // ── Department soft delete ──
  it('soft-deletes a department (deletedAt set, excluded from list)', async () => {
    const created = await request(app).post(`${BASE}/departments`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'Soft Delete Dept' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const del = await request(app).delete(`${BASE}/departments/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);

    const row = await prisma.department.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();

    const list = await request(app).get(`${BASE}/departments`).set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.some((d: { id: number }) => d.id === id)).toBe(false);

    // re-creating the same name revives the soft-deleted row
    const revive = await request(app).post(`${BASE}/departments`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'Soft Delete Dept' });
    expect(revive.status).toBe(201);
    expect(revive.body.id).toBe(id);

    await prisma.department.deleteMany({ where: { id } });
  });

  // ── Authorization type category ──
  it('creates an authorization type with a category', async () => {
    await prisma.authorizationType.deleteMany({ where: { code: 'ZTEST' } });
    const res = await request(app).post(`${BASE}/authorization-types`).set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'ZTEST', description: 'Z Test', category: 'Special' });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('Special');
    await prisma.authorizationType.deleteMany({ where: { code: 'ZTEST' } });
  });
});
