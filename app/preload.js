// -------------------------------------------------------------
// XHR フック (withCredentials 自動有効化 & unsafe header エラー防止)
// -------------------------------------------------------------
try {
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    const res = originalOpen.apply(this, args);
    try { this.withCredentials = true; } catch (e) {}
    return res;
  };

  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
    if (header && (header.toLowerCase() === 'user-agent' || header.toLowerCase() === 'cookie')) {
      // メインプロセス側で注入するため、レンダラーでの unsafe header エラーを回避
      return;
    }
    return originalSetRequestHeader.apply(this, [header, value]);
  };
} catch (e) {
  console.error('[Preload] Failed to patch XMLHttpRequest:', e);
}

const { ipcRenderer } = require('electron');

console.log('[Preload] Initializing browser API polyfill in renderer...');

// window.prompt ポリフィル
window.prompt = function (message, defaultValue) {
  console.log('[Prompt called]', message, defaultValue);
  return defaultValue !== undefined ? String(defaultValue) : null;
};

const storageChangeListeners = new Set();
const runtimeMessageListeners = new Set();

// -------------------------------------------------------------
// storage.local (localStorage バックエンド)
// -------------------------------------------------------------
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

    if (typeof keys === 'string') keys = [keys];

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

    for (const listener of storageChangeListeners) {
      try {
        listener(changes, 'local');
      } catch (err) {
        console.error('storage.onChanged error:', err);
      }
    }
  },

  remove: async (keys) => {
    if (typeof keys === 'string') keys = [keys];
    for (const k of keys) localStorage.removeItem(k);
  },

  clear: async () => localStorage.clear()
};

// -------------------------------------------------------------
// window.browser ポリフィル本体
// -------------------------------------------------------------
window.browser = {
  // management API
  management: {
    getSelf: async () => {
      return {
        id: 'stsen-app',
        name: 'New NicoLive Helper',
        version: '1.0.0',
        installType: 'development',
        type: 'extension'
      };
    }
  },

  // windows API
  windows: {
    getCurrent: async () => {
      return {
        id: 1,
        left: window.screenX,
        top: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
        focused: true
      };
    },
    update: async (id, info) => {
      if (info && (info.width || info.height)) {
        window.resizeTo(info.width || window.outerWidth, info.height || window.outerHeight);
      }
      return { id: 1 };
    },
    create: async (options) => {
      let subUrl = options.url || '';
      if (subUrl.startsWith('../')) {
        subUrl = subUrl.replace(/^\.\.\//, '');
      } else if (!subUrl.startsWith('main/')) {
        subUrl = 'main/' + subUrl;
      }

      await ipcRenderer.invoke('open-subwindow', {
        url: subUrl,
        width: options.width || 700,
        height: options.height || 500
      });
      return { id: 1 };
    },
    get: async () => ({ tabs: [] })
  },

  // tabs API
  tabs: {
    create: async (options) => {
      if (options.url) {
        if (options.url.startsWith('http://') || options.url.startsWith('https://')) {
          ipcRenderer.invoke('open-external', options.url);
        } else {
          ipcRenderer.invoke('open-subwindow', { url: options.url });
        }
      }
      return { id: 1 };
    },
    query: async () => [],
    remove: async () => {},
    sendMessage: async (tabId, message) => {
      ipcRenderer.send('to-extension', message);
    }
  },

  // downloads API
  downloads: {
    download: async (options) => {
      console.log('[Preload:downloads.download]', options);
      if (options.url) {
        const a = document.createElement('a');
        a.href = options.url;
        a.download = options.filename || 'download.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 100);
      }
      return 1;
    }
  },

  // notifications API
  notifications: {
    create: async (id, options) => {
      console.log('[Preload:notifications.create]', options);
      return id || '1';
    }
  },

  // storage API
  storage: {
    local: storageLocal,
    onChanged: {
      addListener: (cb) => storageChangeListeners.add(cb),
      removeListener: (cb) => storageChangeListeners.delete(cb),
      hasListener: (cb) => storageChangeListeners.has(cb)
    }
  },

  // runtime API
  runtime: {
    getManifest: () => ({
      name: 'New NicoLive Helper',
      version: '1.0.0'
    }),
    sendMessage: async (message) => {
      console.log('[Preload:runtime.sendMessage]', message);
      if (!message || !message.cmd) return null;

      switch (message.cmd) {
        case 'get-liveinfo': {
          const res = await ipcRenderer.invoke('get-liveinfo', message.request_id);
          console.log('[Preload:get-liveinfo response]', res ? `SUCCESS (${res.program && res.program.title})` : 'NOT FOUND');
          return res;
        }

        case 'open-nicolivehelper':
          return await ipcRenderer.invoke('open-main-window', message.request_id);

        default:
          ipcRenderer.send('to-extension', message);
          return null;
      }
    },
    onMessage: {
      addListener: (cb) => {
        runtimeMessageListeners.add(cb);
      },
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

  extension: {
    getURL: (path) => path
  },

  browserAction: {
    setBadgeText: () => {}
  }
};

window.chrome = window.browser;

// メインプロセスからのメッセージを受信
ipcRenderer.on('from-extension', (event, data) => {
  console.log('[Preload] Message from extension:', data);
  for (const listener of runtimeMessageListeners) {
    try {
      listener(data, { id: 'extension' }, () => {});
    } catch (err) {
      console.error('runtime.onMessage listener error:', err);
    }
  }
});

console.log('[Preload] Polyfill successfully injected. Initial URL:', window.location.href);