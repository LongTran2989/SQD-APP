import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomDate(start: Date, end: Date) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

const wpNames = [
  "A321 Annual Base Maintenance Audit",
  "Line Station Routine Surveillance - HAN",
  "Component Shop 145 Compliance Check",
  "Engine Borescope Inspection QA Review",
  "Avionics Modification Oversight",
  "NDT Recertification Audit",
  "Cabin Interior Refurbishment Quality Check",
  "Ramp Safety & FOD Prevention Audit",
  "Line Maintenance Night Shift Surveillance",
  "Landing Gear Overhaul Process Audit",
  "Sheet Metal Repair Quality Inspection",
  "A350 C-Check Compliance Review",
  "Store & Logistics Material Control Audit",
  "Aircraft Painting Process Verification",
  "Oxygen System Servicing Oversight"
];

const taskTitles = [
  "Review Work Order Documentation",
  "Inspect Landing Gear Trunnion Link",
  "Verify Calibration of Torque Wrenches",
  "Audit Personnel Training Records",
  "Check AD/SB Compliance Status",
  "Observe Engine Run-up Procedures",
  "Inspect Cargo Door Locking Mechanism",
  "Verify Standard Wiring Practices (SWPM)",
  "Audit Tool Room Inventory",
  "Check Minimum Equipment List (MEL) Dispatch",
  "Verify Component Release Certificates (Form 1)",
  "Observe Aircraft Jacking Procedure",
  "Inspect Flight Control Cable Tension",
  "Review NDT Ultrasonic Test Results",
  "Check Emergency Equipment Expiry Dates"
];

const findingDescriptions = [
  "Torque wrench found out of calibration date during line maintenance.",
  "Maintenance manual revision was outdated at the workstation.",
  "Technician did not wear proper PPE during chemical handling.",
  "Safety wire installation on engine cowling did not meet standard practices.",
  "Missing sign-off on step 4 of the landing gear lubrication task card.",
  "FOD (Foreign Object Debris) found near the aircraft parking bay.",
  "Hydraulic fluid leak observed near the actuator assembly, not reported.",
  "Component shelf life expired in the quarantine store.",
  "Unapproved tools found in the technician's personal toolbox.",
  "Defect deferral (ADD) limits exceeded without proper extension approval.",
  "Emergency exit light battery found discharged during cabin inspection.",
  "Incomplete shift handover logbook entry for unfinished avionics task.",
  "Scaffolding used for tail inspection lacked valid safety inspection tags.",
  "Improper storage of flammable materials in the paint shop.",
  "Tyre pressure gauge used for servicing was not listed in the tool register."
];

async function main() {
  console.log('🧹 Safely cleaning up mock data...');
  
  // Safely delete tasks that match our mock ID format
  await prisma.task.deleteMany({
    where: {
      OR: [
        { taskId: { startsWith: 'MASS-TSK' } },
        { taskId: { startsWith: 'AMO-TSK' } }
      ]
    }
  });

  // Safely delete WPs that match our mock ID format
  await prisma.workPackage.deleteMany({
    where: {
      OR: [
        { wpId: { startsWith: 'MASS-WP' } },
        { wpId: { startsWith: 'AMO-WP' } }
      ]
    }
  });

  // Safely delete old findings
  await prisma.finding.deleteMany({
    where: { description: { endsWith: '[MOCK]' } }
  });
  // One-time cleanup for the old generated findings that didn't have the suffix
  await prisma.finding.deleteMany({
    where: { description: { startsWith: 'Mass Mock Finding' } }
  });
  await prisma.finding.deleteMany({
    where: { description: { in: findingDescriptions } }
  });

  console.log('🌱 Starting refined aviation mock data generation...');

  const users = await prisma.user.findMany({ include: { role: true } });
  const directors = users.filter(u => u.role.name === 'Director' || u.role.name === 'Manager');
  const staffs = users.filter(u => u.role.name === 'Staff');
  const divisions = await prisma.division.findMany();
  const departments = await prisma.department.findMany();
  const templates = await prisma.template.findMany({ where: { status: 'Published' } });
  const eventTypes = await prisma.eventType.findMany();
  
  if (!directors.length || !staffs.length || !divisions.length || !templates.length || !departments.length || !eventTypes.length) {
    console.error('Missing required base data. Please run main seed first.');
    return;
  }

  // Ensure RBAC by only selecting divisions that have users capable of being issuers and assignees
  const validDivisions = divisions.filter(div => 
    directors.some(d => d.divisionId === div.id) && 
    staffs.some(s => s.divisionId === div.id)
  );

  if (!validDivisions.length) {
    console.error('No divisions have both a director/manager and a staff. Cannot satisfy RBAC.');
    return;
  }

  const wpStatuses = ['Open', 'In Progress', 'Closed', 'Inactive'];
  const wpTypes = ['CHECK', 'AUDIT', 'SURVEILLANCE', 'INVESTIGATION', 'OTHER'];
  
  const createdWps: any[] = [];
  console.log('Creating 90 Work Packages with Assignments...');
  for (let i = 1; i <= 90; i++) {
    const status = randomChoice(wpStatuses);
    const division = randomChoice(validDivisions);
    const divisionDirectors = directors.filter(d => d.divisionId === division.id);
    const divisionStaffs = staffs.filter(s => s.divisionId === division.id);
    
    const creator = randomChoice(divisionDirectors);
    const type = randomChoice(wpTypes);
    const timeFrom = randomDate(new Date(2025, 0, 1), new Date());
    const timeTo = new Date(timeFrom.getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000);
    
    const wp = await prisma.workPackage.create({
      data: {
        wpId: `AMO-WP-${Date.now()}-${i}`,
        name: randomChoice(wpNames) + ` - Vol ${i}`,
        type,
        divisionId: division.id,
        timeframeFrom: timeFrom,
        timeframeTo: timeTo,
        creatorId: creator.id,
        targetDepartmentId: type === 'AUDIT' ? randomChoice(departments).id : null,
        status,
        closedAt: status === 'Closed' ? new Date() : null,
      }
    });

    // Create assignments for WP
    const numAssignees = Math.floor(Math.random() * 3) + 1;
    const assignedUsers = new Set<number>();
    for(let a = 0; a < numAssignees; a++) {
      const user = randomChoice([...divisionDirectors, ...divisionStaffs]);
      if(!assignedUsers.has(user.id)) {
        await prisma.workPackageAssignment.create({
          data: {
            wpId: wp.id,
            userId: user.id
          }
        });
        assignedUsers.add(user.id);
      }
    }

    createdWps.push(wp);
  }

  console.log('Creating 300 Tasks inside WPs and 150 standalone Tasks...');
  // Using 'Closed' status correctly
  const taskStatuses = ['Unassigned', 'Assigned', 'InProgress', 'Review', 'Closed', 'Rejected'];
  
  const createTasks = async (count: number, isWp: boolean) => {
    for (let i = 1; i <= count; i++) {
      const wp = isWp ? randomChoice(createdWps) : null;
      // RBAC strictly enforced: Issuer and Assignee must match task's target division.
      const division = wp ? validDivisions.find(d => d.id === wp.divisionId)! : randomChoice(validDivisions);
      
      const divisionDirectors = directors.filter(d => d.divisionId === division.id);
      const divisionStaffs = staffs.filter(s => s.divisionId === division.id);

      const template = randomChoice(templates);
      const issuer = randomChoice(divisionDirectors);
      const assignee = randomChoice(divisionStaffs);
      
      let status = randomChoice(taskStatuses);
      
      const isUnassigned = status === 'Unassigned';
      const isClosed = status === 'Closed';
      const completedAt = isClosed ? new Date() : null;
      const rating = isClosed ? Math.floor(Math.random() * 5) + 1 : null;
      
      const data: any = {
        taskId: `AMO-TSK-${isWp ? 'WP' : 'SA'}-${Date.now()}-${i}`,
        title: randomChoice(taskTitles) + ` #${i}`,
        templateId: template.id,
        status,
        issuerId: issuer.id,
        assignedToUserId: isUnassigned ? null : assignee.id,
        wpId: wp ? wp.id : null,
        deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        schemaSnapshot: template.formSchema || {},
        targetDivisionId: division.id,
        completedAt,
        rating,
      };

      if (isClosed) {
        data.timeEntries = {
          create: [
            {
              loggedByUserId: assignee.id,
              sessionHours: Math.round((Math.random() * 4 + 1) * 10) / 10,
              sessionNotes: 'Completed maintenance compliance checks',
              collaboratorEntries: [],
              loggedAt: new Date(),
            }
          ]
        };
      }

      await prisma.task.create({ data });
    }
  };

  await createTasks(300, true);
  await createTasks(150, false);

  console.log('Creating 60 Findings...');
  const findingStatuses = ['Open', 'In Progress', 'Pending Verification', 'Closed'];
  
  for (let i = 1; i <= 60; i++) {
    const status = randomChoice(findingStatuses);
    const division = randomChoice(validDivisions);
    const reporter = randomChoice(staffs.filter(s => s.divisionId === division.id));
    const closedBy = status === 'Closed' ? randomChoice(directors.filter(d => d.divisionId === division.id)) : null;
    const department = randomChoice(departments);
    const eventType = randomChoice(eventTypes);

    await prisma.finding.create({
      data: {
        description: randomChoice(findingDescriptions) + ' [MOCK]',
        status,
        eventType: eventType.code,
        reportedByUserId: reporter.id,
        closedByUserId: closedBy ? closedBy.id : null,
        closedAt: status === 'Closed' ? new Date() : null,
        departmentId: department.id,
        targetDivisionId: division.id,
        severity: randomChoice(['Observation', 'Level 1', 'Level 2'])
      }
    });
  }

  console.log('🎉 Refined Aviation mockup generation complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
