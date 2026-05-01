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
    media_lock: { photo: false, video: false, sticker: false, audio: false, gif: false },
    auto_clean_messages: false, banned_words: [],
    night_mode: { enabled: false, start_hour: 0, end_hour: 0 },
    captcha_enabled: false, anti_channel_chat: false, auto_replies: {}, notes: {}, pinned_messages_history: []
  };
}

async function setGroupSettings(chatId, settings) {
  if (!GROUP_SETTINGS_KV) return;
  await GROUP_SETTINGS_KV.put(chatId.toString(), JSON.stringify(settings));
}

async function getUserData(chatId, userId) {
  if (!USER_DATA_KV) return {};
  const key = `${chatId}_${userId}`;
  const data = await USER_DATA_KV.get(key);
  return data ? JSON.parse(data) : { warnings: 0 };
}

async function setUserData(chatId, userId, data) {
  if (!USER_DATA_KV) return;
  const key = `${chatId}_${userId}`;
  await USER_DATA_KV.put(key, JSON.stringify(data));
}

async function processUpdate(update) {
  if (update.message) {
    const message = update.message;
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text;
    const chatType = message.chat.type;
    const messageId = message.message_id;

    if (chatType === 'private') {
      if (text === '/start') {
        const keyboard = { inline_keyboard: [[{ text: 'إعدادات المجموعة التجريبية', callback_data: 'show_group_settings:-1001234567890' }]] };
        await sendMessage(chatId, 'أهلاً بك في لوحة تحكم البوت! اختر المجموعة التي تريد إدارتها:', keyboard);
      }
    } else if (chatType === 'group' || chatType === 'supergroup') {
      const settings = await getGroupSettings(chatId);
      const chatMember = await getChatMember(chatId, userId);
      const isAdmin = chatMember && (chatMember.status === 'creator' || chatMember.status === 'administrator');

      if (isAdmin) {
        if (text && text.includes('قفل الروابط')) {
          settings.links_locked = true;
          await setGroupSettings(chatId, settings);
          const sentMessage = await sendMessage(chatId, 'تم قفل الروابط بنجاح! 🔒');
          if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
        } else if (text && text.includes('افتح الروابط')) {
          settings.links_locked = false;
          await setGroupSettings(chatId, settings);
          const sentMessage = await sendMessage(chatId, 'تم فتح الروابط بنجاح! 🔓');
          if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
        } else if (text && text.includes('كتم') && message.reply_to_message) {
          const targetUserId = message.reply_to_message.from.id;
          const targetChatMember = await getChatMember(chatId, targetUserId);
          if (targetChatMember && (targetChatMember.status === 'member' || targetChatMember.status === 'restricted')) {
            await restrictChatMember(chatId, targetUserId, 60 * 60);
            const sentMessage = await sendMessage(chatId, `تم كتم ${message.reply_to_message.from.first_name} لمدة ساعة.`);
            if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
          }
        } else if (text && text.includes('طرد') && message.reply_to_message) {
          const targetUserId = message.reply_to_message.from.id;
          const targetChatMember = await getChatMember(chatId, targetUserId);
          if (targetChatMember && (targetChatMember.status === 'member' || targetChatMember.status === 'restricted')) {
            await kickChatMember(chatId, targetUserId);
            const sentMessage = await sendMessage(chatId, `تم طرد ${message.reply_to_message.from.first_name} من المجموعة.`);
            if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
          }
        } else if (text && text.includes('حظر') && message.reply_to_message) {
          const targetUserId = message.reply_to_message.from.id;
          const targetChatMember = await getChatMember(chatId, targetUserId);
          if (targetChatMember && (targetChatMember.status === 'member' || targetChatMember.status === 'restricted')) {
            await banChatMember(chatId, targetUserId);
            const sentMessage = await sendMessage(chatId, `تم حظر ${message.reply_to_message.from.first_name} من المجموعة نهائياً.`);
            if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
          }
        } else if (text && text.includes('انذار') && message.reply_to_message) {
          const targetUserId = message.reply_to_message.from.id;
          await giveWarning(chatId, targetUserId, settings);
          const sentMessage = await sendMessage(chatId, `تم إعطاء إنذار لـ ${message.reply_to_message.from.first_name}.`);
          if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
        }
      }

      if (settings.links_locked && containsLink(text)) {
        await deleteMessage(chatId, messageId);
        if (settings.warnings_enabled) {
          await giveWarning(chatId, userId, settings);
          const sentMessage = await sendMessage(chatId, `⚠️ ${message.from.first_name}, تم حذف رسالتك لاحتوائها على رابط.`);
          if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
        }
      }

      for (const bannedWord of settings.banned_words) {
        if (text && text.toLowerCase().includes(bannedWord.word.toLowerCase())) {
          await deleteMessage(chatId, messageId);
          await applyBannedWordAction(chatId, userId, bannedWord.action, bannedWord.duration, settings);
          const sentMessage = await sendMessage(chatId, `🚫 ${message.from.first_name}, تم حذف رسالتك لاحتوائها على كلمة محظورة.`);
          if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
          break;
        }
      }

      if (settings.media_lock.photo && message.photo) {
        await deleteMessage(chatId, messageId);
        const sentMessage = await sendMessage(chatId, `🚫 ${message.from.first_name}, لا يسمح بإرسال الصور حالياً.`);
        if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
      }

      for (const keyword in settings.auto_replies) {
        if (text && text.toLowerCase().includes(keyword.toLowerCase())) {
          const sentMessage = await sendMessage(chatId, settings.auto_replies[keyword]);
          if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
          break;
        }
      }

      if (message.new_chat_members) {
        for (const member of message.new_chat_members) {
          if (settings.captcha_enabled) {
            await sendCaptcha(chatId, member.id, member.first_name);
          }
        }
      }

      if (settings.night_mode.enabled) {
        const now = new Date();
        const currentHour = now.getHours();
        const start = settings.night_mode.start_hour;
        const end = settings.night_mode.end_hour;
        let isNightTime = start < end ? (currentHour >= start && currentHour < end) : (currentHour >= start || currentHour < end);
        if (isNightTime && !isAdmin) {
          await deleteMessage(chatId, messageId);
          const sentMessage = await sendMessage(chatId, `😴 ${message.from.first_name}, المجموعة مقفلة حالياً لوضع الليل.`);
          if (settings.auto_clean_messages) await deleteMessageAfterDelay(chatId, sentMessage.message_id, 30000);
        }
      }
    }
  } else if (update.callback_query) {
    const callbackQuery = update.callback_query;
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;

    if (data.startsWith('show_group_settings:')) {
      const targetChatId = data.split(':')[1];
      const settings = await getGroupSettings(targetChatId);
      await sendGroupSettingsMenu(chatId, messageId, targetChatId, settings);
    } else if (data.startsWith('toggle_links:')) {
      const targetChatId = data.split(':')[1];
      const settings = await getGroupSettings(targetChatId);
      settings.links_locked = !settings.links_locked;
      await setGroupSettings(targetChatId, settings);
      await sendGroupSettingsMenu(chatId, messageId, targetChatId, settings);
    } else if (data.startsWith('toggle_media:')) {
      const parts = data.split(':');
      const mediaType = parts[1];
      const targetChatId = parts[2];
      const settings = await getGroupSettings(targetChatId);
      settings.media_lock[mediaType] = !settings.media_lock[mediaType];
      await setGroupSettings(targetChatId, settings);
      await sendGroupSettingsMenu(chatId, messageId, targetChatId, settings);
    } else if (data === 'main_menu') {
      const keyboard = { inline_keyboard: [[{ text: 'إعدادات المجموعة التجريبية', callback_data: 'show_group_settings:-1001234567890' }]] };
      await editMessageText(chatId, messageId, 'أهلاً بك في لوحة تحكم البوت! اختر المجموعة التي تريد إدارتها:', keyboard);
    } else if (data.startsWith('captcha_verify:')) {
      const targetUserId = parseInt(data.split(':')[1]);
      const targetChatId = parseInt(data.split(':')[2]);
      await restrictChatMember(targetChatId, targetUserId, 0);
      await deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id);
      await sendMessage(targetChatId, `✅ ${callbackQuery.from.first_name}, تم التحقق بنجاح! مرحباً بك.`);
    }
    await answerCallbackQuery(callbackQuery.id);
  }
}

async function sendMessage(chatId, text, replyMarkup = null) {
  const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return response.json().then(data => data.result);
}

async function editMessageText(chatId, messageId, text, replyMarkup = null) {
  const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await fetch(`${TELEGRAM_API}/editMessageText`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
}

async function deleteMessage(chatId, messageId) {
  await fetch(`${TELEGRAM_API}/deleteMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  });
}

async function answerCallbackQuery(callbackQueryId) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId })
  });
}

async function getChatMember(chatId, userId) {
  const response = await fetch(`${TELEGRAM_API}/getChatMember`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: userId })
  });
  const data = await response.json();
  return data.ok ? data.result : null;
}

async function unbanChatMember(chatId, userId) {
  await fetch(`${TELEGRAM_API}/unbanChatMember`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: userId })
  });
}

function containsLink(text) {
  if (!text) return false;
  return /(https?:\/\/[^\s]+)/g.test(text);
}

async function giveWarning(chatId, userId, settings) {
  if (!settings.warnings_enabled) return;
  const userData = await getUserData(chatId, userId);
  userData.warnings = (userData.warnings || 0) + 1;
  await setUserData(chatId, userId, userData);
  if (userData.warnings >= settings.max_warnings) {
    if (settings.warn_action === 'kick') await kickChatMember(chatId, userId);
    else if (settings.warn_action === 'ban') await banChatMember(chatId, userId);
    else if (settings.warn_action === 'mute') await restrictChatMember(chatId, userId, 60 * 60 * 24);
    userData.warnings = 0;
    await setUserData(chatId, userId, userData);
  }
}

async function applyBannedWordAction(chatId, userId, action, duration, settings) {
  if (action === 'warn') await giveWarning(chatId, userId, settings);
  else if (action === 'mute') await restrictChatMember(chatId, userId, duration || 60 * 60);
  else if (action === 'kick') await kickChatMember(chatId, userId);
  else if (action === 'ban') await banChatMember(chatId, userId);
}

async function restrictChatMember(chatId, userId, untilDate) {
  await fetch(`${TELEGRAM_API}/restrictChatMember`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: userId, permissions: { can_send_messages: false }, until_date: untilDate ? Math.floor(Date.now() / 1000) + untilDate : 0 })
  });
}

async function kickChatMember(chatId, userId) {
  await fetch(`${TELEGRAM_API}/kickChatMember`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: userId })
  });
  await unbanChatMember(chatId, userId);
}

async function banChatMember(chatId, userId) {
  await fetch(`${TELEGRAM_API}/banChatMember`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: userId })
  });
}

async function sendCaptcha(chatId, userId, userName) {
  await restrictChatMember(chatId, userId, 0);
  const keyboard = { inline_keyboard: [[{ text: 'أنا لست روبوت! اضغط هنا ✅', callback_data: `captcha_verify:${userId}:${chatId}` }]] };
  await sendMessage(chatId, `مرحباً ${userName}! يرجى الضغط على الزر أدناه لإثبات أنك لست روبوت. لديك 5 دقائق.`, keyboard);
}

async function sendGroupSettingsMenu(chatId, messageId, targetChatId, settings) {
  const linksStatus = settings.links_locked ? '🔴 مقفلة' : '🟢 مفتوحة';
  const photoStatus = settings.media_lock.photo ? '🔴 مقفلة' : '🟢 مفتوحة';
  const videoStatus = settings.media_lock.video ? '🔴 مقفلة' : '🟢 مفتوحة';
  const stickerStatus = settings.media_lock.sticker ? '🔴 مقفلة' : '🟢 مفتوحة';
  const audioStatus = settings.media_lock.audio ? '🔴 مقفلة' : '🟢 مفتوحة';
  const gifStatus = settings.media_lock.gif ? '🔴 مقفلة' : '🟢 مفتوحة';
  const warningsStatus = settings.warnings_enabled ? '🟢 مفعل' : '🔴 معطل';
  const captchaStatus = settings.captcha_enabled ? '🟢 مفعل' : '🔴 معطل';
  const nightModeStatus = settings.night_mode.enabled ? '🟢 مفعل' : '🔴 معطل';
  const autoCleanStatus = settings.auto_clean_messages ? '🟢 مفعل' : '🔴 معطل';
  const antiChannelStatus = settings.anti_channel_chat ? '🟢 مفعل' : '🔴 معطل';
  const keyboard = {
    inline_keyboard: [
      [{ text: `الروابط: ${linksStatus}`, callback_data: `toggle_links:${targetChatId}` }],
      [{ text: `الصور: ${photoStatus}`, callback_data: `toggle_media:photo:${targetChatId}` }, { text: `الفيديو: ${videoStatus}`, callback_data: `toggle_media:video:${targetChatId}` }],
      [{ text: `الملصقات: ${stickerStatus}`, callback_data: `toggle_media:sticker:${targetChatId}` }, { text: `الصوت: ${audioStatus}`, callback_data: `toggle_media:audio:${targetChatId}` }],
      [{ text: `الصور المتحركة: ${gifStatus}`, callback_data: `toggle_media:gif:${targetChatId}` }],
      [{ text: `الإنذارات: ${warningsStatus}`, callback_data: `toggle_warnings:${targetChatId}` }],
      [{ text: `الكابتشا: ${captchaStatus}`, callback_data: `toggle_captcha:${targetChatId}` }],
      [{ text: `الوضع الليلي: ${nightModeStatus}`, callback_data: `toggle_night_mode:${targetChatId}` }],
      [{ text: `المنظف الذكي: ${autoCleanStatus}`, callback_data: `toggle_auto_clean:${targetChatId}` }],
      [{ text: `منع التحدث بالقنوات: ${antiChannelStatus}`, callback_data: `toggle_anti_channel:${targetChatId}` }],
      [{ text: 'إدارة الكلمات المحظورة', callback_data: `manage_banned_words:${targetChatId}` }],
      [{ text: 'إدارة الردود التلقائية', callback_data: `manage_auto_replies:${targetChatId}` }],
      [{ text: 'العودة للقائمة الرئيسية', callback_data: 'main_menu' }]
    ]
  };
  await editMessageText(chatId, messageId, `إعدادات المجموعة (${targetChatId}):`, keyboard);
}

async function deleteMessageAfterDelay(chatId, messageId, delay) {}

async function setWebhook(url) {
  const webhookUrl = `${TELEGRAM_API}/setWebhook?url=${url}`;
  const response = await fetch(webhookUrl);
  return response.json();
}
