const apiBase = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function telegramEnabled() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

async function telegramRequest(method, payload = {}, timeoutMs = 15_000) {
  if (!telegramEnabled()) throw new Error('TELEGRAM_BOT_TOKEN is missing');

  const response = await fetch(`${apiBase()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(body)}`);
  }
  return body.result;
}

export async function sendTelegram(chatId, text, extra = {}) {
  if (!telegramEnabled() || !chatId) return;
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

export async function notifyAdmin(text, extra = {}) {
  try {
    await sendTelegram(process.env.TELEGRAM_ADMIN_CHAT_ID, text, extra);
  } catch (error) {
    console.error('Telegram admin notification failed:', error.message);
  }
}

export async function handleTelegramUpdate(update) {
  const message = update?.message;
  if (!message?.chat?.id) return;

  const language = message.from?.language_code === 'ar' ? 'ar' : 'en';
  const text = language === 'ar'
    ? `أهلاً بك في <b>${process.env.APP_NAME || 'المتجر الرقمي'}</b>\nاضغط الزر لفتح المتجر.`
    : `Welcome to <b>${process.env.APP_NAME || 'the digital store'}</b>\nTap the button to open the store.`;

  await sendTelegram(message.chat.id, text, {
    reply_markup: {
      inline_keyboard: [[{
        text: language === 'ar' ? '🛍 فتح المتجر' : '🛍 Open store',
        url: process.env.APP_URL,
      }]],
    },
  });
}

export async function startTelegramPolling() {
  if (!telegramEnabled()) {
    console.log('Telegram disabled: TELEGRAM_BOT_TOKEN is empty');
    return;
  }

  // Polling avoids Railway/Telegram webhook 502 errors entirely.
  // Clear the old failing webhook and its stuck updates once on startup.
  await telegramRequest('deleteWebhook', { drop_pending_updates: true });
  const me = await telegramRequest('getMe');
  console.log(`Telegram polling started for @${me.username || me.id}`);

  let offset = 0;
  while (true) {
    try {
      const updates = await telegramRequest('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message'],
      }, 35_000);

      for (const update of updates) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        try {
          await handleTelegramUpdate(update);
        } catch (error) {
          console.error('Telegram update failed:', error.message);
        }
      }
    } catch (error) {
      console.error('Telegram polling error:', error.message);
      await sleep(3_000);
    }
  }
}
