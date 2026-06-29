import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { validateAutoGenConfig, AutoGenColumns, calendarDateUtc, fireAutoGenForWp } from '../services/autoGenService';
import { createWorkPackageService } from './wp.controller';

// WpBlueprint is config (not a Rule-2 soft-delete entity); "delete" = isActive=false,
// mirroring TemplateSet/WpType. Mutations write a lightweight AuditLog only (no
// TaskActivity — config changes are not task-scoped). Recurrence fields
// (recurrenceType/recurrenceInterval/recurrenceStartDate) drive the P7 nightly
// auto-launch cron; when set, nextRunAt is seeded to the start date.

const MAX_NAME_LEN = 200;
const MAX_TEXT_LEN = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Director/Admin manage blueprints in any division; others are own-division only.
function canManageDivision(req: Request, divisionId: number): boolean {
  const role = req.user!.role;
  if (role === 'Director' || role === 'Admin') return true;
  return req.user!.divisionId === divisionId;
}

const BLUEPRINT_INCLUDE = {
  division: { select: { id: true, name: true, code: true } },
  owner: { select: { id: true, name: true } },
  defaultAutoGenTemplate: { select: { id: true, templateId: true, title: true } },
  defaultAutoGenSet: { select: { id: true, name: true } },
  _count: { select: { instances: true } },
};

// Maps validated AutoGenColumns onto the blueprint's default* column names.
function toDefaultAutoGenColumns(c: AutoGenColumns) {
  return {
    defaultAutoGenerate: c.autoGenerate,
    defaultAutoGenMode: c.autoGenMode,
    defaultAutoGenInterval: c.autoGenInterval,
    defaultAutoGenTemplateId: c.autoGenTemplateId,
    defaultAutoGenSetId: c.autoGenSetId,
    defaultAutoGenInlineSet: c.autoGenInlineSet,
  };
}

// Validates the recurrence block and returns the columns to persist. recurrenceType
// absent/null clears the whole block (manual-launch-only). When set, all three of
// recurrenceType/recurrenceInterval/recurrenceStartDate are required together, and
// nextRunAt is seeded to the (UTC-normalized) start date so the cron picks it up.
export interface RecurrenceColumns {
  recurrenceType: string | null;
  recurrenceInterval: number | null;
  recurrenceStartDate: Date | null;
  nextRunAt: Date | null;
}
export function resolveRecurrence(input: {
  recurrenceType?: unknown; recurrenceInterval?: unknown; recurrenceStartDate?: unknown;
}): { error: string } | { data: RecurrenceColumns } {
  const rt = input.recurrenceType;
  if (rt == null || rt === '') {
    return { data: { recurrenceType: null, recurrenceInterval: null, recurrenceStartDate: null, nextRunAt: null } };
  }
  if (rt !== 'CALENDAR' && rt !== 'LAST_DONE') {
    return { error: "recurrenceType must be 'CALENDAR' or 'LAST_DONE'" };
  }
  const interval = typeof input.recurrenceInterval === 'number'
    ? input.recurrenceInterval
    : Number(input.recurrenceInterval);
  if (!Number.isInteger(interval) || interval < 1) {
    return { error: 'recurrenceInterval must be a positive integer (days) when recurrenceType is set' };
  }
  if (input.recurrenceStartDate == null || input.recurrenceStartDate === '') {
    return { error: 'recurrenceStartDate is required when recurrenceType is set' };
  }
  const start = new Date(input.recurrenceStartDate as string);
  if (Number.isNaN(start.getTime())) {
    return { error: 'recurrenceStartDate is not a valid date' };
  }
  const startUtc = calendarDateUtc(start);
  return { data: { recurrenceType: rt, recurrenceInterval: interval, recurrenceStartDate: startUtc, nextRunAt: startUtc } };
}

// Resolves the type-specific context columns to persist, validating
// targetDepartmentId for AUDIT. Returns an error string on failure.
async function resolveTypeFields(
  type: string,
  input: { acRegistration?: unknown; customer?: unknown; authority?: unknown; targetDepartmentId?: unknown }
): Promise<{ error: string } | { data: { acRegistration: string | null; customer: string | null; authority: string | null; targetDepartmentId: number | null } }> {
  const cleared = { acRegistration: null, customer: null, authority: null, targetDepartmentId: null };
  if (type === 'CHECK') {
    return {
      data: {
        ...cleared,
        acRegistration: typeof input.acRegistration === 'string' ? input.acRegistration : null,
        customer: typeof input.customer === 'string' ? input.customer : null,
        authority: typeof input.authority === 'string' ? input.authority : null,
      },
    };
  }
  if (type === 'AUDIT') {
    let deptId: number | null = null;
    if (input.targetDepartmentId != null) {
      const dept = await prisma.department.findFirst({ where: { id: Number(input.targetDepartmentId), deletedAt: null } });
      if (!dept) return { error: 'targetDepartmentId references a non-existent department' };
      deptId = dept.id;
    }
    return { data: { ...cleared, targetDepartmentId: deptId } };
  }
  return { data: cleared };
}

// ─── GET /api/wp-blueprints ─────────────────────────────────────────────────
export const listWpBlueprints = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Prisma.WpBlueprintWhereInput = {};
    if (req.query.activeOnly === 'true') where.isActive = true;
    if (req.query.divisionId) {
      const divId = parseInt(String(req.query.divisionId), 10);
      if (!Number.isNaN(divId)) where.divisionId = divId;
    }
    const blueprints = await prisma.wpBlueprint.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        division: { select: { id: true, name: true, code: true } },
        owner: { select: { id: true, name: true } },
        _count: { select: { instances: true } },
      },
    });
    res.json(blueprints);
  } catch (error) {
    console.error('Error listing WP blueprints:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/wp-blueprints/:id ─────────────────────────────────────────────
export const getWpBlueprintById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const bp = await prisma.wpBlueprint.findUnique({ where: { id }, include: BLUEPRINT_INCLUDE });
    if (!bp) {
      res.status(404).json({ message: 'Blueprint not found' });
      return;
    }
    res.json(bp);
  } catch (error) {
    console.error('Error fetching WP blueprint:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/wp-blueprints ────────────────────────────────────────────────
export const createWpBlueprint = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const {
      name, description, type, divisionId, defaultDuration,
      acRegistration, customer, authority, targetDepartmentId,
      defaultAutoGenerate, defaultAutoGenMode, defaultAutoGenInterval,
      defaultAutoGenTemplateId, defaultAutoGenSetId, defaultAutoGenInlineSet,
      recurrenceType, recurrenceInterval, recurrenceStartDate,
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }
    if (name.length > MAX_NAME_LEN) {
      res.status(400).json({ message: `name must be ${MAX_NAME_LEN} characters or fewer` });
      return;
    }
    if (typeof description === 'string' && description.length > MAX_TEXT_LEN) {
      res.status(400).json({ message: `description must be ${MAX_TEXT_LEN} characters or fewer` });
      return;
    }
    if (!Number.isInteger(divisionId)) {
      res.status(400).json({ message: 'divisionId is required' });
      return;
    }
    if (!canManageDivision(req, divisionId)) {
      res.status(403).json({ message: 'You can only manage blueprints in your own division' });
      return;
    }
    const division = await prisma.division.findUnique({ where: { id: divisionId }, select: { id: true } });
    if (!division) {
      res.status(400).json({ message: 'divisionId references a non-existent division' });
      return;
    }
    const wpType = await prisma.wpType.findUnique({ where: { code: type } });
    if (!wpType) {
      res.status(400).json({ message: `Invalid WP type: ${type}. Must match an existing WpType code.` });
      return;
    }
    if (!Number.isInteger(defaultDuration) || defaultDuration < 1) {
      res.status(400).json({ message: 'defaultDuration must be a positive integer (days)' });
      return;
    }

    const typeFields = await resolveTypeFields(type, { acRegistration, customer, authority, targetDepartmentId });
    if ('error' in typeFields) {
      res.status(400).json({ message: typeFields.error });
      return;
    }

    const autoGen = await validateAutoGenConfig(prisma, {
      autoGenerate: defaultAutoGenerate, autoGenMode: defaultAutoGenMode, autoGenInterval: defaultAutoGenInterval,
      autoGenTemplateId: defaultAutoGenTemplateId, autoGenSetId: defaultAutoGenSetId, autoGenInlineSet: defaultAutoGenInlineSet,
    });
    if ('error' in autoGen) {
      res.status(400).json({ message: autoGen.error });
      return;
    }

    const recurrence = resolveRecurrence({ recurrenceType, recurrenceInterval, recurrenceStartDate });
    if ('error' in recurrence) {
      res.status(400).json({ message: recurrence.error });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const bp = await tx.wpBlueprint.create({
        data: {
          name: name.trim(),
          description: typeof description === 'string' ? description.trim() : null,
          type,
          divisionId,
          defaultDuration,
          ownerId: userId,
          ...toDefaultAutoGenColumns(autoGen.data),
          ...typeFields.data,
          ...recurrence.data,
        },
        include: BLUEPRINT_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          actionType: 'BLUEPRINT_CREATED',
          entityType: 'WpBlueprint',
          entityId: String(bp.id),
          performedByUserId: userId,
          details: { name: bp.name, type, divisionId },
        },
      });
      return bp;
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating WP blueprint:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/wp-blueprints/:id ─────────────────────────────────────────────
export const updateWpBlueprint = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = parseInt(String(req.params.id), 10);
    const {
      name, description, isActive, defaultDuration,
      acRegistration, customer, authority, targetDepartmentId,
      defaultAutoGenerate, defaultAutoGenMode, defaultAutoGenInterval,
      defaultAutoGenTemplateId, defaultAutoGenSetId, defaultAutoGenInlineSet,
      recurrenceType, recurrenceInterval, recurrenceStartDate,
    } = req.body;

    const existing = await prisma.wpBlueprint.findUnique({ where: { id }, select: { id: true, divisionId: true, type: true } });
    if (!existing) {
      res.status(404).json({ message: 'Blueprint not found' });
      return;
    }
    if (!canManageDivision(req, existing.divisionId)) {
      res.status(403).json({ message: 'You can only manage blueprints in your own division' });
      return;
    }

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      res.status(400).json({ message: 'name cannot be empty' });
      return;
    }
    if (typeof name === 'string' && name.length > MAX_NAME_LEN) {
      res.status(400).json({ message: `name must be ${MAX_NAME_LEN} characters or fewer` });
      return;
    }
    if (typeof description === 'string' && description.length > MAX_TEXT_LEN) {
      res.status(400).json({ message: `description must be ${MAX_TEXT_LEN} characters or fewer` });
      return;
    }
    if (defaultDuration !== undefined && (!Number.isInteger(defaultDuration) || defaultDuration < 1)) {
      res.status(400).json({ message: 'defaultDuration must be a positive integer (days)' });
      return;
    }

    const data: Prisma.WpBlueprintUpdateInput = {};
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = typeof description === 'string' ? description.trim() : null;
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (defaultDuration !== undefined) data.defaultDuration = defaultDuration;

    // Type-specific context fields, resolved against the (immutable) blueprint type.
    if (acRegistration !== undefined || customer !== undefined || authority !== undefined || targetDepartmentId !== undefined) {
      const typeFields = await resolveTypeFields(existing.type, { acRegistration, customer, authority, targetDepartmentId });
      if ('error' in typeFields) {
        res.status(400).json({ message: typeFields.error });
        return;
      }
      Object.assign(data, typeFields.data);
    }

    // If any autogen field is provided, re-validate the whole block (replace-semantics).
    const autoGenProvided = defaultAutoGenerate !== undefined || defaultAutoGenMode !== undefined ||
      defaultAutoGenInterval !== undefined || defaultAutoGenTemplateId !== undefined ||
      defaultAutoGenSetId !== undefined || defaultAutoGenInlineSet !== undefined;
    if (autoGenProvided) {
      const autoGen = await validateAutoGenConfig(prisma, {
        autoGenerate: defaultAutoGenerate, autoGenMode: defaultAutoGenMode, autoGenInterval: defaultAutoGenInterval,
        autoGenTemplateId: defaultAutoGenTemplateId, autoGenSetId: defaultAutoGenSetId, autoGenInlineSet: defaultAutoGenInlineSet,
      });
      if ('error' in autoGen) {
        res.status(400).json({ message: autoGen.error });
        return;
      }
      Object.assign(data, toDefaultAutoGenColumns(autoGen.data));
    }

    // Providing any recurrence field re-resolves the whole block and reseeds
    // nextRunAt to the start date (editing the schedule restarts it). Omitting all
    // three leaves an in-flight schedule (incl. a null LAST_DONE awaiting close) intact.
    const recurrenceProvided = recurrenceType !== undefined || recurrenceInterval !== undefined || recurrenceStartDate !== undefined;
    if (recurrenceProvided) {
      const recurrence = resolveRecurrence({ recurrenceType, recurrenceInterval, recurrenceStartDate });
      if ('error' in recurrence) {
        res.status(400).json({ message: recurrence.error });
        return;
      }
      Object.assign(data, recurrence.data);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const bp = await tx.wpBlueprint.update({ where: { id }, data, include: BLUEPRINT_INCLUDE });
      await tx.auditLog.create({
        data: {
          actionType: 'BLUEPRINT_UPDATED',
          entityType: 'WpBlueprint',
          entityId: String(id),
          performedByUserId: userId,
          details: { fields: Object.keys(data) },
        },
      });
      return bp;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating WP blueprint:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── DELETE /api/wp-blueprints/:id  (soft-disable) ──────────────────────────
export const disableWpBlueprint = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = parseInt(String(req.params.id), 10);

    const existing = await prisma.wpBlueprint.findUnique({ where: { id }, select: { id: true, divisionId: true } });
    if (!existing) {
      res.status(404).json({ message: 'Blueprint not found' });
      return;
    }
    if (!canManageDivision(req, existing.divisionId)) {
      res.status(403).json({ message: 'You can only manage blueprints in your own division' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const bp = await tx.wpBlueprint.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({
        data: {
          actionType: 'BLUEPRINT_DISABLED',
          entityType: 'WpBlueprint',
          entityId: String(id),
          performedByUserId: userId,
          details: { name: bp.name },
        },
      });
      return bp;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error disabling WP blueprint:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/wp-blueprints/:id/launch ─────────────────────────────────────
export const launchBlueprint = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = parseInt(String(req.params.id), 10);
    const { name, timeframeFrom, timeframeTo } = req.body;

    const bp = await prisma.wpBlueprint.findUnique({ where: { id } });
    if (!bp || !bp.isActive) {
      res.status(404).json({ message: 'Blueprint not found' });
      return;
    }
    if (!canManageDivision(req, bp.divisionId)) {
      res.status(403).json({ message: 'You can only launch blueprints in your own division' });
      return;
    }

    // Timeframe: from defaults to today; to defaults to from + defaultDuration days.
    const fromDate = timeframeFrom ? new Date(timeframeFrom) : new Date();
    const toDate = timeframeTo ? new Date(timeframeTo) : new Date(fromDate.getTime() + bp.defaultDuration * DAY_MS);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      res.status(400).json({ message: 'timeframeFrom/timeframeTo must be valid dates' });
      return;
    }
    if (fromDate >= toDate) {
      res.status(400).json({ message: 'timeframeFrom must be before timeframeTo' });
      return;
    }

    // Re-validate the blueprint's autogen defaults at launch time — a referenced
    // template/set may have been archived/disabled since the blueprint was saved.
    const autoGen = await validateAutoGenConfig(prisma, {
      autoGenerate: bp.defaultAutoGenerate,
      autoGenMode: bp.defaultAutoGenMode,
      autoGenInterval: bp.defaultAutoGenInterval,
      autoGenTemplateId: bp.defaultAutoGenTemplateId,
      autoGenSetId: bp.defaultAutoGenSetId,
      autoGenInlineSet: bp.defaultAutoGenInlineSet ?? undefined,
    });
    if ('error' in autoGen) {
      res.status(400).json({ message: `Blueprint auto-generate config is no longer valid: ${autoGen.error}` });
      return;
    }

    const wpName = typeof name === 'string' && name.trim() ? name.trim() : bp.name;

    try {
      const wp = await createWorkPackageService(prisma, { userId }, {
        name: wpName,
        type: bp.type,
        divisionId: bp.divisionId,
        timeframeFrom: fromDate,
        timeframeTo: toDate,
        typeFields: {
          acRegistration: bp.acRegistration,
          customer: bp.customer,
          authority: bp.authority,
          targetDepartmentId: bp.targetDepartmentId,
        },
        autoGenData: autoGen.data,
        blueprintId: bp.id,
        isRoutine: false,
        auditActionType: 'BLUEPRINT_LAUNCHED',
        auditDetails: { wpName, blueprintId: bp.id, blueprintName: bp.name },
        systemEventContent: `Work Package "${wpName}" launched from blueprint "${bp.name}".`,
      });

      if (wp.autoGenerate) {
        const today = calendarDateUtc(new Date());
        const from = calendarDateUtc(wp.timeframeFrom);
        if (today >= from) {
          await fireAutoGenForWp(wp.id);
        }
      }

      res.status(201).json(wp);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Division not found') {
        res.status(400).json({ message: 'Division not found' });
        return;
      }
      throw error;
    }
  } catch (error) {
    console.error('Error launching blueprint:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
