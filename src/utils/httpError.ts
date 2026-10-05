import { Response } from 'express';
import { logger, errorFields } from './logger';

/**
 * Responds 500 without exposing internal error details (database messages, stack traces) to the client.
 * The full error goes to the structured log, correlated by trace.id.
 */
export function sendServerError(res: Response, error: unknown, publicMessage: string, logMessage = 'Request failed'): void {
  logger.error(logMessage, errorFields(error));
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: publicMessage });
  }
}
