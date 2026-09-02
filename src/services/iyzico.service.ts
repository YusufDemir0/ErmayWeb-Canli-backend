// @ts-ignore
import Iyzipay from 'iyzipay';
import crypto from 'crypto';

const iyzipayClient = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY || 'sandbox-apiKey-ermay-2026',
  secretKey: process.env.IYZICO_SECRET_KEY || 'sandbox-secretKey-ermay-2026',
  uri: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com',
});

export interface IyzicoBasketItem {
  id: string;
  name: string;
  category1?: string;
  category2?: string;
  itemType?: string;
  price: number | string;
}

export interface IyzicoPaymentRequest {
  conversationId: string;
  price: number;
  paidPrice: number;
  currency?: string;
  installment?: number;
  basketId?: string;
  basketItems?: IyzicoBasketItem[];
  paymentCard: {
    cardHolderName: string;
    cardNumber: string;
    expireMonth: string;
    expireYear: string;
    cvv: string;
  };
  buyer: {
    id: string;
    name: string;
    surname: string;
    gsmNumber: string;
    email: string;
    identityNumber: string;
    registrationAddress: string;
    city: string;
    country: string;
    ip: string;
  };
}

export interface IyzicoPaymentResponse {
  status: 'success' | 'failure';
  paymentId?: string;
  checkoutFormContent?: string;
  errorMessage?: string;
  errorCode?: string;
  rawSignature?: string;
  idempotencyKey?: string;
}

interface IyzipayCallbackResult {
  status: string;
  paymentId?: string;
  errorMessage?: string;
  errorCode?: string;
  signature?: string;
}

/**
 * Resmi Iyzipay SDK Sandbox API Ödeme Çağrısı
 */
export async function executeIyzicoPayment(paymentData: IyzicoPaymentRequest): Promise<IyzicoPaymentResponse> {
  const idempotencyKey = crypto.randomUUID();

  const cleanCardNumber = paymentData.paymentCard.cardNumber.replace(/\s+/g, '');

  // Map real individual cart items dynamically
  const formattedBasketItems = (paymentData.basketItems && paymentData.basketItems.length > 0)
    ? paymentData.basketItems.map((item, idx) => ({
        id: item.id || `ITEM-${idx + 1}`,
        name: item.name || 'Mobilya Kalemi',
        category1: item.category1 || 'Mobilya',
        category2: item.category2 || 'Ofis & Yaşam',
        itemType: item.itemType || Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
        price: Number(item.price).toFixed(2),
      }))
    : [
        {
          id: 'ITEM-DEFAULT-01',
          name: 'Ermay Mobilya Siparişi',
          category1: 'Mobilya',
          itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
          price: Number(paymentData.paidPrice).toFixed(2),
        },
      ];

  const requestPayload = {
    locale: Iyzipay.LOCALE.TR,
    conversationId: paymentData.conversationId,
    price: Number(paymentData.price).toFixed(2),
    paidPrice: Number(paymentData.paidPrice).toFixed(2),
    currency: Iyzipay.CURRENCY.TRY,
    installment: paymentData.installment || 1,
    basketId: paymentData.basketId || `BSK-${Date.now()}`,
    paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    paymentCard: {
      cardHolderName: paymentData.paymentCard.cardHolderName,
      cardNumber: cleanCardNumber,
      expireMonth: paymentData.paymentCard.expireMonth,
      expireYear: paymentData.paymentCard.expireYear.length === 2 ? `20${paymentData.paymentCard.expireYear}` : paymentData.paymentCard.expireYear,
      cvv: paymentData.paymentCard.cvv,
      registerCard: 0,
    },
    buyer: {
      id: paymentData.buyer.id,
      name: paymentData.buyer.name,
      surname: paymentData.buyer.surname,
      gsmNumber: paymentData.buyer.gsmNumber,
      email: paymentData.buyer.email,
      identityNumber: paymentData.buyer.identityNumber,
      registrationAddress: paymentData.buyer.registrationAddress,
      ip: paymentData.buyer.ip,
      city: paymentData.buyer.city,
      country: paymentData.buyer.country,
    },
    shippingAddress: {
      contactName: `${paymentData.buyer.name} ${paymentData.buyer.surname}`,
      city: paymentData.buyer.city,
      country: paymentData.buyer.country,
      address: paymentData.buyer.registrationAddress,
    },
    billingAddress: {
      contactName: `${paymentData.buyer.name} ${paymentData.buyer.surname}`,
      city: paymentData.buyer.city,
      country: paymentData.buyer.country,
      address: paymentData.buyer.registrationAddress,
    },
    basketItems: formattedBasketItems,
  };

  return new Promise((resolve) => {
    iyzipayClient.payment.create(requestPayload, (err: Error | null, result: IyzipayCallbackResult | null) => {
      if (err || !result) {
        resolve({
          status: 'failure',
          errorMessage: err?.message || 'Iyzico ödeme servisine bağlanılamadı.',
        });
        return;
      }

      if (result.status === 'success') {
        resolve({
          status: 'success',
          paymentId: result.paymentId,
          idempotencyKey,
          rawSignature: result.signature || idempotencyKey,
        });
      } else {
        resolve({
          status: 'failure',
          errorMessage: result.errorMessage || 'Ödeme banka tarafından reddedildi.',
          errorCode: result.errorCode,
        });
      }
    });
  });
}

/**
 * PCI-DSS Uyumlu Iyzico Responsive Checkout Form Başlatma
 */
export async function initializeCheckoutForm(paymentData: Omit<IyzicoPaymentRequest, 'paymentCard'> & { callbackUrl: string }): Promise<{
  status: 'success' | 'failure';
  checkoutFormContent?: string;
  token?: string;
  errorMessage?: string;
}> {
  const formattedBasketItems = (paymentData.basketItems && paymentData.basketItems.length > 0)
    ? paymentData.basketItems.map((item, idx) => ({
        id: item.id || `ITEM-${idx + 1}`,
        name: item.name || 'Mobilya Kalemi',
        category1: item.category1 || 'Mobilya',
        category2: item.category2 || 'Ofis & Yaşam',
        itemType: item.itemType || Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
        price: Number(item.price).toFixed(2),
      }))
    : [
        {
          id: 'ITEM-DEFAULT-01',
          name: 'Ermay Mobilya Siparişi',
          category1: 'Mobilya',
          itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
          price: Number(paymentData.paidPrice).toFixed(2),
        },
      ];

  const requestPayload = {
    locale: Iyzipay.LOCALE.TR,
    conversationId: paymentData.conversationId,
    price: Number(paymentData.price).toFixed(2),
    paidPrice: Number(paymentData.paidPrice).toFixed(2),
    currency: Iyzipay.CURRENCY.TRY,
    basketId: paymentData.basketId || `BSK-${Date.now()}`,
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl: paymentData.callbackUrl,
    buyer: {
      id: paymentData.buyer.id,
      name: paymentData.buyer.name,
      surname: paymentData.buyer.surname,
      gsmNumber: paymentData.buyer.gsmNumber,
      email: paymentData.buyer.email,
      identityNumber: paymentData.buyer.identityNumber,
      registrationAddress: paymentData.buyer.registrationAddress,
      ip: paymentData.buyer.ip,
      city: paymentData.buyer.city,
      country: paymentData.buyer.country,
    },
    shippingAddress: {
      contactName: `${paymentData.buyer.name} ${paymentData.buyer.surname}`,
      city: paymentData.buyer.city,
      country: paymentData.buyer.country,
      address: paymentData.buyer.registrationAddress,
    },
    billingAddress: {
      contactName: `${paymentData.buyer.name} ${paymentData.buyer.surname}`,
      city: paymentData.buyer.city,
      country: paymentData.buyer.country,
      address: paymentData.buyer.registrationAddress,
    },
    basketItems: formattedBasketItems,
  };

  return new Promise((resolve) => {
    iyzipayClient.checkoutFormInitialize.create(requestPayload, (err: Error | null, result: any) => {
      if (err || !result) {
        resolve({
          status: 'failure',
          errorMessage: err?.message || 'Iyzico Checkout Form başlatılamadı.',
        });
        return;
      }

      if (result.status === 'success') {
        resolve({
          status: 'success',
          checkoutFormContent: result.checkoutFormContent,
          token: result.token,
        });
      } else {
        resolve({
          status: 'failure',
          errorMessage: result.errorMessage || 'Ödeme formu oluşturulamadı.',
        });
      }
    });
  });
}

