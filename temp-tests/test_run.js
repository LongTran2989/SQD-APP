const puppeteer = require('puppeteer-core');
const { Pool } = require('../backend/node_modules/pg');
const { PrismaPg } = require('../backend/node_modules/@prisma/adapter-pg');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const bcrypt = require('../backend/node_modules/bcrypt');
require('dotenv').config({ path: '../backend/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Map passwords in memory since we will update them on first forced login
const passwords = {
  'VAE02566': 'Abc@123', // Alice
  'VAE00061': 'Abc@123', // Bob
  'VAE00483': 'Abc@123', // Carol
  'VAE00071': 'Abc@123', // Dave
  'VAE99999': 'Abc@123', // Eve
};

const updatedPassword = 'Abc@12345';

async function setupDatabase() {
  console.log('Resetting user passwords...');
  const defaultHash = await bcrypt.hash('Abc@123', 10);
  await prisma.user.updateMany({
    where: { employeeId: { in: ['VAE02566', 'VAE00061', 'VAE00483', 'VAE00071', 'VAE99999'] } },
    data: {
      passwordHash: defaultHash,
      forcePasswordChange: true
    }
  });

  console.log('Cleaning database findings and tasks...');
  await prisma.findingLink.deleteMany({});
  await prisma.findingHazardTag.deleteMany({});
  await prisma.rcaWhyStep.deleteMany({});
  await prisma.rcaContributingFactor.deleteMany({});
  await prisma.rcaInvestigation.deleteMany({});
  await prisma.capaAction.deleteMany({});
  await prisma.feedPost.deleteMany({});
  await prisma.timeBooking.deleteMany({});
  await prisma.taskData.deleteMany({});
  await prisma.task.updateMany({ data: { parentFindingId: null } });
  await prisma.finding.updateMany({ data: { sourceTaskId: null } });
  await prisma.finding.deleteMany({});
  await prisma.workPackageAssignment.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.workPackage.deleteMany({});
  await prisma.template.deleteMany({});
  await prisma.auditLog.deleteMany({});

  console.log('Fetching users and divisions...');
  const alice = await prisma.user.findFirst({ where: { employeeId: 'VAE02566' } });
  const bob = await prisma.user.findFirst({ where: { employeeId: 'VAE00061' } });
  const carol = await prisma.user.findFirst({ where: { employeeId: 'VAE00483' } });
  const dave = await prisma.user.findFirst({ where: { employeeId: 'VAE00071' } });
  const eve = await prisma.user.findFirst({ where: { employeeId: 'VAE99999' } });

  const dept = await prisma.department.findFirst({ where: { name: 'SQD' } });
  const divQA = await prisma.division.findFirst({ where: { code: 'QA' } });
  const divQCH = await prisma.division.findFirst({ where: { code: 'QCH' } });

  console.log('Creating a template and source tasks...');
  const template = await prisma.template.create({
    data: {
      templateId: 'QA-T-001',
      title: 'QA Inspection Template',
      formSchema: [{ id: '1', type: 'radio', label: 'Safety Check', options: ['Pass', 'Fail'] }],
      status: 'Published',
      ownerId: bob.id,
      divisionId: divQA.id,
      requiresApproval: true,
      allowsFindings: true
    }
  });

  const task1 = await prisma.task.create({
    data: {
      taskId: 'QA-100001',
      templateId: template.id,
      issuerId: bob.id,
      targetDivisionId: divQA.id,
      status: 'Closed',
      schemaSnapshot: []
    }
  });

  const task2 = await prisma.task.create({
    data: {
      taskId: 'QCH-100002',
      templateId: template.id,
      issuerId: carol.id,
      targetDivisionId: divQCH.id,
      status: 'Closed',
      schemaSnapshot: []
    }
  });

  console.log('Creating test findings...');
  // Finding F1: Open, targeted at QA
  const f1 = await prisma.finding.create({
    data: {
      severity: 'Observation',
      description: 'QA Finding F1 Description',
      status: 'Open',
      eventType: 'Procedural Breach',
      sourceTaskId: task1.id,
      reportedByUserId: alice.id,
      targetDivisionId: divQA.id,
      departmentId: dept.id
    }
  });

  // Finding F2: Open, targeted at QCH (Division B)
  const f2 = await prisma.finding.create({
    data: {
      severity: 'Observation',
      description: 'QCH Finding F2 Description',
      status: 'Open',
      eventType: 'FOD',
      sourceTaskId: task2.id,
      reportedByUserId: carol.id,
      targetDivisionId: divQCH.id,
      departmentId: dept.id
    }
  });

  // Finding F3: In Progress, targeted at QA
  const f3 = await prisma.finding.create({
    data: {
      severity: 'Observation',
      description: 'QA Finding F3 Description',
      status: 'In Progress',
      eventType: 'Procedural Breach',
      sourceTaskId: task1.id,
      reportedByUserId: bob.id,
      targetDivisionId: divQA.id,
      departmentId: dept.id
    }
  });

  // Finding F4: In Progress, targeted at QCH (Division B)
  const f4 = await prisma.finding.create({
    data: {
      severity: 'Observation',
      description: 'QCH Finding F4 Description',
      status: 'In Progress',
      eventType: 'FOD',
      sourceTaskId: task2.id,
      reportedByUserId: carol.id,
      targetDivisionId: divQCH.id,
      departmentId: dept.id
    }
  });

  // Create a follow-up task on F4 assigned to Alice
  const tFollowUp = await prisma.task.create({
    data: {
      taskId: 'QCH-200001',
      templateId: template.id,
      issuerId: carol.id,
      parentFindingId: f4.id,
      assignedToUserId: alice.id,
      targetDivisionId: divQCH.id,
      status: 'In Progress',
      schemaSnapshot: []
    }
  });

  console.log('Database setup complete.');
  return {
    f1Id: f1.id,
    f2Id: f2.id,
    f3Id: f3.id,
    f4Id: f4.id,
    tFollowUpId: tFollowUp.id
  };
}

async function runTests() {
  const dbData = await setupDatabase();
  const results = {};

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  async function waitForSelectorDebug(selector, timeout = 15000) {
    try {
      await page.waitForSelector(selector, { timeout });
    } catch (err) {
      console.log(`Failed waiting for selector "${selector}"! Current URL:`, page.url());
      const bodyText = await page.evaluate(() => document.body.innerText);
      console.log('Page body text:', bodyText);
      throw err;
    }
  }

  async function loginAndSetStore(username) {
    const currentPwd = passwords[username];
    console.log(`Logging in as ${username}...`);
    await page.goto('http://localhost:3000/login');
    await waitForSelectorDebug('input[placeholder="e.g. VAE00071"]');
    
    // Clear inputs and type
    await page.click('input[placeholder="e.g. VAE00071"]', { clickCount: 3 });
    await page.type('input[placeholder="e.g. VAE00071"]', username);
    await page.click('input[placeholder="••••••••"]', { clickCount: 3 });
    await page.type('input[placeholder="••••••••"]', currentPwd);
    
    await page.click('button[type="submit"]');
    try {
      await page.waitForFunction(() => window.location.pathname !== '/login', { timeout: 10000 });
    } catch (err) {
      console.log('Login timeout occurred! Current URL:', page.url());
      const bodyText = await page.evaluate(() => document.body.innerText);
      console.log('Page body text:', bodyText);
      throw err;
    }
    
    const url = page.url();
    if (url.includes('/update-password')) {
      console.log(`Updating password for ${username}...`);
      await waitForSelectorDebug('input[placeholder="••••••••"]');
      const passwordInputs = await page.$$('input[type="password"]');
      await passwordInputs[0].type(updatedPassword);
      await passwordInputs[1].type(updatedPassword);
      await page.click('button[type="submit"]');
      await page.waitForFunction(() => window.location.pathname !== '/update-password', { timeout: 10000 });
      passwords[username] = updatedPassword; // save for next login
      console.log(`${username} password updated to ${updatedPassword}`);

      if (page.url().includes('/login')) {
        console.log(`Logging in again after password update for ${username}...`);
        await waitForSelectorDebug('input[placeholder="e.g. VAE00071"]');
        await page.click('input[placeholder="e.g. VAE00071"]', { clickCount: 3 });
        await page.type('input[placeholder="e.g. VAE00071"]', username);
        await page.click('input[placeholder="••••••••"]', { clickCount: 3 });
        await page.type('input[placeholder="••••••••"]', updatedPassword);
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => window.location.pathname !== '/login', { timeout: 10000 });
      }
    }
    // Make sure we are in the dashboard area (which should not have /login in the URL)
    await page.waitForFunction(() => !window.location.pathname.includes('/login') && !window.location.pathname.includes('/update-password'), { timeout: 10000 });
    await waitForSelectorDebug('h1');
  }

  async function logout() {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('http://localhost:3000/login');
  }

  try {
    // ─── Section 1 — Finding Visibility (Open to All) ────────────────────────
    // TC-VIS-1: Staff can view a finding in a different division
    await loginAndSetStore('VAE02566'); // Alice (Staff, QA/Division A)
    
    // Go to findings list
    await page.goto('http://localhost:3000/dashboard/findings');
    await waitForSelectorDebug('.overflow-x-auto');
    
    const pageText = await page.evaluate(() => document.body.innerText);
    results['TC-VIS-1 (Visibility in list)'] = pageText.includes('QCH Finding F4 Description') ? 'PASS' : 'FAIL';

    // Click into Finding F4 detail (division B)
    await page.goto(`http://localhost:3000/dashboard/findings/${dbData.f4Id}`);
    await page.waitForFunction(() => document.body.innerText.includes('Finding #'), { timeout: 15000 });
    
    const detailText = await page.evaluate(() => document.body.innerText);
    const hasDetails = detailText.includes('QCH Finding F4 Description') && detailText.includes('RCA') && detailText.includes('CAPA');
    const hasEditControls = detailText.includes('Correct Severity') || detailText.includes('Dismiss');
    results['TC-VIS-1 (Detail visible, read-only for other division staff)'] = (hasDetails && !hasEditControls) ? 'PASS' : 'FAIL';

    // TC-VIS-2: Staff with a linked follow-up task can see the finding
    await page.goto(`http://localhost:3000/dashboard/tasks/${dbData.tFollowUpId}`);
    await waitForSelectorDebug('h1');
    const taskText = await page.evaluate(() => document.body.innerText);
    const passVis2 = taskText.toLowerCase().includes('raised by finding');
    if (!passVis2) {
      console.log('TC-VIS-2 FAILED! page body text is:', taskText);
    }
    results['TC-VIS-2 (Linked finding referenced in task page)'] = passVis2 ? 'PASS' : 'FAIL';

    await logout();

    // ─── Section 3 — Dismiss Finding ─────────────────────────────────────────
    // TC-DIS-3: Manager in wrong division cannot dismiss (Carol, QCH tries QA finding F1)
    await loginAndSetStore('VAE00483'); // Carol (Manager, QCH/Division B)
    await page.goto(`http://localhost:3000/dashboard/findings/${dbData.f1Id}`);
    await page.waitForFunction(() => document.body.innerText.includes('Finding #'), { timeout: 15000 });
    const carolDetailText = await page.evaluate(() => document.body.innerText);
    results['TC-DIS-3 (Manager in wrong division has no dismiss button)'] = !carolDetailText.includes('Dismiss') ? 'PASS' : 'FAIL';
    
    await logout();

    // TC-DIS-1: Manager in correct division can dismiss an Open finding (Bob QA manages F1 QA)
    await loginAndSetStore('VAE00061'); // Bob (Manager, QA/Division A)
    await page.goto(`http://localhost:3000/dashboard/findings/${dbData.f1Id}`);
    await page.waitForFunction(() => document.body.innerText.includes('Finding #'), { timeout: 15000 });
    
    // Find and click Dismiss
    const dismissBtn = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.innerText.includes('Dismiss'));
    });
    
    if (dismissBtn.asElement()) {
      await dismissBtn.click();
      // Wait for modal input
      await waitForSelectorDebug('textarea');
      await page.type('textarea', 'Duplicate of Finding #12');
      
      const confirmBtn = await page.evaluateHandle(() => {
        const modal = document.querySelector('.fixed.inset-0');
        const root = modal || document;
        const buttons = Array.from(root.querySelectorAll('button'));
        // Find Confirm button or Dismiss (modal action)
        return buttons.find(b => b.innerText.includes('Confirm') || (modal && b.innerText.includes('Dismiss')));
      });
      await confirmBtn.click();
      await page.waitForFunction(() => document.body.innerText.includes('Dismissed'), { timeout: 5000 });
      results['TC-DIS-1 (Manager dismisses finding)'] = 'PASS';
    } else {
      results['TC-DIS-1 (Manager dismisses finding)'] = 'FAIL (Dismiss button not found)';
    }

    // TC-SEV-1: Manager in correct division can correct severity (Bob corrects F3 QA)
    await page.goto(`http://localhost:3000/dashboard/findings/${dbData.f3Id}`);
    await page.waitForFunction(() => document.body.innerText.includes('Finding #'), { timeout: 15000 });
    
    const correctBtn = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.innerText.includes('Correct Severity') || b.innerText.includes('Edit Severity'));
    });
    
    if (correctBtn.asElement()) {
      await correctBtn.click();
      await waitForSelectorDebug('select');
      await page.select('select', 'Level 1');
      await page.type('textarea', 'Initial classification too low');
      
      const saveBtn = await page.evaluateHandle(() => {
        const modal = document.querySelector('.fixed.inset-0');
        const root = modal || document;
        const buttons = Array.from(root.querySelectorAll('button'));
        // Find Save, Submit or Correct inside the modal overlay
        return buttons.find(b => b.innerText.includes('Save') || b.innerText.includes('Submit') || b.innerText.includes('Correct'));
      });
      await saveBtn.click();
      await page.waitForFunction(() => document.body.innerText.includes('Level 1') && document.body.innerText.includes('Severity updated from Observation to Level 1'), { timeout: 6000 });
      results['TC-SEV-1 (Manager corrects severity)'] = 'PASS';
    } else {
      results['TC-SEV-1 (Manager corrects severity)'] = 'FAIL (Button not found)';
    }

    await logout();

    // TC-DIS-4: Director can dismiss any finding
    await loginAndSetStore('VAE00071'); // Dave (Director)
    await page.goto(`http://localhost:3000/dashboard/findings/${dbData.f2Id}`); // QCH Finding (Carol division)
    await page.waitForFunction(() => document.body.innerText.includes('Finding #'), { timeout: 15000 });
    const daveDetailText = await page.evaluate(() => document.body.innerText);
    results['TC-DIS-4 (Director sees dismiss button on another division finding)'] = daveDetailText.includes('Dismiss') ? 'PASS' : 'FAIL';
    
    await logout();

    // TC-STUCK-2: Staff cannot access stuck list (Alice tries GET /api/findings/admin/stuck)
    await loginAndSetStore('VAE02566'); // Alice
    const fetchResponse = await page.evaluate(async () => {
      try {
        const authStorage = sessionStorage.getItem('auth-storage');
        const token = authStorage ? JSON.parse(authStorage).state.token : '';
        const res = await fetch('http://localhost:5000/api/findings/admin/stuck', {
          headers: { Authorization: `Bearer ${token}` }
        });
        return res.status;
      } catch (e) {
        return 500;
      }
    });
    results['TC-STUCK-2 (Staff receives 403 for stuck findings endpoint)'] = fetchResponse === 403 ? 'PASS' : `FAIL (Status: ${fetchResponse})`;
    
    await logout();

    // TC-STUCK-1: Stuck finding appears in admin list
    await loginAndSetStore('VAE99999'); // Eve (Admin)
    const adminFetchResponse = await page.evaluate(async () => {
      try {
        const authStorage = sessionStorage.getItem('auth-storage');
        const token = authStorage ? JSON.parse(authStorage).state.token : '';
        const res = await fetch('http://localhost:5000/api/findings/admin/stuck', {
          headers: { Authorization: `Bearer ${token}` }
        });
        return { status: res.status, body: await res.json() };
      } catch (e) {
        return { status: 500 };
      }
    });
    results['TC-STUCK-1 (Admin can access stuck findings list)'] = adminFetchResponse.status === 200 && Array.isArray(adminFetchResponse.body) ? 'PASS' : 'FAIL';

    await logout();

  } catch (error) {
    console.error('Test execution failed:', error);
  } finally {
    await browser.disconnect();
    await prisma.$disconnect();
    await pool.end();
  }

  console.log('\n--- Checklist Execution Results ---');
  for (const [tc, status] of Object.entries(results)) {
    console.log(`[${status}] ${tc}`);
  }
}

runTests().catch(console.error);
