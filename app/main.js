process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

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
const CONFIG_DIR = path.join(app.getPath('appData'), 'STSen-NicoLiveHelper');
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
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
let loginWindow = null;
let latestLvid = '';
const subWindows = new Map();
const liveProp = {};
const activeExtensions = new Set();
let wss = null;
const WS_PORT = 18765;

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
      const cookieHeader = cachedCookies.map(c => `${c.name}=${c.value}`).join('; ');
      const res = await fetch('https://nvapi.nicovideo.jp/v1/users/me', {
        headers: {
          'X-Frontend-Id': '6',
          'X-Frontend-Version': '0',
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
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
// 内蔵ブラウザによるニコニコ公式ログインウィンドウ
// -------------------------------------------------------------
function openLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 650,
    height: 750,
    minWidth: 450,
    minHeight: 600,
    parent: mainWindow || undefined,
    modal: false,
    title: 'ニコニコログイン - New NicoLive Helper',
    icon: path.join(__dirname, 'src', 'icons', 'icon-96.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      preload: path.join(__dirname, 'login-preload.js'),
      webSecurity: true
    }
  });

  loginWindow.setMenuBarVisibility(false);

  // 実機 Chrome と完全一致する自然な User-Agent (Electron 痕跡を除去)
  const defaultUA = loginWindow.webContents.getUserAgent();
  const cleanUA = defaultUA
    .replace(/new-nicolive-helper\/[^\s]+\s?/g, '')
    .replace(/Electron\/[^\s]+\s?/g, '')
    .trim();
  loginWindow.webContents.setUserAgent(cleanUA);
  console.log('[STSen:Login] Using clean User-Agent:', cleanUA);

  loginWindow.loadURL('https://account.nicovideo.jp/login?site=niconico');

  let isChecking = false;
  const checkLoginCookies = async () => {
    if (isChecking) return false;
    isChecking = true;
    try {
      const cookies = await session.defaultSession.cookies.get({ domain: 'nicovideo.jp' });
      const hasUserSession = cookies.some(c => (c.name === 'user_session' || c.name === 'user_session_secure') && c.value);
      if (hasUserSession) {
        console.log('[STSen:Login] Detected user_session cookie! Saving session...');
        await updateCookies(cookies);
        broadcastAccountStatus();

        setTimeout(() => {
          if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
          }
        }, 800);
        return true;
      }
    } catch (e) {
      console.error('[STSen:Login] Cookie check failed:', e);
    } finally {
      isChecking = false;
    }
    return false;
  };

  loginWindow.webContents.on('did-navigate', async (event, url) => {
    console.log(`[STSen:Login] Navigated: ${url}`);
    if (!url.includes('/login')) {
      await checkLoginCookies();
    }
  });

  loginWindow.webContents.on('did-navigate-in-page', async (event, url) => {
    if (!url.includes('/login')) {
      await checkLoginCookies();
    }
  });

  const cookieChangeListener = async (event, cookie, cause, removed) => {
    if (!removed && (cookie.name === 'user_session' || cookie.name === 'user_session_secure')) {
      console.log(`[STSen:Login] Cookie event: ${cookie.name} set!`);
      await checkLoginCookies();
    }
  };
  session.defaultSession.cookies.on('changed', cookieChangeListener);

  loginWindow.on('closed', () => {
    loginWindow = null;
    session.defaultSession.cookies.removeListener('changed', cookieChangeListener);
  });
}

// -------------------------------------------------------------
// 配信情報の直接取得 (拡張機能なしでの枠読み込み対応)
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
}

// -------------------------------------------------------------
// WebSocket サーバー (ポート 18765)
// -------------------------------------------------------------
function initWebSocketServer() {
  try {
    wss = new WebSocket.Server({
      port: WS_PORT,
      verifyClient: () => true
    });

    console.log(`[STSen WebSocket] Server listening on ws://127.0.0.1:${WS_PORT}`);

    wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress;
      console.log(`[STSen WebSocket] Browser extension connected from ${ip}`);
      activeExtensions.add(ws);

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          await handleExtensionMessage(data, ws);
        } catch (err) {
          console.error('[STSen WebSocket] Message parse error:', err);
        }
      });

      ws.on('close', () => {
        console.log('[STSen WebSocket] Browser extension disconnected');
        activeExtensions.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('[STSen WebSocket] Socket error:', err);
        activeExtensions.delete(ws);
      });

      ws.send(JSON.stringify({ cmd: 'welcome', version: '1.0.0' }));
    });

    wss.on('error', (err) => {
      console.error('[STSen WebSocket] Server error:', err);
    });
  } catch (err) {
    console.error('[STSen WebSocket] Failed to start WebSocket server:', err);
  }
}

async function handleExtensionMessage(data, ws) {
  if (!data || !data.cmd) return;

  console.log(`[STSen WebSocket] Received cmd: ${data.cmd}`);

  switch (data.cmd) {
    case 'sync-cookies': {
      if (Array.isArray(data.cookies)) {
        console.log(`[STSen] Received ${data.cookies.length} cookies from browser extension.`);
        const hasSession = await updateCookies(data.cookies);
        broadcastAccountStatus();
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
    width: 820,
    height: 640,
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

// -------------------------------------------------------------

// -------------------------------------------------------------
// -------------------------------------------------------------
// Chromium 系実機ブラウザ（Edge, Chrome, Brave, Vivaldi, Opera 等）の自動検出
// -------------------------------------------------------------
function getChromiumBrowserPath() {
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

  // 2. レジストリ（App Paths）からの検索フォールバック
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

  return null;
}

let edgeLoginProcess = null;
let edgeCdpWs = null;

async function openEdgeLogin() {
  if (edgeLoginProcess) {
    console.log('[STSen:EdgeLogin] Edge login process is already running.');
    return;
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
      detail: 'Cloudflare Turnstile等のセキュリティ認証を安全に通過してログインを完了するため、Google Chromeのインストールをおすすめします。\\n\\n公式ダウンロードページを開きますか？'
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

  const CDP_PORT = 18766;
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${browserProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--app=https://account.nicovideo.jp/login?site=niconico'
  ];

  console.log(`[STSen:EdgeLogin] Launching Edge: ${edgeExe}`);
  const { spawn } = require('child_process');
  edgeLoginProcess = spawn(edgeExe, args);

  edgeLoginProcess.on('error', (err) => {
    console.error('[STSen:EdgeLogin] Failed to start Edge process:', err);
    edgeLoginProcess = null;
  });

  edgeLoginProcess.on('exit', (code) => {
    console.log(`[STSen:EdgeLogin] Edge process exited with code: ${code}`);
    edgeLoginProcess = null;
    if (edgeCdpWs) {
      try { edgeCdpWs.close(); } catch (e) {}
      edgeCdpWs = null;
    }
  });

  let attempts = 0;
  const maxAttempts = 30;
  const pollInterval = 500;

  const waitForCdp = async () => {
    if (!edgeLoginProcess) return;

    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (res.ok) {
        const targets = await res.json();
        const pageTarget = targets.find(t => t.type === 'page');
        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          console.log('[STSen:EdgeLogin] Found page target, connecting to CDP WebSocket...');
          startCdpMonitoring(pageTarget.webSocketDebuggerUrl);
          return;
        }
      }
    } catch (e) {}

    attempts++;
    if (attempts < maxAttempts && edgeLoginProcess) {
      setTimeout(waitForCdp, pollInterval);
    } else if (edgeLoginProcess) {
      console.warn('[STSen:EdgeLogin] Timed out waiting for CDP port.');
    }
  };

  setTimeout(waitForCdp, 1000);
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
    console.log('[STSen:EdgeLogin] Connected to CDP WebSocket! Starting cookie check...');
    edgeCdpWs.send(JSON.stringify({ id: msgId++, method: 'Network.enable' }));

    checkTimer = setInterval(() => {
      if (edgeCdpWs && edgeCdpWs.readyState === WebSocket.OPEN) {
        edgeCdpWs.send(JSON.stringify({
          id: 100,
          method: 'Network.getCookies',
          params: { urls: ['https://nicovideo.jp', 'https://account.nicovideo.jp'] }
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
          console.log('[STSen:EdgeLogin] user_session detected in Edge! Saving session...');
          clearInterval(checkTimer);

          await updateCookies(cookies);
          broadcastAccountStatus();

          // 1秒待ってEdgeを自動クローズ
          setTimeout(() => {
            if (edgeLoginProcess) {
              console.log('[STSen:EdgeLogin] Closing Edge window automatically.');
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
    clearInterval(checkTimer);
    edgeCdpWs = null;
  });

  edgeCdpWs.on('error', (err) => {
    console.error('[STSen:EdgeLogin] CDP WebSocket error:', err.message);
    clearInterval(checkTimer);
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

ipcMain.handle('open-login-window', () => {
  openEdgeLogin();
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

// アプリ起動フロー
app.whenReady().then(async () => {
  console.log('[STSen] App is ready.');

  setupRequestHeaderInterceptor();
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
