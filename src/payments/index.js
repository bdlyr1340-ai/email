import { query } from '../db.js';
import { createBinancePayment } from './binance.js';
import { createSuperQiPayment } from './superqi.js';

export async function createPayment(order) {
  const created = order.payment_provider === 'BINANCE'
    ? await createBinancePayment(order)
    : await createSuperQiPayment(order);
  await query(
    `INSERT INTO payments(order_id,provider,status,external_id,amount,currency,raw)
     VALUES($1,$2,'CREATED',$3,$4,$5,$6::jsonb)`,
    [order.id, order.payment_provider, created.externalId, order.total_amount, order.currency, JSON.stringify(created.raw || {})],
  );
  await query(`UPDATE orders SET payment_reference=$2,payment_url=$3,updated_at=NOW() WHERE id=$1`, [order.id, created.externalId, created.paymentUrl]);
  return created;
}
