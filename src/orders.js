import { config } from './config.js';
import { decryptJson, encryptJson, randomToken } from './crypto.js';
import { transaction, query } from './db.js';
import { notifyAdmin, sendTelegram } from './telegram.js';

async function releaseExpiredReservations(client) {
  await client.query(`UPDATE inventory_slots SET status='AVAILABLE',reserved_until=NULL,order_item_id=NULL WHERE status='RESERVED' AND reserved_until < NOW()`);
  await client.query(`UPDATE inventory_items SET status='AVAILABLE',reserved_until=NULL,order_item_id=NULL WHERE status='RESERVED' AND reserved_until < NOW()`);
  await client.query(`UPDATE orders SET status='EXPIRED',updated_at=NOW() WHERE status='PENDING' AND created_at < NOW() - ($1 || ' minutes')::interval`, [config.reservationMinutes]);
}

export async function createOrder({ variantId, customerName, customerContact, customerTelegramId, locale, provider, ipHash, fingerprintHash }) {
  return transaction(async (client) => {
    await releaseExpiredReservations(client);
    const variantResult = await client.query(
      `SELECT v.*, p.name_ar AS product_name_ar, p.name_en AS product_name_en, p.active AS product_active
       FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1 FOR SHARE`,
      [variantId],
    );
    const variant = variantResult.rows[0];
    if (!variant || !variant.active || !variant.product_active) throw new Error('PRODUCT_UNAVAILABLE');

    const currency = provider === 'BINANCE' ? 'USDT' : 'IQD';
    const unitPrice = currency === 'USDT' ? variant.price_usdt : variant.price_iqd;
    if (unitPrice == null) throw new Error('PRICE_UNAVAILABLE');

    const orderResult = await client.query(
      `INSERT INTO orders(public_token,customer_name,customer_contact,customer_telegram_id,locale,currency,total_amount,payment_provider,ip_hash,fingerprint_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [randomToken(), customerName, customerContact, customerTelegramId || null, locale, currency, unitPrice, provider, ipHash, fingerprintHash],
    );
    const order = orderResult.rows[0];
    const itemResult = await client.query(
      `INSERT INTO order_items(order_id,variant_id,unit_price) VALUES($1,$2,$3) RETURNING *`,
      [order.id, variant.id, unitPrice],
    );
    const orderItem = itemResult.rows[0];
    const reservedUntil = new Date(Date.now() + config.reservationMinutes * 60_000);

    if (variant.stock_mode === 'SHARED_SLOT') {
      const stock = await client.query(
        `SELECT s.id FROM inventory_slots s
         JOIN inventory_groups g ON g.id=s.group_id
         WHERE g.variant_id=$1 AND g.active=TRUE AND s.status='AVAILABLE'
           AND (g.expires_at IS NULL OR g.expires_at > NOW())
         ORDER BY g.created_at ASC, s.created_at ASC
         FOR UPDATE OF s SKIP LOCKED LIMIT 1`, [variant.id],
      );
      if (!stock.rows[0]) throw new Error('OUT_OF_STOCK');
      await client.query(`UPDATE inventory_slots SET status='RESERVED',reserved_until=$2,order_item_id=$3 WHERE id=$1`, [stock.rows[0].id, reservedUntil, orderItem.id]);
      await client.query(`UPDATE order_items SET inventory_ref_type='SLOT',inventory_ref_id=$2,fulfillment_status='RESERVED' WHERE id=$1`, [orderItem.id, stock.rows[0].id]);
    } else if (variant.stock_mode === 'ITEM') {
      const stock = await client.query(
        `SELECT id FROM inventory_items WHERE variant_id=$1 AND status='AVAILABLE'
         AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`, [variant.id],
      );
      if (!stock.rows[0]) throw new Error('OUT_OF_STOCK');
      await client.query(`UPDATE inventory_items SET status='RESERVED',reserved_until=$2,order_item_id=$3 WHERE id=$1`, [stock.rows[0].id, reservedUntil, orderItem.id]);
      await client.query(`UPDATE order_items SET inventory_ref_type='ITEM',inventory_ref_id=$2,fulfillment_status='RESERVED' WHERE id=$1`, [orderItem.id, stock.rows[0].id]);
    } else if (variant.stock_mode === 'MANUAL') {
      await client.query(`UPDATE order_items SET fulfillment_status='MANUAL' WHERE id=$1`, [orderItem.id]);
    }

    await client.query(`INSERT INTO order_events(order_id,event_type,message) VALUES($1,'CREATED','Order created and stock reserved')`, [order.id]);
    return { order, variant };
  });
}

function expiryFor(days) {
  return days ? new Date(Date.now() + Number(days) * 86_400_000) : null;
}

export async function markOrderPaid(orderId, paymentReference = null, raw = {}) {
  const result = await transaction(async (client) => {
    const orderResult = await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (['FULFILLED', 'MANUAL_REVIEW'].includes(order.status)) return order;
    if (order.status !== 'PENDING') throw new Error('ORDER_NOT_PAYABLE');

    const itemsResult = await client.query(
      `SELECT oi.*,v.delivery_mode,v.duration_days,v.stock_mode,v.metadata,
       p.name_ar AS product_name_ar,p.name_en AS product_name_en,v.name_ar AS variant_name_ar,v.name_en AS variant_name_en
       FROM order_items oi JOIN product_variants v ON v.id=oi.variant_id JOIN products p ON p.id=v.product_id
       WHERE oi.order_id=$1 FOR UPDATE`, [order.id],
    );

    let manual = false;
    const deliveries = [];
    for (const item of itemsResult.rows) {
      let payload = null;
      let status = 'DELIVERED';
      const accessExpiresAt = expiryFor(item.duration_days);

      if (item.inventory_ref_type === 'SLOT') {
        const stock = await client.query(
          `SELECT s.id,s.slot_name,s.encrypted_pin,g.id AS group_id,g.encrypted_credentials,g.capacity
           FROM inventory_slots s JOIN inventory_groups g ON g.id=s.group_id
           WHERE s.id=$1 FOR UPDATE`, [item.inventory_ref_id],
        );
        const row = stock.rows[0];
        if (!row || !['RESERVED','SOLD'].includes((await client.query(`SELECT status FROM inventory_slots WHERE id=$1`, [item.inventory_ref_id])).rows[0]?.status)) throw new Error('RESERVATION_LOST');
        payload = { ...decryptJson(row.encrypted_credentials), slot: row.slot_name };
        if (row.encrypted_pin) payload.pin = decryptJson(row.encrypted_pin);
        await client.query(`UPDATE inventory_slots SET status='SOLD',reserved_until=NULL,access_expires_at=$2 WHERE id=$1`, [row.id, accessExpiresAt]);
        const left = await client.query(`SELECT COUNT(*)::int AS count FROM inventory_slots WHERE group_id=$1 AND status='AVAILABLE'`, [row.group_id]);
        if (left.rows[0].count === 0) await client.query(`UPDATE inventory_groups SET active=FALSE,exhausted_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.group_id]);
      } else if (item.inventory_ref_type === 'ITEM') {
        const stock = await client.query(`SELECT * FROM inventory_items WHERE id=$1 FOR UPDATE`, [item.inventory_ref_id]);
        if (!stock.rows[0]) throw new Error('RESERVATION_LOST');
        payload = decryptJson(stock.rows[0].encrypted_payload);
        await client.query(`UPDATE inventory_items SET status='SOLD',reserved_until=NULL WHERE id=$1`, [item.inventory_ref_id]);
      } else if (item.stock_mode === 'UNLIMITED') {
        payload = item.metadata?.delivery || { message: order.locale === 'ar' ? 'سيتم إرسال التفاصيل لك قريباً.' : 'Delivery details will be sent soon.' };
      }

      if (item.delivery_mode === 'WAIT_CODE') {
        status = 'WAIT_CODE';
        manual = true;
        payload = { ...(payload || {}), waiting_for_code: true };
      } else if (item.delivery_mode === 'MANUAL' || item.stock_mode === 'MANUAL') {
        status = 'MANUAL';
        manual = true;
        payload = { message: order.locale === 'ar' ? 'تم استلام طلبك، وسيقوم فريق المتجر بالتسليم يدوياً.' : 'Your order was received and will be delivered manually.' };
      }

      await client.query(
        `UPDATE order_items SET fulfillment_status=$2,encrypted_delivery=$3,access_expires_at=$4,updated_at=NOW() WHERE id=$1`,
        [item.id, status, encryptJson(payload || {}), accessExpiresAt],
      );
      deliveries.push({ ...item, payload, fulfillment_status: status, access_expires_at: accessExpiresAt });
    }

    const status = manual ? 'MANUAL_REVIEW' : 'FULFILLED';
    await client.query(
      `UPDATE orders SET status=$2,payment_reference=COALESCE($3,payment_reference),paid_at=NOW(),fulfilled_at=CASE WHEN $2='FULFILLED' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1`,
      [order.id, status, paymentReference],
    );
    await client.query(`INSERT INTO order_events(order_id,event_type,message,metadata) VALUES($1,'PAID','Payment confirmed',$2::jsonb)`, [order.id, JSON.stringify(raw)]);
    return { ...order, status, deliveries };
  });

  const first = result.deliveries?.[0];
  const adminText = `🛒 <b>طلب مدفوع #${result.order_number}</b>\nالزبون: ${result.customer_name}\nالتواصل: ${result.customer_contact}\nالحالة: ${result.status}${first?.fulfillment_status === 'WAIT_CODE' ? '\n⚠️ الزبون ينتظر كود الدخول' : ''}`;
  await notifyAdmin(adminText, {
    reply_markup: { inline_keyboard: [[{ text: 'فتح الطلب', url: `${config.appUrl}/admin/orders/${result.id}` }]] },
  });
  if (result.customer_telegram_id) {
    const text = result.locale === 'ar'
      ? `✅ تم تأكيد دفع طلبك #${result.order_number}\nاضغط لعرض تفاصيل التسليم.`
      : `✅ Payment confirmed for order #${result.order_number}.\nTap to view delivery details.`;
    await sendTelegram(result.customer_telegram_id, text, {
      reply_markup: { inline_keyboard: [[{ text: result.locale === 'ar' ? 'عرض الطلب' : 'View order', url: `${config.appUrl}/order/${result.id}?token=${result.public_token}` }]] },
    }).catch(console.error);
  }
  return result;
}

export async function completeManualDelivery(orderId, orderItemId, codeOrMessage) {
  return transaction(async (client) => {
    const row = await client.query(`SELECT oi.*,o.public_token,o.customer_telegram_id,o.locale,o.order_number FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=$1 AND o.id=$2 FOR UPDATE`, [orderItemId, orderId]);
    if (!row.rows[0]) throw new Error('ORDER_ITEM_NOT_FOUND');
    const current = row.rows[0].encrypted_delivery ? decryptJson(row.rows[0].encrypted_delivery) : {};
    const delivery = { ...current, code: codeOrMessage, waiting_for_code: false };
    await client.query(`UPDATE order_items SET encrypted_delivery=$2,fulfillment_status='DELIVERED',updated_at=NOW() WHERE id=$1`, [orderItemId, encryptJson(delivery)]);
    const remaining = await client.query(`SELECT COUNT(*)::int AS count FROM order_items WHERE order_id=$1 AND fulfillment_status IN ('WAIT_CODE','MANUAL','PENDING','RESERVED')`, [orderId]);
    if (remaining.rows[0].count === 0) await client.query(`UPDATE orders SET status='FULFILLED',fulfilled_at=NOW(),updated_at=NOW() WHERE id=$1`, [orderId]);
    return { ...row.rows[0], delivery };
  });
}

export async function getPublicOrder(orderId, publicToken) {
  const orderResult = await query(`SELECT * FROM orders WHERE id=$1 AND public_token=$2`, [orderId, publicToken]);
  const order = orderResult.rows[0];
  if (!order) return null;
  const items = await query(
    `SELECT oi.*,p.name_ar AS product_name_ar,p.name_en AS product_name_en,v.name_ar AS variant_name_ar,v.name_en AS variant_name_en
     FROM order_items oi JOIN product_variants v ON v.id=oi.variant_id JOIN products p ON p.id=v.product_id WHERE oi.order_id=$1`, [order.id],
  );
  order.items = items.rows.map((item) => ({ ...item, delivery: item.encrypted_delivery ? decryptJson(item.encrypted_delivery) : null }));
  return order;
}

export async function getAdminOrder(orderId) {
  const orderResult = await query(`SELECT * FROM orders WHERE id=$1`, [orderId]);
  if (!orderResult.rows[0]) return null;
  const order = orderResult.rows[0];
  const items = await query(
    `SELECT oi.*,p.name_ar AS product_name_ar,p.name_en AS product_name_en,v.name_ar AS variant_name_ar,v.name_en AS variant_name_en
     FROM order_items oi JOIN product_variants v ON v.id=oi.variant_id JOIN products p ON p.id=v.product_id WHERE oi.order_id=$1`, [order.id],
  );
  order.items = items.rows.map((item) => ({ ...item, delivery: item.encrypted_delivery ? decryptJson(item.encrypted_delivery) : null }));
  return order;
}

export async function cancelOrderAndRelease(orderId, reason = 'Payment creation failed') {
  return transaction(async (client) => {
    const items = await client.query(`SELECT * FROM order_items WHERE order_id=$1 FOR UPDATE`, [orderId]);
    for (const item of items.rows) {
      if (item.inventory_ref_type === 'SLOT') {
        await client.query(`UPDATE inventory_slots SET status='AVAILABLE',reserved_until=NULL,order_item_id=NULL WHERE id=$1 AND status='RESERVED'`, [item.inventory_ref_id]);
      } else if (item.inventory_ref_type === 'ITEM') {
        await client.query(`UPDATE inventory_items SET status='AVAILABLE',reserved_until=NULL,order_item_id=NULL WHERE id=$1 AND status='RESERVED'`, [item.inventory_ref_id]);
      }
      await client.query(`UPDATE order_items SET fulfillment_status='CANCELLED',updated_at=NOW() WHERE id=$1`, [item.id]);
    }
    await client.query(`UPDATE orders SET status='CANCELLED',updated_at=NOW() WHERE id=$1 AND status='PENDING'`, [orderId]);
    await client.query(`INSERT INTO order_events(order_id,event_type,message) VALUES($1,'CANCELLED',$2)`, [orderId, reason]);
  });
}
