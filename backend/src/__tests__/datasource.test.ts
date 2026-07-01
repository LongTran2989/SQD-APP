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

describe('Datasource search endpoints', () => {
  let token: string;
  let divisionAId: number;
  let divisionBId: number;
  let userA1Id: number;
  let userA2Id: number;
  let userB1Id: number;
  let wpId: number;
  let closedWpId: number;

  beforeAll(async () => {
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });
    const deptA = await prisma.department.upsert({ where: { name: 'Datasource Test Dept A' }, update: {}, create: { name: 'Datasource Test Dept A' } });
    const deptB = await prisma.department.upsert({ where: { name: 'Datasource Test Dept B' }, update: {}, create: { name: 'Datasource Test Dept B' } });
    const divA = await prisma.division.upsert({ where: { code: 'DSA' }, update: {}, create: { name: 'Datasource Div A', code: 'DSA', departmentId: deptA.id } });
    const divB = await prisma.division.upsert({ where: { code: 'DSB' }, update: {}, create: { name: 'Datasource Div B', code: 'DSB', departmentId: deptB.id } });
    divisionAId = divA.id;
    divisionBId = divB.id;

    const userA1 = await prisma.user.create({ data: { name: 'Alice Anderson', employeeId: 'DSA0001', email: 'alice.ds@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: divisionAId, roleId: staffRole.id } });
    userA1Id = userA1.id;
    const userA2 = await prisma.user.create({ data: { name: 'Aaron Alvarez', employeeId: 'DSA0002', email: 'aaron.ds@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: divisionAId, roleId: staffRole.id } });
    userA2Id = userA2.id;
    const userB1 = await prisma.user.create({ data: { name: 'Bob Baker', employeeId: 'DSB0001', email: 'bob.ds@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: divisionBId, roleId: staffRole.id } });
    userB1Id = userB1.id;

    const wp = await prisma.workPackage.create({
      data: {
        wpId: 'DSA-WP-000001',
        name: 'Datasource Search Test WP',
        type: 'AUDIT',
        divisionId: divisionAId,
        timeframeFrom: new Date(),
        timeframeTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        creatorId: userA1Id,
        status: 'Open'
      }
    });
    const closedWp = await prisma.workPackage.create({
      data: {
        wpId: 'DSA-WP-000002',
        name: 'Datasource Closed Test WP',
        type: 'AUDIT',
        divisionId: divisionAId,
        timeframeFrom: new Date(),
        timeframeTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        creatorId: userA1Id,
        status: 'Closed'
      }
    });
    wpId = wp.id;
    closedWpId = closedWp.id;

    token = makeToken(userA1Id, 'Staff', divisionAId);
  });

  it('returns the full unfiltered users list when no q/limit/divisionId is given (backward compatible)', async () => {
    const res = await request(app).get('/api/datasources/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((u: any) => Number(u.value));
    expect(ids).toEqual(expect.arrayContaining([userA1Id, userA2Id, userB1Id]));
  });

  it('filters users by name/employeeId substring when q is given', async () => {
    const res = await request(app).get('/api/datasources/users?q=Alvarez').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((u: any) => Number(u.value))).toEqual([userA2Id]);
  });

  it('caps results at the given limit, max 20', async () => {
    const res = await request(app).get('/api/datasources/users?limit=1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('filters users by divisionId when given', async () => {
    const res = await request(app).get(`/api/datasources/users?divisionId=${divisionBId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((u: any) => Number(u.value));
    expect(ids).toContain(userB1Id);
    expect(ids).not.toContain(userA1Id);
  });

  it('filters divisions by q when given, and stays unfiltered without it', async () => {
    const filtered = await request(app).get('/api/datasources/divisions?q=Div B').set('Authorization', `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.map((d: any) => Number(d.value))).toEqual([divisionBId]);

    const unfiltered = await request(app).get('/api/datasources/divisions').set('Authorization', `Bearer ${token}`);
    expect(unfiltered.status).toBe(200);
    const ids = unfiltered.body.map((d: any) => Number(d.value));
    expect(ids).toEqual(expect.arrayContaining([divisionAId, divisionBId]));
  });

  it('searches work packages by wpId/name, excludes Closed, respects limit', async () => {
    const res = await request(app).get('/api/datasources/workpackages?q=Search Test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((w: any) => Number(w.value));
    expect(ids).toContain(wpId);
    expect(ids).not.toContain(closedWpId);
  });
});
