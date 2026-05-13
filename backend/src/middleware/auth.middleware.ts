import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId: number;
  role: string;
  divisionId: number;
  forcePasswordChange?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export const authenticateJWT = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ message: 'Unauthorized: Malformed token' });
      return;
    }

    const secret = (process.env.JWT_SECRET || 'fallback_secret') as string;
    
    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        res.status(401).json({ message: 'Unauthorized: Invalid token' });
        return;
      }
      const authPayload = decoded as AuthPayload;
      
      // Enforce password change policy
      if (authPayload.forcePasswordChange && req.path !== '/update-password') {
        res.status(403).json({ message: 'Forbidden: Password change required' });
        return;
      }
      
      req.user = authPayload;
      next();
    });
  } else {
    res.status(401).json({ message: 'Unauthorized: No token provided' });
  }
};
