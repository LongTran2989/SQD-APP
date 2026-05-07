import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Auth Endpoints', () => {
  beforeAll(async () => {
    // Ensure roles exist in the test DB
    const roles = ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'];
    for (const roleName of roles) {
      await prisma.role.upsert({
        where: { name: roleName },
        update: {},
        create: { name: roleName },
      });
    }

    const adminRole = await prisma.role.findUnique({ where: { name: 'Admin' } });
    
    // Create a department and division for testing
    const department = await prisma.department.create({ data: { name: 'Test Dept' } });
    const division = await prisma.division.create({ data: { name: 'Test Div', departmentId: department.id } });

    // Create an initial admin user to test the login
    await prisma.user.create({
      data: {
        name: 'Test Admin',
        email: 'testadmin@sqd.com',
        passwordHash: await bcrypt.hash('password123', 10),
        divisionId: division.id,
        roleId: adminRole!.id
      }
    });
  });

  afterAll(async () => {
    // Clean up test data to isolate tests
    await prisma.user.deleteMany({});
    await prisma.division.deleteMany({});
    await prisma.department.deleteMany({});
    await prisma.$disconnect();
  });

  it('should successfully login an existing user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'testadmin@sqd.com',
        password: 'password123'
      });
    
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('Admin');
  });

  it('should reject login with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'testadmin@sqd.com',
        password: 'wrongpassword'
      });
    
    expect(res.status).toBe(401);
  });
});
