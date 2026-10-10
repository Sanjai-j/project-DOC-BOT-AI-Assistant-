import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

/** 404 for unknown API routes */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
}

/** Central error handler — friendly messages, no stack traces to clients */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  console.error('[error]', err);
  const anyErr = err as { status?: number; message?: string; code?: string };
  if (anyErr?.code === '23505' || /duplicate key/i.test(anyErr?.message ?? '')) {
    res.status(409).json({ error: 'That record already exists (duplicate).' });
    return;
  }
  res.status(anyErr?.status ?? 500).json({
    error:
      anyErr?.status && anyErr.status < 500
        ? anyErr.message
        : 'Something went wrong on our side. Please try again.',
  });
}

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/** Tighter limit for auth endpoints */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/** Multer error translation */
export function onMulterError(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large (max 5 MB)' });
    return;
  }
  if (anyErr?.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({ error: 'Unexpected file field' });
    return;
  }
  next(err);
}
