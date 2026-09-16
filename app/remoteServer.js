const http = require('http');
const WebSocket = require('ws');
const url = require('url');

class RemoteServer {
  constructor(options = {}) {
    this.port = options.port || 18767;
    this.password = options.password || '';
    this.onAction = options.onAction || null; // async (action, params) => result
    this.onSyncCookies = options.onSyncCookies || null; // async (cookies) => result
    this.onLogout = options.onLogout || null; // async () => result
    this.getState = options.getState || (() => ({})); // () => currentState

    this.httpServer = null;
    this.wss = null;
    this.clients = new Set(); // authenticated ws clients
    this.running = false;
  }

  start() {
    if (this.running) return;

    this.httpServer = http.createServer((req, res) => {
      this._handleHttpRequest(req, res);
    });

    this.wss = new WebSocket.Server({ noServer: true });

    this.httpServer.on('upgrade', (req, socket, head) => {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      if (parsed.pathname === '/ws' || parsed.pathname === '/') {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws, req) => {
      this._handleWsConnection(ws, req);
    });

    this.httpServer.listen(this.port, '0.0.0.0', () => {
      this.running = true;
      console.log(`[STSen:RemoteHost] Server listening on http://0.0.0.0:${this.port} (WebSocket enabled)`);
      if (this.password) {
        console.log('[STSen:RemoteHost] Password authentication is ENABLED.');
      } else {
        console.warn('[STSen:RemoteHost] WARNING: No password configured. Remote server will reject unauthorized requests until a password is set.');
      }
    });

    this.httpServer.on('error', (err) => {
      console.error('[STSen:RemoteHost] Server error:', err);
    });
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    for (const client of this.clients) {
      try { client.close(); } catch (e) {}
    }
    this.clients.clear();

    if (this.wss) {
      try { this.wss.close(); } catch (e) {}
      this.wss = null;
    }
    if (this.httpServer) {
      try { this.httpServer.close(); } catch (e) {}
      this.httpServer = null;
    }
    console.log('[STSen:RemoteHost] Server stopped.');
  }

  updateConfig(port, password) {
    const portChanged = port && port !== this.port;
    this.port = port || this.port;
    this.password = password !== undefined ? password : this.password;

    if (portChanged && this.running) {
      this.stop();
      this.start();
    }
  }

  // ブロードキャスト: 接続中の全認証クライアントへ通知
  broadcast(type, data) {
    if (!this.running || this.clients.size === 0) return;
    const msg = JSON.stringify({ type, data, timestamp: Date.now() });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(msg);
        } catch (e) {
          console.error('[STSen:RemoteHost] Failed to send broadcast:', e);
        }
      }
    }
  }

  // 認証チェックヘルパー (パスワード必須 & Bearer トークンのみ許可)
  _isAuthorized(req) {
    if (!this.password) return false;
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7) === this.password;
    }
    return false;
  }

  _getCorsHeaders(req) {
    const origin = req.headers['origin'] || '';
    let allowOrigin = '';
    // 外部サイトからの CSRF / 攻撃を防止。ローカルまたはデスクトップオリジンのみ許可
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.startsWith('file://')) {
      allowOrigin = origin || '*';
    }
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    if (allowOrigin) {
      headers['Access-Control-Allow-Origin'] = allowOrigin;
    }
    return headers;
  }

  _sendJson(res, statusCode, data, req = null) {
    const headers = req ? this._getCorsHeaders(req) : {
      'Content-Type': 'application/json; charset=utf-8'
    };
    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(data));
  }

  // HTTP リクエスト処理
  async _handleHttpRequest(req, res) {
    const parsed = new URL(req.url, 'http://127.0.0.1');

    // CORS preflight
    if (req.method === 'OPTIONS') {
      const headers = this._getCorsHeaders(req);
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const pathname = parsed.pathname;

    // ヘルスチェック (認証不要)
    if (pathname === '/api/ping' || pathname === '/') {
      return this._sendJson(res, 200, {
        app: 'STSen-RemoteHost',
        status: 'ok',
        requiresAuth: true,
        hasPassword: !!this.password,
        version: '1.0.0'
      }, req);
    }

    // 認証 API (パスワード検証)
    if (pathname === '/api/auth' && req.method === 'POST') {
      if (!this.password) {
        return this._sendJson(res, 403, { success: false, error: 'ホスト側でパスワードが設定されていません。パスワードを設定してください。' }, req);
      }
      const body = await this._readBody(req);
      if (body.password === this.password) {
        return this._sendJson(res, 200, { success: true, token: this.password }, req);
      } else {
        return this._sendJson(res, 401, { success: false, error: 'パスワードが一致しません' }, req);
      }
    }

    // 以降のエンドポイントは認証が必要
    if (!this._isAuthorized(req)) {
      return this._sendJson(res, 401, { success: false, error: 'Unauthorized: 有効なパスワード認証が必要です' }, req);
    }

    // 状態取得
    if (pathname === '/api/status' && req.method === 'GET') {
      const state = this.getState ? this.getState() : {};
      return this._sendJson(res, 200, { success: true, state }, req);
    }

    // セッション同期 (手元PCからCookieを受信して適用)
    if (pathname === '/api/session/sync' && req.method === 'POST') {
      try {
        const body = await this._readBody(req);
        if (Array.isArray(body.cookies) && this.onSyncCookies) {
          const result = await this.onSyncCookies(body.cookies);
          return this._sendJson(res, 200, { success: true, result }, req);
        }
        return this._sendJson(res, 400, { success: false, error: 'Invalid cookies array' }, req);
      } catch (e) {
        return this._sendJson(res, 500, { success: false, error: e.message }, req);
      }
    }

    // ホスト側ログアウト
    if (pathname === '/api/session/logout' && req.method === 'POST') {
      try {
        if (this.onLogout) {
          const result = await this.onLogout();
          return this._sendJson(res, 200, { success: true, result }, req);
        }
        return this._sendJson(res, 200, { success: true }, req);
      } catch (e) {
        return this._sendJson(res, 500, { success: false, error: e.message }, req);
      }
    }

    // アクション実行
    if (pathname === '/api/action' && req.method === 'POST') {
      try {
        const body = await this._readBody(req);
        if (!body.action) {
          return this._sendJson(res, 400, { success: false, error: 'action is required' }, req);
        }
        if (this.onAction) {
          const result = await this.onAction(body.action, body.params || {});
          return this._sendJson(res, 200, { success: true, result }, req);
        }
        return this._sendJson(res, 200, { success: true }, req);
      } catch (e) {
        return this._sendJson(res, 500, { success: false, error: e.message }, req);
      }
    }

    this._sendJson(res, 404, { success: false, error: 'Not Found' }, req);
  }

  // WebSocket 接続処理 (常に認証メッセージを必須化)
  _handleWsConnection(ws, req) {
    let authenticated = false;

    console.log('[STSen:RemoteHost] WebSocket client connected. Awaiting auth message...');
    ws.send(JSON.stringify({ type: 'auth-required' }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // 認証メッセージ
        if (msg.type === 'auth') {
          if (this.password && msg.password === this.password) {
            authenticated = true;
            this.clients.add(ws);
            console.log(`[STSen:RemoteHost] Client successfully authenticated via message. Total: ${this.clients.size}`);
            ws.send(JSON.stringify({ type: 'auth-success' }));
            const state = this.getState ? this.getState() : {};
            ws.send(JSON.stringify({ type: 'init-state', data: state }));
          } else {
            console.warn('[STSen:RemoteHost] Client auth failed (wrong or unset password).');
            ws.send(JSON.stringify({ type: 'auth-failure', error: 'パスワードが一致しません（ホスト側にパスワードを設定してください）' }));
          }
          return;
        }

        if (!authenticated) {
          ws.send(JSON.stringify({ type: 'auth-required', error: 'Unauthorized' }));
          return;
        }

        // セッション同期メッセージ
        if (msg.type === 'sync-cookies' && Array.isArray(msg.cookies)) {
          console.log(`[STSen:RemoteHost] Received ${msg.cookies.length} cookies from remote client via WS`);
          if (this.onSyncCookies) {
            const res = await this.onSyncCookies(msg.cookies);
            ws.send(JSON.stringify({ type: 'sync-cookies-result', success: true, result: res }));
          }
          return;
        }

        // ホストログアウトメッセージ
        if (msg.type === 'logout') {
          if (this.onLogout) {
            await this.onLogout();
            ws.send(JSON.stringify({ type: 'logout-result', success: true }));
          }
          return;
        }

        // 状態取得リクエスト
        if (msg.type === 'get-state') {
          const state = this.getState ? this.getState() : {};
          ws.send(JSON.stringify({ type: 'init-state', data: state }));
          return;
        }

        // アクション実行メッセージ
        if (msg.type === 'action' && msg.action) {
          console.log(`[STSen:RemoteHost] WS action received: ${msg.action}`, msg.params);
          if (this.onAction) {
            try {
              const res = await this.onAction(msg.action, msg.params || {});
              ws.send(JSON.stringify({ type: 'action-result', actionId: msg.actionId, success: true, result: res }));
            } catch (err) {
              ws.send(JSON.stringify({ type: 'action-result', actionId: msg.actionId, success: false, error: err.message }));
            }
          }
          return;
        }
      } catch (e) {
        console.error('[STSen:RemoteHost] WS message parse error:', e);
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[STSen:RemoteHost] WS client disconnected. Total: ${this.clients.size}`);
    });

    ws.on('error', (err) => {
      this.clients.delete(ws);
      console.error('[STSen:RemoteHost] WS client error:', err);
    });
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 10 * 1024 * 1024) { // 10MB limit
          req.destroy();
          reject(new Error('Body too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }
}

module.exports = RemoteServer;
