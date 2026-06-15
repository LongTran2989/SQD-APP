import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// Reference Data admin controller (Admin-only).
//
// Manages the aviation reference tables seeded from the SQD spreadsheet:
//   Departments · Operators · Authorities · AircraftTypes ·
//   AircraftRegistrations · AuthorizationTypes
//
// Delete policy:
//   • Department          → SOFT delete (deletedAt) — referenced by compliance
//                           records (Findings, WorkPackages). Never hard-deleted.
//   • Operator/Authority  → HARD delete, BLOCKED while any registration references it.
//   • AircraftType        → HARD delete, BLOCKED while any registration OR
//                           user aircraft-authorization references it.
//   • AircraftRegistration→ HARD delete, BLOCKED while any Finding references it.
//   • AuthorizationType   → HARD delete, BLOCKED while any user job-auth references it.
// ─────────────────────────────────────────────────────────────────────────────

function badRequest(res: Response, message: string): void {
  res.status(400).json({ message });
}

// ── DEPARTMENTS ──────────────────────────────────────────────────────────────

export const listDepartments = async (_req: Request, res: Response): Promise<void> => {
  const departments = await prisma.department.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
  });
  res.json(departments);
};

export const createDepartment = async (req: Request, res: Response): Promise<void> => {
  const name = (req.body?.name ?? '').trim();
  if (!name) return badRequest(res, 'name is required');

  const existing = await prisma.department.findUnique({ where: { name } });
  if (existing && existing.deletedAt === null) {
    return badRequest(res, 'A department with that name already exists');
  }
  // Revive a previously soft-deleted department of the same name rather than
  // colliding on the unique constraint.
  const department = existing
    ? await prisma.department.update({ where: { name }, data: { deletedAt: null } })
    : await prisma.department.create({ data: { name } });
  res.status(201).json(department);
};

export const updateDepartment = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const name = (req.body?.name ?? '').trim();
  if (!name) return badRequest(res, 'name is required');

  const dept = await prisma.department.findFirst({ where: { id, deletedAt: null } });
  if (!dept) {
    res.status(404).json({ message: 'Department not found' });
    return;
  }
  const clash = await prisma.department.findFirst({ where: { name, deletedAt: null, id: { not: id } } });
  if (clash) return badRequest(res, 'A department with that name already exists');

  const updated = await prisma.department.update({ where: { id }, data: { name } });
  res.json(updated);
};

export const deleteDepartment = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const dept = await prisma.department.findFirst({ where: { id, deletedAt: null } });
  if (!dept) {
    res.status(404).json({ message: 'Department not found' });
    return;
  }
  // Soft delete — compliance records keep their FK intact.
  await prisma.department.update({ where: { id }, data: { deletedAt: new Date() } });
  res.status(204).send();
};

// ── OPERATORS ────────────────────────────────────────────────────────────────

export const listOperators = async (_req: Request, res: Response): Promise<void> => {
  const operators = await prisma.operator.findMany({ orderBy: { iataCode: 'asc' } });
  res.json(operators);
};

export const createOperator = async (req: Request, res: Response): Promise<void> => {
  const iataCode = (req.body?.iataCode ?? '').trim();
  const name = (req.body?.name ?? '').trim();
  if (!iataCode || !name) return badRequest(res, 'iataCode and name are required');

  const existing = await prisma.operator.findUnique({ where: { iataCode } });
  if (existing) return badRequest(res, 'An operator with that IATA code already exists');

  const operator = await prisma.operator.create({ data: { iataCode, name } });
  res.status(201).json(operator);
};

export const updateOperator = async (req: Request, res: Response): Promise<void> => {
  const iataCode = String(req.params.code);
  const name = (req.body?.name ?? '').trim();
  if (!name) return badRequest(res, 'name is required');

  const op = await prisma.operator.findUnique({ where: { iataCode } });
  if (!op) {
    res.status(404).json({ message: 'Operator not found' });
    return;
  }
  const updated = await prisma.operator.update({ where: { iataCode }, data: { name } });
  res.json(updated);
};

export const deleteOperator = async (req: Request, res: Response): Promise<void> => {
  const iataCode = String(req.params.code);
  const op = await prisma.operator.findUnique({ where: { iataCode } });
  if (!op) {
    res.status(404).json({ message: 'Operator not found' });
    return;
  }
  const refs = await prisma.aircraftRegistration.count({ where: { operatorCode: iataCode } });
  if (refs > 0) {
    return badRequest(res, `Cannot delete: ${refs} aircraft registration(s) still reference this operator`);
  }
  await prisma.operator.delete({ where: { iataCode } });
  res.status(204).send();
};

// ── AUTHORITIES ──────────────────────────────────────────────────────────────

export const listAuthorities = async (_req: Request, res: Response): Promise<void> => {
  const authorities = await prisma.authority.findMany({ orderBy: { code: 'asc' } });
  res.json(authorities);
};

export const createAuthority = async (req: Request, res: Response): Promise<void> => {
  const code = (req.body?.code ?? '').trim();
  const fullName = (req.body?.fullName ?? '').trim();
  if (!code || !fullName) return badRequest(res, 'code and fullName are required');

  const existing = await prisma.authority.findUnique({ where: { code } });
  if (existing) return badRequest(res, 'An authority with that code already exists');

  const authority = await prisma.authority.create({ data: { code, fullName } });
  res.status(201).json(authority);
};

export const updateAuthority = async (req: Request, res: Response): Promise<void> => {
  const code = String(req.params.code);
  const fullName = (req.body?.fullName ?? '').trim();
  if (!fullName) return badRequest(res, 'fullName is required');

  const auth = await prisma.authority.findUnique({ where: { code } });
  if (!auth) {
    res.status(404).json({ message: 'Authority not found' });
    return;
  }
  const updated = await prisma.authority.update({ where: { code }, data: { fullName } });
  res.json(updated);
};

export const deleteAuthority = async (req: Request, res: Response): Promise<void> => {
  const code = String(req.params.code);
  const auth = await prisma.authority.findUnique({ where: { code } });
  if (!auth) {
    res.status(404).json({ message: 'Authority not found' });
    return;
  }
  const refs = await prisma.aircraftRegistration.count({ where: { authorityCode: code } });
  if (refs > 0) {
    return badRequest(res, `Cannot delete: ${refs} aircraft registration(s) still reference this authority`);
  }
  await prisma.authority.delete({ where: { code } });
  res.status(204).send();
};

// ── AIRCRAFT TYPES ───────────────────────────────────────────────────────────

export const listAircraftTypes = async (_req: Request, res: Response): Promise<void> => {
  const types = await prisma.aircraftType.findMany({ orderBy: { code: 'asc' } });
  res.json(types);
};

export const createAircraftType = async (req: Request, res: Response): Promise<void> => {
  const code = (req.body?.code ?? '').trim();
  if (!code) return badRequest(res, 'code is required');

  const existing = await prisma.aircraftType.findUnique({ where: { code } });
  if (existing) return badRequest(res, 'An aircraft type with that code already exists');

  const type = await prisma.aircraftType.create({ data: { code } });
  res.status(201).json(type);
};

export const deleteAircraftType = async (req: Request, res: Response): Promise<void> => {
  const code = String(req.params.code);
  const type = await prisma.aircraftType.findUnique({ where: { code } });
  if (!type) {
    res.status(404).json({ message: 'Aircraft type not found' });
    return;
  }
  const regRefs = await prisma.aircraftRegistration.count({ where: { aircraftTypeCode: code } });
  if (regRefs > 0) {
    return badRequest(res, `Cannot delete: ${regRefs} aircraft registration(s) still reference this type`);
  }
  const authRefs = await prisma.userAircraftAuthorization.count({ where: { aircraftTypeCode: code } });
  if (authRefs > 0) {
    return badRequest(res, `Cannot delete: ${authRefs} user authorization(s) still reference this type`);
  }
  await prisma.aircraftType.delete({ where: { code } });
  res.status(204).send();
};

// ── AIRCRAFT REGISTRATIONS ───────────────────────────────────────────────────

export const listRegistrations = async (req: Request, res: Response): Promise<void> => {
  const operatorCode = (req.query.operatorCode as string | undefined)?.trim();
  const registrations = await prisma.aircraftRegistration.findMany({
    ...(operatorCode ? { where: { operatorCode } } : {}),
    orderBy: { registration: 'asc' },
  });
  res.json(registrations);
};

export const createRegistration = async (req: Request, res: Response): Promise<void> => {
  const registration = (req.body?.registration ?? '').trim();
  if (!registration) return badRequest(res, 'registration is required');

  const existing = await prisma.aircraftRegistration.findUnique({ where: { registration } });
  if (existing) return badRequest(res, 'A registration with that code already exists');

  const err = await validateRegistrationFks(req.body);
  if (err) return badRequest(res, err);

  const created = await prisma.aircraftRegistration.create({
    data: {
      registration,
      description: nullableStr(req.body?.description),
      serialNumber: nullableStr(req.body?.serialNumber),
      status: (req.body?.status ?? 'Active').trim() || 'Active',
      aircraftTypeCode: nullableStr(req.body?.aircraftTypeCode),
      operatorCode: nullableStr(req.body?.operatorCode),
      authorityCode: nullableStr(req.body?.authorityCode),
    },
  });
  res.status(201).json(created);
};

export const updateRegistration = async (req: Request, res: Response): Promise<void> => {
  const registration = String(req.params.registration);
  const reg = await prisma.aircraftRegistration.findUnique({ where: { registration } });
  if (!reg) {
    res.status(404).json({ message: 'Registration not found' });
    return;
  }
  const err = await validateRegistrationFks(req.body);
  if (err) return badRequest(res, err);

  const updated = await prisma.aircraftRegistration.update({
    where: { registration },
    data: {
      description: nullableStr(req.body?.description),
      serialNumber: nullableStr(req.body?.serialNumber),
      status: (req.body?.status ?? reg.status).trim() || 'Active',
      aircraftTypeCode: nullableStr(req.body?.aircraftTypeCode),
      operatorCode: nullableStr(req.body?.operatorCode),
      authorityCode: nullableStr(req.body?.authorityCode),
    },
  });
  res.json(updated);
};

export const deleteRegistration = async (req: Request, res: Response): Promise<void> => {
  const registration = String(req.params.registration);
  const reg = await prisma.aircraftRegistration.findUnique({ where: { registration } });
  if (!reg) {
    res.status(404).json({ message: 'Registration not found' });
    return;
  }
  const refs = await prisma.finding.count({ where: { aircraftRegistrationCode: registration } });
  if (refs > 0) {
    return badRequest(res, `Cannot delete: ${refs} finding(s) still reference this registration`);
  }
  await prisma.aircraftRegistration.delete({ where: { registration } });
  res.status(204).send();
};

// ── AUTHORIZATION TYPES ──────────────────────────────────────────────────────

export const listAuthorizationTypes = async (_req: Request, res: Response): Promise<void> => {
  const types = await prisma.authorizationType.findMany({ orderBy: { code: 'asc' } });
  res.json(types);
};

export const createAuthorizationType = async (req: Request, res: Response): Promise<void> => {
  const code = (req.body?.code ?? '').trim();
  if (!code) return badRequest(res, 'code is required');

  const existing = await prisma.authorizationType.findUnique({ where: { code } });
  if (existing) return badRequest(res, 'An authorization type with that code already exists');

  const created = await prisma.authorizationType.create({
    data: {
      code,
      description: nullableStr(req.body?.description),
      category: nullableStr(req.body?.category),
    },
  });
  res.status(201).json(created);
};

export const updateAuthorizationType = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const type = await prisma.authorizationType.findUnique({ where: { id } });
  if (!type) {
    res.status(404).json({ message: 'Authorization type not found' });
    return;
  }
  const updated = await prisma.authorizationType.update({
    where: { id },
    data: {
      description: nullableStr(req.body?.description),
      category: nullableStr(req.body?.category),
    },
  });
  res.json(updated);
};

export const deleteAuthorizationType = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const type = await prisma.authorizationType.findUnique({ where: { id } });
  if (!type) {
    res.status(404).json({ message: 'Authorization type not found' });
    return;
  }
  const refs = await prisma.userJobAuthorization.count({ where: { authorizationTypeId: id } });
  if (refs > 0) {
    return badRequest(res, `Cannot delete: ${refs} user authorization(s) still reference this type`);
  }
  await prisma.authorizationType.delete({ where: { id } });
  res.status(204).send();
};

// ── helpers ──────────────────────────────────────────────────────────────────

function nullableStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Validates that any provided operator/authority/aircraft-type code on a
 * registration payload references an existing row. Returns an error message,
 * or null when valid.
 */
async function validateRegistrationFks(body: Record<string, unknown>): Promise<string | null> {
  const typeCode = nullableStr(body?.aircraftTypeCode);
  const opCode = nullableStr(body?.operatorCode);
  const authCode = nullableStr(body?.authorityCode);

  if (typeCode && !(await prisma.aircraftType.findUnique({ where: { code: typeCode } }))) {
    return `Unknown aircraft type: ${typeCode}`;
  }
  if (opCode && !(await prisma.operator.findUnique({ where: { iataCode: opCode } }))) {
    return `Unknown operator: ${opCode}`;
  }
  if (authCode && !(await prisma.authority.findUnique({ where: { code: authCode } }))) {
    return `Unknown authority: ${authCode}`;
  }
  return null;
}
