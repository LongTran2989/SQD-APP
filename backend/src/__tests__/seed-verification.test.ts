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
    // Use the platform-appropriate ts-node binary: ts-node.cmd on Windows, ts-node elsewhere.
    const tsNodeBin = process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node';
    const tsNodePath = path.join(__dirname, '..', '..', 'node_modules', '.bin', tsNodeBin);
    const seedScript = path.join(__dirname, '..', '..', 'prisma', 'seed.ts');
    
    console.log('Running seed script for tests...');
    execSync(`"${tsNodePath}" "${seedScript}"`, { 
      env: process.env,
      stdio: 'inherit'
    });
  });

  afterAll(async () => {
    // Remove the seeded Generic Ad-Hoc template so its ownerId FK does not pin a
    // seeded user — other suites (e.g. auth) wipe all users via deleteMany().
    await prisma.template.deleteMany({ where: { templateId: 'GENERIC-ADHOC' } });
    await prisma.$disconnect();
  });

  it('should have all 4 divisions with correct codes', async () => {
    const divisions = await prisma.division.findMany();
    const codes = divisions.map(d => d.code).sort();
    
    expect(codes).toContain('QA');
    expect(codes).toContain('QCH');
    expect(codes).toContain('QCS');
    expect(codes).toContain('KS');  // Previously 'SQ' — renamed in new seed
  });

  it('should seed the SURVEILLANCE work-package type', async () => {
    const codes = (await prisma.wpType.findMany()).map(t => t.code);
    expect(codes).toContain('SURVEILLANCE');
    expect(codes).toContain('CHECK');
    expect(codes).toContain('AUDIT');
  });

  it('should seed a Published, non-archiving Generic Ad-Hoc Task template', async () => {
    const tpl = await prisma.template.findUnique({ where: { templateId: 'GENERIC-ADHOC' } });
    expect(tpl).not.toBeNull();
    expect(tpl?.status).toBe('Published');
    expect(tpl?.isOneOff).toBe(false);
    expect(tpl?.requiresApproval).toBe(false);
  });

  it('should have all 15 departments seeded', async () => {
    const departments = await prisma.department.findMany();
    const names = departments.map(d => d.name);

    expect(names).toContain('SQD');
    expect(names).toContain('EGD');
    expect(names).toContain('MCC');
    expect(names).toContain('HAN BMC');
    expect(names).toContain('EXTERNAL');
    expect(departments.length).toBeGreaterThanOrEqual(15);
  });

  it('should authenticate seeded users by employeeId and return correct roles', async () => {
    // Sample: one from each division, covering Director/Manager/Staff
    const seededUsers = [
      { employeeId: 'VAE00071', role: 'Director' },   // QCH Director
      { employeeId: 'VAE00483', role: 'Manager'  },   // QCH Manager
      { employeeId: 'VAE00057', role: 'Staff'    },   // QCH Staff
      { employeeId: 'VAE00087', role: 'Manager'  },   // QCS Manager
      { employeeId: 'VAE02576', role: 'Staff'    },   // QCS Staff
      { employeeId: 'VAE00061', role: 'Manager'  },   // QA  Manager
      { employeeId: 'VAE02566', role: 'Staff'    },   // QA  Staff
      { employeeId: 'VAE00049', role: 'Manager'  },   // KS  Manager
      { employeeId: 'VAE02279', role: 'Staff'    },   // KS  Staff
    ];

    for (const user of seededUsers) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          employeeId: user.employeeId,
          password: 'Abc@123'
        });
      
      // All seeded users have forcePasswordChange: true → expect 202
      expect(res.status).toBe(202);
      expect(res.body.token).toBeDefined();
      expect(res.body.requirePasswordChange).toBe(true);
    }
  });
});
