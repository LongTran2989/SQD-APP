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

describe('Template ID Generation', () => {
  let token: string;
  let qaDivId: number;
  let qchDivId: number;

  beforeAll(async () => {
    // Setup roles
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    
    // Setup divisions
    const department = await prisma.department.upsert({
      where: { name: 'Test Dept Gen' },
      update: {},
      create: { name: 'Test Dept Gen' }
    });
    const qaDiv = await prisma.division.upsert({
      where: { code: 'QA' },
      update: {},
      create: { name: 'Quality Assurance', code: 'QA', departmentId: department.id }
    });
    const qchDiv = await prisma.division.upsert({
      where: { code: 'QCH' },
      update: {},
      create: { name: 'Quality Control HAN', code: 'QCH', departmentId: department.id }
    });
    qaDivId = qaDiv.id;
    qchDivId = qchDiv.id;

    // Setup user
    const user = await prisma.user.upsert({
      where: { email: 'testgen@sqd.com' },
      update: {},
      create: {
        name: 'Test Gen',
        email: 'testgen@sqd.com',
        passwordHash: await bcrypt.hash('password123', 10),
        forcePasswordChange: false,
        divisionId: qaDiv.id,
        roleId: adminRole.id
      }
    });

    token = jwt.sign({ userId: user.id, role: 'Admin', divisionId: qaDiv.id }, process.env.JWT_SECRET || 'fallback_secret');
  });

  beforeEach(async () => {
    await prisma.template.deleteMany({});
  });

  afterAll(async () => {
    await prisma.template.deleteMany({});
    await prisma.$disconnect();
    // pool.end() is called by the application shutdown or handled globally usually, but let's be safe
    // We shouldn't close pool here if other tests use it, but each test file has its own process in jest, so it's fine
  });

  it('should generate sequential template IDs for the same division', async () => {
    const res1 = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Template 1',
        formSchema: { fields: [] },
        divisionId: qaDivId
      });
    
    expect(res1.status).toBe(201);
    expect(res1.body.templateId).toBe('QA-001');

    const res2 = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Template 2',
        formSchema: { fields: [] },
        divisionId: qaDivId
      });
    
    expect(res2.status).toBe(201);
    expect(res2.body.templateId).toBe('QA-002');
  });

  it('should generate independent sequence for a different division', async () => {
    // Create QA-001
    await request(app).post('/api/templates').set('Authorization', `Bearer ${token}`).send({
      title: 'QA Template', formSchema: { fields: [] }, divisionId: qaDivId
    });

    // Create QCH-001
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'QCH Template',
        formSchema: { fields: [] },
        divisionId: qchDivId
      });
    
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('QCH-001');
  });

  it('should not generate duplicate template IDs on concurrent creation', async () => {
    const requests = Array.from({ length: 5 }).map((_, i) => 
      request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: `Concurrent Template ${i}`,
          formSchema: { fields: [] },
          divisionId: qaDivId
        })
    );

    const responses = await Promise.all(requests);
    
    // Check all succeeded
    responses.forEach(res => expect(res.status).toBe(201));

    // Check no duplicates
    const ids = responses.map(res => res.body.templateId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(5);
    
    // Check pattern
    ids.forEach(id => expect(id).toMatch(/^QA-\d{3}$/));
  });
});
