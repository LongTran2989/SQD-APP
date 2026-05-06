import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId: number;
  role: string;
  divisionId: number;
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
        res.status(403).json({ message: 'Forbidden: Invalid token' });
        return;
      }
      req.user = decoded as AuthPayload;
      next();
    });
  } else {
    res.status(401).json({ message: 'Unauthorized: No token provided' });
  }
};
