import { OrderStatus } from '@prisma/client';

export class InvalidOrderStateTransitionError extends Error {
  constructor(currentStatus: OrderStatus, targetStatus: OrderStatus) {
    super(`Geçersiz sipariş durum geçişi: "${currentStatus}" durumundan "${targetStatus}" durumuna geçilemez.`);
    this.name = 'InvalidOrderStateTransitionError';
  }
}

/**
 * Sipariş Durumu Geçiş Haritası (Order State Transition Matrix)
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: [OrderStatus.PAYMENT_CONFIRMED, OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PAYMENT_CONFIRMED: [OrderStatus.PREPARING, OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  PREPARING: [OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  SHIPPED: [OrderStatus.DELIVERED, OrderStatus.REFUNDED],
  DELIVERED: [OrderStatus.REFUNDED],
  CANCELLED: [], // Terminal State
  REFUNDED: [],  // Terminal State
};

export function validateOrderStateTransition(currentStatus: OrderStatus, targetStatus: OrderStatus): void {
  if (currentStatus === targetStatus) return;

  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    throw new InvalidOrderStateTransitionError(currentStatus, targetStatus);
  }
}
