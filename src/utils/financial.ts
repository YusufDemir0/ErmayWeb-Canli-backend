/**
 * Financial Calculation Utilities (Kuruş Precision Integer Math)
 * Prevents IEEE 754 floating-point rounding errors during price, discount, and multi-tier tax calculations.
 */

export function toKurus(amount: number): number {
  return Math.round(amount * 100);
}

export function fromKurus(kurusAmount: number): number {
  return Number((kurusAmount / 100).toFixed(2));
}

export interface CalculatedFinancials {
  subTotalKurus: number;
  discountKurus: number;
  netKurus: number;
  taxKurus: number;
  finalTotalKurus: number;
  subTotal: number;
  discountAmount: number;
  taxAmount: number;
  finalTotal: number;
}

export function calculateOrderFinancials(
  items: { unitPrice: number; quantity: number; vatRate?: number }[],
  couponDiscountKurus: number = 0
): CalculatedFinancials {
  let subTotalKurus = 0;

  for (const item of items) {
    const unitPriceKurus = toKurus(item.unitPrice);
    const itemTotalKurus = unitPriceKurus * item.quantity;
    subTotalKurus += itemTotalKurus;
  }

  const discountKurus = Math.min(subTotalKurus, Math.max(0, couponDiscountKurus));
  const finalTotalKurus = Math.max(0, subTotalKurus - discountKurus);

  // Proportional item-by-item VAT calculation without any hardcoded 1.20 assumptions
  let netKurus = 0;
  let taxKurus = 0;

  if (subTotalKurus > 0) {
    const discountRatio = Math.min(1, Math.max(0, discountKurus / subTotalKurus));
    
    for (const item of items) {
      const unitPriceKurus = toKurus(item.unitPrice || 0);
      const itemTotalKurus = unitPriceKurus * (item.quantity || 1);
      const vatRate = item.vatRate !== undefined ? Number(item.vatRate) : 0.20;

      // Net and Tax after proportional coupon distribution
      const discountedItemTotal = Math.round(itemTotalKurus * (1 - discountRatio));
      const safeVatFactor = 1 + (isNaN(vatRate) ? 0.20 : Math.max(0, vatRate));
      const discountedItemNet = Math.round(discountedItemTotal / safeVatFactor);
      const discountedItemTax = Math.max(0, discountedItemTotal - discountedItemNet);

      netKurus += discountedItemNet;
      taxKurus += discountedItemTax;
    }
  } else {
    netKurus = 0;
    taxKurus = 0;
  }

  return {
    subTotalKurus,
    discountKurus,
    netKurus,
    taxKurus,
    finalTotalKurus,
    subTotal: fromKurus(subTotalKurus),
    discountAmount: fromKurus(discountKurus),
    taxAmount: fromKurus(taxKurus),
    finalTotal: fromKurus(finalTotalKurus),
  };
}
