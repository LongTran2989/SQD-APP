import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  fetchAndParseSheet,
  getPreviewData,
  executeSync,
  ValidatedRow,
  PreviewData,
  PreviewItem,
} from '../services/googleSheetSync.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DAY = 86400000;
// Anchored to a fixed epoch so every future(n) call is byte-identical regardless
// of when it runs — date equality assertions must not race the wall clock.
const BASE = Date.UTC(2026, 6, 1, 0, 0, 0); // 2026-07-01T00:00:00Z
const future = (n: number) => new Date(BASE + n * DAY);

const CHK_BP_NAME = 'CHK Blueprint (test)';
const PC_EQ_BP_NAME = 'PC-EQ Blueprint (test)';

// CSV header row shared by the parser tests.
const HEADER = 'WP No.,WP Desc.,WP Status Name,Station,TAT,Start Date,Start Time,End Date,End Time,A/C Reg.,Customer';

function mockFetchCsv(csv: string) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () => csv,
  });
}

describe('Google Sheet WP Sync service', () => {
  let qchId: number;
  let qcsId: number;
  let actorId: number;
  let chkBpId: number;
  let pcEqBpId: number;

  beforeAll(async () => {
    process.env.SHEET_CHK_BLUEPRINT_NAME = CHK_BP_NAME;
    process.env.SHEET_PC_EQ_BLUEPRINT_NAME = PC_EQ_BP_NAME;

    const role = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const dept = await prisma.department.upsert({ where: { name: 'QC Dept' }, update: {}, create: { name: 'QC Dept' } });
    const qch = await prisma.division.upsert({ where: { code: 'QCH' }, update: {}, create: { name: 'QC Hanoi', code: 'QCH', departmentId: dept.id } });
    const qcs = await prisma.division.upsert({ where: { code: 'QCS' }, update: {}, create: { name: 'QC Saigon', code: 'QCS', departmentId: dept.id } });
    qchId = qch.id;
    qcsId = qcs.id;

    const actor = await prisma.user.create({
      data: { name: 'Sync Manager', email: 'syncmgr@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: qchId, roleId: role.id },
    });
    actorId = actor.id;

    const chkBp = await prisma.wpBlueprint.create({
      data: { name: CHK_BP_NAME, type: 'CHECK', divisionId: qchId, defaultDuration: 10, ownerId: actorId, isActive: true, defaultAutoGenerate: false, acRegistration: 'BP-AC', customer: 'BP-Customer', authority: 'CAAV' },
    });
    const pcEqBp = await prisma.wpBlueprint.create({
      data: { name: PC_EQ_BP_NAME, type: 'PC-EQ', divisionId: qcsId, defaultDuration: 2, ownerId: actorId, isActive: true, defaultAutoGenerate: false },
    });
    chkBpId = chkBp.id;
    pcEqBpId = pcEqBp.id;
  });

  beforeEach(async () => {
    // Each test starts with a clean WP/audit/feed slate (static seed persists).
    await prisma.feedPost.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.workPackage.deleteMany({});
    // Ensure blueprint is active by default (one test flips it off).
    await prisma.wpBlueprint.update({ where: { id: chkBpId }, data: { isActive: true } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  // Builds a ValidatedRow with sensible defaults.
  const row = (over: Partial<ValidatedRow> = {}): ValidatedRow => ({
    wpNo: 'VN-CHK-001',
    description: 'A330 base check',
    station: 'HAN',
    tatDays: 5,
    timeframeFrom: future(1),
    timeframeTo: future(5),
    acRegistration: 'VN-A330',
    customer: 'Vietnam Airlines',
    ...over,
  });

  // ── fetchAndParseSheet ──────────────────────────────────────────────────────
  describe('fetchAndParseSheet', () => {
    it('keeps only HAN/SGN + CHK + In Preparation rows and skips the rest', async () => {
      const csv = [
        HEADER,
        'VN-CHK-001,Base check,In Preparation,HAN,5,2026-07-01,08:00,2026-07-05,17:00,VN-A321,VNA', // valid
        'VN-CHK-002,Done,Released,HAN,5,2026-07-01,08:00,2026-07-05,17:00,VN-A321,VNA',             // wrong status
        'VN-PC-003,Equip,In Preparation,HAN,1,2026-07-01,08:00,2026-07-02,10:00,,',                  // no CHK
        'XX-CHK-004,Foreign,In Preparation,DAD,5,2026-07-01,08:00,2026-07-05,17:00,,',               // wrong station
        'VN-CHK-005,Quick,In Preparation,SGN,1,2026-07-02,09:00,2026-07-03,10:00,,',                 // valid
        'VN-CHK-006,Bad,In Preparation,HAN,5,2026-07-09,08:00,2026-07-05,17:00,,',                   // from >= to
      ].join('\n');
      mockFetchCsv(csv);

      const rows = await fetchAndParseSheet('https://example.test/sheet.csv');
      expect(rows.map((r) => r.wpNo).sort()).toEqual(['VN-CHK-001', 'VN-CHK-005']);
      const first = rows.find((r) => r.wpNo === 'VN-CHK-001')!;
      expect(first.station).toBe('HAN');
      expect(first.tatDays).toBe(5);
      // 2026-07-01 08:00 UTC, no timezone shift.
      expect(first.timeframeFrom.toISOString()).toBe('2026-07-01T08:00:00.000Z');
      expect(first.timeframeTo.toISOString()).toBe('2026-07-05T17:00:00.000Z');
    });

    it('throws a clear error on a non-OK HTTP response', async () => {
      (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' });
      await expect(fetchAndParseSheet('https://example.test/x.csv')).rejects.toThrow(/HTTP 503/);
    });
  });

  // ── getPreviewData ──────────────────────────────────────────────────────────
  describe('getPreviewData', () => {
    it('classifies rows into create / update / collision / noChange using stored status', async () => {
      // Open WP, same dates → noChange.
      await prisma.workPackage.create({
        data: { wpId: 'QCH-WP-000001', name: 'VN-CHK-SAME', type: 'CHECK', divisionId: qchId, timeframeFrom: future(1), timeframeTo: future(5), creatorId: actorId, status: 'Open' },
      });
      // Open WP, different dates → toUpdate.
      const upd = await prisma.workPackage.create({
        data: { wpId: 'QCH-WP-000002', name: 'VN-CHK-MOVE', type: 'CHECK', divisionId: qchId, timeframeFrom: future(1), timeframeTo: future(5), creatorId: actorId, status: 'Open' },
      });
      // Closed WP → collision.
      await prisma.workPackage.create({
        data: { wpId: 'QCH-WP-000003', name: 'VN-CHK-CLOSED', type: 'CHECK', divisionId: qchId, timeframeFrom: future(1), timeframeTo: future(5), creatorId: actorId, status: 'Closed' },
      });

      const rows: ValidatedRow[] = [
        row({ wpNo: 'VN-CHK-NEW' }),
        row({ wpNo: 'VN-CHK-SAME', timeframeFrom: future(1), timeframeTo: future(5) }),
        row({ wpNo: 'VN-CHK-MOVE', timeframeFrom: future(2), timeframeTo: future(6) }),
        row({ wpNo: 'VN-CHK-CLOSED' }),
      ];

      const preview = await getPreviewData(rows);
      expect(preview.toCreate.map((p) => p.wpNo)).toEqual(['VN-CHK-NEW']);
      expect(preview.noChange.map((p) => p.wpNo)).toEqual(['VN-CHK-SAME']);
      expect(preview.toUpdate.map((p) => p.wpNo)).toEqual(['VN-CHK-MOVE']);
      expect(preview.toUpdate[0]!.existingWpId).toBe(upd.id);
      expect(preview.collisions.map((p) => p.wpNo)).toEqual(['VN-CHK-CLOSED']);
    });

    it('treats a soft-deleted WP of the same name as not-found (toCreate) — Rule 2', async () => {
      await prisma.workPackage.create({
        data: { wpId: 'QCH-WP-000010', name: 'VN-CHK-DEL', type: 'CHECK', divisionId: qchId, timeframeFrom: future(1), timeframeTo: future(5), creatorId: actorId, status: 'Open', deletedAt: new Date() },
      });
      const preview = await getPreviewData([row({ wpNo: 'VN-CHK-DEL' })]);
      expect(preview.toCreate.map((p) => p.wpNo)).toEqual(['VN-CHK-DEL']);
      expect(preview.toUpdate).toHaveLength(0);
      expect(preview.collisions).toHaveLength(0);
    });
  });

  // ── executeSync ─────────────────────────────────────────────────────────────
  describe('executeSync', () => {
    const emptyPreview = (): PreviewData => ({ toCreate: [], toUpdate: [], collisions: [], noChange: [] });
    const item = (over: Partial<PreviewItem>): PreviewItem => ({
      wpNo: 'VN-CHK-001',
      description: '',
      station: 'HAN',
      tatDays: 5,
      acRegistration: 'VN-A330',
      customer: 'VNA',
      timeframeFrom: future(1),
      timeframeTo: future(5),
      ...over,
    });

    it('creates WPs with the TAT-correct blueprint, type and division', async () => {
      const preview = emptyPreview();
      preview.toCreate = [
        item({ wpNo: 'VN-CHK-BIG', station: 'HAN', tatDays: 5 }), // CHECK @ QCH
        item({ wpNo: 'VN-CHK-SML', station: 'SGN', tatDays: 1 }), // PC-EQ @ QCS
      ];

      const res = await executeSync(preview, { userId: actorId }, { collisionDecisions: {} });
      expect(res.created).toBe(2);
      expect(res.errors).toHaveLength(0);

      const big = await prisma.workPackage.findFirst({ where: { name: 'VN-CHK-BIG', deletedAt: null } });
      expect(big?.type).toBe('CHECK');
      expect(big?.divisionId).toBe(qchId);
      expect(big?.blueprintId).toBe(chkBpId);

      const sml = await prisma.workPackage.findFirst({ where: { name: 'VN-CHK-SML', deletedAt: null } });
      expect(sml?.type).toBe('PC-EQ');
      expect(sml?.divisionId).toBe(qcsId);
      expect(sml?.blueprintId).toBe(pcEqBpId);
    });

    it('reschedules a toUpdate WP and dual-writes AuditLog + WP feed SYSTEM_EVENT (Rule 3)', async () => {
      const wp = await prisma.workPackage.create({
        data: { wpId: 'QCH-WP-000100', name: 'VN-CHK-RS', type: 'CHECK', divisionId: qchId, timeframeFrom: future(1), timeframeTo: future(5), creatorId: actorId, status: 'Open' },
      });
      const preview = emptyPreview();
      preview.toUpdate = [item({ wpNo: 'VN-CHK-RS', existingWpId: wp.id, currentTimeframeFrom: wp.timeframeFrom, currentTimeframeTo: wp.timeframeTo, timeframeFrom: future(3), timeframeTo: future(8) })];

      const res = await executeSync(preview, { userId: actorId }, { collisionDecisions: {} });
      expect(res.updated).toBe(1);
      expect(res.errors).toHaveLength(0);

      const reloaded = await prisma.workPackage.findUnique({ where: { id: wp.id } });
      expect(reloaded?.timeframeFrom.toISOString()).toBe(future(3).toISOString());
      expect(reloaded?.timeframeTo.toISOString()).toBe(future(8).toISOString());

      const audit = await prisma.auditLog.findFirst({ where: { actionType: 'WP_SYNC_RESCHEDULED', entityId: String(wp.id) } });
      expect(audit).not.toBeNull();
      expect(audit?.performedByUserId).toBe(actorId);

      const feed = await prisma.feedPost.findFirst({ where: { scope: 'WP', scopeId: wp.id, type: 'SYSTEM_EVENT' } });
      expect(feed).not.toBeNull();
      expect(feed?.content).toMatch(/Google Sheet Sync/);
    });

    it('skips a toUpdate WP that was closed since preview (race guard)', async () => {
      const wp = await prisma.workPackage.create({
        data: { wpId: 'QCH-WP-000200', name: 'VN-CHK-RACE', type: 'CHECK', divisionId: qchId, timeframeFrom: future(1), timeframeTo: future(5), creatorId: actorId, status: 'Open' },
      });
      const preview = emptyPreview();
      preview.toUpdate = [item({ wpNo: 'VN-CHK-RACE', existingWpId: wp.id, timeframeFrom: future(3), timeframeTo: future(8) })];

      // Another actor closes it between preview and execute.
      await prisma.workPackage.update({ where: { id: wp.id }, data: { status: 'Closed' } });

      const res = await executeSync(preview, { userId: actorId }, { collisionDecisions: {} });
      expect(res.updated).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.errors[0]?.wpNo).toBe('VN-CHK-RACE');
      expect(res.errors[0]?.reason).toMatch(/closed\/inactivated/i);

      // Dates untouched.
      const reloaded = await prisma.workPackage.findUnique({ where: { id: wp.id } });
      expect(reloaded?.timeframeFrom.toISOString()).toBe(future(1).toISOString());
    });

    it('honours a create-new collision decision by suffixing -REV2', async () => {
      // Closed original occupying the base name.
      await prisma.workPackage.create({
        data: { wpId: 'QCH-WP-000300', name: 'VN-CHK-COL', type: 'CHECK', divisionId: qchId, timeframeFrom: future(1), timeframeTo: future(5), creatorId: actorId, status: 'Closed' },
      });
      const preview = emptyPreview();
      preview.collisions = [item({ wpNo: 'VN-CHK-COL', station: 'HAN', tatDays: 5 })];

      const res = await executeSync(preview, { userId: actorId }, { collisionDecisions: { 'VN-CHK-COL': 'create-new' } });
      expect(res.created).toBe(1);
      const rev = await prisma.workPackage.findFirst({ where: { name: 'VN-CHK-COL-REV2', deletedAt: null } });
      expect(rev).not.toBeNull();
    });

    it('skips a collision left as skip', async () => {
      await prisma.workPackage.create({
        data: { wpId: 'QCH-WP-000400', name: 'VN-CHK-IGN', type: 'CHECK', divisionId: qchId, timeframeFrom: future(1), timeframeTo: future(5), creatorId: actorId, status: 'Inactive' },
      });
      const preview = emptyPreview();
      preview.collisions = [item({ wpNo: 'VN-CHK-IGN' })];

      const res = await executeSync(preview, { userId: actorId }, { collisionDecisions: { 'VN-CHK-IGN': 'skip' } });
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(await prisma.workPackage.count({ where: { name: { startsWith: 'VN-CHK-IGN-REV' } } })).toBe(0);
    });

    it('fails fast when a configured blueprint is inactive', async () => {
      await prisma.wpBlueprint.update({ where: { id: chkBpId }, data: { isActive: false } });
      const preview = emptyPreview();
      preview.toCreate = [item({ wpNo: 'VN-CHK-FAIL' })];
      await expect(executeSync(preview, { userId: actorId }, { collisionDecisions: {} })).rejects.toThrow(/CHK Blueprint not found or inactive/);
    });
  });
});
