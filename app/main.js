const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const WebSocket = require('ws');

// 多重起動の制御
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;
const subWindows = new Map();
const liveProp = {};
const activeExtensions = new Set();
let wss = null;
const WS_PORT = 8765;

// ローカル WebSocket サーバーの起動
function initWebSocketServer() {
  try {
    wss = new WebSocket.Server({ port: WS_PORT, host: '127.0.0.1' });
    console.log(`[STSen WebSocket] Server listening on ws://127.0.0.1:${WS_PORT}`);

    wss.on('connection', (ws) => {
      console.log('[STSen WebSocket] Browser extension connected.');
      activeExtensions.add(ws);

      // 接続確認メッセージを送信
      ws.send(JSON.stringify({ cmd: 'app-ready', version: app.getVersion() }));

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          handleExtensionMessage(data, ws);
        } catch (err) {
          console.error('[STSen WebSocket] Message parse error:', err);
        }
      });

      ws.on('close', () => {
        console.log('[STSen WebSocket] Browser extension disconnected.');
        activeExtensions.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('[STSen WebSocket] Client socket error:', err);
        activeExtensions.delete(ws);
      });
    });

    wss.on('error', (err) => {
      console.error('[STSen WebSocket] Server error:', err);
    });
  } catch (e) {
    console.error('[STSen WebSocket] Failed to start server:', e);
  }
}

// 拡張機能から受信したメッセージの処理
function handleExtensionMessage(data, ws) {
  console.log('[STSen WebSocket] Received cmd:', data.cmd);

  switch (data.cmd) {
    case 'put-liveinfo': {
      const liveinfo = data.liveinfo;
      if (liveinfo && liveinfo.program && liveinfo.program.nicoliveProgramId) {
        const lvid = String(liveinfo.program.nicoliveProgramId);
        liveProp[lvid] = liveinfo;
        console.log(`[STSen] Cached liveinfo for ${lvid}`);

        // レンダラーに通知
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('from-extension', data);
        }
      }
      break;
    }

    case 'open-nicolivehelper': {
      const lvid = data.request_id || 'lv0';
      createOrFocusMainWindow(lvid);
      break;
    }

    case 'playvideo': {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('from-extension', data);
      }
      break;
    }

    default:
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('from-extension', data);
      }
      break;
  }
}

// 拡張機能へのブロードキャスト送信
function broadcastToExtensions(data) {
  const jsonStr = JSON.stringify(data);
  for (const client of activeExtensions) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonStr);
    }
  }
}

// ウィンドウ共通の webPreferences を設定
function getWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: false,
    webSecurity: false, // ニコニコ動画APIへのCORS許可
    allowRunningInsecureContent: true
  };
}

// メインウィンドウの作成・表示
function createOrFocusMainWindow(lvid = '') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    if (lvid) {
      mainWindow.webContents.send('navigate-live', lvid);
    }
    return mainWindow;
  }

  const query = lvid ? `?lv=${lvid}` : '';
  const mainHtmlPath = path.join(__dirname, 'src', 'main', 'main.html');

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'New NicoLive Helper (STSen)',
    icon: path.join(__dirname, 'src', 'icons', 'icon-96.png'),
    webPreferences: getWebPreferences()
  });

  mainWindow.setMenuBarVisibility(false);

  // window.open のハンドリング
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: getWebPreferences(),
        autoHideMenuBar: true
      }
    };
  });

  mainWindow.loadURL(`file://${mainHtmlPath}${query}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// サブウィンドウの作成（設定など明示的な起動用）
function createSubWindow(subUrl, options = {}) {
  let targetPath;
  if (path.isAbsolute(subUrl)) {
    targetPath = subUrl;
  } else {
    targetPath = path.join(__dirname, 'src', subUrl);
  }

  const winId = subUrl.split('?')[0];

  if (subWindows.has(winId) && !subWindows.get(winId).isDestroyed()) {
    const existing = subWindows.get(winId);
    existing.show();
    existing.focus();
    return;
  }

  const subWin = new BrowserWindow({
    width: options.width || 700,
    height: options.height || 550,
    title: options.title || 'New NicoLive Helper',
    icon: path.join(__dirname, 'src', 'icons', 'icon-96.png'),
    webPreferences: getWebPreferences()
  });

  subWin.setMenuBarVisibility(false);

  subWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: getWebPreferences(),
        autoHideMenuBar: true
      }
    };
  });

  subWin.loadURL(`file://${targetPath}`);

  subWindows.set(winId, subWin);

  subWin.on('closed', () => {
    subWindows.delete(winId);
  });
}

// IPC ハンドラー群
ipcMain.handle('get-liveinfo', (event, lvid) => {
  return liveProp[String(lvid)] || null;
});

ipcMain.handle('get-all-liveinfo', () => {
  return liveProp;
});

ipcMain.on('to-extension', (event, data) => {
  broadcastToExtensions(data);
});

ipcMain.handle('open-subwindow', (event, { url, width, height, title }) => {
  createSubWindow(url, { width, height, title });
});

ipcMain.handle('open-main-window', (event, lvid) => {
  createOrFocusMainWindow(lvid);
});

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

// アプリのライフサイクル
app.whenReady().then(() => {
  initWebSocketServer();
  createOrFocusMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOrFocusMainWindow();
    }
  });
});

app.on('second-instance', (event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});