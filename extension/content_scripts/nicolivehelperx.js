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

// -------------------------------------------------------------
// UI: アプリ起動促進 & 待機トースト通知
// -------------------------------------------------------------
let toastContainer = null;
let toastTimeout = null;

function createOrGetToast() {
  if (toastContainer && document.body.contains(toastContainer)) {
    return toastContainer;
  }

  toastContainer = document.createElement('div');
  toastContainer.id = 'stsen-bridge-toast-container';
  toastContainer.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    pointer-events: auto;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
}

// アプリ未起動時の待機中トースト表示
function showWaitingToast() {
  if (isConnected) return; // 既に接続済みなら出さない

  const container = createOrGetToast();
  container.innerHTML = `
    <div style="
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 18px;
      background: rgba(26, 28, 35, 0.95);
      color: #e0e6ed;
      border: 1px solid rgba(255, 170, 0, 0.4);
      border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(8px);
      max-width: 360px;
      box-sizing: border-box;
      animation: stsen-toast-in 0.3s ease-out;
    ">
      <div style="
        font-size: 20px;
        line-height: 1;
        padding-top: 2px;
      ">⏳</div>
      <div style="flex: 1;">
        <div style="font-weight: 600; color: #ffb74d; margin-bottom: 3px;">
          New NicoLive Helper 待機中
        </div>
        <div style="font-size: 12px; color: #b0bec5; line-height: 1.4;">
          デスクトップアプリが未起動です。<br>
          <strong style="color: #fff;">STSen アプリを起動</strong>してください。起動すると自動接続します。
        </div>
      </div>
      <button id="stsen-toast-close" style="
        background: transparent;
        border: none;
        color: #78909c;
        font-size: 16px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
      ">×</button>
    </div>
    <style>
      @keyframes stsen-toast-in {
        from { opacity: 0; transform: translateY(12px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
    </style>
  `;

  const closeBtn = container.querySelector('#stsen-toast-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      container.remove();
    });
  }
}

// 接続成功時のトースト表示（自動でフェードアウト）
function showConnectedToast() {
  const container = createOrGetToast();
  container.innerHTML = `
    <div style="
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      background: rgba(20, 36, 25, 0.95);
      color: #e8f5e9;
      border: 1px solid rgba(76, 175, 80, 0.5);
      border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(8px);
      max-width: 360px;
      box-sizing: border-box;
      animation: stsen-toast-in 0.3s ease-out;
    ">
      <div style="font-size: 18px; line-height: 1;">✅</div>
      <div style="flex: 1; font-weight: 600; font-size: 12.5px; color: #a5d6a7;">
        デスクトップアプリと接続しました
      </div>
    </div>
  `;

  // 2.5秒後に自動消去
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    if (container && container.parentNode) {
      container.style.opacity = '0';
      container.style.transform = 'translateY(10px)';
      setTimeout(() => {
        if (container.parentNode) container.parentNode.removeChild(container);
      }, 300);
    }
  }, 2500);
}

// -------------------------------------------------------------
// ローカル WebSocket 接続の管理
// -------------------------------------------------------------
const WS_URL = 'ws://127.0.0.1:18765';
let socket = null;
let isConnected = false;
let reconnectTimer = null;
let initialCheckTimer = null;

function notifyBackgroundStatus(connected) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        cmd: 'status-update',
        connected: connected
      }).catch(() => {});
    }
  } catch (e) {
    // Extension context invalidated を無視
  }
}

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
      const wasDisconnected = !isConnected;
      isConnected = true;
      notifyBackgroundStatus(true);

      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }

      // 未起動トーストが出ていた場合は接続成功トーストに切り替えて自動消去
      if (wasDisconnected) {
        showConnectedToast();
      }

      // Background に Cookie 同期を要求
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({ cmd: 'sync-cookies' }).catch(() => {});
        }
      } catch (e) {}

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
        console.log('[STSen Bridge] Disconnected from desktop app. Waiting for app...');
      }
      isConnected = false;
      notifyBackgroundStatus(false);
      scheduleReconnect();
    };

    socket.onerror = () => {
      isConnected = false;
      notifyBackgroundStatus(false);
    };
  } catch (e) {
    isConnected = false;
    notifyBackgroundStatus(false);
    scheduleReconnect();
  }
}

// 接続待機リトライループ
function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setInterval(() => {
      connectToApp();
    }, 2500);
  }
}

// アプリからのコマンド処理
function handleAppCommand(msg) {
  switch (msg.cmd) {
    case 'extend-live':
      const extendBtn = document.querySelector('button[aria-label="現在OFF"]');
      if (extendBtn) {
        extendBtn.click();
        console.log('[STSen Bridge] Clicked extend button.');
      }
      break;

    case 'start-live':
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

// 初回接続開始
connectToApp();

// ページロード後 1.5 秒経っても接続できない場合にトーストでアプリ起動を促す
initialCheckTimer = setTimeout(() => {
  if (!isConnected) {
    showWaitingToast();
  }
}, 1500);

// -------------------------------------------------------------
// 自動操作（拡張機能設定に基づく動作）
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// DOM変更監視（再生された動画IDの検知）
// -------------------------------------------------------------
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
  const bodyObserver = new MutationObserver(() => {
    const target = document.querySelector('div[class*="___lock-item-area"]');
    if (target) {
      bodyObserver.disconnect();
      observer.observe(target, { childList: true, subtree: true });
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}