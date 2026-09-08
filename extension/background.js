/*
 * New NicoLive Helper Bridge - Background Service Worker (MV3)
 */

console.log('[STSen Bridge] Background Service Worker loaded.');

const WS_URL = 'ws://127.0.0.1:18765';
let isAppConnected = false;

// コンテキストメニューの作成
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "menu_open_nicolivehelper_x",
    type: "normal",
    title: "Open New NicoLive Helper",
    contexts: ["all"]
  });

  chrome.contextMenus.create({
    id: "menu_copy_video_id",
    type: "normal",
    title: "ページ内の動画IDをコピー",
    contexts: ["all"],
    documentUrlPatterns: [
      "*://www.nicovideo.jp/tag/*",
      "*://www.nicovideo.jp/search/*",
      "*://com.nicovideo.jp/video/*",
      "*://www.nicovideo.jp/ranking*"
    ]
  });
});

// バッジ状態の更新
function updateBadge(connected) {
  isAppConnected = connected;
  if (connected) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: 'WAIT' });
    chrome.action.setBadgeBackgroundColor({ color: '#f39c12' });
  }
}

// ニコニコの認証 Cookie を取得してデスクトップアプリへ送信
async function syncCookiesToDesktopApp() {
  try {
    if (!chrome.cookies) {
      console.warn('[STSen Bridge] chrome.cookies API not available.');
      return;
    }

    const cookies = await chrome.cookies.getAll({ domain: 'nicovideo.jp' });
    console.log(`[STSen Bridge] Found ${cookies.length} cookies for nicovideo.jp`);

    if (cookies.length === 0) return;

    // 重要な Cookie を安全にシリアライズ
    const cookiePayload = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate
    }));

    sendToDesktopApp({
      cmd: 'sync-cookies',
      cookies: cookiePayload
    });
  } catch (err) {
    console.error('[STSen Bridge] Failed to sync cookies:', err);
  }
}

// デスクトップアプリへメッセージ送信
function sendToDesktopApp(message, onError) {
  try {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      ws.send(JSON.stringify(message));
      updateBadge(true);
      setTimeout(() => ws.close(), 500);
    };
    ws.onerror = (err) => {
      updateBadge(false);
      if (typeof onError === 'function') onError(err);
    };
  } catch (e) {
    updateBadge(false);
    if (typeof onError === 'function') onError(e);
  }
}

// 拡張機能アイコンクリック時の挙動
chrome.action.onClicked.addListener((tab) => {
  let lvid = 'lv0';
  if (tab && tab.url) {
    const match = tab.url.match(/nicovideo\.jp\/watch\/((lv|co|ch)\d+)/);
    if (match) lvid = match[1];
  }

  // まず Cookie を同期
  syncCookiesToDesktopApp();

  sendToDesktopApp(
    { cmd: 'open-nicolivehelper', request_id: lvid },
    () => {
      console.warn('[STSen Bridge] App is not running. Waiting for launch.');
    }
  );
});

// コンテキストメニュークリック
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'menu_open_nicolivehelper_x') {
    let lvid = 'lv0';
    if (tab && tab.url) {
      const match = tab.url.match(/nicovideo\.jp\/watch\/((lv|co|ch)\d+)/);
      if (match) lvid = match[1];
    }
    syncCookiesToDesktopApp();
    sendToDesktopApp({ cmd: 'open-nicolivehelper', request_id: lvid });
  } else if (info.menuItemId === 'menu_copy_video_id') {
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { cmd: 'get-video-id' }).catch(() => {});
    }
  }
});

// Content Script からのメッセージ受信
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.cmd === 'status-update') {
    updateBadge(request.connected);
    // 接続完了通知が来たら即座に Cookie も同期！
    if (request.connected) {
      syncCookiesToDesktopApp();
    }
  } else if (request.cmd === 'sync-cookies') {
    syncCookiesToDesktopApp();
  } else if (request.cmd === 'open-nicolivehelper' || request.cmd === 'put-liveinfo' || request.cmd === 'playvideo') {
    sendToDesktopApp(request);
  }
  return true;
});