import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import slugify from 'slugify';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate, query, transaction } from './db.js';
import { config, localeOf } from './config.js';
import { createAdminToken, requireAdmin, validateAdmin } from './auth.js';
import { translateArabicObject } from './translate.js';
import { createChallenge, enforceCheckoutAbuseLimits, requestIdentity, verifyChallenge, verifyTurnstile } from './security.js';
import { addInventory, listInventoryForVariant } from './inventory.js';
import { createOrder, markOrderPaid, getPublicOrder, getAdminOrder, completeManualDelivery, cancelOrderAndRelease } from './orders.js';
import { createPayment } from './payments/index.js';
import { parseBinanceWebhook, verifyBinanceWebhook } from './payments/binance.js';
import { verifySuperQiWebhook } from './payments/superqi.js';
import { configureTelegramWebhook, handleTelegramUpdate, notifyAdmin } from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb', verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0 }));

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const checkoutLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 15, standardHeaders: true, legacyHeaders: false });

const labels = {
  ar: {
    home: 'الرئيسية', orders: 'طلباتي', admin: 'الإدارة', buy: 'شراء الآن', choose: 'اختر النوع',
    available: 'متوفر', unavailable: 'غير متوفر', iqd: 'د.ع', shared: 'مشترك', personal: 'شخصي',
  },
  en: {
    home: 'Home', orders: 'Orders', admin: 'Admin', buy: 'Buy now', choose: 'Choose a plan',
    available: 'Available', unavailable: 'Unavailable', iqd: 'IQD', shared: 'Shared', personal: 'Personal',
  },
};

app.use((req, res, next) => {
  const locale = localeOf(req);
  if (req.query.lang === 'ar' || req.query.lang === 'en') res.cookie('locale', req.query.lang, { maxAge: 365 * 86400_000, sameSite: 'lax' });
  res.locals.locale = locale;
  res.locals.rtl = locale === 'ar';
  res.locals.t = labels[locale];
  res.locals.appName = config.appName;
  res.locals.appUrl = config.appUrl;
  res.locals.money = (value, currency) => currency === 'USDT'
    ? `${Number(value).toFixed(2)} USDT`
    : `${Number(value || 0).toLocaleString(locale === 'ar' ? 'ar-IQ' : 'en-US')} ${locale === 'ar' ? 'د.ع' : 'IQD'}`;
  next();
});

app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, app: config.appName });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.get('/', async (req, res, next) => {
  try {
    const products = await query(
      `SELECT p.*,c.name_ar AS category_name_ar,c.name_en AS category_name_en,
       COALESCE(json_agg(json_build_object(
         'id',v.id,'name_ar',v.name_ar,'name_en',v.name_en,'sale_mode',v.sale_mode,
         'stock_mode',v.stock_mode,'price_iqd',v.price_iqd,'price_usdt',v.price_usdt,
         'shared_available',(SELECT COUNT(*) FROM inventory_slots s JOIN inventory_groups g ON g.id=s.group_id WHERE g.variant_id=v.id AND g.active=TRUE AND s.status='AVAILABLE'),
         'item_available',(SELECT COUNT(*) FROM inventory_items i WHERE i.variant_id=v.id AND i.status='AVAILABLE')
       ) ORDER BY v.sort_order) FILTER (WHERE v.id IS NOT NULL),'[]') AS variants
       FROM products p LEFT JOIN categories c ON c.id=p.category_id
       LEFT JOIN product_variants v ON v.product_id=p.id AND v.active=TRUE
       WHERE p.active=TRUE GROUP BY p.id,c.name_ar,c.name_en ORDER BY p.featured DESC,p.created_at DESC`,
    );
    res.render('store', { products: products.rows });
  } catch (error) { next(error); }
});

app.get('/product/:slug', async (req, res, next) => {
  try {
    const productResult = await query(`SELECT * FROM products WHERE slug=$1 AND active=TRUE`, [req.params.slug]);
    if (!productResult.rows[0]) return res.status(404).render('message', { title: '404', message: res.locals.locale === 'ar' ? 'المنتج غير موجود' : 'Product not found' });
    const variants = await query(
      `SELECT v.*,
       (SELECT COUNT(*)::int FROM inventory_slots s JOIN inventory_groups g ON g.id=s.group_id WHERE g.variant_id=v.id AND g.active=TRUE AND s.status='AVAILABLE') AS shared_available,
       (SELECT COUNT(*)::int FROM inventory_items i WHERE i.variant_id=v.id AND i.status='AVAILABLE') AS item_available
       FROM product_variants v WHERE v.product_id=$1 AND v.active=TRUE ORDER BY v.sort_order,v.created_at`, [productResult.rows[0].id],
    );
    res.render('product', {
      product: productResult.rows[0], variants: variants.rows, challenge: createChallenge(res.locals.locale),
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
      paymentOptions: {
        binance: config.demoPayment || process.env.BINANCE_PAY_ENABLED === 'true',
        superqi: config.demoPayment || process.env.SUPERQI_ENABLED === 'true',
      },
    });
  } catch (error) { next(error); }
});

app.post('/checkout/:variantId', checkoutLimiter, async (req, res, next) => {
  let order;
  try {
    if (req.body.website) throw new Error('BOT_DETECTED');
    if (!verifyChallenge(req.body.challenge_token, req.body.challenge_answer)) throw new Error('CAPTCHA_FAILED');
    const identity = requestIdentity(req);
    const turnstileOk = await verifyTurnstile(req.body['cf-turnstile-response'], req.ip);
    if (!turnstileOk) throw new Error('TURNSTILE_FAILED');
    const customerName = String(req.body.customer_name || '').trim();
    const customerContact = String(req.body.customer_contact || '').trim();
    const provider = req.body.payment_provider === 'BINANCE' ? 'BINANCE' : 'SUPERQI';
    if (customerName.length < 2 || customerContact.length < 3) throw new Error('INVALID_CUSTOMER');
    await enforceCheckoutAbuseLimits({ ipHash: identity.ipHash, contact: customerContact });
    const created = await createOrder({
      variantId: req.params.variantId,
      customerName,
      customerContact,
      customerTelegramId: String(req.body.telegram_id || '').trim() || null,
      locale: res.locals.locale,
      provider,
      ...identity,
    });
    order = created.order;
    const payment = await createPayment(order);
    await notifyAdmin(`🧾 <b>طلب جديد #${order.order_number}</b>\n${customerName}\n${customerContact}\nبانتظار الدفع عبر ${provider}`);
    return res.redirect(payment.paymentUrl);
  } catch (error) {
    if (order?.id) await cancelOrderAndRelease(order.id, error.message).catch(console.error);
    const messages = {
      CAPTCHA_FAILED: res.locals.locale === 'ar' ? 'إجابة التحقق غير صحيحة.' : 'The verification answer is incorrect.',
      TURNSTILE_FAILED: res.locals.locale === 'ar' ? 'تعذر التحقق من أنك مستخدم حقيقي.' : 'Human verification failed.',
      OUT_OF_STOCK: res.locals.locale === 'ar' ? 'نفد مخزون هذا الخيار.' : 'This option is out of stock.',
      TOO_MANY_PENDING: res.locals.locale === 'ar' ? 'عندك طلبات غير مدفوعة كثيرة. أكملها أو انتظر قليلاً.' : 'You have too many pending orders.',
      TOO_MANY_CHECKOUTS: res.locals.locale === 'ar' ? 'محاولات كثيرة، حاول بعد قليل.' : 'Too many attempts. Try again later.',
    };
    res.status(400).render('message', { title: res.locals.locale === 'ar' ? 'تعذر إنشاء الطلب' : 'Could not create order', message: messages[error.message] || error.message });
  }
});

app.get('/payment/demo/:orderId', async (req, res, next) => {
  try {
    if (!config.demoPayment) return res.sendStatus(404);
    const paid = await markOrderPaid(req.params.orderId, `DEMO-${Date.now()}`, { demo: true });
    res.redirect(`/order/${paid.id}?token=${paid.public_token}`);
  } catch (error) { next(error); }
});

app.get('/payment/result', async (req, res) => {
  if (req.query.order && req.query.token) return res.redirect(`/order/${req.query.order}?token=${req.query.token}`);
  res.render('message', { title: res.locals.locale === 'ar' ? 'نتيجة الدفع' : 'Payment result', message: res.locals.locale === 'ar' ? 'يتم تحديث حالة الدفع تلقائياً. ارجع إلى رابط طلبك.' : 'Payment status updates automatically. Return to your order link.' });
});

app.get('/order/:id', async (req, res, next) => {
  try {
    const order = await getPublicOrder(req.params.id, req.query.token);
    if (!order) return res.status(404).render('message', { title: '404', message: res.locals.locale === 'ar' ? 'رابط الطلب غير صحيح.' : 'Invalid order link.' });
    res.render('order', { order });
  } catch (error) { next(error); }
});

app.post('/webhooks/superqi', async (req, res) => {
  try {
    const signature = req.get('X-Signature');
    if (!verifySuperQiWebhook(req.body, signature)) return res.status(401).json({ ok: false });
    if (req.body.status === 'SUCCESS') {
      const payment = await query(`SELECT order_id FROM payments WHERE provider='SUPERQI' AND external_id=$1`, [req.body.paymentId]);
      if (payment.rows[0]) await markOrderPaid(payment.rows[0].order_id, req.body.paymentId, req.body);
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(200).json({ ok: false });
  }
});

app.post('/webhooks/binance', async (req, res) => {
  try {
    if (!verifyBinanceWebhook(req.rawBody, req.headers)) return res.status(401).json({ returnCode: 'FAIL', returnMessage: 'Invalid signature' });
    const parsed = parseBinanceWebhook(req.body);
    if (parsed.paid) {
      const payment = await query(`SELECT order_id FROM payments WHERE provider='BINANCE' AND external_id=$1`, [parsed.externalId]);
      if (payment.rows[0]) await markOrderPaid(payment.rows[0].order_id, parsed.externalId, parsed.raw);
    }
    res.json({ returnCode: 'SUCCESS', returnMessage: null });
  } catch (error) {
    console.error(error);
    res.status(200).json({ returnCode: 'SUCCESS', returnMessage: null });
  }
});

app.post('/webhooks/telegram', async (req, res) => {
  if (process.env.TELEGRAM_WEBHOOK_SECRET && req.get('X-Telegram-Bot-Api-Secret-Token') !== process.env.TELEGRAM_WEBHOOK_SECRET) return res.sendStatus(401);
  await handleTelegramUpdate(req.body).catch(console.error);
  res.json({ ok: true });
});

// ---------- Admin ----------
app.get('/admin/login', (_req, res) => res.render('admin/login', { error: null }));
app.post('/admin/login', loginLimiter, (req, res) => {
  if (!validateAdmin(req.body.email, req.body.password)) return res.status(401).render('admin/login', { error: 'بيانات الدخول غير صحيحة' });
  res.cookie('admin_token', createAdminToken(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 12 * 3600_000 });
  res.redirect('/admin');
});
app.post('/admin/logout', (_req, res) => { res.clearCookie('admin_token'); res.redirect('/admin/login'); });

app.get('/admin', requireAdmin, async (_req, res, next) => {
  try {
    const [products, orders, pending, stock] = await Promise.all([
      query(`SELECT COUNT(*)::int AS count FROM products`),
      query(`SELECT COUNT(*)::int AS count FROM orders`),
      query(`SELECT COUNT(*)::int AS count FROM orders WHERE status='MANUAL_REVIEW'`),
      query(`SELECT ((SELECT COUNT(*) FROM inventory_items WHERE status='AVAILABLE') + (SELECT COUNT(*) FROM inventory_slots WHERE status='AVAILABLE'))::int AS count`),
    ]);
    const recent = await query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 10`);
    res.render('admin/dashboard', { stats: { products: products.rows[0].count, orders: orders.rows[0].count, pending: pending.rows[0].count, stock: stock.rows[0].count }, recent: recent.rows });
  } catch (error) { next(error); }
});

app.get('/admin/products', requireAdmin, async (_req, res, next) => {
  try {
    const products = await query(`SELECT p.*,COUNT(v.id)::int AS variants FROM products p LEFT JOIN product_variants v ON v.product_id=p.id GROUP BY p.id ORDER BY p.created_at DESC`);
    res.render('admin/products', { products: products.rows });
  } catch (error) { next(error); }
});

app.get('/admin/products/new', requireAdmin, (_req, res) => res.render('admin/product-new', { error: null }));
app.post('/admin/products', requireAdmin, async (req, res, next) => {
  try {
    const nameAr = String(req.body.name_ar || '').trim();
    const descriptionAr = String(req.body.description_ar || '').trim();
    const variantAr = String(req.body.variant_name_ar || '').trim();
    const categoryAr = String(req.body.category_ar || 'عام').trim();
    if (!nameAr || !variantAr) throw new Error('اسم المنتج والخيار مطلوبان');
    const translated = await translateArabicObject({ name: nameAr, description: descriptionAr, variant: variantAr, category: categoryAr });
    const created = await transaction(async (client) => {
      const categorySlug = slugify(translated.category || categoryAr, { lower: true, strict: true }) || `category-${crypto.randomUUID().slice(0, 8)}`;
      let category = await client.query(`SELECT id FROM categories WHERE name_ar=$1 LIMIT 1`, [categoryAr]);
      if (!category.rows[0]) category = await client.query(`INSERT INTO categories(slug,name_ar,name_en) VALUES($1,$2,$3) RETURNING id`, [categorySlug, categoryAr, translated.category || categoryAr]);
      let slug = slugify(translated.name || nameAr, { lower: true, strict: true }) || `product-${crypto.randomUUID().slice(0, 8)}`;
      const duplicate = await client.query(`SELECT 1 FROM products WHERE slug=$1`, [slug]);
      if (duplicate.rows[0]) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
      const product = await client.query(
        `INSERT INTO products(category_id,slug,name_ar,name_en,description_ar,description_en,image_url,featured)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [category.rows[0].id, slug, nameAr, translated.name || nameAr, descriptionAr, translated.description || descriptionAr, req.body.image_url || null, req.body.featured === 'on'],
      );
      await client.query(
        `INSERT INTO product_variants(product_id,name_ar,name_en,sale_mode,stock_mode,delivery_mode,duration_days,price_iqd,price_usdt,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [product.rows[0].id, variantAr, translated.variant || variantAr, req.body.sale_mode, req.body.stock_mode, req.body.delivery_mode, req.body.duration_days || null, req.body.price_iqd || null, req.body.price_usdt || null, JSON.stringify({ shared_capacity: Number(req.body.shared_capacity || 5) })],
      );
      return product.rows[0];
    });
    res.redirect(`/admin/products/${created.id}`);
  } catch (error) {
    res.status(400).render('admin/product-new', { error: error.message });
  }
});

app.get('/admin/products/:id', requireAdmin, async (req, res, next) => {
  try {
    const product = await query(`SELECT * FROM products WHERE id=$1`, [req.params.id]);
    if (!product.rows[0]) return res.sendStatus(404);
    const variants = await query(
      `SELECT v.*,
       (SELECT COUNT(*)::int FROM inventory_slots s JOIN inventory_groups g ON g.id=s.group_id WHERE g.variant_id=v.id AND s.status='AVAILABLE') AS shared_available,
       (SELECT COUNT(*)::int FROM inventory_items i WHERE i.variant_id=v.id AND i.status='AVAILABLE') AS item_available
       FROM product_variants v WHERE v.product_id=$1 ORDER BY v.created_at`, [req.params.id],
    );
    res.render('admin/product-detail', { product: product.rows[0], variants: variants.rows });
  } catch (error) { next(error); }
});

app.post('/admin/products/:id/toggle', requireAdmin, async (req, res, next) => {
  try { await query(`UPDATE products SET active=NOT active,updated_at=NOW() WHERE id=$1`, [req.params.id]); res.redirect(`/admin/products/${req.params.id}`); } catch (error) { next(error); }
});

app.post('/admin/products/:id/variants', requireAdmin, async (req, res, next) => {
  try {
    const nameAr = String(req.body.name_ar || '').trim();
    const translated = await translateArabicObject({ name: nameAr });
    await query(
      `INSERT INTO product_variants(product_id,name_ar,name_en,sale_mode,stock_mode,delivery_mode,duration_days,price_iqd,price_usdt,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [req.params.id, nameAr, translated.name || nameAr, req.body.sale_mode, req.body.stock_mode, req.body.delivery_mode, req.body.duration_days || null, req.body.price_iqd || null, req.body.price_usdt || null, JSON.stringify({ shared_capacity: Number(req.body.shared_capacity || 5) })],
    );
    res.redirect(`/admin/products/${req.params.id}`);
  } catch (error) { next(error); }
});

app.get('/admin/variants/:id/inventory', requireAdmin, async (req, res, next) => {
  try {
    const variant = await query(`SELECT v.*,p.name_ar AS product_name FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1`, [req.params.id]);
    if (!variant.rows[0]) return res.sendStatus(404);
    const inventory = await listInventoryForVariant(req.params.id);
    res.render('admin/inventory', { variant: variant.rows[0], inventory, message: req.query.message || null });
  } catch (error) { next(error); }
});

app.post('/admin/variants/:id/inventory', requireAdmin, upload.single('inventory_file'), async (req, res, next) => {
  try {
    const variant = await query(`SELECT * FROM product_variants WHERE id=$1`, [req.params.id]);
    if (!variant.rows[0]) return res.sendStatus(404);
    const fileText = req.file ? req.file.buffer.toString('utf8') : '';
    const text = [req.body.inventory_text, fileText].filter(Boolean).join('\n');
    const created = await addInventory({ variantId: req.params.id, stockMode: variant.rows[0].stock_mode, text, capacity: req.body.capacity || variant.rows[0].metadata?.shared_capacity || 5, expiresAt: req.body.expires_at || null });
    res.redirect(`/admin/variants/${req.params.id}/inventory?message=${encodeURIComponent(`تمت إضافة ${created} حساب/عنصر`)}`);
  } catch (error) { next(error); }
});

app.get('/admin/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const order = await getAdminOrder(req.params.id);
    if (!order) return res.sendStatus(404);
    res.render('admin/order-detail', { order });
  } catch (error) { next(error); }
});

app.post('/admin/orders/:id/mark-paid', requireAdmin, async (req, res, next) => {
  try { await markOrderPaid(req.params.id, `ADMIN-${Date.now()}`, { admin: true }); res.redirect(`/admin/orders/${req.params.id}`); } catch (error) { next(error); }
});

app.post('/admin/orders/:id/deliver/:itemId', requireAdmin, async (req, res, next) => {
  try {
    const completed = await completeManualDelivery(req.params.id, req.params.itemId, String(req.body.code || '').trim());
    if (completed.customer_telegram_id) {
      const text = completed.locale === 'ar' ? `🔐 وصل كود طلبك #${completed.order_number}. افتح صفحة الطلب.` : `🔐 Your code for order #${completed.order_number} is ready.`;
      // notification is intentionally best-effort
      const { sendTelegram } = await import('./telegram.js');
      await sendTelegram(completed.customer_telegram_id, text, { reply_markup: { inline_keyboard: [[{ text: completed.locale === 'ar' ? 'فتح الطلب' : 'Open order', url: `${config.appUrl}/order/${req.params.id}?token=${completed.public_token}` }]] } }).catch(console.error);
    }
    res.redirect(`/admin/orders/${req.params.id}`);
  } catch (error) { next(error); }
});

app.use((error, req, res, _next) => {
  console.error(error);
  res.status(500).render('message', { title: res.locals.locale === 'ar' ? 'حدث خطأ' : 'Something went wrong', message: process.env.NODE_ENV === 'production' ? (res.locals.locale === 'ar' ? 'راجع الإعدادات أو حاول مرة ثانية.' : 'Check the configuration and try again.') : error.stack });
});

await migrate();
app.listen(process.env.PORT || 3000, async () => {
  console.log(`${config.appName} listening on port ${process.env.PORT || 3000}`);
  await configureTelegramWebhook().catch(console.error);
});
