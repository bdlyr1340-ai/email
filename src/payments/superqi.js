import crypto from 'node:crypto';
import { config } from '../config.js';

function enabled() {
  return process.env.SUPERQI_ENABLED === 'true' && process.env.SUPERQI_TERMINAL_ID &&
    process.env.SUPERQI_USERNAME && process.env.SUPERQI_PASSWORD;
}

export async function createSuperQiPayment(order) {
  if (!enabled()) {
    if (config.demoPayment) return { externalId: `demo-superqi-${order.id}`, paymentUrl: `${config.appUrl}/payment/demo/${order.id}`, raw: { demo: true } };
    throw new Error('SUPERQI_NOT_CONFIGURED');
  }

  const base = (process.env.SUPERQI_API_URL || 'https://uat-sandbox-3ds-api.qi.iq/api/v1').replace(/\/$/, '');
  const auth = Buffer.from(`${process.env.SUPERQI_USERNAME}:${process.env.SUPERQI_PASSWORD}`).toString('base64');
  const payload = {
    requestId: crypto.randomUUID(),
    amount: Number(order.total_amount).toFixed(2),
    currency: 'IQD',
    locale: order.locale === 'ar' ? 'ar_IQ' : 'en_US',
    finishPaymentUrl: `${process.env.SUPERQI_RETURN_URL || `${config.appUrl}/payment/result`}?order=${order.id}&token=${order.public_token}`,
    notificationUrl: `${config.appUrl}/webhooks/superqi`,
    customerInfo: {
      firstName: order.customer_name,
      accountId: order.customer_contact,
    },
    additionalInfo: { orderId: order.id, orderNumber: String(order.order_number) },
    appChannel: false,
  };
  const response = await fetch(`${base}/payment`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Terminal-Id': process.env.SUPERQI_TERMINAL_ID,
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.formUrl) throw new Error(`SUPERQI_CREATE_FAILED:${JSON.stringify(data)}`);
  return { externalId: data.paymentId, paymentUrl: data.formUrl, raw: data };
}

export function verifySuperQiWebhook(payload, signature) {
  const publicKey = process.env.SUPERQI_WEBHOOK_PUBLIC_KEY?.replace(/\\n/g, '\n');
  if (!publicKey) return process.env.NODE_ENV !== 'production';
  const fields = [
    payload.paymentId || '-',
    payload.amount != null ? `${payload.amount}.000` : '-',
    payload.currency || '-',
    payload.creationDate || '-',
    payload.status || '-',
  ];
  const verifier = crypto.createVerify('sha256');
  verifier.update(fields.join('|'));
  verifier.end();
  return verifier.verify(publicKey, Buffer.from(signature || '', 'base64'));
}
