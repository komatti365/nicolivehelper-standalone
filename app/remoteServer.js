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
        console.log('[STSen:RemoteHost] WARNING: Password authentication is DISABLED (Open access).');
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

  // 認証チェックヘルパー
  _isAuthorized(req, parsedUrl) {
    if (!this.password) return true;
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      if (authHeader.slice(7) === this.password) return true;
    }
    if (parsedUrl.searchParams && parsedUrl.searchParams.get('token') === this.password) {
      return true;
    }
    return false;
  }

  _sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
  }

  // HTTP リクエスト処理
  async _handleHttpRequest(req, res) {
    const parsed = new URL(req.url, 'http://127.0.0.1');

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      res.end();
      return;
    }

    const pathname = parsed.pathname;

    // ヘルスチェック (認証不要)
    if (pathname === '/api/ping' || pathname === '/') {
      return this._sendJson(res, 200, {
        app: 'STSen-RemoteHost',
        status: 'ok',
        requiresAuth: !!this.password,
        version: '1.0.0'
      });
    }

    // 認証 API (トークン検証)
    if (pathname === '/api/auth' && req.method === 'POST') {
      const body = await this._readBody(req);
      if (!this.password || body.password === this.password) {
        return this._sendJson(res, 200, { success: true, token: this.password });
      } else {
        return this._sendJson(res, 401, { success: false, error: 'パスワードが一致しません' });
      }
    }

    // 以降のエンドポイントは認証が必要
    if (!this._isAuthorized(req, parsed)) {
      return this._sendJson(res, 401, { success: false, error: 'Unauthorized: パスワードが必要です' });
    }

    // 状態取得
    if (pathname === '/api/status' && req.method === 'GET') {
      const state = this.getState ? this.getState() : {};
      return this._sendJson(res, 200, { success: true, state });
    }

    // セッション同期 (手元PCからCookieを受信して適用)
    if (pathname === '/api/session/sync' && req.method === 'POST') {
      try {
        const body = await this._readBody(req);
        if (Array.isArray(body.cookies) && this.onSyncCookies) {
          const result = await this.onSyncCookies(body.cookies);
          return this._sendJson(res, 200, { success: true, result });
        }
        return this._sendJson(res, 400, { success: false, error: 'Invalid cookies array' });
      } catch (e) {
        return this._sendJson(res, 500, { success: false, error: e.message });
      }
    }

    // ホスト側ログアウト
    if (pathname === '/api/session/logout' && req.method === 'POST') {
      try {
        if (this.onLogout) {
          const result = await this.onLogout();
          return this._sendJson(res, 200, { success: true, result });
        }
        return this._sendJson(res, 200, { success: true });
      } catch (e) {
        return this._sendJson(res, 500, { success: false, error: e.message });
      }
    }

    // アクション実行
    if (pathname === '/api/action' && req.method === 'POST') {
      try {
        const body = await this._readBody(req);
        if (!body.action) {
          return this._sendJson(res, 400, { success: false, error: 'action is required' });
        }
        if (this.onAction) {
          const result = await this.onAction(body.action, body.params || {});
          return this._sendJson(res, 200, { success: true, result });
        }
        return this._sendJson(res, 200, { success: true });
      } catch (e) {
        return this._sendJson(res, 500, { success: false, error: e.message });
      }
    }

    this._sendJson(res, 404, { success: false, error: 'Not Found' });
  }

  // WebSocket 接続処理
  _handleWsConnection(ws, req) {
    const parsed = new URL(req.url, 'http://127.0.0.1');
    let authenticated = !this.password;

    // クエリパラメータでの認証チェック
    if (this.password && parsed.searchParams && parsed.searchParams.get('token') === this.password) {
      authenticated = true;
    }

    if (authenticated) {
      this.clients.add(ws);
      console.log(`[STSen:RemoteHost] Client authenticated via WebSocket. Total: ${this.clients.size}`);
      // 初期状態をプッシュ
      const state = this.getState ? this.getState() : {};
      ws.send(JSON.stringify({ type: 'init-state', data: state }));
    } else {
      console.log('[STSen:RemoteHost] WebSocket client connected. Awaiting auth message...');
      ws.send(JSON.stringify({ type: 'auth-required' }));
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // 認証メッセージ
        if (msg.type === 'auth') {
          if (!this.password || msg.password === this.password) {
            authenticated = true;
            this.clients.add(ws);
            console.log(`[STSen:RemoteHost] Client successfully authenticated via message. Total: ${this.clients.size}`);
            ws.send(JSON.stringify({ type: 'auth-success' }));
            const state = this.getState ? this.getState() : {};
            ws.send(JSON.stringify({ type: 'init-state', data: state }));
          } else {
            console.warn('[STSen:RemoteHost] Client auth failed (wrong password).');
            ws.send(JSON.stringify({ type: 'auth-failure', error: 'パスワードが一致しません' }));
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
