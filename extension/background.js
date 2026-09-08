/*
 * New NicoLive Helper Bridge - Background Service Worker (MV3)
 */

console.log('[STSen Bridge] Background Service Worker loaded.');

const WS_URL = 'ws://127.0.0.1:8765';

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

// デスクトップアプリへメッセージ送信を試行する関数
function sendToDesktopApp(message) {
  try {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      ws.send(JSON.stringify(message));
      setTimeout(() => ws.close(), 500);
    };
    ws.onerror = (err) => {
      console.warn('[STSen Bridge] Could not connect to desktop app:', err);
    };
  } catch (e) {
    console.error('[STSen Bridge] WebSocket error:', e);
  }
}

// 拡張機能アイコンクリック時の挙動
chrome.action.onClicked.addListener((tab) => {
  if (tab.url) {
    const match = tab.url.match(/nicovideo\.jp\/watch\/((lv|co|ch)\d+)/);
    const lvid = match ? match[1] : '';
    sendToDesktopApp({
      cmd: 'open-nicolivehelper',
      request_id: lvid
    });
  } else {
    sendToDesktopApp({
      cmd: 'open-nicolivehelper',
      request_id: 'lv0'
    });
  }
});

// コンテキストメニュークリック
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'menu_open_nicolivehelper_x') {
    let lvid = 'lv0';
    if (tab && tab.url) {
      const match = tab.url.match(/nicovideo\.jp\/watch\/((lv|co|ch)\d+)/);
      if (match) lvid = match[1];
    }
    sendToDesktopApp({
      cmd: 'open-nicolivehelper',
      request_id: lvid
    });
  } else if (info.menuItemId === 'menu_copy_video_id') {
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { cmd: 'get-video-id' }).catch(() => {});
    }
  }
});

// Content Script からのメッセージ受信
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.cmd === 'open-nicolivehelper' || request.cmd === 'put-liveinfo' || request.cmd === 'playvideo') {
    sendToDesktopApp(request);
  }
  return true;
});