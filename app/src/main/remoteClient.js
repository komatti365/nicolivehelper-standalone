/**
 * remoteClient.js
 * 手元の STSen-Extension からリモートホスト（Linuxサーバーや別PC）に接続し、
 * ホストの状態を手元画面に同期表示し、手元の操作をホストへ送信するコントローラー。
 */

window.RemoteClient = {
  ws: null,
  connected: false,
  hostUrl: '',
  password: '',
  _actionCallbacks: new Map(),
  _actionIdCounter: 1,
  _localBackup: null,

  // 接続中かどうか
  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  },

  // リモートホストへの接続開始
  connect(targetHost, password = '') {
    return new Promise((resolve, reject) => {
      if (this.isConnected()) {
        this.disconnect();
      }

      let wsUrl = targetHost.trim();
      if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
        if (wsUrl.startsWith('http://')) {
          wsUrl = wsUrl.replace('http://', 'ws://');
        } else if (wsUrl.startsWith('https://')) {
          wsUrl = wsUrl.replace('https://', 'wss://');
        } else {
          wsUrl = `ws://${wsUrl}`;
        }
      }

      // ポート指定がない場合はデフォルト 18767
      try {
        const parsed = new URL(wsUrl);
        if (!parsed.port) {
          wsUrl = `${parsed.protocol}//${parsed.hostname}:18767`;
        }
      } catch (e) {}

      console.log(`[RemoteClient] Connecting to ${wsUrl}...`);
      this.hostUrl = wsUrl;
      this.password = password;

      let isSettled = false;
      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try { this.ws.close(); } catch (e) {}
          reject(new Error('接続タイムアウト（ホストが見つかりません）'));
        }
      }, 8000);

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        clearTimeout(timeout);
        return reject(err);
      }

      this.ws.onopen = () => {
        console.log('[RemoteClient] WebSocket opened. Sending auth or awaiting handshake...');
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          // 認証要求
          if (msg.type === 'auth-required') {
            if (this.password) {
              this.ws.send(JSON.stringify({ type: 'auth', password: this.password }));
            } else {
              if (!isSettled) {
                isSettled = true;
                clearTimeout(timeout);
                reject(new Error('ホスト側でパスワードが設定されています。パスワードを入力してください。'));
              }
            }
            return;
          }

          // 認証失敗
          if (msg.type === 'auth-failure') {
            if (!isSettled) {
              isSettled = true;
              clearTimeout(timeout);
              reject(new Error(msg.error || '認証に失敗しました（パスワード不一致）'));
            }
            return;
          }

          // 認証成功
          if (msg.type === 'auth-success') {
            console.log('[RemoteClient] Authenticated successfully with remote host.');
          }

          // 初期状態受信（接続完了）
          if (msg.type === 'init-state') {
            if (!isSettled) {
              isSettled = true;
              clearTimeout(timeout);
              this.connected = true;
              this._onConnected();
              resolve({ success: true, host: this.hostUrl });
            }
            if (msg.data) {
              this.applyRemoteState(msg.data);
            }
            return;
          }

          // リアルタイム状態更新
          if (msg.type === 'state-update' && msg.data) {
            this.applyRemoteState(msg.data);
            return;
          }

          // 再生進捗のリアルタイム受信
          if (msg.type === 'playback-progress' && msg.data) {
            this.applyPlaybackProgress(msg.data);
            return;
          }

          // コメント受信
          if (msg.type === 'comment' && msg.data) {
            this.applyComment(msg.data);
            return;
          }

          // アクション実行結果
          if (msg.type === 'action-result') {
            const cb = this._actionCallbacks.get(msg.actionId);
            if (cb) {
              this._actionCallbacks.delete(msg.actionId);
              if (msg.success) {
                cb.resolve(msg.result);
              } else {
                cb.reject(new Error(msg.error || 'Action failed'));
              }
            }
            return;
          }

          // セッション同期結果
          if (msg.type === 'sync-cookies-result') {
            console.log('[RemoteClient] Session sync completed on host:', msg.result);
            return;
          }
        } catch (e) {
          console.error('[RemoteClient] Message handling error:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[RemoteClient] WebSocket connection closed.');
        const wasConnected = this.connected;
        this.connected = false;
        this._onDisconnected(wasConnected);
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          reject(new Error('接続が切断されました'));
        }
      };

      this.ws.onerror = (err) => {
        console.error('[RemoteClient] WebSocket error:', err);
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          reject(new Error('接続に失敗しました'));
        }
      };
    });
  },

  // 接続切断
  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
    this._onDisconnected(true);
  },

  // リモートコマンドの送信
  sendAction(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        return reject(new Error('リモートホストに接続されていません'));
      }
      const actionId = `client_act_${this._actionIdCounter++}_${Date.now()}`;
      this._actionCallbacks.set(actionId, { resolve, reject });

      const timer = setTimeout(() => {
        if (this._actionCallbacks.has(actionId)) {
          this._actionCallbacks.delete(actionId);
          reject(new Error(`操作タイムアウト: ${action}`));
        }
      }, 15000);

      try {
        this.ws.send(JSON.stringify({
          type: 'action',
          actionId,
          action,
          params
        }));
      } catch (err) {
        clearTimeout(timer);
        this._actionCallbacks.delete(actionId);
        reject(err);
      }
    });
  },

  // ログインセッションの自動同期（手元PCのCookieをホストへ送信）
  async syncLoginSession() {
    if (!this.isConnected() || typeof window.stsen === 'undefined' || !window.stsen.getCookiesForSync) return;
    try {
      const cookies = await window.stsen.getCookiesForSync();
      if (Array.isArray(cookies) && cookies.length > 0) {
        console.log(`[RemoteClient] Syncing ${cookies.length} cookies to remote host...`);
        this.ws.send(JSON.stringify({
          type: 'sync-cookies',
          cookies: cookies
        }));
      }
    } catch (e) {
      console.error('[RemoteClient] Failed to sync login cookies:', e);
    }
  },

  // 接続完了時のUI処理
  _onConnected() {
    console.log('[RemoteClient] Successfully connected to remote host!');
    // 接続先バッジ表示
    $('#remote-connection-badge')
      .show()
      .removeClass('badge-secondary badge-danger')
      .addClass('badge-success')
      .html(`🌐 リモート接続中: <strong style="font-weight: bold;">${this.hostUrl.replace(/^wss?:\/\//, '')}</strong>`);

    $('#btn-remote-connect-open').addClass('btn-success').removeClass('btn-outline-primary');

    // 接続時にログインセッションを自動同期
    this.syncLoginSession();

    // 接続成功メッセージ
    if (typeof Toast !== 'undefined' && Toast.show) {
      Toast.show('リモートホストに接続しました');
    }
  },

  // 切断時のUI処理
  _onDisconnected(wasConnected) {
    $('#remote-connection-badge').hide();
    $('#btn-remote-connect-open').removeClass('btn-success').addClass('btn-outline-primary');
    if (wasConnected) {
      console.log('[RemoteClient] Restoring local state or reconnecting...');
      // 画面をローカル状態へ復帰
      if (typeof NicoLiveStock !== 'undefined' && NicoLiveStock.createTable) {
        NicoLiveStock.createTable();
      }
      if (typeof NicoLiveRequest !== 'undefined' && NicoLiveRequest.createTable) {
        NicoLiveRequest.createTable();
      }
      if (typeof NicoLiveHelper !== 'undefined') {
        $('#community-id').text(NicoLiveHelper.liveProp && NicoLiveHelper.liveProp.community ? NicoLiveHelper.liveProp.community.id : 'co000000');
        $('#live-title').text(NicoLiveHelper.liveProp && NicoLiveHelper.liveProp.program ? NicoLiveHelper.liveProp.program.title : '[オフライン]');
      }
    }
  },

  // ホスト側の全状態を手元UIに適用
  applyRemoteState(state) {
    if (!state) return;

    // 1. 枠情報
    if (state.liveInfo) {
      const info = state.liveInfo;
      $('#live-title').text(info.title ? `[リモート] ${info.title}` : '[リモート: オフライン]');
      $('#community-id').text(info.communityId || 'co------');
      $('#live-caster').text(info.casterName || '---');
      if (info.lvid) {
        $('#input-manual-lvid').val(info.lvid);
      }
    }

    // 2. 再生中動画
    if (state.currentVideo) {
      const v = state.currentVideo;
      $('#remaining-time-main').text(v.progressText || `${v.title} (再生中)`);
      if (v.progressWidth) {
        $('#progressbar-main').css('width', v.progressWidth);
      }
    } else {
      $('#remaining-time-main').text('---(-0:00)');
      $('#progressbar-main').css('width', '0%');
    }

    // 3. ストック一覧の同期描画
    if (Array.isArray(state.stocks)) {
      this.renderStocks(state.stocks);
    }

    // 4. リクエスト一覧の同期描画
    if (Array.isArray(state.requests)) {
      this.renderRequests(state.requests);
    }

    // 5. 設定（プレイスタイル、リクエスト許可）
    if (state.settings) {
      if (state.settings.playStyle !== undefined) {
        $('#sel-playstyle').val(String(state.settings.playStyle));
      }
      if (state.settings.allowRequest !== undefined) {
        $('#sel-allow-request').val(String(state.settings.allowRequest));
      }
    }

    // 6. コメント
    if (Array.isArray(state.recentComments)) {
      this.renderComments(state.recentComments);
    }
  },

  // 再生進捗の更新
  applyPlaybackProgress(data) {
    if (!data) return;
    if (data.progressText) {
      $('#remaining-time-main').text(data.progressText);
    }
    if (data.progressWidth) {
      $('#progressbar-main').css('width', data.progressWidth);
    }
  },

  // コメントのリアルタイム追加
  applyComment(comment) {
    if (!comment) return;
    const table = document.querySelector('#comment-table');
    if (!table) return;

    const tr = table.insertRow(0);
    tr.setAttribute('tr_comment_by', comment.userId || '');

    const dateStr = comment.date ? new Date(comment.date * 1000).toLocaleTimeString() : '';
    const noCell = tr.insertCell();
    noCell.className = 'nico-comment-no';
    noCell.textContent = comment.no || '';

    const nameCell = tr.insertCell();
    nameCell.className = 'nico-user-name';
    nameCell.textContent = comment.userName || comment.userId || '';

    const textCell = tr.insertCell();
    textCell.className = 'nico-comment-text';
    textCell.textContent = comment.text || '';

    const dateCell = tr.insertCell();
    dateCell.className = 'nico-comment-date';
    dateCell.textContent = dateStr;

    // 表示行数制限
    const maxLines = (typeof Config !== 'undefined' && Config['comment-dispay-lines']) || 100;
    while (table.rows.length > maxLines) {
      table.deleteRow(table.rows.length - 1);
    }
  },

  // ストック一覧の描画
  renderStocks(stocks) {
    $('#number-of-stocks').text(stocks.filter(s => !s.isPlayed && !s.noLivePlay).length);
    const tbody = $('#stock-table-body');
    tbody.empty();

    let totalLengthMs = 0;
    stocks.forEach((s, i) => {
      totalLengthMs += (s.lengthMs || 0);
      const row = $(`
        <tr class="stock-item ${s.isPlayed ? 'is-played' : ''}" data-index="${i}" data-video-id="${s.videoId}">
          <td class="nico-index">#${i + 1}</td>
          <td class="nico-thumbnail">
            <img src="${s.thumbnailUrl || '../icons/icon-16.png'}" style="width: 40px; height: 30px; object-fit: cover; border-radius: 2px;">
          </td>
          <td class="nico-title" style="vertical-align: middle;">
            <div style="font-weight: bold; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px;">
              ${this._escapeHtml(s.title || s.videoId)}
            </div>
            <div style="font-size: 10px; color: #6c757d;">
              ${s.videoId} | ${this._formatDuration(s.lengthMs)}
            </div>
          </td>
          <td style="vertical-align: middle; text-align: right; white-space: nowrap;">
            <button class="btn btn-sm btn-outline-primary btn-remote-play-this p-0 px-1" title="この動画を即時再生" data-video-id="${s.videoId}">再生</button>
            <button class="btn btn-sm btn-outline-danger btn-remote-stock-remove p-0 px-1" title="ストックから削除" data-index="${i}">×</button>
          </td>
        </tr>
      `);
      tbody.append(row);
    });

    const totalSec = Math.floor(totalLengthMs / 1000);
    const m = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    $('#total-stock-time').text(`${m}分${sec < 10 ? '0' : ''}${sec}秒`);

    // イベントバインド
    tbody.find('.btn-remote-play-this').on('click', (e) => {
      e.stopPropagation();
      const vid = $(e.currentTarget).data('video-id');
      this.sendAction('play-video', { videoId: vid });
    });
    tbody.find('.btn-remote-stock-remove').on('click', (e) => {
      e.stopPropagation();
      const idx = $(e.currentTarget).data('index');
      this.sendAction('stock-remove', { index: idx });
    });
  },

  // リクエスト一覧の描画
  renderRequests(requests) {
    $('#number-of-requests').text(requests.length);
    const tbody = $('#request-table-body');
    tbody.empty();

    let totalLengthMs = 0;
    requests.forEach((r, i) => {
      totalLengthMs += (r.lengthMs || 0);
      const row = $(`
        <tr class="request-item" data-index="${i}" data-video-id="${r.videoId}">
          <td class="nico-index">#${i + 1}</td>
          <td class="nico-thumbnail">
            <img src="${r.thumbnailUrl || '../icons/icon-16.png'}" style="width: 40px; height: 30px; object-fit: cover; border-radius: 2px;">
          </td>
          <td class="nico-title" style="vertical-align: middle;">
            <div style="font-weight: bold; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px;">
              ${this._escapeHtml(r.title || r.videoId)}
            </div>
            <div style="font-size: 10px; color: #6c757d;">
              ${r.videoId} | ${this._formatDuration(r.lengthMs)} | リクエスト: ${this._escapeHtml(r.userName || r.userId || '')}
            </div>
          </td>
          <td style="vertical-align: middle; text-align: right; white-space: nowrap;">
            <button class="btn btn-sm btn-outline-success btn-remote-req-adopt p-0 px-1" title="ストックへ採用" data-index="${i}">採用</button>
            <button class="btn btn-sm btn-outline-danger btn-remote-req-remove p-0 px-1" title="リクエスト削除" data-index="${i}">×</button>
          </td>
        </tr>
      `);
      tbody.append(row);
    });

    const totalSec = Math.floor(totalLengthMs / 1000);
    const m = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    $('#total-request-time').text(`${m}分${sec < 10 ? '0' : ''}${sec}秒`);

    tbody.find('.btn-remote-req-adopt').on('click', (e) => {
      e.stopPropagation();
      const idx = $(e.currentTarget).data('index');
      this.sendAction('request-adopt', { index: idx });
    });
    tbody.find('.btn-remote-req-remove').on('click', (e) => {
      e.stopPropagation();
      const idx = $(e.currentTarget).data('index');
      this.sendAction('request-remove', { index: idx });
    });
  },

  // コメント履歴の描画
  renderComments(comments) {
    const table = document.querySelector('#comment-table');
    if (!table) return;
    $(table).empty();
    comments.slice().reverse().forEach(c => {
      this.applyComment(c);
    });
  },

  _formatDuration(ms) {
    if (!ms) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  },

  _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

// ログイン状態変更の監視（手元でログインした際にホストへ自動同期）
window.addEventListener('stsen-account-status-changed', (e) => {
  if (window.RemoteClient && window.RemoteClient.isConnected()) {
    console.log('[RemoteClient] Account status changed. Syncing session to remote host...');
    window.RemoteClient.syncLoginSession();
  }
});
