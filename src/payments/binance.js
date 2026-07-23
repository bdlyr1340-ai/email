import crypto from 'node:crypto';
import { config } from '../config.js';

function enabled() {
  return process.env.BINANCE_PAY_ENABLED === 'true' &&
    process.env.BINANCE_PAY_API_KEY && process.env.BINANCE_PAY_SECRET_KEY;
}

function sign(body, timestamp, nonce) {
  const payload = `${timestamp}\n${nonce}\n${body}\n`;
  return crypto.createHmac('sha512', process.env.BINANCE_PAY_SECRET_KEY).update(payload).digest('hex').toUpperCase();
}

export async function createBinancePayment(order) {
  if (!enabled()) {
    if (config.demoPayment) return { externalId: `demo-binance-${order.id}`, paymentUrl: `${config.appUrl}/payment/demo/${order.id}`, raw: { demo: true } };
    throw new Error('BINANCE_NOT_CONFIGURED');
  }

  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyObject = {
    env: { terminalType: 'WEB' },
    merchantTradeNo: order.id.replaceAll('-', '').slice(0, 32),
    orderAmount: Number(order.total_amount),
    currency: 'USDT',
    goods: {
      goodsType: '02',
      goodsCategory: 'Z000',
      referenceGoodsId: order.id,
      goodsName: `Digital order #${order.order_number}`.slice(0, 256),
      goodsDetail: 'Digital product order',
    },
    returnUrl: process.env.BINANCE_PAY_RETURN_URL || `${config.appUrl}/payment/result`,
    cancelUrl: process.env.BINANCE_PAY_CANCEL_URL || `${config.appUrl}/payment/result`,
    webhookUrl: `${config.appUrl}/webhooks/binance`,
    orderExpireTime: Date.now() + 15 * 60_000,
  };
  const body = JSON.stringify(bodyObject);
  const response = await fetch(`${process.env.BINANCE_PAY_API_URL || 'https://bpay.binanceapi.com'}/binancepay/openapi/v2/order`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'BinancePay-Timestamp': timestamp,
      'BinancePay-Nonce': nonce,
      'BinancePay-Certificate-SN': process.env.BINANCE_PAY_API_KEY,
      'BinancePay-Signature': sign(body, timestamp, nonce),
    },
    body,
  });
  const data = await response.json();
  if (!response.ok || data.status !== 'SUCCESS') throw new Error(`BINANCE_CREATE_FAILED:${JSON.stringify(data)}`);
  return {
    externalId: data.data?.prepayId || bodyObject.merchantTradeNo,
    paymentUrl: data.data?.checkoutUrl || data.data?.deeplink,
    raw: data,
  };
}

export function parseBinanceWebhook(body) {
  const data = typeof body.data === 'string' ? JSON.parse(body.data) : (body.data || body);
  return {
    paid: ['PAY_SUCCESS', 'SUCCESS'].includes(body.bizStatus) || ['PAID', 'SUCCESS'].includes(data.status),
    orderId: data.merchantTradeNo || data.merchantOrderNo,
    externalId: data.prepayId || data.transactionId,
    raw: body,
  };
}

export function verifyBinanceWebhook(rawBody, headers) {
  const publicKey = process.env.BINANCE_PAY_WEBHOOK_PUBLIC_KEY?.replace(/\\n/g, '\n');
  if (!publicKey) return process.env.NODE_ENV !== 'production';
  const timestamp = headers['binancepay-timestamp'];
  const nonce = headers['binancepay-nonce'];
  const signature = headers['binancepay-signature'];
  if (!timestamp || !nonce || !signature || !rawBody) return false;
  const payload = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(payload);
  verifier.end();
  return verifier.verify(publicKey, Buffer.from(signature, 'base64'));
}
