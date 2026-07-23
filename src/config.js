export const config = {
  appName: process.env.APP_NAME || 'متجري الرقمي',
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  defaultLocale: process.env.DEFAULT_LOCALE === 'en' ? 'en' : 'ar',
  reservationMinutes: Number(process.env.RESERVATION_MINUTES || 20),
  demoPayment: process.env.ENABLE_DEMO_PAYMENT === 'true',
  maxPendingPerContact: Number(process.env.MAX_PENDING_ORDERS_PER_CONTACT || 3),
  maxCheckoutsPerIp15m: Number(process.env.MAX_CHECKOUTS_PER_IP_15M || 8),
};

export function localeOf(req) {
  const requested = req.query.lang || req.cookies?.locale;
  return requested === 'en' ? 'en' : 'ar';
}
