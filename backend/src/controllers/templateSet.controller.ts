import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hasPrivilege } from '../utils/privilegeAccess';

// TemplateSet is config (not a Rule-2 soft-delete entity); "delete" = isActive=false,
// matching WpType/EventType. Changes aren't task-scoped, so Rule-3 dual-write does not
// apply — we write a lightweight AuditLog entry only (no TaskActivity).

const MAX_NAME_LEN = 200;
const MAX_TEXT_LEN = 2000;

interface IncomingItem {
  templateId: number;
  orderIndex?: number;
  deadlineOffsetDays?: number | null;
  estimatedHours?: number | null;
  skillLevel?: number | null;
  requiresApproval?: boolean | null;
  defaultNote?: string | null;
}

interface NormalizedItem {
  templateId: number;
  orderIndex: number;
  deadlineOffsetDays: number | null;
  estimatedHours: number | null;
  skillLevel: number | null;
  requiresApproval: boolean | null;
  defaultNote: string | null;
}

// Director/Admin manage sets in any division; a Manager (or other wp:create holder)
// is restricted to their own division.
function canManageDivision(req: Request, divisionId: number): boolean {
  const role = req.user!.role;
  if (role === 'Director' || role === 'Admin') return true;
  return req.user!.divisionId === divisionId;
}

/**
 * Validates + normalizes the incoming items array: each templateId must be an
 * integer referencing a Published template in `divisionId`; orderIndex (defaulted
 * to position) must be unique. Returns normalized items or an error string.
 */
async function validateItems(
  rawItems: unknown,
  divisionId: number
): Promise<{ error: string } | { items: NormalizedItem[] }> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'A template set must contain at least one item' };
  }

  const seenOrder = new Set<number>();
  const normalized: NormalizedItem[] = [];
  for (const [i, raw] of rawItems.entries()) {
    if (!raw || typeof raw !== 'object') return { error: `items[${i}] must be an object` };
    const e = raw as IncomingItem;
    if (!Number.isInteger(e.templateId)) return { error: `items[${i}].templateId must be an integer` };
    const orderIndex = Number.isInteger(e.orderIndex) ? (e.orderIndex as number) : i;
    if (seenOrder.has(orderIndex)) return { error: `Duplicate orderIndex ${orderIndex}` };
    seenOrder.add(orderIndex);

    const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const intOrNull = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);
    if (typeof e.defaultNote === 'string' && e.defaultNote.length > MAX_TEXT_LEN) {
      return { error: `items[${i}].defaultNote must be ${MAX_TEXT_LEN} characters or fewer` };
    }

    normalized.push({
      templateId: e.templateId,
      orderIndex,
      deadlineOffsetDays: intOrNull(e.deadlineOffsetDays),
      estimatedHours: numOrNull(e.estimatedHours),
      skillLevel: intOrNull(e.skillLevel),
      requiresApproval: typeof e.requiresApproval === 'boolean' ? e.requiresApproval : null,
      defaultNote: typeof e.defaultNote === 'string' ? e.defaultNote : null,
    });
  }

  // Every template must exist and be Published.
  const ids = [...new Set(normalized.map((n) => n.templateId))];
  const templates = await prisma.template.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  });
  const byId = new Map(templates.map((t) => [t.id, t]));
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) return { error: `Template id=${id} does not exist` };
    if (t.status !== 'Published') return { error: `Template id=${id} must be Published` };
  }

  return { items: normalized };
}

// Re-usable include for returning a fully-hydrated set.
const SET_INCLUDE = {
  division: { select: { id: true, name: true, code: true } },
  owner: { select: { id: true, name: true } },
  items: {
    orderBy: { orderIndex: 'asc' as const },
    include: { template: { select: { id: true, templateId: true, title: true, status: true } } },
  },
  _count: { select: { items: true } },
};

// ─── GET /api/template-sets ─────────────────────────────────────────────────
export const listTemplateSets = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Prisma.TemplateSetWhereInput = {};
    if (req.query.activeOnly === 'true') where.isActive = true;
    if (req.query.divisionId) {
      const divId = parseInt(String(req.query.divisionId), 10);
      if (!Number.isNaN(divId)) where.divisionId = divId;
    }

    const sets = await prisma.templateSet.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        division: { select: { id: true, name: true, code: true } },
        owner: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
    res.json(sets);
  } catch (error) {
    console.error('Error listing template sets:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/template-sets/:id ─────────────────────────────────────────────
export const getTemplateSetById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const set = await prisma.templateSet.findUnique({ where: { id }, include: SET_INCLUDE });
    if (!set) {
      res.status(404).json({ message: 'Template set not found' });
      return;
    }
    res.json(set);
  } catch (error) {
    console.error('Error fetching template set:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/template-sets ────────────────────────────────────────────────
export const createTemplateSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { name, description, divisionId, items } = req.body;

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
      res.status(403).json({ message: 'You can only manage template sets in your own division' });
      return;
    }

    const division = await prisma.division.findUnique({ where: { id: divisionId }, select: { id: true } });
    if (!division) {
      res.status(400).json({ message: 'divisionId references a non-existent division' });
      return;
    }

    const validated = await validateItems(items, divisionId);
    if ('error' in validated) {
      res.status(400).json({ message: validated.error });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const set = await tx.templateSet.create({
        data: {
          name: name.trim(),
          description: typeof description === 'string' ? description.trim() : null,
          divisionId,
          ownerId: userId,
          items: { create: validated.items },
        },
        include: SET_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          actionType: 'TEMPLATE_SET_CREATED',
          entityType: 'TemplateSet',
          entityId: String(set.id),
          performedByUserId: userId,
          details: { name: set.name, divisionId, itemCount: validated.items.length },
        },
      });
      return set;
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating template set:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/template-sets/:id ─────────────────────────────────────────────
export const updateTemplateSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = parseInt(String(req.params.id), 10);
    const { name, description, isActive, items } = req.body;

    const existing = await prisma.templateSet.findUnique({ where: { id }, select: { id: true, divisionId: true } });
    if (!existing) {
      res.status(404).json({ message: 'Template set not found' });
      return;
    }
    if (!canManageDivision(req, existing.divisionId)) {
      res.status(403).json({ message: 'You can only manage template sets in your own division' });
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

    // If items are provided, validate against the set's (unchanged) division.
    let validatedItems: NormalizedItem[] | null = null;
    if (items !== undefined) {
      const validated = await validateItems(items, existing.divisionId);
      if ('error' in validated) {
        res.status(400).json({ message: validated.error });
        return;
      }
      validatedItems = validated.items;
    }

    const data: Prisma.TemplateSetUpdateInput = {};
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = typeof description === 'string' ? description.trim() : null;
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const updated = await prisma.$transaction(async (tx) => {
      // Replace items wholesale when provided (deleteMany → createMany).
      if (validatedItems !== null) {
        await tx.templateSetItem.deleteMany({ where: { setId: id } });
        await tx.templateSetItem.createMany({
          data: validatedItems.map((it) => ({ ...it, setId: id })),
        });
      }
      const set = await tx.templateSet.update({ where: { id }, data, include: SET_INCLUDE });
      await tx.auditLog.create({
        data: {
          actionType: 'TEMPLATE_SET_UPDATED',
          entityType: 'TemplateSet',
          entityId: String(id),
          performedByUserId: userId,
          details: {
            fields: Object.keys(data),
            itemsReplaced: validatedItems !== null,
            itemCount: validatedItems?.length,
          },
        },
      });
      return set;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating template set:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── DELETE /api/template-sets/:id  (soft-disable) ──────────────────────────
export const disableTemplateSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = parseInt(String(req.params.id), 10);

    const existing = await prisma.templateSet.findUnique({ where: { id }, select: { id: true, divisionId: true } });
    if (!existing) {
      res.status(404).json({ message: 'Template set not found' });
      return;
    }
    if (!canManageDivision(req, existing.divisionId)) {
      res.status(403).json({ message: 'You can only manage template sets in your own division' });
      return;
    }

    // Soft-disable only. WorkPackage.autoGenSetId is ON DELETE SET NULL, so a hard
    // delete would silently orphan referencing WPs; disabling just hides it from new
    // pickers while already-fired WPs keep their resolved tasks.
    const updated = await prisma.$transaction(async (tx) => {
      const set = await tx.templateSet.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({
        data: {
          actionType: 'TEMPLATE_SET_DISABLED',
          entityType: 'TemplateSet',
          entityId: String(id),
          performedByUserId: userId,
          details: { name: set.name },
        },
      });
      return set;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error disabling template set:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
