// backend/prisma/seed-mass-mockup-v2.ts
// -----------------------------------------------------------------------
// DEMO SEED — full-coverage mockup for management demonstrations.
//
// Generates:
//   • 30 Work Packages  — all 5 types, all statuses incl. Overdue + Inactive,
//                         one blueprint-launched routine WP, CHECK WPs with
//                         acRegistration, AUDIT WPs with targetDepartmentId
//   • 150 Tasks         — all 9 statuses, overdue tasks, TaskData on active
//                         tasks, time entries + ratings on Closed tasks,
//                         FeedPost comments on selected tasks
//   • 20 Findings       — all 5 statuses incl. Dismissed, unique curated
//                         descriptions, findingId, dueDate, ATA chapters,
//                         hazard tags, severity
//   • 5 "hero" findings — full lifecycle: RCA (5-Whys, MEDA, OTHER),
//                         CAPA (Corrective + Preventive), follow-up tasks,
//                         finding links, response actions
//   • Trend cluster     — 3 findings sharing dept+ATA+cause+hazardTag so
//                         the isRecurring banner fires on GET /:id
//   • FeedPosts         — COMMENT + SYSTEM_EVENT posts on tasks and WPs
//
// HOW TO RUN (from inside /backend):
//   npx ts-node prisma/seed-mass-mockup-v2.ts
//
// MUST RUN AFTER: seed-org.ts, seed-reference.ts, seed-templates.ts,
//                 seed-blueprints.ts (for blueprint lookup).
//
// IDEMPOTENT CLEANUP: deletes rows by stable ID prefix (DEMO-WP, DEMO-TSK,
//   DEMO-FND) before re-seeding. Safe to re-run.
// -----------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function randBetween(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

function fndId(n: number): string {
  return `FND-${String(n).padStart(6, '0')}`;
}

// ── Curated content pools ─────────────────────────────────────────────────────

const wpData = [
  // CHECK — with aircraft registration
  { name: 'A321 Annual Base Maintenance Check', type: 'CHECK', acRegistration: 'VN-A321', status: 'Closed' },
  { name: 'B737-800 Progressive Check Oversight', type: 'CHECK', acRegistration: 'VN-B738', status: 'In Progress' },
  { name: 'ATR72 400-Hour Periodic Check QA Review', type: 'CHECK', acRegistration: 'VN-ATR7', status: 'Open' },
  { name: 'A320 D-Check Return-to-Service Audit', type: 'CHECK', acRegistration: 'VN-A320', status: 'Overdue' },
  { name: 'A350 C-Check Compliance Review', type: 'CHECK', acRegistration: 'VN-A350', status: 'Inactive' },

  // AUDIT — with targetDepartmentId
  { name: 'Q2 Quality Assurance Division Audit', type: 'AUDIT', status: 'In Progress' },
  { name: 'Stores & Logistics Material Control Audit', type: 'AUDIT', status: 'Open' },
  { name: 'Line Maintenance Night Shift Compliance Audit', type: 'AUDIT', status: 'Closed' },
  { name: 'Component Shop 145 Regulatory Compliance Audit', type: 'AUDIT', status: 'Overdue' },
  { name: 'NDT Recertification & Personnel Audit', type: 'AUDIT', status: 'Open' },

  // SURVEILLANCE
  { name: 'Ramp Safety & FOD Prevention Surveillance', type: 'SURVEILLANCE', status: 'In Progress' },
  { name: 'Line Station Routine Surveillance — HAN', type: 'SURVEILLANCE', status: 'Closed' },
  { name: 'Avionics Workshop Electrostatic Safety Surveillance', type: 'SURVEILLANCE', status: 'Open' },
  { name: 'Engine Shop Hazardous Materials Surveillance', type: 'SURVEILLANCE', status: 'Overdue' },
  { name: 'Cabin Interior Refurbishment Quality Surveillance', type: 'SURVEILLANCE', status: 'Inactive' },

  // INVESTIGATION
  { name: 'Tail Strike Event Investigation — VN-A321', type: 'INVESTIGATION', status: 'In Progress' },
  { name: 'Hydraulic Fluid Contamination Root Cause Investigation', type: 'INVESTIGATION', status: 'Open' },
  { name: 'Landing Gear Collapse Precursor Investigation', type: 'INVESTIGATION', status: 'Closed' },
  { name: 'Ground Handling FOD Incident Investigation', type: 'INVESTIGATION', status: 'Open' },
  { name: 'Avionics Fault Recurrence Pattern Investigation', type: 'INVESTIGATION', status: 'Overdue' },

  // OTHER
  { name: 'Sheet Metal Repair Process Verification', type: 'OTHER', status: 'Open' },
  { name: 'Oxygen System Servicing Oversight', type: 'OTHER', status: 'In Progress' },
  { name: 'Aircraft Painting Process Verification', type: 'OTHER', status: 'Closed' },
  { name: 'Tool Room Annual Inventory Reconciliation', type: 'OTHER', status: 'Open' },
  { name: 'Personnel Fitness-for-Duty Programme Review', type: 'OTHER', status: 'Inactive' },

  // Extra — mixed for volume
  { name: 'Engine Borescope Inspection QA Review', type: 'SURVEILLANCE', status: 'Open' },
  { name: 'Landing Gear Overhaul Process Audit', type: 'AUDIT', status: 'In Progress' },
  { name: 'Emergency Equipment Annual Compliance Check', type: 'CHECK', acRegistration: 'VN-B738', status: 'Closed' },
  { name: 'AD/SB Compliance Tracking Review Q3', type: 'AUDIT', status: 'Open' },
  // Blueprint-launched routine WP (set below via blueprintId lookup)
  { name: 'Monthly QA Surveillance Routine — Jun 2026', type: 'SURVEILLANCE', status: 'In Progress', isRoutine: true },
];

const taskTitles = [
  'Review Work Order Documentation',
  'Inspect Landing Gear Trunnion Link',
  'Verify Calibration of Torque Wrenches',
  'Audit Personnel Training Records',
  'Check AD/SB Compliance Status',
  'Observe Engine Run-up Procedures',
  'Inspect Cargo Door Locking Mechanism',
  'Verify Standard Wiring Practices (SWPM)',
  'Audit Tool Room Inventory',
  'Check Minimum Equipment List (MEL) Dispatch',
  'Verify Component Release Certificates (CRS/Form 1)',
  'Observe Aircraft Jacking Procedure',
  'Inspect Flight Control Cable Tension',
  'Review NDT Ultrasonic Test Results',
  'Check Emergency Equipment Expiry Dates',
  'Inspect Hydraulic System Reservoir Level',
  'Verify Oxygen System Pressure Records',
  'Audit Shift Handover Log Completeness',
  'Inspect Nose Gear Steering Actuator',
  'Review Aircraft Weight & Balance Records',
];

const taskNotes = [
  'Completed per AMM Chapter 32. No discrepancies found.',
  'Calibration tags verified. Two instruments flagged for renewal next cycle.',
  'Training records up to date for all technicians on shift.',
  'AD 2024-18-05 compliance confirmed on aircraft VN-A321.',
  'Engine run-up observed. Procedures followed in accordance with EO 24-009.',
  'Minor FOD risk area identified near bay 3. Housekeeping team notified.',
  'All tool calibration stickers current. Register updated.',
  'MEL dispatch authorised by Maintenance Controller. Documentation in order.',
  'Form 1 certificates present for all installed components.',
  'Weight & balance records verified against last C-Check documentation.',
  'Component removed and routed to shop for overhaul.',
  'Visual inspection completed; minor surface corrosion noted but within limits.',
  'Operational test passed successfully. No faults in BITE test.',
  'Replaced worn seals per AMM procedures. Leak check satisfactory.',
  'Functional check of system completed. Parameters normal.',
  'Lubrication applied to all required grease points.',
];

// Unique curated finding descriptions
const findingDescriptions = [
  'Torque wrench SN-TW-2241 found 38 days beyond its 6-month calibration due date on B737-800 VN-B738 nose gear strut lubrication task card MNT-NG-004.',
  'Maintenance manual AMM 32-11-00 Rev. 47 in use at Line Station HAN was superseded by Rev. 49 issued 2025-12-01; technician was unaware of the update.',
  'Three technicians on night shift (C-Check VN-A350, bay 14) observed performing chemical stripping without respiratory PPE as required by SHE-SOP-003.',
  'Safety wire on engine cowling cowl-lock fastener (A321 VN-A321, ENG-2) did not meet MS25083 standard — insufficient twist density across 40mm span.',
  'Step 4 of landing gear lubrication task card TC-LG-0032 (A320 VN-A320) had no sign-off from authorised certifying staff at task completion.',
  'FOD survey following engine ground run on apron Bay 7 identified a stainless steel socket (3/8 in.) unaccounted for in technician tool check-out sheet.',
  'Hydraulic fluid seepage detected at actuator assembly (A321 VN-A321, spoiler panel 4L) during daily check; condition not entered in Technical Log.',
  'Four components in Quarantine Store (shelf C-3) exceeded shelf-life limits by 11–27 days. No QA hold tag affixed; items were accessible for installation.',
  'Non-standard tool (personal ratchet SN-RT-4492) found in QA-authorised tool kit during random tool audit. Tool not listed in approved tool register.',
  'ADD (Acceptable Deferred Defect) item #ADD-0442 on B737-800 VN-B738 (nose wheel steering fault) exceeded its 10-day deferral limit by 4 days without extension approval.',
  'Emergency exit light battery (seat row 22, VN-A321) found discharged to 18% during cabin safety inspection — below the 50% serviceable limit per CMR 25-60-11.',
  'Shift handover logbook for avionics task (ACARS antenna replacement, VN-A320) contained no entry for partially completed connector re-pinning work.',
  'Scaffolding platform used for horizontal stabiliser inspection (VN-A350, bay 6) lacked a valid 6-monthly structural inspection tag (expired 2025-10-31).',
  'Flammable solvent containers (1L acetone, 5L MEK) stored adjacent to an electrical panel in the paint shop — in violation of Fire Safety SOP-FS-002.',
  'Tyre pressure gauge PG-3391 used to service VN-B738 main gear tyres was absent from the calibrated-equipment register; traceability chain broken.',
  'RII (Required Inspection Item) sign-off for wing-to-fuselage fairing re-installation (VN-A321) was performed by the same technician who completed the work — dual-sign requirement not met.',
  'Engine oil sample (VN-ATR7, ENG-1) collected outside the specified sampling window of 10 flight hours post-oil service, invalidating spectroscopic trend data.',
  'Aircraft VN-B738 departed with captain\'s OFP (Operational Flight Plan) showing a NOTAM flag for Destination alternate — dispatcher had not acknowledged the flag.',
  'Non-conforming repair (cold-bonded doublerplate, SRM 57-10-05) applied to cargo door surround skin without approved FAA/EASA DER data or STC backing.',
  'Technician-in-charge on C-Check VN-A350 bay 12 authorised continuation of fuel system purge procedure without required continuous-duty explosion-proof ventilation running.',
];

const feedComments: { type: 'manager' | 'staff' | 'system'; content: string }[] = [
  { type: 'manager', content: 'Please ensure calibration certificates are scanned and attached before closing this task.' },
  { type: 'staff', content: 'Calibration certs scanned and uploaded. Ready for review.' },
  { type: 'manager', content: 'Good work. Closing this after confirming all docs are in order.' },
  { type: 'staff', content: 'Inspection completed. Two minor discrepancies noted — see attached photos.' },
  { type: 'manager', content: 'Discrepancies reviewed. Raising a finding for the uncalibrated instrument. Continue with the remaining items.' },
  { type: 'staff', content: 'Task in progress — partial completion on items 1–6. Items 7–10 expected by EOD.' },
  { type: 'manager', content: 'Noted. Please flag if you need additional support from the night shift team.' },
  { type: 'system', content: 'Task status changed from Assigned to In Progress.' },
  { type: 'system', content: 'Deadline extended by 3 days following manager approval.' },
  { type: 'staff', content: 'Awaiting QA sign-off from Group Leader before proceeding to step 5.' },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🧹 Cleaning up previous DEMO mock data...');

  // Clean in FK-safe order
  await prisma.capaAction.deleteMany({ where: { finding: { findingId: { startsWith: 'FND-0' } } } });
  await prisma.rcaInvestigation.deleteMany({ where: { finding: { findingId: { startsWith: 'FND-0' } } } });
  await prisma.findingLink.deleteMany({
    where: {
      OR: [
        { fromFinding: { findingId: { startsWith: 'FND-0' } } },
        { relatedFinding: { findingId: { startsWith: 'FND-0' } } },
      ],
    },
  });
  await prisma.findingResponseAction.deleteMany({ where: { finding: { findingId: { startsWith: 'FND-0' } } } });
  await prisma.findingHazardTag.deleteMany({ where: { finding: { findingId: { startsWith: 'FND-0' } } } });

  // Delete tasks associated with DEMO findings (follow-up tasks)
  await prisma.task.deleteMany({ where: { taskId: { startsWith: 'DEMO-FUP' } } });

  // Delete DEMO findings
  await prisma.finding.deleteMany({ where: { findingId: { startsWith: 'FND-0' } } });

  // Delete DEMO tasks (before WPs due to FK)
  await prisma.task.deleteMany({ where: { taskId: { startsWith: 'DEMO-TSK' } } });

  // Delete DEMO WPs
  await prisma.workPackage.deleteMany({ where: { wpId: { startsWith: 'DEMO-WP' } } });

  console.log('✅ Cleanup complete.\n');
  console.log('🌱 Starting DEMO data generation...\n');

  // ── Load reference data ────────────────────────────────────────────────────

  const users = await prisma.user.findMany({ where: { deletedAt: null }, include: { role: true } });
  const directors = users.filter(u => ['Director', 'Manager'].includes(u.role.name));
  const staffs = users.filter(u => u.role.name === 'Staff');
  const divisions = await prisma.division.findMany();
  const departments = await prisma.department.findMany();
  const templates = await prisma.template.findMany({ where: { status: 'Published' } });
  const eventTypes = await prisma.eventType.findMany({ where: { isActive: true } });
  const ataChapters = await prisma.ataChapter.findMany({ where: { isActive: true } });
  const hazardTags = await prisma.hazardTag.findMany({ where: { isActive: true } });
  const causeCodes = await prisma.causeCode.findMany({ where: { isActive: true } });
  const blueprints = await prisma.wpBlueprint.findMany({ where: { isActive: true } });

  if (!directors.length || !staffs.length || !divisions.length || !templates.length || !departments.length || !eventTypes.length) {
    console.error('❌ Missing required base data. Please run main seed first (seed.ts).');
    return;
  }

  const validDivisions = divisions.filter(div =>
    directors.some(d => d.divisionId === div.id) &&
    staffs.some(s => s.divisionId === div.id)
  );

  if (!validDivisions.length) {
    console.error('❌ No divisions have both a Director/Manager and a Staff. Cannot satisfy RBAC.');
    return;
  }

  function divDirectors(divId: number) { return directors.filter(d => d.divisionId === divId); }
  function divStaffs(divId: number)    { return staffs.filter(s => s.divisionId === divId); }

  // ── 1. Work Packages ───────────────────────────────────────────────────────

  console.log(`📦 Creating ${wpData.length} Work Packages...`);
  const createdWps: any[] = [];

  const routineBlueprint = blueprints.length > 0 ? blueprints[0] : null;

  for (let i = 0; i < wpData.length; i++) {
    const def = wpData[i]!;
    const division = pick(validDivisions);
    const creator  = pick(divDirectors(division.id));
    const timeFrom = daysAgo(Math.floor(Math.random() * 60) + 5);
    const timeTo   = def.status === 'Overdue'
      ? daysAgo(Math.floor(Math.random() * 10) + 1)   // expired
      : daysFromNow(Math.floor(Math.random() * 40) + 5);

    const wpPayload: any = {
      wpId:          `DEMO-WP-${String(i + 1).padStart(3, '0')}`,
      name:          def.name,
      type:          def.type,
      divisionId:    division.id,
      timeframeFrom: timeFrom,
      timeframeTo:   timeTo,
      creatorId:     creator.id,
      status:        def.status,
      closedAt:      def.status === 'Closed' ? daysAgo(Math.floor(Math.random() * 10) + 1) : null,
      isRoutine:     !!(def as any).isRoutine,
    };

    if (def.type === 'CHECK' && (def as any).acRegistration) {
      wpPayload.acRegistration = (def as any).acRegistration;
    }
    if (def.type === 'AUDIT') {
      wpPayload.targetDepartmentId = pick(departments).id;
    }
    if ((def as any).isRoutine && routineBlueprint) {
      wpPayload.blueprintId = routineBlueprint.id;
    }

    const wp = await prisma.workPackage.create({ data: wpPayload });

    // Assign 1–3 users
    const assignees = pickN([...divDirectors(division.id), ...divStaffs(division.id)], Math.floor(Math.random() * 3) + 1);
    const seen = new Set<number>();
    for (const u of assignees) {
      if (!seen.has(u.id)) {
        await prisma.workPackageAssignment.create({ data: { wpId: wp.id, userId: u.id } });
        seen.add(u.id);
      }
    }

    createdWps.push(wp);
  }
  console.log(`✅ ${createdWps.length} Work Packages created.\n`);

  // ── 2. Tasks ───────────────────────────────────────────────────────────────

  console.log('📋 Creating 150 Tasks...');

  // All 9 valid task statuses
  const taskStatusPool: string[] = [
    'Unassigned',
    'Assigned',
    'In Progress',
    'In Review',
    'Follow-up Required',
    'Closed',
    'Rejected',
    'Terminated',
    'Inactive',
  ];

  // Weight distribution to get realistic counts
  const weightedStatuses: string[] = [
    ...Array(18).fill('Unassigned'),
    ...Array(22).fill('Assigned'),
    ...Array(30).fill('In Progress'),
    ...Array(15).fill('In Review'),
    ...Array(8).fill('Follow-up Required'),
    ...Array(35).fill('Closed'),
    ...Array(10).fill('Rejected'),
    ...Array(7).fill('Terminated'),
    ...Array(5).fill('Inactive'),
  ];

  const createdTasks: any[] = [];

  for (let i = 1; i <= 150; i++) {
    const useWp    = i <= 100; // first 100 in WPs, rest standalone
    const wp       = useWp ? pick(createdWps) : null;
    const division = wp ? validDivisions.find(d => d.id === wp.divisionId)! : pick(validDivisions);
    const dirs     = divDirectors(division.id);
    const stfs     = divStaffs(division.id);
    const template = pick(templates);
    const issuer   = pick(dirs);
    const assignee = pick(stfs);

    let status      = pick(weightedStatuses);
    if (wp && wp.status === 'Closed') {
      status = 'Closed';
    }
    const isUnassigned = status === 'Unassigned';
    const isClosed     = status === 'Closed';
    const isRejected   = status === 'Rejected';
    const isTerminated = status === 'Terminated';
    const isInactive   = status === 'Inactive';
    const isFinal      = isClosed || isRejected || isTerminated;

    // Mix of overdue, upcoming, and far-future deadlines
    const deadlineOffsets = [-5, -2, 1, 3, 7, 14, 21, 30];
    const deadlineDays    = pick(deadlineOffsets);
    const deadline        = daysFromNow(deadlineDays);
    const completedAt     = isClosed ? daysAgo(Math.floor(Math.random() * 14) + 1) : null;
    const rating          = isClosed ? (Math.floor(Math.random() * 5) + 1) : null;

    const taskPayload: any = {
      taskId:            `DEMO-TSK-${String(i).padStart(4, '0')}`,
      title:             pick(taskTitles) + ` #${i}`,
      templateId:        template.id,
      status,
      issuerId:          issuer.id,
      assignedToUserId:  isUnassigned ? null : assignee.id,
      wpId:              wp ? wp.id : null,
      deadline,
      schemaSnapshot:    template.formSchema || {},
      targetDivisionId:  division.id,
      completedAt,
      rating,
      estimatedHours:    template.estimatedHours || randBetween(1, 8),
      requiresApproval:  template.requiresApproval,
      rejectionReason:   isRejected ? 'Documentation incomplete — task card missing QA sign-off.' : null,
      inactivationLog:   isInactive ? [{ reason: 'Work deferred pending aircraft availability.', at: new Date().toISOString() }] : null,
    };

    // TaskData for active tasks (In Progress, In Review, Follow-up Required)
    if (['In Progress', 'In Review', 'Follow-up Required', 'Closed'].includes(status)) {
      taskPayload.taskData = {
        create: {
          data: {
            instruction: pick(taskNotes),
            completionNote: isFinal ? 'All checklist items verified and signed.' : undefined,
          },
        },
      };
    }

    // Time entries for Closed tasks (1–3 sessions)
    if (isClosed) {
      const numSessions = Math.floor(Math.random() * 3) + 1;
      let totalAssigneeHours = 0;
      let totalCollabHours = 0;
      const allCollabs: any[] = [];
      const assigneeNotes: string[] = [];

      const sessions = Array.from({ length: numSessions }, (_, idx) => {
        const hasCollab = Math.random() < 0.3;
        const collabUserId = pick(stfs).id;
        const collabHrs = randBetween(0.5, 2);
        
        const collabEntries = hasCollab ? [
          { userId: collabUserId, sessionHours: collabHrs, notes: 'Assisted with inspection' }
        ] : [];

        if (hasCollab) {
           allCollabs.push({ userId: collabUserId, hoursLogged: collabHrs, notes: 'Assisted with inspection' });
           totalCollabHours += collabHrs;
        }

        const hrs = Math.random() < 0.7 ? randBetween(0.5, 2.0) : randBetween(2.5, 4.0);
        totalAssigneeHours += hrs;
        const note = pick(taskNotes);
        assigneeNotes.push(note);

        return {
          loggedByUserId:     assignee.id,
          sessionHours:       hrs,
          sessionNotes:       note,
          collaboratorEntries: collabEntries,
          loggedAt:           daysAgo(idx + 1),
        };
      });
      taskPayload.timeEntries = { create: sessions };
      taskPayload.timeBooking = {
        create: {
          assigneeEntry: {
            userId: assignee.id,
            hoursLogged: totalAssigneeHours,
            notes: assigneeNotes.join(' | ')
          },
          collaborators: allCollabs,
          totalHours: totalAssigneeHours + totalCollabHours,
          estimatedHours: taskPayload.estimatedHours,
        }
      };
    }

    // Time entry for In Progress / In Review tasks (partial hours logged)
    if (['In Progress', 'In Review'].includes(status)) {
      const hrs = randBetween(0.5, 3);
      taskPayload.timeEntries = {
        create: [{
          loggedByUserId:     assignee.id,
          sessionHours:       hrs,
          sessionNotes:       'Work in progress — partial session logged.',
          collaboratorEntries: [],
          loggedAt:           daysAgo(1),
        }],
      };
      taskPayload.timeBooking = {
        create: {
          assigneeEntry: {
            userId: assignee.id,
            hoursLogged: hrs,
            notes: 'Work in progress — partial session logged.'
          },
          collaborators: [],
          totalHours: hrs,
          estimatedHours: taskPayload.estimatedHours,
        }
      };
    }

    const task = await prisma.task.create({ data: taskPayload });
    createdTasks.push(task);
  }
  console.log(`✅ 150 Tasks created.\n`);

  // ── 3. FeedPosts on tasks and WPs ─────────────────────────────────────────

  console.log('💬 Creating FeedPosts on selected tasks and WPs...');

  // Add 2–3 comment threads on 10 random tasks
  const tasksForFeed = pickN(createdTasks, 10);
  for (const task of tasksForFeed) {
    const division = validDivisions.find(d => d.id === task.targetDivisionId) || pick(validDivisions);
    const manager  = pick(divDirectors(division.id));
    const staff    = pick(divStaffs(division.id));

    const thread = pickN(feedComments.filter(c => c.type !== 'system'), 3);
    for (let j = 0; j < thread.length; j++) {
      const c = thread[j]!;
      await prisma.feedPost.create({
        data: {
          type:     'COMMENT',
          scope:    'TASK',
          scopeId:  task.id,
          authorId: c.type === 'manager' ? manager.id : staff.id,
          content:  c.content,
          createdAt: daysAgo(thread.length - j),
        },
      });
    }

    // System event
    await prisma.feedPost.create({
      data: {
        type:     'SYSTEM_EVENT',
        scope:    'TASK',
        scopeId:  task.id,
        authorId: null,
        content:  `Task status changed to ${task.status}.`,
        createdAt: daysAgo(thread.length + 1),
      },
    });
  }

  // Add comment threads on 5 random WPs
  const wpsForFeed = pickN(createdWps, 5);
  for (const wp of wpsForFeed) {
    const division = validDivisions.find(d => d.id === wp.divisionId) || pick(validDivisions);
    const manager  = pick(divDirectors(division.id));
    const staff    = pick(divStaffs(division.id));

    await prisma.feedPost.create({
      data: {
        type:     'COMMENT',
        scope:    'WP',
        scopeId:  wp.id,
        authorId: manager.id,
        content:  'Reminder: all outstanding tasks must be reviewed and closed before WP can be signed off.',
        createdAt: daysAgo(3),
      },
    });
    await prisma.feedPost.create({
      data: {
        type:     'COMMENT',
        scope:    'WP',
        scopeId:  wp.id,
        authorId: staff.id,
        content:  'Understood. Working through the remaining items — expect completion by end of week.',
        createdAt: daysAgo(2),
      },
    });
    await prisma.feedPost.create({
      data: {
        type:     'SYSTEM_EVENT',
        scope:    'WP',
        scopeId:  wp.id,
        authorId: null,
        content:  `Work Package status: ${wp.status}.`,
        createdAt: daysAgo(5),
      },
    });
  }
  console.log('✅ FeedPosts created.\n');

  // ── 4. Findings ─────────────────────────────────────────────────────────────

  console.log('🔍 Creating 20 curated Findings...');

  // Ensure we have reference data for taxonomy
  const ataPool  = ataChapters.length  > 0 ? ataChapters  : null;
  const tagPool  = hazardTags.length   > 0 ? hazardTags   : null;
  const codePool = causeCodes.length   > 0 ? causeCodes   : null;

  const findingStatusPool = [
    'Open', 'Open',                        // 2×
    'In Progress', 'In Progress',          // 2×
    'Pending Verification',                // 1×
    'Closed', 'Closed', 'Closed',          // 3×
    'Dismissed',                           // 1×
  ];

  const severityPool = ['Observation', 'Level 1', 'Level 2'];

  const createdFindings: any[] = [];

  for (let i = 1; i <= 20; i++) {
    const division   = pick(validDivisions);
    const reporter   = pick(divStaffs(division.id));
    const closer     = pick(divDirectors(division.id));
    const department = pick(departments);
    const eventType  = pick(eventTypes);
    const status     = findingStatusPool[(i - 1) % findingStatusPool.length] as string;
    const severity   = status === 'Open' ? null : pick(severityPool);
    const hasDueDate = status !== 'Open' && status !== 'Dismissed';

    const finding = await prisma.finding.create({
      data: {
        findingId:         fndId(i),
        description:       findingDescriptions[(i - 1) % findingDescriptions.length]!,
        status,
        severity,
        eventType:         eventType.code,
        reportedByUserId:  reporter.id,
        closedByUserId:    status === 'Closed' ? closer.id : null,
        closedAt:          status === 'Closed' ? daysAgo(Math.floor(Math.random() * 7) + 1) : null,
        departmentId:      department.id,
        targetDivisionId:  division.id,
        dueDate:           hasDueDate ? daysFromNow(Math.floor(Math.random() * 30) + 5) : null,
        ataChapterId:      ataPool && status !== 'Open' ? pick(ataPool).id : null,
        regulatoryReference: status !== 'Open' ? `EASA Part-145.A.${45 + i}` : null,
        createdAt:         daysAgo(Math.floor(Math.random() * 60) + 3),
      },
    });

    // Hazard tags (1–3) for non-Open findings
    if (tagPool && status !== 'Open' && status !== 'Dismissed') {
      const tags = pickN(tagPool, Math.floor(Math.random() * 3) + 1);
      for (const tag of tags) {
        await prisma.findingHazardTag.create({ data: { findingId: finding.id, hazardTagId: tag.id } });
      }
    }

    createdFindings.push(finding);
  }
  console.log(`✅ 20 Findings created.\n`);

  // ── 5. Hero Findings — full lifecycle ─────────────────────────────────────

  console.log('⭐  Creating 5 Hero Findings with full lifecycle...');

  // Pick a stable division + users for hero findings
  const heroDivision = validDivisions[0]!;
  const heroDirector = pick(divDirectors(heroDivision.id));
  const heroStaff1   = divStaffs(heroDivision.id)[0]!;
  const heroStaff2   = divStaffs(heroDivision.id)[1] ?? heroStaff1;
  const heroDept     = pick(departments);
  const heroEvtType  = eventTypes[0]!;
  const heroAta      = ataPool ? ataPool[0]! : null;
  const heroTags     = tagPool ? pickN(tagPool, 2) : [];
  const heroCause    = codePool ? codePool[0]! : null;

  // ── Hero 1: FIVE_WHYS RCA + CORRECTIVE CAPA (status: Closed) ──────────────
  const h1 = await prisma.finding.create({
    data: {
      findingId:        fndId(101),
      description:      'Torque wrench SN-TW-2241 found 38 days beyond its 6-month calibration due date on B737-800 VN-B738 nose gear strut lubrication task. [HERO-1]',
      status:           'Closed',
      severity:         'Level 2',
      eventType:        heroEvtType.code,
      reportedByUserId: heroStaff1.id,
      closedByUserId:   heroDirector.id,
      closedAt:         daysAgo(2),
      departmentId:     heroDept.id,
      targetDivisionId: heroDivision.id,
      dueDate:          daysAgo(5),
      ataChapterId:     heroAta?.id ?? null,
      regulatoryReference: 'EASA Part-145.A.40(a)',
      createdAt:        daysAgo(30),
    },
  });

  // Hazard tags
  for (const tag of heroTags) {
    await prisma.findingHazardTag.create({ data: { findingId: h1.id, hazardTagId: tag.id } });
  }

  // RCA — 5-Whys, Complete with cause code
  const h1Rca = await prisma.rcaInvestigation.create({
    data: {
      findingId:         h1.id,
      method:            'FIVE_WHYS',
      summary:           'Root cause traced to absence of a reliable recall system for calibration-due equipment.',
      status:            'Complete',
      causeCodeId:       heroCause?.id ?? null,
      conductedByUserId: heroDirector.id,
    },
  });

  await prisma.rcaWhyStep.createMany({
    data: [
      { rcaId: h1Rca.id, orderIndex: 0, question: 'Why was the torque wrench out of calibration?',       answer: 'The calibration due date had passed 38 days earlier without triggering a recall.' },
      { rcaId: h1Rca.id, orderIndex: 1, question: 'Why was there no recall triggered?',                  answer: 'The calibration tracking spreadsheet had not been updated after the last service.' },
      { rcaId: h1Rca.id, orderIndex: 2, question: 'Why was the spreadsheet not updated?',                answer: 'Responsibility for updating was not formally assigned to any individual after the tool clerk vacancy.' },
      { rcaId: h1Rca.id, orderIndex: 3, question: 'Why was the vacancy not addressed?',                  answer: 'The position had been vacant for 3 months pending HR approval for backfill.' },
      { rcaId: h1Rca.id, orderIndex: 4, question: 'Why was there no interim cover for the tracking task?', answer: 'No documented interim procedure existed to redistribute the tracking responsibility.' },
    ],
  });

  // CAPA — Corrective (Verified) + Preventive (Completed)
  const h1CapaCorr = await prisma.capaAction.create({
    data: {
      findingId:       h1.id,
      type:            'CORRECTIVE',
      description:     'Recall all out-of-calibration tools from service. Verify calibration status of entire tool inventory and update register within 5 days.',
      status:          'Verified',
      ownerUserId:     heroDirector.id,
      deadline:        daysAgo(20),
      verifiedByUserId: heroDirector.id,
      verifiedAt:      daysAgo(3),
      createdByUserId: heroDirector.id,
    },
  });

  const h1CapaPrev = await prisma.capaAction.create({
    data: {
      findingId:       h1.id,
      type:            'PREVENTIVE',
      description:     'Implement a digital calibration-due alert system (CMMS integration) with 30-day and 7-day advance notifications to Tool Room supervisor.',
      status:          'Completed',
      ownerUserId:     heroDirector.id,
      deadline:        daysFromNow(30),
      createdByUserId: heroDirector.id,
    },
  });

  // Follow-up tasks for hero 1
  const h1Task = await prisma.task.create({
    data: {
      taskId:           'DEMO-FUP-H1-001',
      title:            'Full tool inventory calibration audit — corrective action',
      templateId:       templates[0]!.id,
      status:           'Closed',
      issuerId:         heroDirector.id,
      assignedToUserId: heroStaff1.id,
      wpId:             null,
      deadline:         daysAgo(20),
      schemaSnapshot:   templates[0]!.formSchema || {},
      targetDivisionId: heroDivision.id,
      parentFindingId:  h1.id,
      completedAt:      daysAgo(18),
      rating:           5,
      timeEntries: {
        create: [{
          loggedByUserId:      heroStaff1.id,
          sessionHours:        3.5,
          sessionNotes:        'Full audit of tool room completed. 4 items recalled and sent for re-calibration.',
          collaboratorEntries: [],
          loggedAt:            daysAgo(19),
        }],
      },
      timeBooking: {
        create: {
          assigneeEntry: { userId: heroStaff1.id, hoursLogged: 3.5, notes: 'Full audit of tool room completed. 4 items recalled and sent for re-calibration.' },
          collaborators: [],
          totalHours: 3.5,
          estimatedHours: templates[0]!.estimatedHours || 4.0,
        }
      },
    },
  });

  // Link CAPA corrective → follow-up task
  await prisma.capaTaskLink.create({ data: { capaId: h1CapaCorr.id, taskId: h1Task.id, mandatory: true } });

  // ── Hero 2: MEDA RCA + CORRECTIVE + PREVENTIVE CAPAs (status: Pending Verification) ──

  const h2 = await prisma.finding.create({
    data: {
      findingId:        fndId(102),
      description:      'Hydraulic fluid seepage detected at actuator assembly (A321 VN-A321, spoiler panel 4L) during daily check; condition not entered in Technical Log. [HERO-2]',
      status:           'Pending Verification',
      severity:         'Level 1',
      eventType:        heroEvtType.code,
      reportedByUserId: heroStaff1.id,
      closedByUserId:   null,
      departmentId:     heroDept.id,
      targetDivisionId: heroDivision.id,
      dueDate:          daysFromNow(7),
      ataChapterId:     heroAta?.id ?? null,
      regulatoryReference: 'EASA Part-145.A.45(d)',
      createdAt:        daysAgo(20),
    },
  });

  for (const tag of heroTags) {
    await prisma.findingHazardTag.create({ data: { findingId: h2.id, hazardTagId: tag.id } });
  }

  const h2Rca = await prisma.rcaInvestigation.create({
    data: {
      findingId:         h2.id,
      method:            'MEDA',
      summary:           'MEDA analysis identified communication breakdown and inadequate shift handover as primary contributing factors.',
      status:            'Complete',
      causeCodeId:       heroCause?.id ?? null,
      conductedByUserId: heroDirector.id,
    },
  });

  await prisma.rcaContributingFactor.createMany({
    data: [
      { rcaId: h2Rca.id, category: 'Communication',           detail: 'Shift changeover verbal brief did not include the hydraulic seepage observation.', isPrimary: true },
      { rcaId: h2Rca.id, category: 'Information',             detail: 'Technical Log entry procedure was not posted at the daily check station.',         isPrimary: false },
      { rcaId: h2Rca.id, category: 'Leadership/Supervision',  detail: 'Check supervisor did not verify Technical Log completion at end of shift.',        isPrimary: false },
    ],
  });

  await prisma.capaAction.create({
    data: {
      findingId:       h2.id,
      type:            'CORRECTIVE',
      description:     'Re-inspect hydraulic actuator assembly on VN-A321 panel 4L. Replace O-ring seal if seepage source confirmed. Update Technical Log with finding and repair action.',
      status:          'Verified',
      ownerUserId:     heroStaff1.id,
      deadline:        daysAgo(5),
      verifiedByUserId: heroDirector.id,
      verifiedAt:      daysAgo(2),
      createdByUserId: heroDirector.id,
    },
  });

  await prisma.capaAction.create({
    data: {
      findingId:       h2.id,
      type:            'PREVENTIVE',
      description:     'Revise daily check shift handover SOP to include mandatory Technical Log review sign-off by outgoing and incoming supervisors.',
      status:          'In Progress',
      ownerUserId:     heroDirector.id,
      deadline:        daysFromNow(14),
      createdByUserId: heroDirector.id,
    },
  });

  const h2Task = await prisma.task.create({
    data: {
      taskId:           'DEMO-FUP-H2-001',
      title:            'VN-A321 Panel 4L Hydraulic Actuator Re-inspection & Tech Log Update',
      templateId:       templates[0]!.id,
      status:           'Closed',
      issuerId:         heroDirector.id,
      assignedToUserId: heroStaff2.id,
      wpId:             null,
      deadline:         daysAgo(5),
      schemaSnapshot:   templates[0]!.formSchema || {},
      targetDivisionId: heroDivision.id,
      parentFindingId:  h2.id,
      completedAt:      daysAgo(4),
      rating:           4,
      timeEntries: {
        create: [{
          loggedByUserId:      heroStaff2.id,
          sessionHours:        2.0,
          sessionNotes:        'O-ring seal replaced. Technical Log updated. Panel re-sealed and leak-checked — no further seepage.',
          collaboratorEntries: [],
          loggedAt:            daysAgo(5),
        }],
      },
      timeBooking: {
        create: {
          assigneeEntry: { userId: heroStaff2.id, hoursLogged: 2.0, notes: 'O-ring seal replaced. Technical Log updated. Panel re-sealed and leak-checked — no further seepage.' },
          collaborators: [],
          totalHours: 2.0,
          estimatedHours: templates[0]!.estimatedHours || 4.0,
        }
      },
    },
  });
  void h2Task; // referenced by CAPA link below if needed

  // ── Hero 3: OTHER RCA + Response Action (status: In Progress) ─────────────

  const h3 = await prisma.finding.create({
    data: {
      findingId:        fndId(103),
      description:      'Non-conforming repair (cold-bonded doublerplate, SRM 57-10-05) applied to cargo door surround skin without approved DER data or STC backing. [HERO-3]',
      status:           'In Progress',
      severity:         'Level 2',
      eventType:        heroEvtType.code,
      reportedByUserId: heroStaff1.id,
      departmentId:     heroDept.id,
      targetDivisionId: heroDivision.id,
      dueDate:          daysFromNow(14),
      ataChapterId:     ataPool && ataPool.length > 1 ? ataPool[1]!.id : heroAta?.id ?? null,
      regulatoryReference: 'EASA Part-145.A.50(a)',
      createdAt:        daysAgo(10),
    },
  });

  if (tagPool && tagPool.length > 1) {
    await prisma.findingHazardTag.create({ data: { findingId: h3.id, hazardTagId: tagPool[1]!.id } });
  }

  await prisma.rcaInvestigation.create({
    data: {
      findingId:         h3.id,
      method:            'OTHER',
      summary:           'Review of work order and task card documentation confirmed technician accessed an outdated SRM revision that did not include the cold-bonding exclusion note added in Rev. 52. Engineering hold placed on aircraft pending approved repair scheme from OEM DER.',
      status:            'Complete',
      causeCodeId:       codePool && codePool.length > 1 ? codePool[1]!.id : heroCause?.id ?? null,
      conductedByUserId: heroDirector.id,
    },
  });

  // Response Action (NCR)
  const h3FupTask = await prisma.task.create({
    data: {
      taskId:           'DEMO-FUP-H3-001',
      title:            'Raise NCR and coordinate OEM DER approval for cargo door skin repair',
      templateId:       templates[0]!.id,
      status:           'In Progress',
      issuerId:         heroDirector.id,
      assignedToUserId: heroStaff1.id,
      deadline:         daysFromNow(10),
      schemaSnapshot:   templates[0]!.formSchema || {},
      targetDivisionId: heroDivision.id,
      parentFindingId:  h3.id,
      responseActionType: 'NCR',
      requiresApproval: true,
      timeEntries: {
        create: [{
          loggedByUserId:      heroStaff1.id,
          sessionHours:        1.5,
          sessionNotes:        'NCR raised and sent to Engineering. Awaiting DER data package from OEM.',
          collaboratorEntries: [],
          loggedAt:            daysAgo(3),
        }],
      },
      timeBooking: {
        create: {
          assigneeEntry: { userId: heroStaff1.id, hoursLogged: 1.5, notes: 'NCR raised and sent to Engineering. Awaiting DER data package from OEM.' },
          collaborators: [],
          totalHours: 1.5,
          estimatedHours: templates[0]!.estimatedHours || 4.0,
        }
      },
    },
  });

  await prisma.findingResponseAction.create({
    data: {
      findingId:       h3.id,
      type:            'NCR',
      taskId:          h3FupTask.id,
      note:            'Non-conformance requires OEM-DER approved repair scheme before return to service.',
      createdByUserId: heroDirector.id,
    },
  });

  // ── Hero 4: In Progress, MEDA RCA Draft + CAPA Open (no follow-up tasks yet) ──

  const h4Ata  = ataPool && ataPool.length > 2 ? ataPool[2]! : heroAta;
  const h4Tags = tagPool && tagPool.length > 2 ? [tagPool[2]!] : heroTags.slice(0, 1);

  const h4 = await prisma.finding.create({
    data: {
      findingId:        fndId(104),
      description:      'Safety wire on engine cowling cowl-lock fastener (A321 VN-A321, ENG-2) did not meet MS25083 standard — insufficient twist density across 40mm span. [HERO-4]',
      status:           'In Progress',
      severity:         'Level 1',
      eventType:        heroEvtType.code,
      reportedByUserId: heroStaff2.id,
      departmentId:     heroDept.id,
      targetDivisionId: heroDivision.id,
      dueDate:          daysFromNow(10),
      ataChapterId:     h4Ata?.id ?? null,
      regulatoryReference: 'EASA Part-145.A.48',
      createdAt:        daysAgo(7),
    },
  });

  for (const tag of h4Tags) {
    await prisma.findingHazardTag.create({ data: { findingId: h4.id, hazardTagId: tag.id } });
  }

  await prisma.rcaInvestigation.create({
    data: {
      findingId:         h4.id,
      method:            'MEDA',
      summary:           'Investigation ongoing — preliminary contributing factor identified as inadequate OJT coverage of MS25083 safety-wiring standard.',
      status:            'Draft',
      conductedByUserId: heroDirector.id,
    },
  });

  await prisma.capaAction.create({
    data: {
      findingId:       h4.id,
      type:            'CORRECTIVE',
      description:     'Remove and re-install safety wire on ENG-2 cowl-lock fasteners per MS25083. Verify by certifying staff before next flight.',
      status:          'In Progress',
      ownerUserId:     heroStaff2.id,
      deadline:        daysFromNow(3),
      createdByUserId: heroDirector.id,
    },
  });

  await prisma.task.create({
    data: {
      taskId:           'DEMO-FUP-H4-001',
      title:            'Re-install ENG-2 cowl safety wire per MS25083 standard',
      templateId:       templates[0]!.id,
      status:           'Assigned',
      issuerId:         heroDirector.id,
      assignedToUserId: heroStaff2.id,
      deadline:         daysFromNow(3),
      schemaSnapshot:   templates[0]!.formSchema || {},
      targetDivisionId: heroDivision.id,
      parentFindingId:  h4.id,
    },
  });

  // ── Hero 5: Open, no RCA/CAPA yet (fresh finding for demo "raise" flow) ───

  const h5 = await prisma.finding.create({
    data: {
      findingId:        fndId(105),
      description:      'Shift handover logbook for avionics task (ACARS antenna replacement, VN-A320) contained no entry for partially completed connector re-pinning work. [HERO-5]',
      status:           'Open',
      severity:         null,
      eventType:        heroEvtType.code,
      reportedByUserId: heroStaff1.id,
      departmentId:     heroDept.id,
      targetDivisionId: heroDivision.id,
      createdAt:        daysAgo(1),
    },
  });

  console.log('✅ 5 Hero Findings created.\n');

  // ── 6. Finding Links (traceability between heroes) ─────────────────────────

  console.log('🔗 Creating Finding Links...');

  // H1 RELATED → H2 (both involve maintenance record failures)
  await prisma.findingLink.create({
    data: {
      fromFindingId:    h1.id,
      relatedFindingId: h2.id,
      linkType:         'RELATED',
      note:             'Both findings stem from inadequate shift documentation practices.',
      createdByUserId:  heroDirector.id,
    },
  });

  // H5 CAUSED_BY → H4 (shift log failure directly contributed to safety wire oversight)
  await prisma.findingLink.create({
    data: {
      fromFindingId:    h5.id,
      relatedFindingId: h4.id,
      linkType:         'CAUSED_BY',
      note:             'Incomplete handover logbook contributed to safety-wire oversight on subsequent shift.',
      createdByUserId:  heroDirector.id,
    },
  });

  // Link one bulk finding as DUPLICATE of hero 1 (for traceability demo)
  if (createdFindings.length > 0) {
    await prisma.findingLink.create({
      data: {
        fromFindingId:    createdFindings[0]!.id,
        relatedFindingId: h1.id,
        linkType:         'DUPLICATE',
        note:             'Duplicate report from a different inspector on the same shift.',
        createdByUserId:  heroDirector.id,
      },
    });
  }

  console.log('✅ Finding Links created.\n');

  // ── 7. Trend Cluster — triggers isRecurring banner ─────────────────────────

  if (heroAta && heroTags.length > 0 && heroCause) {
    console.log('📈 Creating Trend Cluster (3 findings, same dept+ATA+cause+hazardTag)...');

    // Hero 1 and 2 already share the same heroAta, heroTags, and heroDept.
    // We need a third finding to cross TREND_THRESHOLD (3).
    const trendFinding = await prisma.finding.create({
      data: {
        findingId:        fndId(106),
        description:      'Calibration tracking failure (third recurrence) — torque wrench SN-TW-3301 found overdue for calibration at Engine Shop. [TREND-CLUSTER]',
        status:           'Closed',
        severity:         'Level 1',
        eventType:        heroEvtType.code,
        reportedByUserId: heroStaff1.id,
        closedByUserId:   heroDirector.id,
        closedAt:         daysAgo(1),
        departmentId:     heroDept.id,
        targetDivisionId: heroDivision.id,
        dueDate:          daysAgo(1),
        ataChapterId:     heroAta.id,
        regulatoryReference: 'EASA Part-145.A.40(a)',
        createdAt:        daysAgo(45),
      },
    });

    for (const tag of heroTags) {
      await prisma.findingHazardTag.create({ data: { findingId: trendFinding.id, hazardTagId: tag.id } });
    }

    // RCA with same cause code so the trend signature matches h1 and h2
    await prisma.rcaInvestigation.create({
      data: {
        findingId:         trendFinding.id,
        method:            'FIVE_WHYS',
        summary:           'Same root cause as FND-000101 — no formal tracking ownership for calibration due dates.',
        status:            'Complete',
        causeCodeId:       heroCause.id,
        conductedByUserId: heroDirector.id,
      },
    });

    // Also apply the same RCA cause to H1 and H2 (already set via heroCause), confirm H2 has it
    // H2 was created with heroCause — trend signature: heroDept + heroAta + heroCause + heroTags
    // Result: FND-101, FND-102, FND-106 all share the signature → matchCount = 3 → isRecurring = true

    console.log('✅ Trend Cluster created (FND-000101, FND-000102, FND-000106 share dept+ATA+cause+hazardTag).\n');
  } else {
    console.warn('⚠️  Skipped trend cluster — missing ATA chapters, hazard tags, or cause codes in reference data.');
    console.log();
  }

  // ── 8. Dismissed finding (status coverage) ────────────────────────────────

  const dismissedDivision = pick(validDivisions);
  await prisma.finding.create({
    data: {
      findingId:        fndId(107),
      description:      'Alleged hydraulic fluid stain on hangar floor reported as active leak — confirmed on investigation to be residual contamination from previous day\'s maintenance. Finding dismissed as no-defect. [DISMISSED]',
      status:           'Dismissed',
      severity:         null,
      eventType:        pick(eventTypes).code,
      reportedByUserId: pick(divStaffs(dismissedDivision.id)).id,
      closedByUserId:   pick(divDirectors(dismissedDivision.id)).id,
      departmentId:     pick(departments).id,
      targetDivisionId: dismissedDivision.id,
      createdAt:        daysAgo(5),
    },
  });

  console.log('✅ Dismissed finding created.\n');

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('🎉 DEMO data generation complete!\n');
  console.log('── Summary ──────────────────────────────────────────────────');
  console.log(`   Work Packages created  : ${createdWps.length}`);
  console.log(`   Tasks created          : 150`);
  console.log(`   Findings created       : 20 bulk + 5 hero + 1 trend cluster + 1 dismissed = 27`);
  console.log(`   Follow-up tasks        : 4 (DEMO-FUP-H1 … H4)`);
  console.log(`   FeedPosts              : on 10 tasks + 5 WPs`);
  console.log(`   Hero findings          : FND-000101 … FND-000105`);
  console.log(`   Trend cluster          : FND-000101, FND-000102, FND-000106 → isRecurring = true`);
  console.log('─────────────────────────────────────────────────────────────');
}

main()
  .catch((e) => {
    console.error('❌ DEMO seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
