process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// 多重起動の制御
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[STSen] Another instance is already running. Quitting.');
  app.quit();
}

let mainWindow = null;
let latestLvid = '';
const subWindows = new Map();
const liveProp = {};
const activeExtensions = new Set();
let wss = null;
const WS_PORT = 18765;
const COOKIE_FILE = path.join(__dirname, 'cookies.json');

// メモリ上にキャッシュする Cookie リスト
let cachedCookies = [];

// -------------------------------------------------------------
// ニコニコ Cookie のインポート & 永続化
// -------------------------------------------------------------
async function updateCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;

  cachedCookies = cookies;

  // Electron セッションの Cookie ストアにも登録
  let userSessionCount = 0;
  for (const c of cookies) {
    try {
      let domain = c.domain || '.nicovideo.jp';
      const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
      const url = `https://${cleanDomain}${c.path || '/'}`;

      await session.defaultSession.cookies.set({
        url: url,
        name: c.name,
        value: c.value,
        domain: domain,
        path: c.path || '/',
        secure: c.secure !== undefined ? c.secure : true,
        httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
        expirationDate: c.expirationDate
      });

      if (c.name === 'user_session' || c.name === 'user_session_secure') {
        userSessionCount++;
      }
    } catch (e) {}
  }

  // ローカルに永続化保存
  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log(`[STSen] Saved ${cookies.length} cookies to cookies.json (user_session found: ${userSessionCount})`);
  } catch (e) {
    console.error('[STSen] Failed to save cookies.json:', e);
  }

  return userSessionCount > 0;
}

// 保存済み Cookie の自動復元
async function restoreSavedCookies() {
  if (fs.existsSync(COOKIE_FILE)) {
    try {
      const data = fs.readFileSync(COOKIE_FILE, 'utf-8');
      const cookies = JSON.parse(data);
      console.log(`[STSen] Restoring ${cookies.length} saved cookies from cookies.json...`);
      await updateCookies(cookies);
    } catch (e) {
      console.error('[STSen] Failed to restore saved cookies:', e);
    }
  } else {
    console.log('[STSen] No saved cookies.json found. Waiting for extension sync.');
  }
}

// -------------------------------------------------------------
// HTTP リクエストヘッダーのインターセプト（Cookie 強制注入）
// -------------------------------------------------------------
function setupRequestHeaderInterceptor() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const urlStr = details.url;

    try {
      const parsedUrl = new URL(urlStr);
      if (parsedUrl.hostname.endsWith('nicovideo.jp')) {
        // User-Agent の設定
        details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NicoLiveHelper/1.0';

        // キャッシュされた Cookie を強制注入！
        if (cachedCookies.length > 0) {
          // 該当ドメインにマッチする Cookie を抽出
          const matchingCookies = cachedCookies.filter(c => {
            const cDomain = (c.domain || '').replace(/^\./, '');
            return parsedUrl.hostname.endsWith(cDomain);
          });

          if (matchingCookies.length > 0) {
            const cookieStr = matchingCookies.map(c => `${c.name}=${c.value}`).join('; ');
            details.requestHeaders['Cookie'] = cookieStr;
            // ログが多すぎないように nvapi や api のみ出力
            if (urlStr.includes('nvapi') || urlStr.includes('api')) {
              console.log(`[STSen:HTTP] Injected ${matchingCookies.length} cookies into: ${parsedUrl.pathname}`);
            }
          }
        }
      }
    } catch (e) {}

    callback({ requestHeaders: details.requestHeaders });
  });
}

// -------------------------------------------------------------
// ローカル WebSocket サーバーの起動
// -------------------------------------------------------------
function initWebSocketServer() {
  try {
    wss = new WebSocket.Server({
      port: WS_PORT,
      host: '127.0.0.1',
      verifyClient: (info, done) => {
        done(true);
      }
    });
    console.log(`[STSen WebSocket] Server listening on ws://127.0.0.1:${WS_PORT}`);

    wss.on('connection', (ws, req) => {
      console.log('[STSen WebSocket] Browser extension connected from', req.socket.remoteAddress);
      activeExtensions.add(ws);

      ws.send(JSON.stringify({ cmd: 'app-ready', version: app.getVersion() }));

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          await handleExtensionMessage(data, ws);
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
async function handleExtensionMessage(data, ws) {
  console.log('[STSen WebSocket] Received cmd:', data.cmd);

  switch (data.cmd) {
    case 'sync-cookies': {
      if (Array.isArray(data.cookies) && data.cookies.length > 0) {
        console.log(`[STSen] Received ${data.cookies.length} cookies from extension.`);
        const hasSession = await updateCookies(data.cookies);

        if (hasSession && mainWindow && !mainWindow.isDestroyed()) {
          console.log('[STSen] Cookies synced with user_session! Reloading window...');
          mainWindow.webContents.reload();
        }
      }
      break;
    }

    case 'put-liveinfo': {
      const liveinfo = data.liveinfo;
      if (liveinfo && liveinfo.program && liveinfo.program.nicoliveProgramId) {
        const rawId = String(liveinfo.program.nicoliveProgramId);
        const idWithLv = rawId.startsWith('lv') ? rawId : `lv${rawId}`;
        const idWithoutLv = rawId.replace(/^lv/, '');

        latestLvid = idWithLv;
        liveProp[rawId] = liveinfo;
        liveProp[idWithLv] = liveinfo;
        liveProp[idWithoutLv] = liveinfo;

        console.log(`[STSen] Cached liveinfo for keys: "${rawId}", "${idWithLv}", "${idWithoutLv}"`);
        console.log(`[STSen] Program title: "${liveinfo.program.title}"`);
        console.log(`[STSen] Community ID: "${liveinfo.community ? liveinfo.community.id : 'official'}"`);

        // メインウィンドウへの反映処理
        if (mainWindow && !mainWindow.isDestroyed()) {
          const currentUrl = mainWindow.webContents.getURL();
          console.log(`[STSen] Current Window URL: ${currentUrl}`);

          if (!currentUrl.includes(`lv=${idWithLv}`) && !currentUrl.includes(`lv=${idWithoutLv}`)) {
            const mainHtmlPath = path.join(__dirname, 'src', 'main', 'main.html');
            const targetUrl = `file://${mainHtmlPath}?lv=${idWithLv}`;
            console.log(`[STSen] >>> Auto-navigating main window to: ${targetUrl}`);
            mainWindow.loadURL(targetUrl);
          } else {
            console.log('[STSen] Main window is already at this live. Forwarding message to renderer.');
            mainWindow.webContents.send('from-extension', data);
          }
        } else {
          console.log('[STSen] Main window does not exist yet. Creating with lvid:', idWithLv);
          createOrFocusMainWindow(idWithLv);
        }
      }
      break;
    }

    case 'open-nicolivehelper': {
      const lvid = data.request_id || latestLvid || 'lv0';
      console.log(`[STSen] open-nicolivehelper requested for: ${lvid}`);
      createOrFocusMainWindow(lvid);
      break;
    }

    case 'playvideo': {
      console.log(`[STSen] playvideo: sm${data.video_id} for ${data.lvid}`);
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

function broadcastToExtensions(data) {
  const jsonStr = JSON.stringify(data);
  for (const client of activeExtensions) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonStr);
    }
  }
}

function getWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: false,
    webSecurity: false,
    allowRunningInsecureContent: true
  };
}

// メインウィンドウの作成・表示
function createOrFocusMainWindow(lvid = '') {
  const targetLvid = lvid || latestLvid;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    if (targetLvid) {
      const currentUrl = mainWindow.webContents.getURL();
      if (!currentUrl.includes(`lv=${targetLvid}`)) {
        const mainHtmlPath = path.join(__dirname, 'src', 'main', 'main.html');
        const targetUrl = `file://${mainHtmlPath}?lv=${targetLvid}`;
        console.log(`[STSen] Navigating existing window to: ${targetUrl}`);
        mainWindow.loadURL(targetUrl);
      }
    }
    return mainWindow;
  }

  const query = targetLvid ? `?lv=${targetLvid}` : '';
  const mainHtmlPath = path.join(__dirname, 'src', 'main', 'main.html');
  const targetUrl = `file://${mainHtmlPath}${query}`;

  console.log(`[STSen] Creating MainWindow with URL: ${targetUrl}`);

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

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelStr = ['DEBUG', 'INFO', 'WARN', 'ERROR'][level] || 'LOG';
    const srcFile = sourceId ? sourceId.split('/').pop().split('\\').pop() : 'inline';
    console.log(`[Renderer:${levelStr}][${srcFile}:${line}] ${message}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`[STSen] MainWindow did-finish-load: ${mainWindow.webContents.getURL()}`);
  });

  if (!app.isPackaged) { mainWindow.webContents.openDevTools({ mode: 'detach' }); }

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

  mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// サブウィンドウの作成
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

  subWin.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[SubWin:${winId}] ${message}`);
  });

  subWin.loadURL(`file://${targetPath}`);
  subWindows.set(winId, subWin);

  subWin.on('closed', () => {
    subWindows.delete(winId);
  });
}

// IPC ハンドラー群
ipcMain.handle('get-liveinfo', (event, lvid) => {
  console.log(`[IPC:get-liveinfo] Requested for lvid: "${lvid}"`);
  const strId = String(lvid);
  const idWithLv = strId.startsWith('lv') ? strId : `lv${strId}`;
  const idWithoutLv = strId.replace(/^lv/, '');
  const info = liveProp[strId] || liveProp[idWithLv] || liveProp[idWithoutLv] || null;
  return info;
});

ipcMain.handle('get-all-liveinfo', () => liveProp);

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

// 同期プロンプト (window.prompt ポリフィル用)
ipcMain.on('show-prompt-sync', (event, { message, defaultValue }) => {
  try {
    const safeMsg = (message || '').replace(/'/g, "''").replace(/\r?\n/g, ' ');
    const safeDef = (defaultValue !== undefined ? String(defaultValue) : '').replace(/'/g, "''");
    const script = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
      Add-Type -AssemblyName Microsoft.VisualBasic;
      $res = [Microsoft.VisualBasic.Interaction]::InputBox('${safeMsg}', 'New NicoLive Helper', '${safeDef}');
      [Console]::Write($res);
    `;
    const { execFileSync } = require('child_process');
    const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000
    });
    event.returnValue = result === '' ? null : result;
  } catch (e) {
    console.error('[STSen] Prompt error:', e);
    event.returnValue = null;
  }
});

// アプリ起動フロー
app.whenReady().then(async () => {
  console.log('[STSen] App is ready.');

  // HTTP ヘッダーインターセプターの有効化
  setupRequestHeaderInterceptor();

  // 保存済み Cookie の自動復元
  await restoreSavedCookies();

  initWebSocketServer();
  createOrFocusMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOrFocusMainWindow();
    }
  });
});

app.on('second-instance', () => {
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