import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { hasPrivilege } from '../utils/privilegeAccess';
import { canActionFlag } from '../services/escalationService';

export const getSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;
    let metrics: any = {};

    if (role === 'Staff') {
      // Independent counts — run in parallel (one round trip wave, not three serial).
      const [myPendingTasks, unassignedTasks, allOpenFindings] = await Promise.all([
        prisma.task.count({
          where: { assignedToUserId: userId, status: { notIn: ['Closed'] }, deletedAt: null }
        }),
        prisma.task.count({
          where: { targetDivisionId: divisionId, status: 'Unassigned', deletedAt: null }
        }),
        prisma.finding.count({
          where: { status: { notIn: ['Closed'] }, deletedAt: null }
        }),
      ]);
      metrics = { myPendingTasks, unassignedTasks, allOpenFindings };
      
    } else if (role === 'Manager') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday.getTime() + 86400000);

      const [unassigned, dueToday, overdue, inReview, pendingRating] = await Promise.all([
        prisma.task.count({
          where: { targetDivisionId: divisionId, status: 'Unassigned', deletedAt: null }
        }),
        prisma.task.count({
          where: { targetDivisionId: divisionId, status: { notIn: ['Closed', 'Inactive', 'Terminated'] }, deadline: { gte: startOfToday, lt: endOfToday }, deletedAt: null }
        }),
        prisma.task.count({
          where: { targetDivisionId: divisionId, status: { notIn: ['Closed', 'Inactive', 'Terminated'] }, deadline: { lt: startOfToday }, deletedAt: null }
        }),
        prisma.task.count({
          where: { targetDivisionId: divisionId, status: 'In Review', deletedAt: null }
        }),
        prisma.task.count({
          where: { targetDivisionId: divisionId, status: { in: ['Closed'] }, rating: null, deletedAt: null }
        }),
      ]);
      const divisionPendingTasks = { unassigned, dueToday, overdue, inReview, pendingRating };
      
      let escalationsCount = 0;
      if (hasPrivilege(req.user!, 'escalation:review')) {
        const flags = await prisma.escalationFlag.findMany({
          where: { status: 'PENDING' },
          include: { cards: { where: { type: 'ESCALATION_CARD' }, select: { scope: true, scopeId: true } } }
        });
        
        const wpTargetIds = flags.filter((f) => f.targetScope === 'WP').map((f) => f.cards[0]?.scopeId).filter((id): id is number => typeof id === 'number');
        const wps = wpTargetIds.length ? await prisma.workPackage.findMany({ where: { id: { in: wpTargetIds }, deletedAt: null }, select: { id: true, divisionId: true } }) : [];
        const wpDiv = new Map(wps.map((w) => [w.id, w.divisionId]));

        escalationsCount = flags.filter((f) => {
          const card = f.cards[0];
          let flagDiv: number | null = null;
          if (f.targetScope === 'DIVISION') flagDiv = card?.scopeId ?? null;
          else if (f.targetScope === 'WP') flagDiv = card ? wpDiv.get(card.scopeId as number) ?? null : null;
          return canActionFlag({ role, divisionId, permissions: req.user!.permissions }, { targetScope: f.targetScope, divisionId: flagDiv });
        }).length;
      }

      // Findings are organisation-wide transparent (no division filter), matching
      // the open Findings list/detail. Tasks + escalations above stay division-scoped.
      const [openFindings, pendingVerification, inProgressFindings] = await Promise.all([
        prisma.finding.count({ where: { status: 'Open', deletedAt: null } }),
        prisma.finding.count({ where: { status: 'Pending Verification', deletedAt: null } }),
        prisma.finding.count({ where: { status: 'In Progress', deletedAt: null } }),
      ]);
      const findingsOverview = { open: openFindings, pendingVerification, inProgress: inProgressFindings };

      metrics = { divisionPendingTasks, escalations: escalationsCount, findingsOverview };
      
    } else if (role === 'Director' || role === 'Admin' || role === 'Senior Advisor') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday.getTime() + 86400000);

      const [unassigned, dueToday, overdue, inReview, pendingRating] = await Promise.all([
        prisma.task.count({
          where: { status: 'Unassigned', deletedAt: null }
        }),
        prisma.task.count({
          where: { status: { notIn: ['Closed', 'Inactive', 'Terminated'] }, deadline: { gte: startOfToday, lt: endOfToday }, deletedAt: null }
        }),
        prisma.task.count({
          where: { status: { notIn: ['Closed', 'Inactive', 'Terminated'] }, deadline: { lt: startOfToday }, deletedAt: null }
        }),
        prisma.task.count({
          where: { status: 'In Review', deletedAt: null }
        }),
        prisma.task.count({
          where: { status: { in: ['Closed'] }, rating: null, deletedAt: null }
        }),
      ]);
      const systemPendingTasks = { unassigned, dueToday, overdue, inReview, pendingRating };
      
      let escalationsCount = 0;
      if (hasPrivilege(req.user!, 'escalation:review')) {
        escalationsCount = await prisma.escalationFlag.count({ where: { status: 'PENDING' } });
      }

      const [openFindings, pendingVerification, inProgressFindings] = await Promise.all([
        prisma.finding.count({ where: { status: 'Open', deletedAt: null } }),
        prisma.finding.count({ where: { status: 'Pending Verification', deletedAt: null } }),
        prisma.finding.count({ where: { status: 'In Progress', deletedAt: null } }),
      ]);
      const findingsOverview = { open: openFindings, pendingVerification, inProgress: inProgressFindings };

      metrics = { systemPendingTasks, escalations: escalationsCount, findingsOverview };
    }

    res.json(metrics);
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getWorkPackages = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;
    
    let where: any = { status: { notIn: ['Closed', 'Inactive'] }, deletedAt: null };
    
    if (role === 'Staff') {
      where.assignments = { some: { userId } };
    } else if (role === 'Manager') {
      where.divisionId = divisionId;
    }
    // Director/Admin sees all active WPs (no additional where filter needed)

    const wps = await prisma.workPackage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        tasks: {
          where: { deletedAt: null },
          select: { id: true, status: true }
        }
      }
    });

    const formattedWps = wps.map(wp => {
      const totalTasks = wp.tasks.length;
      const completedTasks = wp.tasks.filter(t => t.status === 'Closed').length;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      
      return {
        id: wp.id,
        wpId: wp.wpId,
        name: wp.name,
        type: wp.type,
        status: wp.status,
        progress,
        totalTasks,
        completedTasks,
        timeframeTo: wp.timeframeTo
      };
    });

    res.json(formattedWps);
  } catch (error) {
    console.error('Error fetching dashboard work packages:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;
    let feedWhere: any = {};

    if (role === 'Staff') {
      // Find tasks/findings assigned/reported by the user
      const myTasks = await prisma.task.findMany({ where: { assignedToUserId: userId, deletedAt: null }, select: { id: true } });
      const myFindings = await prisma.finding.findMany({ where: { reportedByUserId: userId, deletedAt: null }, select: { id: true } });
      
      const taskIds = myTasks.map(t => t.id);
      const findingIds = myFindings.map(f => f.id);
      
      feedWhere = {
        OR: [
          { scope: 'TASK', scopeId: { in: taskIds } },
          { scope: 'FINDING', scopeId: { in: findingIds } }
        ]
      };
    } else if (role === 'Manager') {
      // Division scope + tasks and findings
      const divisionTasks = await prisma.task.findMany({ where: { targetDivisionId: divisionId, deletedAt: null }, select: { id: true } });
      const divisionFindings = await prisma.finding.findMany({ where: { targetDivisionId: divisionId, deletedAt: null }, select: { id: true } });
      
      feedWhere = {
        OR: [
          { scope: 'DIVISION', scopeId: divisionId },
          { scope: 'ORG' },
          { scope: 'TASK', scopeId: { in: divisionTasks.map(t => t.id) } },
          { scope: 'FINDING', scopeId: { in: divisionFindings.map(f => f.id) } }
        ]
      };
    } else {
      // Director/Admin: Org scope + all tasks and findings
      feedWhere = {
        OR: [
          { scope: 'ORG' },
          { scope: 'DIVISION' },
          { scope: 'TASK' },
          { scope: 'FINDING' }
        ]
      };
    }

    // Exclude soft-hidden comments (M4) from the aggregate dashboard feed.
    const posts = await prisma.feedPost.findMany({
      where: { ...feedWhere, hiddenAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { author: { select: { name: true } } }
    });

    // Resolve human-readable scopeNames in a single batch per entity type
    const taskIds   = posts.filter(p => p.scope === 'TASK'     && p.scopeId != null).map(p => p.scopeId as number);
    const findingIds= posts.filter(p => p.scope === 'FINDING'  && p.scopeId != null).map(p => p.scopeId as number);
    const wpIds     = posts.filter(p => p.scope === 'WP'       && p.scopeId != null).map(p => p.scopeId as number);
    const divIds    = posts.filter(p => p.scope === 'DIVISION' && p.scopeId != null).map(p => p.scopeId as number);

    const [tasks, findings, wps, divisions] = await Promise.all([
      taskIds.length    ? prisma.task.findMany        ({ where: { id: { in: taskIds    } }, select: { id: true, taskId: true   } }) : [],
      findingIds.length ? prisma.finding.findMany     ({ where: { id: { in: findingIds } }, select: { id: true, findingId: true } }) : [],
      wpIds.length      ? prisma.workPackage.findMany ({ where: { id: { in: wpIds      } }, select: { id: true, wpId: true     } }) : [],
      divIds.length     ? prisma.division.findMany    ({ where: { id: { in: divIds     } }, select: { id: true, name: true     } }) : [],
    ]);

    const taskMap    = new Map(tasks.map(t    => [t.id, t.taskId   ]));
    // Prefer the human-readable Finding.findingId business code; fall back to the
    // numeric id for any legacy finding not yet backfilled (findingId is nullable).
    const findingMap = new Map(findings.map(f => [f.id, f.findingId ?? `#${f.id}`]));
    const wpMap      = new Map(wps.map(w      => [w.id, w.wpId     ]));
    const divMap     = new Map(divisions.map(d=> [d.id, d.name     ]));

    const enriched = posts.map(p => ({
      ...p,
      scopeName:
        p.scope === 'TASK'     && p.scopeId ? (taskMap.get(p.scopeId)    ?? null) :
        p.scope === 'FINDING'  && p.scopeId ? (findingMap.get(p.scopeId) ?? null) :
        p.scope === 'WP'       && p.scopeId ? (wpMap.get(p.scopeId)      ?? null) :
        p.scope === 'DIVISION' && p.scopeId ? (divMap.get(p.scopeId)     ?? null) :
        p.scope === 'ORG'                   ? 'Organisation' : null,
    }));

    res.json(enriched);
  } catch (error) {
    console.error('Error fetching dashboard feed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getOngoingWorks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;
    const statusFilter = req.query.status as string;

    // Build common where conditions
    let wpWhere: any = { deletedAt: null };
    let taskWhere: any = { wpId: null, deletedAt: null };

    if (role === 'Staff') {
      wpWhere.assignments = { some: { userId } };
      taskWhere.assignedToUserId = userId;
    } else if (role === 'Manager' || role === 'Group Leader') {
      wpWhere.divisionId = divisionId;
      taskWhere.targetDivisionId = divisionId;
    }

    wpWhere.status = { notIn: ['Closed', 'Inactive'] };
    taskWhere.status = { notIn: ['Closed', 'Inactive', 'Terminated'] };

    // Blueprints
    let bpWhere: any = { isActive: true, recurrenceType: { not: null } };
    if (role === 'Manager' || role === 'Group Leader' || role === 'Staff') {
      bpWhere.divisionId = divisionId;
    }

    const MAX_RESULTS = 200;

    const [wps, tasks, bps] = await Promise.all([
      prisma.workPackage.findMany({
        where: wpWhere,
        take: MAX_RESULTS,
        orderBy: { timeframeTo: 'asc' },
        include: {
          division: { select: { code: true } },
          tasks: { select: { _count: { select: { sourceFindings: { where: { deletedAt: null } } } } } }
        }
      }),
      prisma.task.findMany({
        where: taskWhere,
        take: MAX_RESULTS,
        orderBy: { deadline: 'asc' },
        include: {
          targetDivision: { select: { code: true } },
          assignedToUser: { select: { name: true } },
          template: { select: { type: true, title: true } },
          _count: { select: { sourceFindings: { where: { deletedAt: null } } } }
        }
      }),
      prisma.wpBlueprint.findMany({
        where: bpWhere,
        take: MAX_RESULTS,
        orderBy: { nextRunAt: 'asc' },
        include: {
          division: { select: { code: true } },
          _count: { select: { instances: true } }
        }
      })
    ]);

    const wpIds = wps.map(w => w.id);
    const taskIds = tasks.map(t => t.id);

    const [wpFeeds, taskFeeds] = await Promise.all([
      wpIds.length ? prisma.feedPost.findMany({
        where: { scope: 'WP', scopeId: { in: wpIds }, hiddenAt: null },
        orderBy: { createdAt: 'desc' },
        take: MAX_RESULTS,
        include: { author: { select: { name: true } } }
      }) : [],
      taskIds.length ? prisma.feedPost.findMany({
        where: { scope: 'TASK', scopeId: { in: taskIds }, hiddenAt: null },
        orderBy: { createdAt: 'desc' },
        take: MAX_RESULTS,
        include: { author: { select: { name: true } } }
      }) : []
    ]);

    const getFeeds = (scope: string, id: number) => {
      const feeds = scope === 'WP' ? wpFeeds.filter(f => f.scopeId === id) : taskFeeds.filter(f => f.scopeId === id);
      return feeds.slice(0, 5); // Return up to 5
    };

    const unified = [
      ...wps.map(wp => ({
        id: `wp-${wp.id}`,
        entityId: wp.id,
        link: `/dashboard/work-packages/${wp.id}`,
        type: 'WP',
        title: wp.name,
        itemType: wp.type,
        status: wp.status,
        assignee: '-',
        deadline: wp.timeframeTo,
        divisionAbbrev: wp.division?.code ?? '-',
        instructions: null,
        findingsCount: wp.tasks.reduce((sum, t) => sum + t._count.sourceFindings, 0),
        recentEvents: getFeeds('WP', wp.id),
        meta: {}
      })),
      ...tasks.map(t => ({
        id: `task-${t.id}`,
        entityId: t.id,
        link: `/dashboard/tasks/${t.id}`,
        type: 'TASK',
        title: t.title || t.template?.title || 'Task',
        itemType: t.template?.type ?? 'Task',
        status: t.status,
        assignee: t.assignedToUser?.name ?? 'Unassigned',
        deadline: t.deadline,
        divisionAbbrev: t.targetDivision?.code ?? '-',
        instructions: t.issuanceNote || null,
        findingsCount: t._count.sourceFindings,
        recentEvents: getFeeds('TASK', t.id),
        meta: {}
      })),
      ...bps.map(b => ({
        id: `blueprint-${b.id}`,
        entityId: b.id,
        link: `/dashboard/wp-blueprints`,
        type: 'BLUEPRINT',
        title: b.name,
        itemType: b.type,
        status: b.nextRunAt ? 'Scheduled' : 'Awaiting Completion',
        assignee: '-',
        deadline: b.nextRunAt,
        divisionAbbrev: b.division?.code ?? '-',
        instructions: b.description || null,
        findingsCount: 0,
        recentEvents: [],
        meta: {
          recurrenceType: b.recurrenceType,
          recurrenceInterval: b.recurrenceInterval,
          instancesLaunched: b._count.instances
        }
      }))
    ];

    unified.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });

    res.json(unified);
  } catch (err) {
    console.error('Error fetching ongoing works:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};
