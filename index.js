const BOT_TOKEN = 'YOUR_BOT_TOKEN'; 
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const GROUP_SETTINGS_KV = typeof GROUP_SETTINGS !== 'undefined' ? GROUP_SETTINGS : null;
const USER_DATA_KV = typeof USER_DATA !== 'undefined' ? USER_DATA : null;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method !== 'POST') {
    return new Response('Only POST requests are accepted from Telegram', { status: 200 });
  }
  try {
    const update = await request.json();
    await processUpdate(update);
    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Error processing update:', e);
    return new Response('Error', { status: 500 });
  }
}

async function getGroupSettings(chatId) {
  if (!GROUP_SETTINGS_KV) return {};
  const settings = await GROUP_SETTINGS_KV.get(chatId.toString());
  return settings ? JSON.parse(settings) : {
    links_locked: false, warnings_enabled: true, max_warnings: 3, warn_action: 'kick',
    media_lock: { photo: false, video: false, sticker: false, audio: false, gif: false },​​​​​​​​​​​​​​​​
