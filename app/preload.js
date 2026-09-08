const { ipcRenderer } = require('electron');

// ストレージ変更リスナー
const storageChangeListeners = new Set();
const runtimeMessageListeners = new Set();

// localStorage をバックエンドにした browser.storage.local ポリフィル
const storageLocal = {
  get: async (keys) => {
    const result = {};
    if (keys === null || keys === undefined) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        try {
          result[k] = JSON.parse(localStorage.getItem(k));
        } catch {
          result[k] = localStorage.getItem(k);
        }
      }
      return result;
    }

    if (typeof keys === 'string') {
      keys = [keys];
    }

    if (Array.isArray(keys)) {
      for (const k of keys) {
        const val = localStorage.getItem(k);
        if (val !== null) {
          try {
            result[k] = JSON.parse(val);
          } catch {
            result[k] = val;
          }
        }
      }
    } else if (typeof keys === 'object') {
      for (const k in keys) {
        const val = localStorage.getItem(k);
        if (val !== null) {
          try {
            result[k] = JSON.parse(val);
          } catch {
            result[k] = val;
          }
        } else {
          result[k] = keys[k];
        }
      }
    }
    return result;
  },

  set: async (items) => {
    const changes = {};
    for (const [k, v] of Object.entries(items)) {
      const oldValRaw = localStorage.getItem(k);
      let oldValue = undefined;
      if (oldValRaw !== null) {
        try {
          oldValue = JSON.parse(oldValRaw);
        } catch {
          oldValue = oldValRaw;
        }
      }
      localStorage.setItem(k, JSON.stringify(v));
      changes[k] = { oldValue, newValue: v };
    }

    // onChanged リスナーに通知
    for (const listener of storageChangeListeners) {
      try {
        listener(changes, 'local');
      } catch (err) {
        console.error('storage.onChanged listener error:', err);
      }
    }
  },

  remove: async (keys) => {
    if (typeof keys === 'string') keys = [keys];
    for (const k of keys) {
      localStorage.removeItem(k);
    }
  },

  clear: async () => {
    localStorage.clear();
  }
};

// browser API ポリフィル
window.browser = {
  storage: {
    local: storageLocal,
    onChanged: {
      addListener: (cb) => storageChangeListeners.add(cb),
      removeListener: (cb) => storageChangeListeners.delete(cb),
      hasListener: (cb) => storageChangeListeners.has(cb)
    }
  },

  runtime: {
    sendMessage: async (message) => {
      if (!message || !message.cmd) return null;

      switch (message.cmd) {
        case 'get-liveinfo':
          return await ipcRenderer.invoke('get-liveinfo', message.request_id);

        case 'open-nicolivehelper':
          return await ipcRenderer.invoke('open-main-window', message.request_id);

        default:
          // 拡張機能へ転送
          ipcRenderer.send('to-extension', message);
          return null;
      }
    },

    onMessage: {
      addListener: (cb) => runtimeMessageListeners.add(cb),
      removeListener: (cb) => runtimeMessageListeners.delete(cb),
      hasListener: (cb) => runtimeMessageListeners.has(cb)
    },

    openOptionsPage: () => {
      ipcRenderer.invoke('open-subwindow', {
        url: 'options/options.html',
        width: 650,
        height: 700,
        title: 'New NicoLive Helper 設定'
      });
    },

    getURL: (path) => path
  },

  windows: {
    create: async (options) => {
      let subUrl = options.url || '';
      // 相対パスの正規化
      if (subUrl.startsWith('../')) {
        subUrl = subUrl.replace(/^\.\.\//, '');
      } else if (subUrl.startsWith('main/')) {
        // main/main.html など
      } else {
        subUrl = 'main/' + subUrl;
      }

      await ipcRenderer.invoke('open-subwindow', {
        url: subUrl,
        width: options.width || 700,
        height: options.height || 500
      });
      return { id: 1 };
    },
    get: async () => ({ tabs: [] }),
    update: async () => {}
  },

  tabs: {
    create: async (options) => {
      if (options.url) {
        if (options.url.startsWith('http://') || options.url.startsWith('https://')) {
          ipcRenderer.invoke('open-external', options.url);
        } else {
          ipcRenderer.invoke('open-subwindow', { url: options.url });
        }
      }
    },
    sendMessage: async (tabId, message) => {
      ipcRenderer.send('to-extension', message);
    }
  },

  extension: {
    getURL: (path) => path
  },

  browserAction: {
    setBadgeText: () => {}
  }
};

// Chrome 互換用エイリアス
window.chrome = window.browser;

// メインプロセスからのメッセージ（拡張機能から届いたデータ等）を受信
ipcRenderer.on('from-extension', (event, data) => {
  console.log('[Preload] Received from extension:', data);
  for (const listener of runtimeMessageListeners) {
    try {
      listener(data, { id: 'extension' }, () => {});
    } catch (err) {
      console.error('runtime.onMessage listener error:', err);
    }
  }
});

// 新しい放送IDへ切り替え通知を受信
ipcRenderer.on('navigate-live', (event, lvid) => {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('lv', lvid);
  window.location.href = currentUrl.toString();
});