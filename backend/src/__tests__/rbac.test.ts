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

describe('RBAC Middleware', () => {
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;
  let noRoleToken: string;
  
  let divisionId: number;

  beforeAll(async () => {
    // Setup roles
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });
    
    // Setup division
    const department = await prisma.department.upsert({ where: { name: 'RBAC Dept' }, update: {}, create: { name: 'RBAC Dept' } });
    const division = await prisma.division.upsert({ where: { code: 'RBC' }, update: {}, create: { name: 'RBAC Div', code: 'RBC', departmentId: department.id } });
    divisionId = division.id;

    // Create users & tokens
    const adminUser = await prisma.user.create({
      data: { name: 'Admin User', email: 'admin_rbac@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: adminRole.id }
    });
    const managerUser = await prisma.user.create({
      data: { name: 'Manager User', email: 'manager_rbac@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id }
    });
    const staffUser = await prisma.user.create({
      data: { name: 'Staff User', email: 'staff_rbac@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id }
    });

    const secret = process.env.JWT_SECRET || 'fallback_secret';
    adminToken = jwt.sign({ userId: adminUser.id, role: 'Admin', divisionId }, secret);
    managerToken = jwt.sign({ userId: managerUser.id, role: 'Manager', divisionId }, secret);
    staffToken = jwt.sign({ userId: staffUser.id, role: 'Staff', divisionId }, secret);
    
    // Create a rogue token with no role
    noRoleToken = jwt.sign({ userId: 9999, divisionId }, secret);
  });

  beforeEach(async () => {
    await prisma.template.deleteMany({});
  });

  afterAll(async () => {
    await prisma.template.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { in: ['admin_rbac@sqd.com', 'manager_rbac@sqd.com', 'staff_rbac@sqd.com'] } }
    });
    await prisma.$disconnect();
  });

  describe('Happy Paths', () => {
    it('should allow Admin to access Admin-only routes (update role)', async () => {
      // Create a dummy user to update
      const dummyRole = await prisma.role.findFirst({ where: { name: 'Staff' } });
      const dummyUser = await prisma.user.create({
        data: { name: 'Dummy', email: 'dummy@sqd.com', passwordHash: 'hash', divisionId, roleId: dummyRole!.id }
      });

      const res = await request(app)
        .put(`/api/users/${dummyUser.id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleName: dummyRole!.name });
      
      expect(res.status).toBe(200);
      
      await prisma.user.delete({ where: { id: dummyUser.id } });
    });

    it('should allow Manager to create a template', async () => {
      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ title: 'Manager Template', formSchema: { fields: [] } });
      
      expect(res.status).toBe(201);
    });
  });

  describe('RBAC Edge Cases & Boundaries', () => {
    // Protects against: Privilege escalation where standard staff users can mutate templates
    it('should return 403 when Staff attempts to create/publish a template', async () => {
      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ title: 'Staff Template', formSchema: { fields: [] } });
      
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/insufficient permissions/i);
    });

    // Protects against: Managers modifying global system configurations or user roles
    it('should return 403 when Manager attempts to access Admin-only endpoints', async () => {
      const res = await request(app)
        .put(`/api/users/999/role`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ roleId: 1 });
      
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/insufficient permissions/i);
    });

    // Protects against: Tampered tokens or users deleted but session active, missing role claim
    it('should reject requests that have a valid JWT but lack the required role claim', async () => {
      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .send({ title: 'Rogue Template', formSchema: {} });
      
      expect(res.status).toBe(401);
    });
  });
});
