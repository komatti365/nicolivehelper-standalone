/*
 * New NicoLive Helper Bridge - Content Script (MV3)
 */

console.log('[STSen Bridge] Content script loaded on nicolive watch page.');

let liveData = null;
const embeddedDataElem = document.querySelector('#embedded-data');
if (embeddedDataElem) {
  try {
    liveData = JSON.parse(embeddedDataElem.getAttribute('data-props'));
    liveData._type = 'html5';
    console.log('[STSen Bridge] html5 nicolive player data detected:', liveData);
  } catch (e) {
    console.error('[STSen Bridge] Failed to parse #embedded-data:', e);
  }
}

// ローカル WebSocket 接続の管理
const WS_URL = 'ws://127.0.0.1:8765';
let socket = null;
let isConnected = false;
let reconnectTimer = null;

function sendToApp(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    return true;
  }
  return false;
}

function connectToApp() {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      console.log('[STSen Bridge] Connected to desktop app via WebSocket.');
      isConnected = true;
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }

      // 接続成功時に番組データを送信
      if (liveData) {
        sendToApp({
          cmd: 'put-liveinfo',
          liveinfo: liveData
        });
      }
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[STSen Bridge] Received from desktop app:', msg);
        handleAppCommand(msg);
      } catch (err) {
        console.error('[STSen Bridge] Error parsing message from app:', err);
      }
    };

    socket.onclose = () => {
      if (isConnected) {
        console.log('[STSen Bridge] Disconnected from desktop app. Retrying...');
      }
      isConnected = false;
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      // 接続失敗（アプリ未起動時など）
      isConnected = false;
    };
  } catch (e) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setInterval(() => {
      connectToApp();
    }, 3000);
  }
}

// アプリからのコマンド処理
function handleAppCommand(msg) {
  switch (msg.cmd) {
    case 'extend-live':
      // 枠自動延長ボタンをクリック
      const extendBtn = document.querySelector('button[aria-label="現在OFF"]');
      if (extendBtn) {
        extendBtn.click();
        console.log('[STSen Bridge] Clicked extend button.');
      }
      break;

    case 'start-live':
      // 放送開始ボタンをクリック
      const startBtn = document.querySelector('button[class*="__button"][value="番組開始"]');
      if (startBtn) {
        startBtn.click();
        console.log('[STSen Bridge] Clicked start button.');
      }
      break;

    case 'get-liveinfo':
      if (liveData) {
        sendToApp({
          cmd: 'put-liveinfo',
          liveinfo: liveData
        });
      }
      break;
  }
}

// WebSocket 接続開始
connectToApp();

// バックグラウンド・Service Worker との通信フォールバック（念のため）
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
  if (liveData) {
    chrome.runtime.sendMessage({
      cmd: 'put-liveinfo',
      liveinfo: liveData
    }).catch(() => {});
  }
}

// 自動操作（拡張機能設定に基づく動作）
(async () => {
  let config = {};
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get('config');
      config = res.config || {};
    }
  } catch (e) {}

  if (config['auto-extend']) {
    setTimeout(() => {
      const autoExtendBtn = document.querySelector('button[aria-label="現在OFF"]');
      if (autoExtendBtn) autoExtendBtn.click();
    }, 2000);
  }

  const startButton = document.querySelector('button[class*="__button"][value="番組開始"]');
  if (startButton) {
    startButton.addEventListener('click', () => {
      console.log('[STSen Bridge] Start button manually clicked.');
    });
  }

  if (config['auto-start']) {
    setTimeout(() => {
      if (startButton) startButton.click();
    }, 2000);
  }

  if (config['auto-open'] && liveData) {
    setTimeout(() => {
      const lvid = liveData.program.nicoliveProgramId;
      sendToApp({
        cmd: 'open-nicolivehelper',
        request_id: lvid
      });
    }, 1000);
  }
})();

// DOM変更監視（再生された動画IDの検知）
const observerCallback = (mutationsList) => {
  for (const mutation of mutationsList) {
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) {
        if (node.querySelector) {
          const img = node.querySelector('img');
          if (img && img.src && img.src.match(/nicovideo\.cdn\.nimg\.jp\/thumbnails\/\d+\/(\d+)/)) {
            const vid = RegExp.$1;
            console.log(`[STSen Bridge] Video detected: sm${vid}`);
            sendToApp({
              cmd: 'playvideo',
              video_id: vid,
              lvid: liveData ? liveData.program.nicoliveProgramId : ''
            });
          }
        }
      }
    }
  }
};

const observer = new MutationObserver(observerCallback);
const lockItemArea = document.querySelector('div[class*="___lock-item-area"]');
if (lockItemArea) {
  observer.observe(lockItemArea, { childList: true, subtree: true });
} else {
  // 後から追加される場合に対応
  const bodyObserver = new MutationObserver(() => {
    const target = document.querySelector('div[class*="___lock-item-area"]');
    if (target) {
      bodyObserver.disconnect();
      observer.observe(target, { childList: true, subtree: true });
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}