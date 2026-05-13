import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import path from 'path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Seed Data Verification', () => {
  beforeAll(() => {
    // Run the seed script against the test database
    // We use ts-node.cmd explicitly to avoid Windows npx execution policy issues
    const tsNodePath = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'ts-node.cmd');
    const seedScript = path.join(__dirname, '..', '..', 'prisma', 'seed.ts');
    
    console.log('Running seed script for tests...');
    execSync(`"${tsNodePath}" "${seedScript}"`, { 
      env: process.env,
      stdio: 'inherit'
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should have all 4 divisions with correct codes', async () => {
    const divisions = await prisma.division.findMany();
    const codes = divisions.map(d => d.code).sort();
    
    expect(codes).toContain('QA');
    expect(codes).toContain('QCH');
    expect(codes).toContain('QCS');
    expect(codes).toContain('SQ');
  });

  it('should authenticate all seeded users and return correct roles', async () => {
    const seededUsers = [
      { email: 'director@sqd.com', role: 'Director' },
      { email: 'admin.qa@sqd.com', role: 'Admin' },
      { email: 'manager.qch@sqd.com', role: 'Manager' },
      { email: 'manager.qcs@sqd.com', role: 'Manager' },
      { email: 'gl.qa@sqd.com', role: 'Group Leader' },
      { email: 'nguyen.van.an@sqd.com', role: 'Staff' },
      { email: 'tran.thi.bich@sqd.com', role: 'Staff' },
      { email: 'le.quoc.hung@sqd.com', role: 'Staff' },
      { email: 'pham.minh.duc@sqd.com', role: 'Staff' },
      { email: 'hoang.thi.lan@sqd.com', role: 'Staff' },
      { email: 'vo.thanh.liem@sqd.com', role: 'Staff' },
    ];

    for (const user of seededUsers) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: 'password123'
        });
      
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.role).toBe(user.role);
    }
  });
});
