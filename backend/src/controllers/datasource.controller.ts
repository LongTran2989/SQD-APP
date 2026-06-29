import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

import { prisma } from '../lib/prisma';

/**
 * Returns data for dynamic dropdowns in the template builder and forms.
 * Supports: departments, divisions, users, aircrafts, operators, registrations
 */
export const getDataSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const source = req.params.source as string;

    switch (source) {
      case 'departments': {
        const departments = await prisma.department.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' }
        });
        res.json(departments.map(d => ({ value: String(d.id), label: d.name })));
        return;
      }
      case 'divisions': {
        const divisions = await prisma.division.findMany({
          select: { id: true, name: true, department: { select: { name: true } } },
          orderBy: { name: 'asc' }
        });
        res.json(divisions.map(d => ({
          value: String(d.id),
          label: `${d.name} (${d.department.name})`
        })));
        return;
      }
      case 'users': {
        const users = await prisma.user.findMany({
          select: { id: true, name: true, employeeId: true, divisionId: true },
          where: { deletedAt: null, role: { name: { notIn: ['Admin', 'Senior Advisor'] } } },
          orderBy: { name: 'asc' }
        });
        res.json(users.map(u => ({ value: String(u.id), label: `${u.name} (${u.employeeId ?? ''})`, divisionId: u.divisionId })));
        return;
      }
      case 'aircrafts': {
        const aircrafts = await prisma.aircraftType.findMany({
          select: { code: true },
          orderBy: { code: 'asc' }
        });
        res.json(aircrafts.map(a => ({ value: a.code, label: a.code })));
        return;
      }
      case 'operators': {
        const operators = await prisma.operator.findMany({
          select: { iataCode: true, name: true },
          orderBy: { iataCode: 'asc' }
        });
        res.json(operators.map(o => ({ value: o.iataCode, label: `${o.iataCode} — ${o.name}` })));
        return;
      }
      case 'registrations': {
        // Used by the finding form's cascading Operator → Aircraft dropdowns.
        // Each option carries operatorCode so the UI can filter by operator and
        // auto-fill the operator when an aircraft is chosen.
        const registrations = await prisma.aircraftRegistration.findMany({
          select: { registration: true, description: true, operatorCode: true, aircraftTypeCode: true },
          orderBy: { registration: 'asc' }
        });
        res.json(registrations.map(r => ({
          value: r.registration,
          label: r.description ? `${r.registration} — ${r.description}` : r.registration,
          operatorCode: r.operatorCode,
          aircraftTypeCode: r.aircraftTypeCode,
        })));
        return;
      }
      default:
        res.status(400).json({ message: `Unknown data source: ${source}` });
    }
  } catch (error) {
    console.error('Error fetching data source:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
