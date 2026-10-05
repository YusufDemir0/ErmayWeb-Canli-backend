import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { logger } from '../utils/logger';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and normalises one part of the request with a zod schema.
 * Unknown keys are stripped by zod objects, so controllers only ever see declared fields.
 * On failure responds 400 with field-level messages (Turkish, shown in the UI); the log line stays in English
 * and lists only field paths, never the submitted values.
 */
export const validateRequest = (schema: ZodTypeAny, source: Source = 'body') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req[source] ?? {});
      if (source === 'query') {
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true, enumerable: true });
      } else {
        req[source] = parsed;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        logger.info('Request validation failed', {
          'http.request.method': req.method,
          'url.path': `${req.baseUrl}${req.route?.path ?? ''}`,
          'validation.source': source,
          'validation.fields': error.issues.slice(0, 20).map((e) => e.path.join('.') || source),
        });
        res.status(400).json({
          success: false,
          message: error.issues[0]?.message || 'Girdi doğrulama hatası',
          errors: error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
};

export const validateQuery = (schema: ZodTypeAny) => validateRequest(schema, 'query');
export const validateParams = (schema: ZodTypeAny) => validateRequest(schema, 'params');
