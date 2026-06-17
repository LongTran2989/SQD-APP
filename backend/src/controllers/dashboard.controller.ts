import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { hasPrivilege } from '../utils/privilegeAccess';
import { canActionFlag } from '../services/escalationService';

export const getSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;
    let metrics: any = {};

    if (role === 'Staff') {
      const myPendingTasks = await prisma.task.count({
        where: { assignedToUserId: userId, status: { notIn: ['Closed', 'Approved'] }, deletedAt: null }
      });
      const unassignedTasks = await prisma.task.count({
        where: { targetDivisionId: divisionId, status: 'Unassigned', deletedAt: null }
      });
      const allOpenFindings = await prisma.finding.count({
        where: { status: { notIn: ['Closed'] }, deletedAt: null }
      });
      metrics = { myPendingTasks, unassignedTasks, allOpenFindings };
      
    } else if (role === 'Manager') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday.getTime() + 86400000);

      const unassigned = await prisma.task.count({
        where: { targetDivisionId: divisionId, status: 'Unassigned', deletedAt: null }
      });
      const dueToday = await prisma.task.count({
        where: { targetDivisionId: divisionId, status: { notIn: ['Closed', 'Approved', 'Inactive', 'Terminated'] }, deadline: { gte: startOfToday, lt: endOfToday }, deletedAt: null }
      });
      const overdue = await prisma.task.count({
        where: { targetDivisionId: divisionId, status: { notIn: ['Closed', 'Approved', 'Inactive', 'Terminated'] }, deadline: { lt: startOfToday }, deletedAt: null }
      });
      const inReview = await prisma.task.count({
        where: { targetDivisionId: divisionId, status: 'In Review', deletedAt: null }
      });
      const pendingRating = await prisma.task.count({
        where: { targetDivisionId: divisionId, status: { in: ['Closed', 'Approved'] }, rating: null, deletedAt: null }
      });
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

      const openFindings = await prisma.finding.count({ where: { targetDivisionId: divisionId, status: 'Open', deletedAt: null } });
      const pendingVerification = await prisma.finding.count({ where: { targetDivisionId: divisionId, status: 'Pending Verification', deletedAt: null } });
      const inProgressFindings = await prisma.finding.count({ where: { targetDivisionId: divisionId, status: 'In Progress', deletedAt: null } });
      const findingsOverview = { open: openFindings, pendingVerification, inProgress: inProgressFindings };

      metrics = { divisionPendingTasks, escalations: escalationsCount, findingsOverview };
      
    } else if (role === 'Director' || role === 'Admin') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday.getTime() + 86400000);

      const unassigned = await prisma.task.count({
        where: { status: 'Unassigned', deletedAt: null }
      });
      const dueToday = await prisma.task.count({
        where: { status: { notIn: ['Closed', 'Approved', 'Inactive', 'Terminated'] }, deadline: { gte: startOfToday, lt: endOfToday }, deletedAt: null }
      });
      const overdue = await prisma.task.count({
        where: { status: { notIn: ['Closed', 'Approved', 'Inactive', 'Terminated'] }, deadline: { lt: startOfToday }, deletedAt: null }
      });
      const inReview = await prisma.task.count({
        where: { status: 'In Review', deletedAt: null }
      });
      const pendingRating = await prisma.task.count({
        where: { status: { in: ['Closed', 'Approved'] }, rating: null, deletedAt: null }
      });
      const systemPendingTasks = { unassigned, dueToday, overdue, inReview, pendingRating };
      
      let escalationsCount = 0;
      if (hasPrivilege(req.user!, 'escalation:review')) {
        escalationsCount = await prisma.escalationFlag.count({ where: { status: 'PENDING' } });
      }

      const openFindings = await prisma.finding.count({ where: { status: 'Open', deletedAt: null } });
      const pendingVerification = await prisma.finding.count({ where: { status: 'Pending Verification', deletedAt: null } });
      const inProgressFindings = await prisma.finding.count({ where: { status: 'In Progress', deletedAt: null } });
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
      const completedTasks = wp.tasks.filter(t => t.status === 'Closed' || t.status === 'Approved').length;
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

    const posts = await prisma.feedPost.findMany({
      where: feedWhere,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { author: { select: { name: true } } }
    });

    res.json(posts);
  } catch (error) {
    console.error('Error fetching dashboard feed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
