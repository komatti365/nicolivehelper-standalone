const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const RemoteServer = require('./remoteServer');

// コマンドライン引数 & 環境変数の解析
const argv = process.argv.slice(2);
function getArgVal(flag) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
  const eqArg = argv.find(a => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.split('=').slice(1).join('=');
  return null;
}
const isHeadlessArg = argv.includes('--headless') || process.env.STSEN_HEADLESS === '1';
const isHostArg = argv.includes('--host') || argv.includes('--remote-host') || process.env.STSEN_HOST_ENABLED === '1';
const customPort = getArgVal('--port') || process.env.STSEN_HOST_PORT;
const customPassword = getArgVal('--password') || process.env.STSEN_HOST_PASSWORD;

if (isHeadlessArg) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
  console.log('[STSen] Running in HEADLESS mode.');
}
if (isHostArg) {
  console.log('[STSen] Remote host mode forced via flag/env.');
}

// Cloudflare Turnstile / ボット検出対策
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// 多重起動の制御
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[STSen] Another instance is already running. Quitting.');
  app.quit();
}

// -------------------------------------------------------------
// AppData 専用ディレクトリの設定
// -------------------------------------------------------------
const CONFIG_DIR = path.join(app.getPath('appData'), 'nicolivehelper-standalone');
const PREV_CONFIG_DIR = path.join(app.getPath('appData'), 'STSen-NicoLiveHelper');
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // 旧 STSen-NicoLiveHelper からのデータ移行
  if (fs.existsSync(PREV_CONFIG_DIR)) {
    try {
      const prevCookies = path.join(PREV_CONFIG_DIR, 'cookies.json');
      const prevStorage = path.join(PREV_CONFIG_DIR, 'storage.json');
      if (fs.existsSync(prevCookies)) fs.copyFileSync(prevCookies, path.join(CONFIG_DIR, 'cookies.json'));
      if (fs.existsSync(prevStorage)) fs.copyFileSync(prevStorage, path.join(CONFIG_DIR, 'storage.json'));
      console.log('[STSen] Migrated config from previous STSen-NicoLiveHelper directory.');
    } catch (e) {
      console.error('[STSen] Failed to migrate previous config:', e);
    }
  }
}
app.setPath('userData', CONFIG_DIR);
console.log('[STSen] Config & UserData directory:', CONFIG_DIR);

const COOKIE_FILE = path.join(CONFIG_DIR, 'cookies.json');
const STORAGE_FILE = path.join(CONFIG_DIR, 'storage.json');

// 既存の旧 cookies.json があれば新フォルダへ移行
const OLD_COOKIE_FILE = path.join(__dirname, 'cookies.json');
if (fs.existsSync(OLD_COOKIE_FILE) && !fs.existsSync(COOKIE_FILE)) {
  try {
    fs.copyFileSync(OLD_COOKIE_FILE, COOKIE_FILE);
    console.log('[STSen] Migrated old cookies.json to AppData directory.');
  } catch (e) {
    console.error('[STSen] Failed to migrate old cookies.json:', e);
  }
}

let mainWindow = null;
let latestLvid = '';
const subWindows = new Map();
const liveProp = {};

let remoteServer = null;
let lastKnownState = {};

// メモリ上にキャッシュする Cookie リスト
let cachedCookies = [];

// -------------------------------------------------------------
// 設定ファイル (storage.json) の管理
// -------------------------------------------------------------
function loadStorageFile() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[STSen] Failed to read storage.json:', e);
  }
  return {};
}

function saveStorageFile(data) {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[STSen] Failed to write storage.json:', e);
  }
}

function broadcastStorageChange(changes) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('storage-changed', changes);
  }
  for (const [_, subWin] of subWindows) {
    if (subWin && !subWin.isDestroyed()) {
      subWin.webContents.send('storage-changed', changes);
    }
  }
}

// -------------------------------------------------------------
// ニコニコ Cookie のインポート & 永続化
// -------------------------------------------------------------
async function updateCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;

  cachedCookies = cookies;

  let userSessionCount = 0;
  for (const c of cookies) {
    try {
      let domain = c.domain || '.nicovideo.jp';
      const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
      const url = `https://${cleanDomain}${c.path || '/'}`;
      const exp = c.expirationDate !== undefined ? c.expirationDate : (c.expires !== undefined ? c.expires : undefined);

      await session.defaultSession.cookies.set({
        url: url,
        name: c.name,
        value: c.value,
        domain: domain,
        path: c.path || '/',
        secure: c.secure !== undefined ? c.secure : true,
        httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
        expirationDate: exp
      });

      if (c.name === 'user_session' || c.name === 'user_session_secure') {
        userSessionCount++;
      }
    } catch (e) {
      console.warn(`[STSen] Failed to set cookie ${c.name}:`, e.message);
    }
  }

  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log(`[STSen] Saved ${cookies.length} cookies to ${COOKIE_FILE} (user_session found: ${userSessionCount})`);
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
      console.log(`[STSen] Restoring ${cookies.length} saved cookies from ${COOKIE_FILE}...`);
      await updateCookies(cookies);
    } catch (e) {
      console.error('[STSen] Failed to restore saved cookies:', e);
    }
  } else {
    console.log('[STSen] No saved cookies.json found. Waiting for login or extension sync.');
  }
}

// -------------------------------------------------------------
// アカウント情報取得 & ログアウト処理
// -------------------------------------------------------------
async function getAccountStatus() {
  const cookies = await session.defaultSession.cookies.get({ domain: 'nicovideo.jp' });
  const userSession = cookies.find(c => (c.name === 'user_session' || c.name === 'user_session_secure') && c.value);
  const loggedIn = !!userSession;

  let userInfo = null;
  if (loggedIn) {
    try {
      const targetCookies = (cookies && cookies.length > 0) ? cookies : cachedCookies;
      const cookieHeader = targetCookies.map(c => `${c.name}=${c.value}`).join('; ');
      const res = await fetch('https://nvapi.nicovideo.jp/v1/users/me', {
        headers: {
          'X-Frontend-Id': '6',
          'X-Frontend-Version': '0',
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.user) {
          userInfo = {
            id: json.data.user.id,
            nickname: json.data.user.nickname,
            iconUrl: json.data.user.icons && json.data.user.icons.small
          };
        }
      }
    } catch (e) {
      console.warn('[STSen:Account] Could not fetch user profile details:', e.message);
    }
  }

  return { loggedIn, user: userInfo };
}

function broadcastAccountStatus() {
  getAccountStatus().then(status => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('account-status-changed', status);
    }
    for (const [_, subWin] of subWindows) {
      if (subWin && !subWin.isDestroyed()) {
        subWin.webContents.send('account-status-changed', status);
      }
    }
  });
}

async function logout() {
  console.log('[STSen] Logging out...');
  try {
    const cookies = await session.defaultSession.cookies.get({ domain: 'nicovideo.jp' });
    for (const c of cookies) {
      try {
        let domain = c.domain || '.nicovideo.jp';
        const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
        await session.defaultSession.cookies.remove(`https://${cleanDomain}${c.path || '/'}`, c.name);
      } catch (e) {}
    }
    cachedCookies = [];
    if (fs.existsSync(COOKIE_FILE)) {
      fs.unlinkSync(COOKIE_FILE);
    }
    broadcastAccountStatus();
    console.log('[STSen] Logged out successfully.');
    return { success: true };
  } catch (e) {
    console.error('[STSen] Logout failed:', e);
    return { success: false, error: e.message };
  }
}

// -------------------------------------------------------------
// 配信情報の直接取得 (枠読み込み対応)
// -------------------------------------------------------------
async function fetchLiveInfoDirect(lvid) {
  const strId = String(lvid).trim();
  const idWithLv = strId.startsWith('lv') ? strId : `lv${strId}`;
  const idWithoutLv = strId.replace(/^lv/, '');

  if (liveProp[strId] || liveProp[idWithLv] || liveProp[idWithoutLv]) {
    return liveProp[strId] || liveProp[idWithLv] || liveProp[idWithoutLv];
  }

  console.log(`[STSen] Fetching liveinfo directly for: ${idWithLv}...`);
  try {
    const url = `https://live.nicovideo.jp/watch/${idWithLv}`;
    const cookieHeader = cachedCookies.map(c => `${c.name}=${c.value}`).join('; ');
    const res = await fetch(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) {
      console.warn(`[STSen] Fetch live watch page returned HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    const m = html.match(/id=["']embedded-data["'][^>]*data-props=["'](.*?)["']/s) ||
              html.match(/<script id=["']embedded-data["'][^>]*>(.*?)<\/script>/s);
    if (m) {
      const raw = m[1].includes('&quot;') ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : m[1];
      const liveinfo = JSON.parse(raw);
      latestLvid = idWithLv;
      liveProp[strId] = liveinfo;
      liveProp[idWithLv] = liveinfo;
      liveProp[idWithoutLv] = liveinfo;
      console.log(`[STSen] Successfully extracted liveinfo for ${idWithLv}: "${liveinfo.program ? liveinfo.program.title : ''}"`);
      return liveinfo;
    } else {
      console.warn('[STSen] Could not find embedded-data in watch page.');
    }
  } catch (err) {
    console.error(`[STSen] Error fetching liveinfo direct for ${idWithLv}:`, err);
  }
  return null;
}

// -------------------------------------------------------------
// ログイン中ユーザーの現在放送中（ON_AIR）の配信を自動検出
// -------------------------------------------------------------
async function fetchMyCurrentLiveInfo() {
  const account = await getAccountStatus();
  if (!account || !account.loggedIn || !account.user || !account.user.id) {
    console.log('[STSen] User is not logged in. Skipping auto-detect live.');
    return null;
  }

  const userId = account.user.id;
  console.log(`[STSen] Checking active live for user ${userId} (${account.user.nickname})...`);
  try {
    const url = `https://live.nicovideo.jp/watch/user/${userId}`;
    const cookieHeader = cachedCookies.map(c => `${c.name}=${c.value}`).join('; ');
    const res = await fetch(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!res.ok) {
      console.warn(`[STSen] Fetch user live page returned HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();
    const m = html.match(/id=["']embedded-data["'][^>]*data-props=["'](.*?)["']/s) ||
              html.match(/<script id=["']embedded-data["'][^>]*>(.*?)<\/script>/s);
    if (m) {
      const raw = m[1].includes('&quot;') ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : m[1];
      const liveinfo = JSON.parse(raw);
      if (liveinfo.program && liveinfo.program.status === 'ON_AIR') {
        let lvid = liveinfo.program.nicoliveProgramId;
        if (!lvid && liveinfo.program.watchPageUrl) {
          const matchLv = liveinfo.program.watchPageUrl.match(/lv\d+/);
          if (matchLv) lvid = matchLv[0];
        }
        if (lvid) {
          console.log(`[STSen] Active live detected: ${lvid} - "${liveinfo.program.title}"`);
          latestLvid = lvid;
          liveProp[lvid] = liveinfo;
          return { lvid, liveinfo };
        }
      } else {
        console.log('[STSen] No active live currently ON_AIR for this user.');
      }
    }
  } catch (err) {
    console.error('[STSen] Error detecting current live:', err);
  }
  return null;
}

// -------------------------------------------------------------
// HTTP リクエストヘッダーのインターセプト（Cookie 強制注入）
// -------------------------------------------------------------
function setupRequestHeaderInterceptor() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const urlStr = details.url;

    try {
      const parsedUrl = new URL(urlStr);

      // account.nicovideo.jp や Cloudflare 関連はヘッダーを一切変更せず素通し（ボット検知防止）
      if (
        parsedUrl.hostname === 'account.nicovideo.jp' ||
        parsedUrl.hostname.includes('cloudflare.com') ||
        parsedUrl.hostname.includes('challenges')
      ) {
        return callback({ requestHeaders: details.requestHeaders });
      }

      if (parsedUrl.hostname.endsWith('nicovideo.jp')) {
        // APIリクエストのみ Cookie を注入 (User-Agent は偽装・汚染しない)
        if (cachedCookies.length > 0) {
          const matchingCookies = cachedCookies.filter(c => {
            const cDomain = (c.domain || '').replace(/^\./, '');
            return parsedUrl.hostname.endsWith(cDomain);
          });

          if (matchingCookies.length > 0) {
            const cookieStr = matchingCookies.map(c => `${c.name}=${c.value}`).join('; ');
            details.requestHeaders['Cookie'] = cookieStr;
            if (urlStr.includes('nvapi') || urlStr.includes('api')) {
              console.log(`[STSen:HTTP] Injected ${matchingCookies.length} cookies into: ${parsedUrl.pathname}`);
            }
          }
        }
      }
    } catch (e) {}

    callback({ requestHeaders: details.requestHeaders });
  });

  // webSecurity: true 下で file:// からのニコニコ API 通信を可能にする CORS 補正
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    try {
      const parsedUrl = new URL(details.url);
      if (
        parsedUrl.hostname.endsWith('nicovideo.jp') ||
        parsedUrl.hostname.endsWith('nimg.jp') ||
        parsedUrl.hostname.endsWith('dmc.nico')
      ) {
        responseHeaders['access-control-allow-origin'] = ['*'];
        responseHeaders['access-control-allow-headers'] = ['*'];
        responseHeaders['access-control-allow-methods'] = ['GET, POST, PUT, PATCH, DELETE, OPTIONS'];
        responseHeaders['access-control-allow-credentials'] = ['true'];
      }
    } catch (e) {}
    callback({ responseHeaders });
  });
}

function getWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    webSecurity: true,
    allowRunningInsecureContent: false
  };
}

// -------------------------------------------------------------
// リモートホストサーバー（API & WebSocket）の初期化
// -------------------------------------------------------------
function initRemoteServer() {
  const storageData = loadStorageFile();
  const config = storageData.config || {};

  const enabled = isHostArg || config['remote-server-enabled'] === true || config['remote-server-enabled'] === 'true';
  const port = parseInt(customPort || config['remote-server-port'] || 18767, 10);
  const password = customPassword !== null && customPassword !== undefined ? customPassword : (config['remote-server-password'] || '');

  if (remoteServer) {
    remoteServer.updateConfig(port, password);
    if (!enabled && remoteServer.running) {
      remoteServer.stop();
    } else if (enabled && !remoteServer.running) {
      remoteServer.start();
    }
    return;
  }

  remoteServer = new RemoteServer({
    port: port,
    password: password,
    getState: () => lastKnownState,
    onAction: async (action, params) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new Error('Main window is not available');
      }
      return new Promise((resolve, reject) => {
        const actionId = `act_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const timeout = setTimeout(() => {
          ipcMain.removeHandler(`remote-action-res:${actionId}`);
          reject(new Error(`Action timeout: ${action}`));
        }, 15000);

        ipcMain.handleOnce(`remote-action-res:${actionId}`, (event, result) => {
          clearTimeout(timeout);
          if (result && result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result ? result.data : null);
          }
        });

        mainWindow.webContents.send('remote-host-execute-action', { actionId, action, params });
      });
    },
    onSyncCookies: async (cookies) => {
      console.log(`[STSen:RemoteHost] Syncing ${cookies.length} cookies from remote client...`);
      const success = await updateCookies(cookies);
      broadcastAccountStatus();
      return { success, count: cookies.length };
    },
    onLogout: async () => {
      console.log('[STSen:RemoteHost] Logging out via remote client request...');
      return await logout();
    }
  });

  if (enabled) {
    remoteServer.start();
  }
}

// メインウィンドウの作成・表示
function createOrFocusMainWindow(lvid = '') {
  const targetLvid = lvid || latestLvid;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!isHeadlessArg) {
      mainWindow.show();
      mainWindow.focus();
    }
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

  console.log(`[STSen] Creating MainWindow with URL: ${targetUrl} (headless: ${isHeadlessArg})`);

  mainWindow = new BrowserWindow({
    width: 820,
    height: 640,
    minWidth: 600,
    minHeight: 400,
    show: !isHeadlessArg,
    title: `New NicoLive Helper (STSen) v${app.getVersion()}`,
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

  if (!app.isPackaged && !isHeadlessArg) { mainWindow.webContents.openDevTools({ mode: 'detach' }); }

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

// -------------------------------------------------------------

// -------------------------------------------------------------
// -------------------------------------------------------------
// Chromium 系実機ブラウザ（Edge, Chrome, Brave, Vivaldi, Opera 等）の自動検出
// -------------------------------------------------------------
function getChromiumBrowserPath() {
  if (process.platform !== 'win32') {
    const linuxCandidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/snap/bin/chromium'
    ];
    for (const p of linuxCandidates) {
      if (fs.existsSync(p)) {
        console.log(`[STSen:Browser] Detected Linux Chromium browser by path: ${p}`);
        return p;
      }
    }
    return null;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  // 1. 一般的な既知のインストール先パス（Edge, Chrome, Brave, Vivaldi, Opera）
  const candidates = [
    // Microsoft Edge
    path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(localAppData, 'Microsoft/Edge/Application/msedge.exe'),

    // Google Chrome
    path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
    path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
    path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),

    // Brave
    path.join(programFiles, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    path.join(programFilesX86, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    path.join(localAppData, 'BraveSoftware/Brave-Browser/Application/brave.exe'),

    // Vivaldi
    path.join(localAppData, 'Vivaldi/Application/vivaldi.exe'),
    path.join(programFiles, 'Vivaldi/Application/vivaldi.exe'),

    // Opera / Opera GX
    path.join(localAppData, 'Programs/Opera/launcher.exe'),
    path.join(localAppData, 'Programs/Opera GX/launcher.exe'),
    path.join(programFiles, 'Opera/launcher.exe')
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`[STSen:Browser] Detected Chromium browser by path: ${p}`);
      return p;
    }
  }

  // 2. レジストリ（App Paths）からの検索フォールバック (Windowsのみ)
  try {
    const { execSync } = require('child_process');
    const regNames = ['msedge.exe', 'chrome.exe', 'brave.exe', 'vivaldi.exe'];
    for (const name of regNames) {
      try {
        const out = execSync(`reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}" /ve`, {
          encoding: 'utf8',
          windowsHide: true
        });
        const match = out.match(/REG_SZ\s+([^\r\n]+)/);
        if (match && fs.existsSync(match[1].trim())) {
          const found = match[1].trim();
          console.log(`[STSen:Browser] Detected Chromium browser from registry: ${found}`);
          return found;
        }
      } catch (e) {}

      try {
        const out = execSync(`reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}" /ve`, {
          encoding: 'utf8',
          windowsHide: true
        });
        const match = out.match(/REG_SZ\s+([^\r\n]+)/);
        if (match && fs.existsSync(match[1].trim())) {
          const found = match[1].trim();
          console.log(`[STSen:Browser] Detected Chromium browser from HKCU registry: ${found}`);
          return found;
        }
      } catch (e) {}
    }
  } catch (err) {}

  return null;
}

let edgeLoginProcess = null;
let edgeCdpWs = null;
let edgeLoginTimeout = null;

async function openEdgeLogin() {
  console.log('[STSen:EdgeLogin] openEdgeLogin() called');
  if (edgeLoginProcess) {
    console.log('[STSen:EdgeLogin] Previous Edge process detected. Restarting for fresh login attempt...');
    try { edgeLoginProcess.kill(); } catch (e) {}
    edgeLoginProcess = null;
    if (edgeCdpWs) {
      try { edgeCdpWs.close(); } catch (e) {}
      edgeCdpWs = null;
    }
    if (edgeLoginTimeout) {
      clearTimeout(edgeLoginTimeout);
      edgeLoginTimeout = null;
    }
  }

  const edgeExe = getChromiumBrowserPath();
  if (!edgeExe) {
    console.warn('[STSen:Browser] No Chromium-based browser found on system.');
    const result = await dialog.showMessageBox(mainWindow || null, {
      type: 'warning',
      buttons: ['Google Chrome をダウンロード', 'キャンセル'],
      defaultId: 0,
      cancelId: 1,
      title: 'ブラウザが見つかりません - New NicoLive Helper',
      message: 'ログインに必要なブラウザ（Microsoft Edge または Google Chrome 等）が見つかりませんでした。',
      detail: 'Cloudflare Turnstile等のセキュリティ認証を安全に通過してログインを完了するため、Google Chromeのインストールをおすすめします。\n\n公式ダウンロードページを開きますか？'
    });

    if (result.response === 0) {
      shell.openExternal('https://www.google.com/intl/ja/chrome/');
    }
    return;
  }

  const browserProfileDir = path.join(CONFIG_DIR, 'browser-profile');
  if (!fs.existsSync(browserProfileDir)) {
    fs.mkdirSync(browserProfileDir, { recursive: true });
  }

  // 固定ポートではなくランダムな動的ポートを使用（無認証CDPへの不正アクセス防止）
  const CDP_PORT = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${browserProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-features=msEdgeSyncPrompt,msFirstRun',
    '--window-size=600,750',
    '--app=https://account.nicovideo.jp/login?site=niconico'
  ];

  console.log(`[STSen:EdgeLogin] Launching browser: ${edgeExe} on port ${CDP_PORT}`);
  const { spawn } = require('child_process');
  edgeLoginProcess = spawn(edgeExe, args);

  // 3分間のタイムアウト保護（放置された場合の自動終了）
  edgeLoginTimeout = setTimeout(() => {
    if (edgeLoginProcess) {
      console.log('[STSen:EdgeLogin] Login process timed out (3 minutes). Closing browser.');
      try { edgeLoginProcess.kill(); } catch (e) {}
      edgeLoginProcess = null;
    }
    if (edgeCdpWs) {
      try { edgeCdpWs.close(); } catch (e) {}
      edgeCdpWs = null;
    }
  }, 180000);

  edgeLoginProcess.on('error', (err) => {
    console.error('[STSen:EdgeLogin] Failed to start browser process:', err);
    edgeLoginProcess = null;
    if (edgeLoginTimeout) {
      clearTimeout(edgeLoginTimeout);
      edgeLoginTimeout = null;
    }
  });

  edgeLoginProcess.on('exit', (code) => {
    console.log(`[STSen:EdgeLogin] Browser process exited with code: ${code}`);
    edgeLoginProcess = null;
    if (edgeLoginTimeout) {
      clearTimeout(edgeLoginTimeout);
      edgeLoginTimeout = null;
    }
    if (edgeCdpWs) {
      try { edgeCdpWs.close(); } catch (e) {}
      edgeCdpWs = null;
    }
  });

  let attempts = 0;
  const maxAttempts = 40;
  const pollInterval = 500;

  const waitForCdp = async () => {
    if (!edgeLoginProcess) return;

    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (res.ok) {
        const targets = await res.json();
        const pageTarget = targets.find(t => t.type === 'page' && t.url && t.url.includes('nicovideo.jp'))
          || targets.find(t => t.type === 'page' && !t.url.startsWith('edge://') && !t.url.startsWith('chrome://'));

        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          console.log(`[STSen:EdgeLogin] Found page target (${pageTarget.url}), connecting to CDP WebSocket...`);
          startCdpMonitoring(pageTarget.webSocketDebuggerUrl);
          return;
        }
      }
    } catch (e) {}

    attempts++;
    if (attempts < maxAttempts && edgeLoginProcess) {
      setTimeout(waitForCdp, pollInterval);
    } else if (edgeLoginProcess) {
      console.warn('[STSen:EdgeLogin] Timed out waiting for CDP port or login target.');
    }
  };

  setTimeout(waitForCdp, 600);
}

function startCdpMonitoring(wsUrl) {
  if (edgeCdpWs) {
    try { edgeCdpWs.close(); } catch (e) {}
    edgeCdpWs = null;
  }

  edgeCdpWs = new WebSocket(wsUrl);

  let checkTimer = null;
  let msgId = 1;

  edgeCdpWs.on('open', () => {
    console.log('[STSen:EdgeLogin] Connected to CDP WebSocket! Starting cookie monitoring...');
    edgeCdpWs.send(JSON.stringify({ id: msgId++, method: 'Network.enable' }));

    checkTimer = setInterval(() => {
      if (edgeCdpWs && edgeCdpWs.readyState === WebSocket.OPEN) {
        edgeCdpWs.send(JSON.stringify({
          id: 100,
          method: 'Network.getAllCookies'
        }));
      }
    }, 1000);
  });

  edgeCdpWs.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.id === 100 && data.result && Array.isArray(data.result.cookies)) {
        const cookies = data.result.cookies;
        const userSession = cookies.find(c => (c.name === 'user_session' || c.name === 'user_session_secure') && c.value);
        if (userSession) {
          console.log('[STSen:EdgeLogin] user_session detected in browser! Saving session...');
          if (checkTimer) {
            clearInterval(checkTimer);
            checkTimer = null;
          }

          const nicoCookies = cookies.filter(c => c.domain && c.domain.includes('nicovideo.jp'));
          await updateCookies(nicoCookies.length > 0 ? nicoCookies : cookies);
          broadcastAccountStatus();

          setTimeout(() => {
            if (edgeLoginProcess) {
              console.log('[STSen:EdgeLogin] Closing browser window automatically.');
              try { edgeLoginProcess.kill(); } catch (e) {}
              edgeLoginProcess = null;
            }
          }, 1000);
        }
      }
    } catch (e) {
      console.error('[STSen:EdgeLogin] Message parsing error:', e);
    }
  });

  edgeCdpWs.on('close', () => {
    console.log('[STSen:EdgeLogin] CDP WebSocket closed.');
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
    edgeCdpWs = null;
  });

  edgeCdpWs.on('error', (err) => {
    console.error('[STSen:EdgeLogin] CDP WebSocket error:', err.message);
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
    edgeCdpWs = null;
  });
}

// IPC ハンドラー群
// -------------------------------------------------------------
// storage.local (storage.json) ハンドラー
ipcMain.handle('storage-get', (event, keys) => {
  const store = loadStorageFile();
  if (keys === null || keys === undefined) return store;
  if (typeof keys === 'string') keys = [keys];
  if (Array.isArray(keys)) {
    const res = {};
    for (const k of keys) {
      if (k in store) res[k] = store[k];
    }
    return res;
  }
  if (typeof keys === 'object') {
    const res = {};
    for (const k in keys) {
      res[k] = (k in store) ? store[k] : keys[k];
    }
    return res;
  }
  return store;
});

ipcMain.handle('storage-set', (event, items) => {
  const store = loadStorageFile();
  const changes = {};
  for (const [k, v] of Object.entries(items)) {
    const oldValue = store[k];
    store[k] = v;
    changes[k] = { oldValue, newValue: v };
  }
  saveStorageFile(store);
  broadcastStorageChange(changes);
  return true;
});

ipcMain.handle('storage-remove', (event, keys) => {
  const store = loadStorageFile();
  if (typeof keys === 'string') keys = [keys];
  for (const k of keys) {
    delete store[k];
  }
  saveStorageFile(store);
  return true;
});

ipcMain.handle('storage-clear', () => {
  saveStorageFile({});
  return true;
});

ipcMain.handle('open-config-folder', () => {
  shell.openPath(CONFIG_DIR);
});

ipcMain.handle('reset-all-data', async () => {
  const focusedWin = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showMessageBox(focusedWin || null, {
    type: 'warning',
    title: 'アプリの完全初期化',
    message: 'すべての設定、ログイン情報、保存データを完全に初期化しますか？',
    detail: '以下のデータが完全に消去されます：\n・保存された設定（storage.json）\n・ログインセッション／Cookie（cookies.json）\n・過去の移行元データ（STSen-NicoLiveHelper）\n・ブラウザキャッシュおよびデータベース\n\n処理完了後、アプリケーションは自動的に終了します。この操作は取り消せません。',
    buttons: ['完全初期化してアプリを終了', 'キャンセル'],
    defaultId: 1,
    cancelId: 1
  });

  if (result.response !== 0) {
    return { cancelled: true };
  }

  console.log('[STSen:Reset] Starting full data reset...');

  try {
    // 1. サブウィンドウをすべて閉じる
    for (const [_, subWin] of subWindows) {
      if (subWin && !subWin.isDestroyed()) {
        try { subWin.destroy(); } catch (e) {}
      }
    }
    subWindows.clear();

    // 2. メモリ上キャッシュを破棄
    cachedCookies = [];
    lastKnownState = {};

    // 3. Chromium セッションデータを全クリア
    try {
      await session.defaultSession.clearStorageData();
      await session.defaultSession.clearCache();
      await session.defaultSession.clearAuthCache();
    } catch (e) {
      console.warn('[STSen:Reset] Failed to clear session data:', e.message);
    }

    // 4. 旧設定ディレクトリ (PREV_CONFIG_DIR) を完全削除
    if (fs.existsSync(PREV_CONFIG_DIR)) {
      try {
        fs.rmSync(PREV_CONFIG_DIR, { recursive: true, force: true });
        console.log('[STSen:Reset] Deleted PREV_CONFIG_DIR:', PREV_CONFIG_DIR);
      } catch (e) {
        console.error('[STSen:Reset] Failed to delete PREV_CONFIG_DIR:', e);
      }
    }

    // 5. 開発フォルダ内の旧 cookies.json があれば削除
    if (fs.existsSync(OLD_COOKIE_FILE)) {
      try {
        fs.unlinkSync(OLD_COOKIE_FILE);
        console.log('[STSen:Reset] Deleted old cookies.json in app directory.');
      } catch (e) {}
    }

    // 6. 設定ファイルおよびディレクトリ内データの削除
    if (fs.existsSync(COOKIE_FILE)) {
      try { fs.unlinkSync(COOKIE_FILE); } catch (e) {}
    }
    if (fs.existsSync(STORAGE_FILE)) {
      try { fs.unlinkSync(STORAGE_FILE); } catch (e) {}
    }

    const browserProfileDir = path.join(CONFIG_DIR, 'browser-profile');
    if (fs.existsSync(browserProfileDir)) {
      try { fs.rmSync(browserProfileDir, { recursive: true, force: true }); } catch (e) {}
    }

    // CONFIG_DIR 配下の全ファイルを可能な限り削除
    if (fs.existsSync(CONFIG_DIR)) {
      try {
        const entries = fs.readdirSync(CONFIG_DIR);
        for (const entry of entries) {
          const target = path.join(CONFIG_DIR, entry);
          try {
            fs.rmSync(target, { recursive: true, force: true });
          } catch (err) {
            console.warn(`[STSen:Reset] Note: could not remove locked item ${entry}:`, err.message);
          }
        }
      } catch (e) {}
    }

    // 7. 完了ダイアログの表示
    await dialog.showMessageBox({
      type: 'info',
      title: '初期化完了',
      message: 'すべての設定とデータを完全に消去しました。',
      detail: 'アプリケーションを終了します。次回起動時は初期状態で起動します。',
      buttons: ['OK']
    });

    console.log('[STSen:Reset] Reset complete. Exiting application now.');
    app.exit(0);
    return { success: true };
  } catch (err) {
    console.error('[STSen:Reset] Unexpected error during reset:', err);
    await dialog.showMessageBox({
      type: 'error',
      title: 'エラー',
      message: '完全初期化中にエラーが発生しました。',
      detail: err.message,
      buttons: ['OK']
    });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-liveinfo', async (event, lvid) => {
  console.log(`[IPC:get-liveinfo] Requested for lvid: "${lvid}"`);
  const strId = String(lvid);
  const idWithLv = strId.startsWith('lv') ? strId : `lv${strId}`;
  const idWithoutLv = strId.replace(/^lv/, '');
  let info = liveProp[strId] || liveProp[idWithLv] || liveProp[idWithoutLv] || null;
  if (!info && strId && strId !== '0' && strId !== 'lv0') {
    info = await fetchLiveInfoDirect(idWithLv);
  }
  return info;
});

ipcMain.handle('get-all-liveinfo', () => liveProp);

ipcMain.handle('open-login-window', async () => {
  console.log('[STSen] IPC: open-login-window received. Starting browser login...');
  try {
    await openEdgeLogin();
    return { success: true };
  } catch (err) {
    console.error('[STSen] Error during openEdgeLogin():', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('logout', async () => {
  return await logout();
});


ipcMain.handle('set-user-session', async (event, sessionValue) => {
  const cleanVal = (sessionValue || '').trim();
  if (!cleanVal) return { success: false, error: 'セッション値が空です' };

  let token = cleanVal;
  const match = cleanVal.match(/user_session=([^;\s]+)/);
  if (match) {
    token = match[1];
  }

  console.log('[STSen] Manually setting user_session...');
  const cookieObj = {
    name: 'user_session',
    value: token,
    domain: '.nicovideo.jp',
    path: '/',
    secure: true,
    httpOnly: true,
    expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  };

  await updateCookies([cookieObj]);
  broadcastAccountStatus();

  const status = await getAccountStatus();
  return {
    success: status.loggedIn,
    user: status.user
  };
});

ipcMain.handle('get-account-status', async () => {
  return await getAccountStatus();
});

ipcMain.handle('load-live', async (event, lvid) => {
  const strId = String(lvid).trim();
  if (!strId) return null;
  const idWithLv = strId.startsWith('lv') ? strId : `lv${strId}`;
  console.log(`[STSen] Manual load-live requested for: ${idWithLv}`);
  await fetchLiveInfoDirect(idWithLv);
  createOrFocusMainWindow(idWithLv);
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

ipcMain.handle('detect-current-live', async () => {
  return await fetchMyCurrentLiveInfo();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.on('get-app-version-sync', (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.handle('show-about-dialog', async () => {
  const version = app.getVersion();
  const focusedWin = BrowserWindow.getFocusedWindow() || mainWindow;
  await dialog.showMessageBox(focusedWin || null, {
    type: 'info',
    title: 'バージョン情報',
    message: `NicoLive Helper Standalone (STSen)`,
    detail: `バージョン: v${version}\nElectron: ${process.versions.electron}\nChromium: ${process.versions.chrome}\nNode.js: ${process.versions.node}\nUserData: ${CONFIG_DIR}`,
    buttons: ['OK']
  });
});

// -------------------------------------------------------------
// リモートホスト関連 IPC
// -------------------------------------------------------------
ipcMain.on('remote-host-state-update', (event, state) => {
  lastKnownState = Object.assign(lastKnownState, state);
  if (remoteServer) {
    remoteServer.broadcast('state-update', state);
  }
});

ipcMain.on('remote-host-broadcast-event', (event, { type, data }) => {
  if (remoteServer) {
    remoteServer.broadcast(type, data);
  }
});

ipcMain.handle('remote-server-update-config', async (event, { enabled, port, password }) => {
  const store = loadStorageFile();
  store.config = store.config || {};
  if (enabled !== undefined) store.config['remote-server-enabled'] = enabled;
  if (port !== undefined) store.config['remote-server-port'] = port;
  if (password !== undefined) store.config['remote-server-password'] = password;
  saveStorageFile(store);
  initRemoteServer();
  return {
    running: remoteServer ? remoteServer.running : false,
    port: remoteServer ? remoteServer.port : port,
    hasPassword: !!(remoteServer && remoteServer.password)
  };
});

ipcMain.handle('get-remote-server-status', async () => {
  return {
    running: remoteServer ? remoteServer.running : false,
    port: remoteServer ? remoteServer.port : 18767,
    hasPassword: !!(remoteServer && remoteServer.password)
  };
});

// クライアント側（操作側）がホストに同期するためのCookie取得
ipcMain.handle('get-cookies-for-sync', async () => {
  const cookies = await session.defaultSession.cookies.get({ domain: 'nicovideo.jp' });
  return cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    expirationDate: c.expirationDate
  }));
});

// アプリ起動フロー
app.whenReady().then(async () => {
  console.log('[STSen] App is ready.');

  setupRequestHeaderInterceptor();
  await restoreSavedCookies();

  initRemoteServer();

  // 起動時に最新の放送中の配信に自動接続する設定をチェック
  let initialLvid = '';
  const storageData = loadStorageFile();
  const config = storageData.config || {};
  const autoConnect = config['auto-connect-on-start'] !== false;
  if (autoConnect) {
    try {
      const detected = await fetchMyCurrentLiveInfo();
      if (detected && detected.lvid) {
        initialLvid = detected.lvid;
        console.log(`[STSen] Auto-connecting to current active live on startup: ${initialLvid}`);
      }
    } catch (e) {
      console.warn('[STSen] Failed to auto-detect live on startup:', e);
    }
  }

  createOrFocusMainWindow(initialLvid);

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
