import { RequestStatus } from '@prisma/client';

export class InvalidRequestStateTransitionError extends Error {
  constructor(currentStatus: RequestStatus, targetStatus: RequestStatus) {
    super(`Geçersiz talep durum geçişi: "${currentStatus}" durumundan "${targetStatus}" durumuna geçilemez.`);
    this.name = 'InvalidRequestStateTransitionError';
  }
}

/**
 * Sipariş Talebi Durum Geçiş Haritası (Request State Transition Matrix)
 * Referans: docs/03_DATA_MODEL_AND_STATE_MACHINE.md
 */
export const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  NEW: [RequestStatus.CONTACTED, RequestStatus.CANCELLED, RequestStatus.SPAM, RequestStatus.EXPIRED],
  CONTACTED: [RequestStatus.STORE_VISIT_SCHEDULED, RequestStatus.AWAITING_PAYMENT, RequestStatus.CANCELLED, RequestStatus.EXPIRED],
  STORE_VISIT_SCHEDULED: [RequestStatus.AWAITING_PAYMENT, RequestStatus.COMPLETED, RequestStatus.CANCELLED],
  AWAITING_PAYMENT: [RequestStatus.PAID_OFFLINE, RequestStatus.CANCELLED],
  PAID_OFFLINE: [RequestStatus.COMPLETED],
  COMPLETED: [], // Terminal
  CANCELLED: [], // Terminal
  SPAM: [],      // Terminal
  EXPIRED: [],   // Terminal
};

export function validateRequestStateTransition(currentStatus: RequestStatus, targetStatus: RequestStatus): boolean {
  if (currentStatus === targetStatus) return false; // No-op: aynı durum

  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    throw new InvalidRequestStateTransitionError(currentStatus, targetStatus);
  }
  return true;
}

// Geriye dönük uyumluluk takma adı
export const validateOrderStateTransition = validateRequestStateTransition as unknown as (c: unknown, t: unknown) => boolean;
