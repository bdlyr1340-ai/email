const apiBase = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export function telegramEnabled() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function sendTelegram(chatId, text, extra = {}) {
  if (!telegramEnabled() || !chatId) return;
  const response = await fetch(`${apiBase()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
  });
  if (!response.ok) throw new Error(`Telegram error: ${await response.text()}`);
}

export async function notifyAdmin(text, extra = {}) {
  try {
    await sendTelegram(process.env.TELEGRAM_ADMIN_CHAT_ID, text, extra);
  } catch (error) {
    console.error(error);
  }
}

export async function configureTelegramWebhook() {
  if (!telegramEnabled() || !process.env.APP_URL || !process.env.TELEGRAM_WEBHOOK_SECRET) return;
  const response = await fetch(`${apiBase()}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${process.env.APP_URL.replace(/\/$/, '')}/webhooks/telegram`,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message'],
    }),
  });
  if (!response.ok) console.error('Telegram webhook setup failed:', await response.text());
}

export async function handleTelegramUpdate(update) {
  const message = update?.message;
  if (!message?.chat?.id) return;
  const language = message.from?.language_code === 'ar' ? 'ar' : 'en';
  const text = language === 'ar'
    ? `أهلاً بك في <b>${process.env.APP_NAME || 'المتجر الرقمي'}</b>\nاضغط الزر لفتح المتجر.`
    : `Welcome to <b>${process.env.APP_NAME || 'the digital store'}</b>\nTap the button to open the store.`;
  await sendTelegram(message.chat.id, text, {
    reply_markup: { inline_keyboard: [[{ text: language === 'ar' ? '🛍 فتح المتجر' : '🛍 Open store', url: process.env.APP_URL }]] },
  });
}
