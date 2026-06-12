import { Request, Response, NextFunction } from 'express';
import { hasPrivilege } from '../utils/privilegeAccess';
import { PrivilegeKey } from '../constants/privileges';

export const authorizeRoles = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role) {
      res.status(401).json({ message: 'Unauthorized: Role not found' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
};

/**
 * Phase 7 — DB-driven route guard. Replaces hardcoded `authorizeRoles(...)`
 * with a privilege lookup resolved against the actor's live PrivilegeConfig
 * map (falling back to DEFAULT_PRIVILEGES).
 */
export const requirePrivilege = (key: PrivilegeKey) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role) {
      res.status(401).json({ message: 'Unauthorized: Role not found' });
      return;
    }

    if (!hasPrivilege(req.user, key)) {
      res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
};

/**
 * OR-variant of `requirePrivilege`: passes if the actor holds ANY of the given
 * privilege keys. Used where a route is reachable by more than one privilege
 * (e.g. listing users is allowed for both `user:create` and `user:manage_roles`).
 */
export const requireAnyPrivilege = (...keys: PrivilegeKey[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role) {
      res.status(401).json({ message: 'Unauthorized: Role not found' });
      return;
    }

    if (!keys.some((key) => hasPrivilege(req.user!, key))) {
      res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
};
