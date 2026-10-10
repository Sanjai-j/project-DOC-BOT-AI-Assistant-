import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type Role } from '../utils/auth.js';

export interface AuthedRequest extends Request {
  user?: {
    id: string;
    role: Role;
    name: string;
    doctorCode?: string;
  };
}

export function requireAuth(roles?: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const payload = verifyToken(header.slice(7));
    if (!payload) {
      res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
      return;
    }
    if (roles && roles.length > 0 && !roles.includes(payload.role)) {
      res.status(403).json({ error: 'You do not have permission to perform this action' });
      return;
    }
    req.user = {
      id: payload.sub,
      role: payload.role,
      name: payload.name,
      doctorCode: payload.doctorCode,
    };
    next();
  };
}
